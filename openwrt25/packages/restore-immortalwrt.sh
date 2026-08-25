#!/bin/sh
# ============================================================================
#  Chester K43P - restore ImmortalWrt (modem recovery)
#
#  Run on the router over SSH:
#
#      wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/packages/restore-immortalwrt.sh | sh
#
#  WHY THIS EXISTS
#  ---------------
#  On some units the OpenWrt 25 build does not bring up the modem: the PCIe
#  link never trains ("PCIe link down, LTSSM state: detect.quiet") so the
#  modem never appears, there is no /dev/mhi_* and no rmnet interface. The
#  same units run the modem correctly on ImmortalWrt. This puts them back.
#
#  * This REPLACES the firmware and writes BOTH flash banks. Settings are NOT
#    kept -- the two firmwares use different config layouts and carrying one
#    across produces a router that boots to no network. You are asked to type
#    YES before anything is written.
#
#  Options:  --dry-run    check and download, flash nothing
#            --yes        skip the confirmation (unattended)
# ============================================================================
set -u

FW_NAME="ImmortalWrt (final Chester build)"
FW_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/ChesterK43P-Bin/26-2026-08-25-ChesterK43P-25.12.bin"
FW_SHA="7f569641262632ab4fbb465f1220f1a8946601f12744a3fddfddcd780a2e54bf"
FW_SIZE=25034752

PLATFORM_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/platform.sh"
PEB=131072
IMG=/tmp/snand-ubi.bin
PLATFORM=/lib/upgrade/platform.sh

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
warn(){ printf '  [!]    %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; exit 1; }

lp_main() {

DRY=0; ASSUME_YES=0
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        *) die "unknown option: $1" ;;
    esac
    shift
done

printf '\n  Chester K43P - restore %s\n' "$FW_NAME"
printf '  ==================================================\n\n'

[ "$(id -u 2>/dev/null || echo 0)" = 0 ] || die "run this as root"

BOARD=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
info "board: $BOARD"
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

# Report what we are actually fixing, so the operator can confirm the symptom.
if [ -e /sys/bus/pci/devices/0000:01:00.0 ]; then
    warn "this router's modem IS currently detected on the PCI bus"
    warn "you probably do not need this - it will still erase settings"
else
    ok "modem not on the PCI bus (the symptom this recovers from)"
fi

FREE=$(df -k /tmp | awk 'NR==2{print $4}')
NEED=$(( (FW_SIZE / 1024) + 4096 ))
[ "$FREE" -ge "$NEED" ] || die "not enough space in /tmp (${FREE}K free, need ${NEED}K)"
ok "space in /tmp: ${FREE}K"

printf '\n'
warn "This installs ImmortalWrt and ERASES all settings:"
info "  - Wi-Fi name and password"
info "  - LAN address and DHCP"
info "  - admin password"
info "  - APN and modem settings, port forwards, VPN profiles"
info "Write down anything you still need before continuing."
printf '\n'

info "downloading ($(( FW_SIZE / 1048576 )) MB) ..."
rm -f "$IMG"
wget -q -O "$IMG" "$FW_URL" || die "download failed - is the router online?"

GOT=$(wc -c < "$IMG" | tr -d ' ')
[ "$GOT" = "$FW_SIZE" ] || die "wrong size: got $GOT, expected $FW_SIZE"
ok "size $GOT"

if command -v sha256sum >/dev/null 2>&1; then
    ACT=$(sha256sum "$IMG" | awk '{print $1}')
    [ "$ACT" = "$FW_SHA" ] || die "checksum mismatch - refusing to flash
             got      $ACT
             expected $FW_SHA"
    ok "sha256 verified"
else
    warn "sha256sum not available - checksum NOT verified"
fi

[ "$(dd if="$IMG" bs=4 count=1 2>/dev/null)" = "UBI#" ] || die "not a raw UBI image"
[ "$(dd if="$IMG" bs=1 skip=$PEB count=4 2>/dev/null)" = "UBI#" ] || \
    die "second UBI header missing at offset $PEB - wrong erase-block size"
ok "raw UBI image, ${PEB}-byte erase blocks"

# This board BOOTS 'ubi' but the stock writer only ever touches 'ubi2'. Without
# this the flash appears to succeed and the router comes back on the old build.
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

if [ "$ASSUME_YES" != 1 ]; then
    printf '\n'
    warn "About to install: $FW_NAME"
    warn "This erases the current firmware and BOTH flash banks."
    printf '\n  Type YES to continue (anything else cancels): '
    if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
        read -r REPLY < /dev/tty
    else
        die "no terminal for confirmation - re-run with --yes"
    fi
    [ "$REPLY" = "YES" ] || { printf '\n  Cancelled. Nothing was written.\n\n'; exit 0; }
fi

printf '\n'
info "flashing - do NOT unplug the router"
info "it reboots on its own and comes back on 192.168.100.1"
sync
exec sysupgrade -n "$IMG"
}

lp_main "$@"
