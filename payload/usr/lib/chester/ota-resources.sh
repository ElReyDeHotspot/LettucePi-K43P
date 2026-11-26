#!/bin/sh
# Only the updater holding its exclusive lock may own this RAM-only journal.
OTA_RES_DIR=${OTA_RES_DIR:-/tmp/chester-ota-resources}
OTA_INIT_DIR=${OTA_INIT_DIR:-/etc/init.d}
OTA_RESTORE_RESERVE=12288
OTA_DOWNLOAD_OVERHEAD=8192

ota_available() { awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo; }
ota_identity() { awk '{print $22}' "/proc/$1/stat" 2>/dev/null; }
ota_alive() { [ "$(ota_identity "$1")" = "$2" ] && kill -0 "$1" 2>/dev/null; }
ota_note() { log "OTA preparation: $*"; }
ota_active() { "$OTA_INIT_DIR/$1" status >/dev/null 2>&1; }
ota_service_rss() {
    # Conservative restoration budget; shared pages may be counted twice.
    ubus call service list "{\"name\":\"$1\"}" 2>/dev/null |
        jsonfilter -e '@.*.instances.*.pid' 2>/dev/null |
        while read -r ota_rss_pid; do
            case "$ota_rss_pid" in ''|*[!0-9]*) continue;; esac
            awk '/^VmRSS:/ {print $2}' "/proc/$ota_rss_pid/status" 2>/dev/null
        done | awk '{n+=$1} END {print n+0}'
}
ota_reclaim_cache() {
    # Reclaim clean caches, never lower watermarks or the upgrade RAM reserve.
    sync
    [ ! -w /proc/sys/vm/drop_caches ] || printf '3\n' > /proc/sys/vm/drop_caches
}
ota_rules_hash() {
    ota_rules_tmp=$(mktemp "$OTA_RES_DIR/rules.XXXXXX") || return 1
    if ! nft -s list ruleset > "$ota_rules_tmp" 2>/dev/null; then
        rm -f "$ota_rules_tmp"; return 1
    fi
    sha256sum "$ota_rules_tmp" | cut -d ' ' -f1
    rm -f "$ota_rules_tmp"
}
ota_upgrade_active() {
    for ota_cmd in /proc/[0-9]*/cmdline; do
        ota_args=$(tr '\000' ' ' < "$ota_cmd" 2>/dev/null) || continue
        case "$ota_args" in
            */sbin/sysupgrade\ *|*/sbin/upgraded\ *|*/lib/upgrade/stage2\ *) return 0;;
        esac
    done
    return 1
}
ota_stop_download() {
    [ -s "$OTA_RES_DIR/downloader" ] || return 0
    read -r ota_download_pid ota_download_start < "$OTA_RES_DIR/downloader"
    case "$ota_download_pid:$ota_download_start" in *[!0-9:]*|:*|*:) return 0;; esac
    if ota_alive "$ota_download_pid" "$ota_download_start"; then
        kill -TERM "$ota_download_pid" 2>/dev/null || true
        ota_download_tries=0
        while ota_alive "$ota_download_pid" "$ota_download_start" && [ "$ota_download_tries" -lt 3 ]; do
            sleep 1; ota_download_tries=$((ota_download_tries+1))
        done
        if ota_alive "$ota_download_pid" "$ota_download_start"; then
            kill -KILL "$ota_download_pid" 2>/dev/null || true
        fi
    fi
}
ota_restore() (
    [ -d "$OTA_RES_DIR" ] || return 0
    # Serialize EXIT cleanup with the orphan watchdog.
    exec 8>"$OTA_RES_DIR/restore.lock"
    flock -n 8 || return 1
    [ -z "${1:-}" ] || [ "$(cat "$OTA_RES_DIR/owner" 2>/dev/null)" = "$1" ] || return 0
    ota_stop_download
    ota_restore_need=$(awk '{n+=$2} END {print n+12288}' "$OTA_RES_DIR/paused" 2>/dev/null)
    ota_restore_need=${ota_restore_need:-12288}
    if [ "$(ota_available)" -lt "$ota_restore_need" ]; then
        # Only this updater's reproducible download cache is disposable.
        # Retain partial downloads when there is enough RAM to restore services.
        rm -f "$PART" "$IMG" "$PART_URL"
        ota_note 'Released the download cache to restore normal services safely.'
    fi
    ota_restore_failed=0
    if [ -s "$OTA_RES_DIR/paused" ]; then
        while read -r ota_restore_name ota_restore_rss; do
            case "$ota_restore_name" in chester_sim|chester_traffic|ttyd) ;; *) continue;; esac
            if ! ota_active "$ota_restore_name"; then
                "$OTA_INIT_DIR/$ota_restore_name" start >/dev/null 2>&1 || true
                ota_restore_tries=0
                while ! ota_active "$ota_restore_name" && [ "$ota_restore_tries" -lt 5 ]; do
                    sleep 1; ota_restore_tries=$((ota_restore_tries+1))
                done
            fi
            if ! ota_active "$ota_restore_name"; then
                ota_note "Retry needed to restore $ota_restore_name."
                ota_restore_failed=1
            else ota_note "Restored $ota_restore_name."
            fi
        done < "$OTA_RES_DIR/paused"
    fi

    [ "$ota_restore_failed" = 0 ] || return 1
    rm -f "$OTA_RES_DIR/paused" "$OTA_RES_DIR/owner" "$OTA_RES_DIR/phase" "$OTA_RES_DIR/restore.lock" "$OTA_RES_DIR/downloader" "$OTA_RES_DIR"/rules.*
    rmdir "$OTA_RES_DIR" 2>/dev/null || true
    return 0
)
ota_watch() {
    ota_watch_owner=$1; ota_watch_start=$2
    while [ "$(cat "$OTA_RES_DIR/owner" 2>/dev/null)" = "$ota_watch_owner $ota_watch_start" ]; do
        if [ -s "$OTA_RES_DIR/downloader" ] && [ "$(ota_available)" -lt "$OTA_RESTORE_RESERVE" ]; then
            ota_note 'Stopping the download to preserve the RAM safety reserve.'
            ota_stop_download
        fi
        if ! ota_alive "$ota_watch_owner" "$ota_watch_start"; then
            if [ "$(cat "$OTA_RES_DIR/phase" 2>/dev/null)" = flashing ]; then
                # Native sysupgrade kills the parent and then this watchdog.
                # Never restart services into a real flash operation.
                sleep 30
                ota_upgrade_active && { sleep 2; continue; }
            fi
            ota_restore "$ota_watch_owner $ota_watch_start" && return 0
        fi
        sleep 2
    done
}
ota_arm() {
    [ ! -d "$OTA_RES_DIR" ] || { ota_restore || return 1; }
    umask 077
    mkdir "$OTA_RES_DIR" || return 1
    OTA_OWNER_START=$(ota_identity "$$")
    printf '%s %s\n' "$$" "$OTA_OWNER_START" > "$OTA_RES_DIR/owner"
    : > "$OTA_RES_DIR/paused"
    printf 'preparing\n' > "$OTA_RES_DIR/phase"
    OTA_FLASHING=0
    trap 'ota_exit_code=$?; trap - EXIT; [ "${OTA_FLASHING:-0}" = 1 ] || ota_restore; exit "$ota_exit_code"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    # Do not inherit the updater flock: an orphan must release its lock.
    (exec 9>&-; exec setsid "$0" recover-resources "$$" "$OTA_OWNER_START") </dev/null >/dev/null 2>&1 &
}
ota_prepare() {
    ota_wanted=$(( $1 + OTA_RESTORE_RESERVE + OTA_DOWNLOAD_OVERHEAD ))
    ota_arm || return 1
    for ota_operation in /tmp/chester-sim.lock /tmp/chester-link-test.lock /tmp/chester-ipv6.lock /tmp/chester-mtu.lock; do
        [ ! -e "$ota_operation" ] || { ota_note 'A cellular operation is still running.'; return 1; }
    done
    [ "$(ota_available)" -lt "$ota_wanted" ] || return 0
    ota_reclaim_cache
    # SIM polling, connection telemetry, browser terminal. No Wi-Fi, firewall,
    # routing, DNS, SSH, VPN, web UI or modem data-session services are stopped.
    for ota_service in chester_sim chester_traffic ttyd; do
        [ "$(ota_available)" -lt "$ota_wanted" ] || break
        [ -x "$OTA_INIT_DIR/$ota_service" ] && ota_active "$ota_service" || continue
        ota_rss=$(ota_service_rss "$ota_service")
        ota_before_rules=$(ota_rules_hash) || return 1
        # Journal before stop so signals and failed stop calls are recoverable.
        printf '%s %s\n' "$ota_service" "$ota_rss" >> "$OTA_RES_DIR/paused"
        "$OTA_INIT_DIR/$ota_service" stop >/dev/null 2>&1 || true
        ota_note "Paused $ota_service."
        ota_after_rules=$(ota_rules_hash) || return 1
        [ "$ota_after_rules" = "$ota_before_rules" ] || { ota_note 'Firewall rules changed; aborting preparation.'; return 1; }
        ota_reclaim_cache
    done
    [ "$(ota_available)" -ge "$ota_wanted" ] || {
        ota_note "Need $ota_wanted KiB including the unchanged safety reserve; have $(ota_available) KiB."
        return 1
    }
}
