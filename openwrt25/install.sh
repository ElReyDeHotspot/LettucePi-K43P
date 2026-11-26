#!/bin/sh
# ============================================================================
#  Chester K43P - OpenWrt 25 installer
#
#  Run on the router over SSH:
#
#      curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
#
#  Downloads OpenWrt 25, checks it, and flashes it. The router must be online.
#  Nothing is copied by hand.
#
#  * This REPLACES the router firmware and writes BOTH flash banks. There is no
#    fallback bank afterwards and no way back except TFTP or serial recovery.
#    You are asked to type YES before anything is written.
#
#  Options:  --dry-run    do every check and download, flash nothing
#            --yes        skip the confirmation (unattended)
# ============================================================================
set -u

# ---------------------------------------------------------------- firmware
# The image is raw UBI. It is written to both banks by the staged platform.sh,
# because this board boots the bank the stock writer ignores.
#
# Resolve main once, then fetch metadata, image and writer from that immutable
# commit. A release published mid-download cannot mix two different versions.
RAW_BASE="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P"
REF_URL="https://api.github.com/repos/ElReyDeHotspot/LettucePi-K43P/git/ref/heads/main"

PEB=131072
IMG=/tmp/snand-ubi.bin          # the staged path platform.sh looks for
PLATFORM=/lib/upgrade/platform.sh

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
warn(){ printf '  [!]    %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; exit 1; }
# jsonfilter ships on OpenWrt 21. Keep a narrow fallback for vendor builds
# without it; every extracted value is validated before it is used.
jget(){
    if command -v jsonfilter >/dev/null 2>&1; then
        jsonfilter -e "@.$1" 2>/dev/null
    else
        sed -n "s/.*\"${1##*.}\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" | head -1
    fi
}
fetch_release(){
    ref=$(curl -fsSL --connect-timeout 15 --max-time 45 "$REF_URL?cb=$(date +%s)") || die "could not resolve the latest published release"
    RELEASE_REF=$(printf '%s' "$ref" | jget object.sha)
    [ "${#RELEASE_REF}" = 40 ] || die "invalid release commit"
    case "$RELEASE_REF" in *[!0-9a-f]*) die "invalid release commit" ;; esac
    metadata=$(curl -fsSL --connect-timeout 15 --max-time 45 "$RAW_BASE/$RELEASE_REF/openwrt25/latest.json") || die "could not fetch the current firmware manifest"
    FAMILY=$(printf '%s' "$metadata" | jget family)
    BIN=$(printf '%s' "$metadata" | jget bin)
    BUILD=$(printf '%s' "$metadata" | jget build)
    URL=$(printf '%s' "$metadata" | jget url)
    SHA=$(printf '%s' "$metadata" | jget sha256)
    SIZE=$(printf '%s' "$metadata" | jget size)
    [ "$FAMILY" = Immortal-Chester-25 ] || die "unexpected firmware family"
    case "$BIN" in ''|*[!0-9]*) die "invalid BIN number" ;; esac
    [ "${#BIN}" -le 4 ] || die "invalid BIN number"
    case "$BUILD" in ''|*[!0-9]*) die "invalid build number" ;; esac
    [ "${#BUILD}" = 14 ] || die "invalid build number"
    [ "${#SHA}" = 64 ] || die "invalid SHA-256"
    case "$SHA" in *[!0-9a-f]*) die "invalid SHA-256" ;; esac
    case "$SIZE" in ''|*[!0-9]*) die "invalid image size" ;; esac
    [ "${#SIZE}" -le 8 ] && [ "$SIZE" -ge 1000000 ] && [ "$SIZE" -le 33554432 ] || die "image size outside the K43P release limit"
    file=${URL##*/}
    case "$file" in *[!A-Za-z0-9._-]*) die "invalid image filename" ;; esac
    case "$file" in "$BIN"-*-ChesterK43P-25.12.bin) ;; *) die "image filename does not match this K43P release" ;; esac
    [ "$URL" = "$RAW_BASE/main/ChesterK43P-Bin/$file" ] || die "unexpected firmware download URL"
    URL="$RAW_BASE/$RELEASE_REF/ChesterK43P-Bin/$file"
    PLATFORM_URL="$RAW_BASE/$RELEASE_REF/openwrt25/platform.sh"
    NAME="OpenWrt 25 - BIN$BIN"
}

# Everything runs inside a function so that a truncated download cannot
# execute a half-read script: sh only runs this once the final line is read.
lp_main() {

DRY=0; ASSUME_YES=0
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        # There used to be a choice of firmware here. Accept and ignore the old
        # flag so existing one-liners and scripts do not fail on it.
        --choice)  shift ;;
        --choice=*) ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

printf '\n  Chester K43P - install latest OpenWrt 25\n'
printf '  ==========================================\n\n'

# ------------------------------------------------------------ sanity checks
[ "$(id -u 2>/dev/null || echo 0)" = 0 ] || die "run this as root"

BOARD=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
MODEL=$(cat /tmp/sysinfo/model 2>/dev/null || echo unknown)
info "board: $BOARD"
info "model: $MODEL"
case "$BOARD" in
    M01K43|M01K43P|misectel,m01k43|misectel,m01k43-usb|alwaylink,m01k43) ok "supported board" ;;
    *) die "this is not a Chester K43P (board reports '$BOARD') - refusing to flash" ;;
esac

for t in curl sysupgrade sha256sum; do
    command -v "$t" >/dev/null 2>&1 || die "$t not found"
done

grep -q '"ubi"'  /proc/mtd || die "no partition named 'ubi' - unexpected flash layout"
grep -q '"ubi2"' /proc/mtd || die "no partition named 'ubi2' - unexpected flash layout"
ok "flash layout looks right (ubi + ubi2)"

FREE=$(df -k /tmp | awk 'NR==2{print $4}')

fetch_release
ok "installing: $NAME"
info "published build: $BUILD"

# Settings cannot be carried between firmware families: the two use different
# config layouts, so a preserved /etc/config produces a router that boots to no
# network. That is why the flash below is unconditionally sysupgrade -n.
# Which firmware family is this? /etc/openwrt_release cannot answer it: the
# ImmortalWrt-derived builds are rebranded and report DISTRIB_ID='OpenWrt'
# too, so asking it would call a migration a clean install. Newer builds stamp
# the answer; older ones are identified by the vendor updater, which only ever
# shipped on the ImmortalWrt side.
CURRENT=""
[ -r /etc/chester-family ] && CURRENT=$(cat /etc/chester-family 2>/dev/null)
# Only trust a stamp we recognise. busybox tr has no [:space:] class -- it
# deletes those characters literally -- so the stamp is validated rather than
# scrubbed, and command substitution has already dropped the trailing newline.
case "$CURRENT" in
    ImmortalWrt|OpenWrt) ;;
    *) CURRENT="" ;;
esac
if [ -z "$CURRENT" ]; then
    if [ -f /usr/sbin/chester-update ] || [ -f /etc/chester-version ]; then
        CURRENT="ImmortalWrt"
    elif grep -qi immortalwrt /etc/openwrt_release 2>/dev/null; then
        CURRENT="ImmortalWrt"
    else
        CURRENT="OpenWrt"
    fi
fi
info "currently running: $CURRENT"

printf '\n'
if [ "$CURRENT" != "$FAMILY" ]; then
    warn "MIGRATION: $CURRENT  ->  $FAMILY"
    warn "This changes firmware family, so NOTHING is carried over."
else
    warn "This is a clean install. NOTHING is carried over."
fi
info "These are ERASED and go back to defaults:"
info "  - Wi-Fi name and password  (back to 5G_CPE / 123456789)"
info "  - LAN address and DHCP     (back to 192.168.100.1)"
info "  - admin password           (back to admin - change it after)"
info "  - APN and modem settings"
info "  - installed packages, VPN profiles, port forwards"
info "Write down anything you still need before continuing."

NEED=$(( (SIZE / 1024) + 4096 ))
[ "$FREE" -ge "$NEED" ] || die "not enough space in /tmp (${FREE}K free, need ${NEED}K)"
ok "space in /tmp: ${FREE}K"

# ---------------------------------------------------------------- download
info "downloading ($(( SIZE / 1048576 )) MB) ..."
rm -f "$IMG"
curl -fsSL "$URL" -o "$IMG" || die "download failed - is the router online?"

GOT=$(wc -c < "$IMG" | tr -d ' ')
[ "$GOT" = "$SIZE" ] || die "wrong size: got $GOT, expected $SIZE"
ok "size $GOT"

ACT=$(sha256sum "$IMG" | awk '{print $1}')
[ "$ACT" = "$SHA" ] || die "checksum mismatch - refusing to flash
             got      $ACT
             expected $SHA"
ok "sha256 verified"

# Verify the format BEFORE anything is erased. Once the flash is wiped a bad
# image means TFTP or serial recovery, so every check happens up front.
[ "$(dd if="$IMG" bs=4 count=1 2>/dev/null)" = "UBI#" ] || die "not a raw UBI image"
[ "$(dd if="$IMG" bs=1 skip=$PEB count=4 2>/dev/null)" = "UBI#" ] || \
    die "second UBI header missing at offset $PEB - wrong erase-block size"
ok "raw UBI image, ${PEB}-byte erase blocks"

# ------------------------------------------------- flash method (both banks)
# The stock writer targets only 'ubi2', but this board boots 'ubi'. That is why
# a stock-path upgrade appears to work and then comes back on the old firmware.
info "fetching the flash method ..."
curl -fsSL "$PLATFORM_URL" -o /tmp/platform.sh.new || die "could not fetch platform.sh"
grep -q 'snand_do_upgrade' /tmp/platform.sh.new || die "platform.sh looks wrong - aborting"
sh -n /tmp/platform.sh.new || die "platform.sh syntax is invalid - aborting"
ok "flash method downloaded and checked (writes both banks)"

if [ "$DRY" = 1 ]; then
    printf '\n  Dry run: everything checked and downloaded; firmware and flash writer unchanged.\n\n'
    exit 0
fi

# ------------------------------------------------------------- confirmation
if [ "$ASSUME_YES" != 1 ]; then
    printf '\n'
    warn "About to install: $NAME"
    warn "This erases the current firmware and BOTH flash banks."
    warn "Settings are NOT kept. There is no fallback bank afterwards."
    printf '\n  Type YES to continue (anything else cancels): '
    # A piped script has no stdin left, so read from the terminal.
    if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
        read -r REPLY < /dev/tty
    else
        die "no terminal for confirmation - re-run with --yes"
    fi
    [ "$REPLY" = "YES" ] || { printf '\n  Cancelled. Nothing was written.\n\n'; exit 0; }
fi

cp /tmp/platform.sh.new "$PLATFORM" || die "could not stage the flash method"
sync
ok "flash method staged (writes both banks)"

printf '\n'
info "flashing - do NOT unplug the router"
info "it will reboot on its own and come back on 192.168.100.1"
sync
# -n : do not keep settings. The firmwares use different config layouts and
# carrying one across produces a router that boots to no network.
exec sysupgrade -n "$IMG"
}

lp_main "$@"
