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

	ubidetach -m 8
	ubiformat /dev/mtd8 -y -f "$IMG"

	ubidetach -m 9
	ubiformat /dev/mtd9 -y -f "$IMG"
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
