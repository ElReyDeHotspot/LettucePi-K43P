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
