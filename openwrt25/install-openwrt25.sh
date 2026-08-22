#!/bin/sh
# ============================================================================
#  LettucePi - upgrade a Chester K43P (M10K43P) to OpenWrt 25 / ImmortalWrt
#
#  Run it on the router, over SSH:
#
#      curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install-openwrt25.sh | sh
#
#  It downloads the firmware, checks it, and flashes it. The router needs to be
#  online; nothing has to be copied by hand.
#
#  ⚠ This REPLACES the router firmware and writes BOTH flash banks. There is no
#    fallback bank afterwards and no way back except TFTP or serial recovery.
#    You will be asked to type YES before anything is written.
#
#  Options:  --dry-run   do every check and download, flash nothing
#            --yes       skip the confirmation (for unattended use)
# ============================================================================
set -u

EXPECTED_BOARD=M01K43P
EXPECTED_BOARD_ALT=misectel,m01k43   # what the same box reports once on OpenWrt 25
DISPLAY_NAME="Chester K43P"
IMG_URL="https://github.com/ElReyDeHotspot/LettucePi-K43P/releases/download/chester-25.12/immortalwrt-25.12-ChesterK43P-20260822003206-ubi.bin"
IMG_SHA=cdda5f27719d8cf3c1dde5dce55fdb67025b461a0ae911c336b8ca9022c824fb
IMG_SIZE=23461888
PEB=131072
# The staged path the replacement platform.sh looks for. Do not change one
# without the other.
IMG=/tmp/snand-ubi.bin
PLATFORM=/lib/upgrade/platform.sh

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; exit 1; }

lp_main() {
DRY=0; ASSUME_YES=0; KEEP=
for a in "$@"; do
    case "$a" in
        --dry-run) DRY=1 ;;
        --yes|-y)  ASSUME_YES=1 ;;
        --keep)    KEEP=1 ;;
        --wipe)    KEEP=0 ;;
        *) die "unknown option: $a" ;;
    esac
done

printf '\n  Upgrade %s to OpenWrt 25\n\n' "$DISPLAY_NAME"

# ------------------------------------------------------------------ checks
[ "$(id -u)" = 0 ] || die "must run as root"

board=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
case "$board" in
    "$EXPECTED_BOARD"|"$EXPECTED_BOARD_ALT") ;;
    *) die "this router reports board '$board'; this upgrade is only for the $DISPLAY_NAME" ;;
esac
ok "router is $DISPLAY_NAME"

# Coming from the vendor firmware, its settings are meaningless to OpenWrt and
# keeping them would carry junk across; going OpenWrt 25 -> OpenWrt 25 is an
# update and the customer expects to keep everything. Default accordingly,
# --keep / --wipe override.
if [ -z "$KEEP" ]; then
    case "$board" in
        "$EXPECTED_BOARD_ALT") KEEP=1 ;;
        *)                     KEEP=0 ;;
    esac
fi
[ "$KEEP" = 1 ] && ok "settings will be KEPT (update)" || ok "settings will be ERASED (clean install)"

for t in curl sha256sum sysupgrade ubiformat ubidetach dd; do
    command -v "$t" >/dev/null 2>&1 || die "required tool missing: $t"
done
ok "required tools present"

# Both banks must exist, or this is not the flash layout we expect.
grep -q '"ubi"'  /proc/mtd || die "no 'ubi' partition found - unexpected flash layout"
grep -q '"ubi2"' /proc/mtd || die "no 'ubi2' partition found - unexpected flash layout"
ok "flash layout looks right (ubi + ubi2)"

# Need room for the image in the tmpfs.
FREE=$(df -k /tmp | awk 'NR==2{print $4}')
NEED=$(( (IMG_SIZE / 1024) + 4096 ))
[ "$FREE" -ge "$NEED" ] || die "not enough space in /tmp (${FREE}K free, need ~${NEED}K)"
ok "space available in /tmp (${FREE}K)"

# ---------------------------------------------------------------- download
info "downloading firmware (23 MB), please wait..."
rm -f "$IMG"
# -L because release assets redirect to a CDN host. -# is a single-line progress
# bar; curl's default table redraws badly when the script is piped in.
curl -fL -# --retry 3 --retry-delay 2 --max-time 900 -o "$IMG" "$IMG_URL" \
    || die "download failed - check the router's internet connection"

GOT=$(wc -c < "$IMG" | tr -d ' ')
[ "$GOT" = "$IMG_SIZE" ] || die "download is $GOT bytes, expected $IMG_SIZE - it was cut short, nothing has been changed"
ok "downloaded $GOT bytes"

# A truncated or wrong file here would brick the router, so verify before we
# go anywhere near the flash.
SHA=$(sha256sum "$IMG" | awk '{print $1}')
[ "$SHA" = "$IMG_SHA" ] || die "checksum mismatch - refusing to flash. Got $SHA"
ok "checksum verified"

[ "$(dd if="$IMG" bs=4 count=1 2>/dev/null)" = "UBI#" ] || die "not a raw UBI image - refusing to flash"
ok "image format verified (raw UBI)"

# The flash erases in 128 KiB blocks; a UBI built for another eraseblock size
# will not come up after ubiformat.
# If the eraseblock size matches, the second UBI header sits exactly one PEB
# in. Checked with dd rather than `grep -abo`, which busybox grep does not
# reliably support.
[ "$(dd if="$IMG" bs=1 skip="$PEB" count=4 2>/dev/null)" = "UBI#" ] \
    || die "image eraseblock size does not match this flash (expected a UBI header at $PEB) - refusing to flash"
ok "eraseblock size matches this flash ($PEB)"

if [ "$DRY" = 1 ]; then
    printf '\n  Dry run: everything checked out. Nothing was flashed.\n'
    printf '  The firmware is staged at %s\n\n' "$IMG"
    exit 0
fi

# ------------------------------------------------------------- confirmation
if [ "$KEEP" = 1 ]; then
    DATA_LINE="Your settings are kept. Installed packages are NOT."
else
    DATA_LINE="Everything on the router is erased - settings, Wi-Fi, packages."
fi
if [ "$ASSUME_YES" != 1 ]; then
    cat <<WARN

  ------------------------------------------------------------------
   READ THIS BEFORE CONTINUING

   This replaces the router's firmware with OpenWrt 25.

   * $DATA_LINE
   * This cannot be undone.
   * If it is interrupted, the router needs special recovery tools.

   Do not unplug the router while it is working.

   When it finishes, the router is at the SAME address as now
   (http://192.168.100.1, root/admin).
  ------------------------------------------------------------------

WARN
    # This script is usually piped in (curl | sh), so stdin is the script
    # itself -- the answer has to come from the terminal.
    if ( : < /dev/tty ) 2>/dev/null; then
        printf '  Type YES to continue: '
        read answer < /dev/tty || answer=""
    else
        die "no terminal available to confirm. Re-run with --yes if you are sure:
         curl -fsSL <url> | sh -s -- --yes"
    fi
    [ "$answer" = "YES" ] || { printf '\n  Cancelled. Nothing was changed.\n\n'; exit 0; }
fi

# ------------------------------------------------------------------- flash
# The stock platform.sh writes only ubi2, but this router boots ubi -- so the
# stock path silently leaves the old firmware running. Swap in the version that
# writes both banks.
if [ -f "$PLATFORM" ] && [ ! -f "$PLATFORM.lp-orig" ]; then
    cp "$PLATFORM" "$PLATFORM.lp-orig" && ok "saved original platform.sh"
fi

cat > "$PLATFORM.new" <<'PLATEOF'
RAMFS_COPY_BIN='mkfs.f2fs blkid blockdev fw_printenv fw_setenv dmsetup'
RAMFS_COPY_DATA="/etc/fw_env.config /var/lock/fw_printenv.lock"

# Chester K43P (M10K43P) - OpenWrt 25 / ImmortalWrt install.
#
# The stock vendor platform.sh writes ONLY mtd9 ("ubi2"), but this router boots
# mtd8 ("ubi"). That is why a stock-path upgrade appears to succeed and then
# comes back on the old firmware: the image lands in a bank nothing boots.
# This version writes BOTH banks, which is what makes the new firmware take.
#
# Consequence, stated plainly: after this runs there is no fallback bank left.

nor_do_upgrade() {
	sync
	echo 3 > /proc/sys/vm/drop_caches
	if [ -n "$UPGRADE_BACKUP" ]; then
		get_image "$1" "$2" | dd bs=64k skip=1 conv=sync 2>/dev/null | mtd $MTD_ARGS $MTD_CONFIG_ARGS -j "$UPGRADE_BACKUP" write - "${PART_NAME:-image}"
	else
		get_image "$1" "$2" | dd bs=64k skip=1 conv=sync 2>/dev/null | mtd $MTD_ARGS write - "${PART_NAME:-image}"
	fi
	[ $? -ne 0 ] && exit 1
}

snand_do_upgrade() {
	# The installer stages the image here; fall back to whatever sysupgrade
	# handed us if that is missing.
	IMG=/tmp/snand-ubi.bin
	[ -f "$IMG" ] || IMG="$1"

	# Verify BEFORE erasing anything. Once mtd8 is erased there is no way back
	# except TFTP or serial, so a truncated or wrong-format file must stop here
	# rather than half-way through.
	[ -s "$IMG" ] || { echo "wt: firmware image missing - aborting before erase" >&2; exit 1; }
	[ "$(dd if="$IMG" bs=4 count=1 2>/dev/null)" = "UBI#" ] || {
		echo "wt: not a raw UBI image - aborting before erase" >&2; exit 1; }

	# Look the partitions up BY NAME. mtd numbering is not stable across
	# firmwares -- on the vendor image ubi/ubi2 are mtd8/mtd9, on ImmortalWrt
	# they are mtd7/mtd8 -- so hardcoded numbers write the wrong partition, and
	# on some layouts could land on the bootloader. The vendor's own script
	# looked them up by name; the community one hardcoded them.
	for name in ubi ubi2; do
		part=$(grep "\"$name\"" /proc/mtd | cut -d: -f1)
		case "$part" in
			mtd[0-9]*) ;;
			*) echo "wt: partition \"$name\" not found - aborting" >&2; exit 1 ;;
		esac
		num=${part#mtd}
		echo "wt: writing $name ($part)"
		ubidetach -m "$num" 2>/dev/null
		ubiformat "/dev/$part" -y -f "$IMG" || {
			echo "wt: ubiformat failed on $part" >&2; exit 1; }
	done

	# Keep settings unless sysupgrade was given -n.
	#
	# Formatting both banks wipes rootfs_data, so the overlay is gone and the
	# config has to be put back deliberately -- the vendor platform.sh did this
	# and the community one dropped it, which is why an upgrade always lost
	# every setting. nand_restore_config (from /lib/upgrade/nand.sh, in scope
	# because stage2 does `include /lib/upgrade`) mounts rootfs_data on the boot
	# bank and leaves sysupgrade.tgz at its root; /lib/preinit/80_mount_root
	# extracts it on the next boot.
	if [ -n "$UPGRADE_BACKUP" ]; then
		bootpart=$(grep '"ubi"' /proc/mtd | cut -d: -f1)
		ubiattach -m "${bootpart#mtd}" >/dev/null 2>&1
		sleep 1
		if nand_restore_config "$UPGRADE_BACKUP"; then
			echo "wt: settings preserved"
		else
			# Not fatal: the new firmware is already written and will boot,
			# just with defaults. Say so loudly rather than failing the flash.
			echo "wt: WARNING - could not preserve settings, router will come up with defaults" >&2
		fi
	fi
}

platform_do_upgrade() {
	local board=$(board_name)

	cat /proc/mtd | grep ubi2
	if [ $? -eq 0 ]; then
		snand_do_upgrade "$1"
	else
		nor_do_upgrade "$1"
	fi
}

PART_NAME=firmware

platform_check_image() {
	return 0
}
PLATEOF
chmod 0644 "$PLATFORM.new"
mv "$PLATFORM.new" "$PLATFORM" || die "could not install platform.sh"
sync
ok "flash method installed"

printf '\n  Flashing now. This takes a few minutes.\n'
printf '  DO NOT power off the router.\n\n'
sync
if [ "$KEEP" = 1 ]; then
    exec sysupgrade "$IMG"        # keeps /etc/config via sysupgrade.tgz
else
    exec sysupgrade -n "$IMG"     # -n = do not save config
fi
}

lp_main "$@"
