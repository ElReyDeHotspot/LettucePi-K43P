#!/bin/sh
# ============================================================================
#  Add "System Update" to a Chester K43P that shipped without it
#
#  Run on the router over SSH:
#
#      wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/packages/add-system-update.sh | sh
#
#  Every build before 20260824232739 shipped no updater at all, so those
#  routers can only be moved forward by a full reflash -- which erases
#  settings. This installs the updater in place instead: nothing is erased,
#  and from then on the router updates itself from System -> Settings ->
#  System Update, keeping its settings.
#
#  It writes seven small files and restarts two services. It does NOT touch
#  the firmware, the network, or any user setting.
# ============================================================================
set -u

BASE="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/overlay-files"
PLATFORM_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/platform.sh"

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; exit 1; }

lp_main() {

printf '\n  Chester K43P - add System Update\n'
printf '  ================================\n\n'

[ "$(id -u 2>/dev/null || echo 0)" = 0 ] || die "run this as root"

BOARD=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
case "$BOARD" in
    M01K43P|misectel,m01k43|misectel,m01k43-usb|alwaylink,m01k43)
        ok "board: $BOARD" ;;
    *) die "this is not a Chester K43P (board reports '$BOARD')" ;;
esac

command -v wget >/dev/null 2>&1 || die "wget not found"

if [ -x /usr/sbin/chester-update ]; then
    info "System Update is already installed - refreshing it"
fi

TMP=/tmp/chester-addon.$$
mkdir -p "$TMP" || die "cannot write to /tmp"
trap 'rm -rf "$TMP"' EXIT

# path-under-overlay-files  ->  destination
set -- \
    "usr/sbin/chester-update:/usr/sbin/chester-update:755" \
    "www/luci-static/resources/view/chester-update/index.js:/www/luci-static/resources/view/chester-update/index.js:644" \
    "www/luci-static/resources/chester-ui/kit.css:/www/luci-static/resources/chester-ui/kit.css:644" \
    "usr/share/luci/menu.d/luci-app-chester-update.json:/usr/share/luci/menu.d/luci-app-chester-update.json:644" \
    "usr/share/rpcd/acl.d/luci-app-chester-update.json:/usr/share/rpcd/acl.d/luci-app-chester-update.json:644"

info "downloading ..."
n=0
for spec in "$@"; do
    src=${spec%%:*}; rest=${spec#*:}; dst=${rest%%:*}; mode=${rest##*:}
    wget -q -O "$TMP/f$n" "$BASE/$src" || die "could not download $src"
    [ -s "$TMP/f$n" ] || die "$src came back empty"
    n=$((n+1))
done
ok "$n files downloaded"

# The both-banks flash writer. Without it an update writes the bank this
# board does not boot, and the router silently comes back on the old build.
wget -q -O "$TMP/platform.sh" "$PLATFORM_URL" || die "could not download the flash method"
grep -q snand_do_upgrade "$TMP/platform.sh" || die "flash method looks wrong - aborting"
ok "flash method verified (writes both banks)"

info "installing ..."
n=0
for spec in "$@"; do
    rest=${spec#*:}; dst=${rest%%:*}; mode=${rest##*:}
    mkdir -p "$(dirname "$dst")"
    cat "$TMP/f$n" > "$dst" || die "could not write $dst"
    chmod "$mode" "$dst"
    n=$((n+1))
done
mkdir -p /usr/share/chester
cat "$TMP/platform.sh" > /usr/share/chester/platform.sh
chmod 644 /usr/share/chester/platform.sh
ok "installed"

# The updater compares build ids. A router that predates the stamp has no
# /etc/chester-version, which would read as "installed build unknown" -- so
# seed it from what the firmware does know. Any published build is newer
# than this, which is exactly right for a router that shipped without an
# updater.
if [ ! -s /etc/chester-version ]; then
    built=$(sed -n 's/^DISTRIB_DESCRIPTION=.*(\(.*\)).*/\1/p' /etc/openwrt_release 2>/dev/null)
    printf 'version=25.12\nbuilt=%s\nbuild=0\n' "${built:-unknown}" > /etc/chester-version
    ok "stamped /etc/chester-version (build 0 - any published build is newer)"
else
    ok "existing version stamp kept: $(sed -n 's/^build=//p' /etc/chester-version)"
fi

/etc/init.d/rpcd restart >/dev/null 2>&1
rm -f /tmp/luci-indexcache* 2>/dev/null
rm -rf /tmp/luci-modulecache/* 2>/dev/null
/etc/init.d/uhttpd restart >/dev/null 2>&1
ok "services restarted"

printf '\n  Done. Open the router and go to:\n'
printf '      System  ->  Settings  ->  System Update\n\n'
printf '  It keeps your settings. Nothing was erased.\n\n'
}

lp_main "$@"
