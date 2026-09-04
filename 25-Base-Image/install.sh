#!/bin/sh
# Install the tested M01K43 OpenWrt 25 base image from an existing Chester build.
set -u

BASE_URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/25-Base-Image"
IMAGE_URL="$BASE_URL/m01k43-5g-openwrt25-base.bin"
PLATFORM_URL="$BASE_URL/platform.sh"
IMAGE=/tmp/snand-ubi.bin
EXPECTED_SIZE=18087936
EXPECTED_SHA256="491591f36efd91979775bc19b9e7253ac3b9ab645543eb181904e98f497e20aa"

die() { printf '\n[FAIL] %s\n\n' "$*" >&2; exit 1; }
ok() { printf '[ok] %s\n' "$*"; }

main() {
    [ "$(id -u 2>/dev/null || echo 1)" = 0 ] || die "run this as root"
    [ -r /etc/chester-version ] || die "this installer is only for a router already running a Chester build"

    BOARD=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
    case "$BOARD" in
        M01K43P|M02K43P|feiyan,m01k43|misectel,m01k43|misectel,m01k43-usb|alwaylink,m01k43)
            ok "supported K43P board: $BOARD"
            ;;
        *) die "unsupported board: $BOARD" ;;
    esac

    for tool in curl sha256sum sysupgrade; do
        command -v "$tool" >/dev/null 2>&1 || die "$tool not found"
    done
    grep -q '"ubi"' /proc/mtd || die "partition named ubi not found"
    grep -q '"ubi2"' /proc/mtd || die "partition named ubi2 not found"
    ok "dual-bank flash layout verified"

    FREE=$(df -k /tmp | awk 'NR==2 {print $4}')
    NEED=$((EXPECTED_SIZE / 1024 + 4096))
    [ "$FREE" -ge "$NEED" ] || die "not enough free space in /tmp"

    rm -f "$IMAGE" /tmp/platform.sh.new
    printf 'Downloading OpenWrt 25 base image...\n'
    curl -fsSL "$IMAGE_URL" -o "$IMAGE" || die "image download failed"

    SIZE=$(wc -c < "$IMAGE" | tr -d ' ')
    [ "$SIZE" = "$EXPECTED_SIZE" ] || die "wrong image size: $SIZE"
    SHA=$(sha256sum "$IMAGE" | awk '{print $1}')
    [ "$SHA" = "$EXPECTED_SHA256" ] || die "SHA-256 mismatch"
    [ "$(dd if="$IMAGE" bs=4 count=1 2>/dev/null)" = "UBI#" ] || die "first UBI header missing"
    [ "$(dd if="$IMAGE" bs=1 skip=131072 count=4 2>/dev/null)" = "UBI#" ] || die "second UBI header missing"
    ok "image size, SHA-256, and UBI headers verified"

    curl -fsSL "$PLATFORM_URL" -o /tmp/platform.sh.new || die "flash writer download failed"
    grep -q 'snand_do_upgrade' /tmp/platform.sh.new || die "flash writer validation failed"

    printf '\nWARNING: This clean-flashes BOTH firmware banks and erases all settings.\n'
    printf 'After reboot: address 192.168.1.1, user root, password internet.\n'
    printf 'Type YES (ALL CAPS) to continue: '
    if [ -r /dev/tty ]; then
        read -r REPLY < /dev/tty
    else
        die "no interactive terminal available"
    fi
    [ "$REPLY" = YES ] || { printf '\nCancelled. Firmware was not flashed.\n'; exit 0; }

    cp /tmp/platform.sh.new /lib/upgrade/platform.sh || die "could not stage flash writer"
    sync
    printf '\nFlashing both banks. DO NOT UNPLUG THE ROUTER.\n'
    exec sysupgrade -n "$IMAGE"
}

main "$@"

