#!/bin/sh
# ============================================================================
#  Chester K43P - firmware chooser
#
#  Run on the router over SSH:
#
#      wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
#
#  Offers a choice of firmware, downloads it, checks it, and flashes it.
#  The router must be online. Nothing is copied by hand.
#
#  * This REPLACES the router firmware and writes BOTH flash banks. There is no
#    fallback bank afterwards and no way back except TFTP or serial recovery.
#    You are asked to type YES before anything is written.
#
#  Options:  --dry-run    do every check and download, flash nothing
#            --yes        skip the confirmation (unattended)
#            --choice N   pick 1 or 2 without prompting
# ============================================================================
set -u

# ---------------------------------------------------------------- firmware
# Both images are raw UBI. They are written to both banks by the staged
# platform.sh, because this board boots the bank the stock writer ignores.
A_NAME="ImmortalWrt 25 (Chester)"
A_DESC="Vendor-style interface: dashboard, modem pages, port map, VPN, QModem.
             Closest to the firmware the router shipped with."
A_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/ChesterK43P-Bin/13-2026-08-23-ChesterK43P-25.12.bin"
A_SHA="d1740c6f75ae7de00703d08b4acda859761fe6dac67d2a402c18588df83c1859"
A_SIZE=23592960

B_NAME="OpenWrt 25 (official)"
B_DESC="Stock OpenWrt with LuCI and QModem. Newer kernel (6.18), package feeds
             that match the build, upstream support. Fewer vendor pages."
B_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/firmware/chester-openwrt25-20260824002534-factory.bin"
B_SHA="6b6919b43fadac2bb7c7912d5bc3a9509abb69d8dbbe51f97c7efca0a36f8bef"
B_SIZE=14680064

PLATFORM_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/platform.sh"

PEB=131072
IMG=/tmp/snand-ubi.bin          # the staged path platform.sh looks for
PLATFORM=/lib/upgrade/platform.sh

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
warn(){ printf '  [!]    %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; exit 1; }

# Everything runs inside a function so that a truncated download cannot
# execute a half-read script: sh only runs this once the final line is read.
lp_main() {

DRY=0; ASSUME_YES=0; CHOICE=
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        --choice)  shift; CHOICE="${1:-}" ;;
        --choice=*) CHOICE="${1#--choice=}" ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

printf '\n  Chester K43P firmware installer\n'
printf '  ==============================\n\n'

# ------------------------------------------------------------ sanity checks
[ "$(id -u 2>/dev/null || echo 0)" = 0 ] || die "run this as root"

BOARD=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
MODEL=$(cat /tmp/sysinfo/model 2>/dev/null || echo unknown)
info "board: $BOARD"
info "model: $MODEL"
case "$BOARD" in
    M01K43P|misectel,m01k43|misectel,m01k43-usb|alwaylink,m01k43) ok "supported board" ;;
    *) die "this is not a Chester K43P (board reports '$BOARD') - refusing to flash" ;;
esac

for t in wget sysupgrade; do
    command -v "$t" >/dev/null 2>&1 || die "$t not found"
done

grep -q '"ubi"'  /proc/mtd || die "no partition named 'ubi' - unexpected flash layout"
grep -q '"ubi2"' /proc/mtd || die "no partition named 'ubi2' - unexpected flash layout"
ok "flash layout looks right (ubi + ubi2)"

FREE=$(df -k /tmp | awk 'NR==2{print $4}')

# ------------------------------------------------------------------- menu
printf '\n  Choose the firmware to install:\n\n'
printf '    1) %s\n             %s\n\n' "$A_NAME" "$A_DESC"
printf '    2) %s\n             %s\n\n' "$B_NAME" "$B_DESC"
printf '    3) Cancel\n\n'

if [ -z "$CHOICE" ]; then
    # A piped script has no stdin left, so read from the terminal.
    if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
        printf '  Enter 1, 2 or 3: '
        read -r CHOICE < /dev/tty
    else
        die "no terminal available - re-run with --choice 1 or --choice 2"
    fi
fi

case "$CHOICE" in
    1) NAME="$A_NAME"; URL="$A_URL"; SHA="$A_SHA"; SIZE="$A_SIZE" ;;
    2) NAME="$B_NAME"; URL="$B_URL"; SHA="$B_SHA"; SIZE="$B_SIZE" ;;
    3|c|C|q|Q) printf '\n  Cancelled. Nothing was changed.\n\n'; exit 0 ;;
    *) die "invalid choice '$CHOICE'" ;;
esac

printf '\n'
ok "selected: $NAME"

NEED=$(( (SIZE / 1024) + 4096 ))
[ "$FREE" -ge "$NEED" ] || die "not enough space in /tmp (${FREE}K free, need ${NEED}K)"
ok "space in /tmp: ${FREE}K"

# ---------------------------------------------------------------- download
info "downloading ($(( SIZE / 1048576 )) MB) ..."
rm -f "$IMG"
wget -q -O "$IMG" "$URL" || die "download failed - is the router online?"

GOT=$(wc -c < "$IMG" | tr -d ' ')
[ "$GOT" = "$SIZE" ] || die "wrong size: got $GOT, expected $SIZE"
ok "size $GOT"

if command -v sha256sum >/dev/null 2>&1; then
    ACT=$(sha256sum "$IMG" | awk '{print $1}')
    [ "$ACT" = "$SHA" ] || die "checksum mismatch - refusing to flash
             got      $ACT
             expected $SHA"
    ok "sha256 verified"
else
    warn "sha256sum not available - checksum NOT verified"
fi

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
wget -q -O /tmp/platform.sh.new "$PLATFORM_URL" || die "could not fetch platform.sh"
grep -q 'snand_do_upgrade' /tmp/platform.sh.new || die "platform.sh looks wrong - aborting"
cp /tmp/platform.sh.new "$PLATFORM" || die "could not stage the flash method"
sync
ok "flash method staged (writes both banks)"

if [ "$DRY" = 1 ]; then
    printf '\n  Dry run: everything checked and downloaded, nothing written.\n\n'
    exit 0
fi

# ------------------------------------------------------------- confirmation
if [ "$ASSUME_YES" != 1 ]; then
    printf '\n'
    warn "About to install: $NAME"
    warn "This erases the current firmware and BOTH flash banks."
    warn "Settings are NOT kept. There is no fallback bank afterwards."
    printf '\n  Type YES to continue: '
    if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
        read -r REPLY < /dev/tty
    else
        die "no terminal for confirmation - re-run with --yes"
    fi
    [ "$REPLY" = "YES" ] || { printf '\n  Cancelled. Nothing was written.\n\n'; exit 0; }
fi

printf '\n'
info "flashing - do NOT unplug the router"
info "it will reboot on its own and come back on 192.168.100.1"
sync
# -n : do not keep settings. The firmwares use different config layouts and
# carrying one across produces a router that boots to no network.
exec sysupgrade -n "$IMG"
}

lp_main "$@"
