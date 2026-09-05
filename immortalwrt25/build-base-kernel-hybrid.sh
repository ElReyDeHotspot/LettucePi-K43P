#!/bin/bash
# Combine Bin 42's finished Chester userspace with the tested base FIT/kernel.
# No kernel bytes or device-tree bytes are modified.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BASE="${1:-$REPO/25-Base-Image/m01k43-5g-openwrt25-base.bin}"
CHESTER="${2:-$REPO/ChesterK43P-Bin/42-2026-09-01-ChesterK43P-25.12.bin}"
OUT="${3:-$REPO/25-Base-Image/m01k43-5g-openwrt25-chester-hybrid.bin}"
KERNEL_FIT="${KERNEL_FIT:-}"
MODULE_TREE="${MODULE_TREE:-}"
WORK="${WORK:-/root/k43p-base-kernel-hybrid}"
PEB=131072
MINIO=2048
SLOT_MAX=58720256

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

case "$WORK" in /mnt/*) die "WORK must be on a Linux filesystem" ;; esac
for tool in python3 unsquashfs mksquashfs ubinize sha256sum dumpimage; do
	command -v "$tool" >/dev/null || die "$tool is missing"
done
for image in "$BASE" "$CHESTER"; do
	[ -f "$image" ] || die "missing image: $image"
	[ "$(head -c4 "$image")" = "UBI#" ] || die "not raw UBI: $image"
done

rm -rf "$WORK"
mkdir -p "$WORK/base" "$WORK/chester" "$WORK/root-base" "$WORK/root-hybrid"

step "Extracting base and Bin 42"
python3 "$HERE/ubi-extract.py" "$BASE" "$WORK/base"
python3 "$HERE/ubi-extract.py" "$CHESTER" "$WORK/chester"
unsquashfs -no-progress -dest "$WORK/root-base" "$WORK/base/rootfs" >/dev/null
unsquashfs -no-progress -dest "$WORK/root-hybrid" "$WORK/chester/rootfs" >/dev/null

BASE_KERNEL_SHA=$(sha256sum "$WORK/base/kernel" | awk '{print $1}')
BASE_MODULE_RELEASE=$(find "$WORK/root-base/lib/modules" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
CHESTER_MODULE_RELEASE=$(find "$WORK/root-hybrid/lib/modules" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
[ -n "$BASE_MODULE_RELEASE" ] || die "base module release not found"
[ "$(printf '%s\n' "$BASE_MODULE_RELEASE" | wc -l)" = 1 ] || die "multiple base module releases"
echo "  base kernel SHA-256: $BASE_KERNEL_SHA"
echo "  modules: $CHESTER_MODULE_RELEASE -> $BASE_MODULE_RELEASE"

if [ -n "$KERNEL_FIT" ]; then
	[ -f "$KERNEL_FIT" ] || die "missing rebuilt FIT: $KERNEL_FIT"
	cp "$KERNEL_FIT" "$WORK/kernel"
else
	cp "$WORK/base/kernel" "$WORK/kernel"
fi

step "Replacing every kernel-coupled component"
rm -rf "$WORK/root-hybrid/lib/modules" \
	"$WORK/root-hybrid/etc/modules.d" \
	"$WORK/root-hybrid/etc/modules-boot.d"
cp -a "$WORK/root-base/lib/modules" "$WORK/root-hybrid/lib/modules"
cp -a "$WORK/root-base/etc/modules.d" "$WORK/root-hybrid/etc/modules.d"
cp -a "$WORK/root-base/etc/modules-boot.d" "$WORK/root-hybrid/etc/modules-boot.d"

if [ -n "$MODULE_TREE" ]; then
	[ -d "$MODULE_TREE" ] || die "missing rebuilt module tree: $MODULE_TREE"
	mkdir -p "$WORK/new-modules"
	find "$MODULE_TREE" -type f -name '*.ko' -exec cp -t "$WORK/new-modules" {} +
	# Retain base-only external drivers such as mt7915e/mac80211, GPIO hotplug,
	# and Quectel PCIe MHI, but rebuilt modules win on basename collisions.
	for module in "$WORK/root-base/lib/modules/$BASE_MODULE_RELEASE"/*.ko; do
		[ -e "$module" ] || continue
		[ -e "$WORK/new-modules/$(basename "$module")" ] || cp "$module" "$WORK/new-modules/"
	done
	rm -rf "$WORK/root-hybrid/lib/modules/$BASE_MODULE_RELEASE"
	mkdir -p "$WORK/root-hybrid/lib/modules/$BASE_MODULE_RELEASE"
	cp -a "$WORK/new-modules/." "$WORK/root-hybrid/lib/modules/$BASE_MODULE_RELEASE/"
	for metadata in modules.order modules.builtin modules.builtin.modinfo; do
		[ ! -f "$MODULE_TREE/$metadata" ] || cp "$MODULE_TREE/$metadata" "$WORK/root-hybrid/lib/modules/$BASE_MODULE_RELEASE/"
	done
	depmod -b "$WORK/root-hybrid" "$BASE_MODULE_RELEASE"
fi

# Retain Bin 42's extra firmware blobs, but the base version wins for every
# blob used by the working kernel.
cp -a "$WORK/root-base/lib/firmware/." "$WORK/root-hybrid/lib/firmware/"

python3 "$HERE/merge-kernel-apk-db.py" \
	"$WORK/root-base/lib/apk/db/installed" \
	"$WORK/root-hybrid/lib/apk/db/installed" \
	"$WORK/installed.merged"
cp "$WORK/installed.merged" "$WORK/root-hybrid/lib/apk/db/installed"

# The base DT reports alwaylink,m01k43. Keep that identity so the base's
# generic four-LAN network rule is selected. Import only its exact LED rule;
# add the alias to Misectel's non-network defaults separately.
cp "$WORK/root-base/etc/board.d/01_leds" "$WORK/root-hybrid/etc/board.d/01_leds"
python3 - "$WORK/root-hybrid/etc/board.d/99-misectel-config" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
needle = "misectel,m01k43|\\\n"
if "alwaylink,m01k43|\\\n" not in s:
    if needle not in s:
        raise SystemExit("M01K43 defaults case not found")
    s = s.replace(needle, "alwaylink,m01k43|\\\n" + needle, 1)
p.write_text(s)
PY

cat > "$WORK/root-hybrid/etc/chester-base-kernel" <<EOF
source=OpenWrt 3fa2284d15 Linux 6.18.31 plus proven base DTB
kernel_sha256=$(sha256sum "$WORK/kernel" | awk '{print $1}')
kernel_release=$BASE_MODULE_RELEASE
userspace=ChesterK43P-Bin/42-2026-09-01-ChesterK43P-25.12.bin
EOF

step "Repacking hybrid rootfs"
mksquashfs "$WORK/root-hybrid" "$WORK/rootfs.squashfs" \
	-comp xz -Xdict-size 256K -b 262144 -noappend -nopad -no-xattrs \
	-processors "$(nproc)" >/dev/null

cat > "$WORK/ubinize.cfg" <<EOF
[kernel]
mode=ubi
image=$WORK/kernel
vol_id=0
vol_type=dynamic
vol_name=kernel
vol_alignment=1

[rootfs]
mode=ubi
image=$WORK/rootfs.squashfs
vol_id=1
vol_type=dynamic
vol_name=rootfs
vol_alignment=1

[rootfs_data]
mode=ubi
vol_id=2
vol_type=dynamic
vol_name=rootfs_data
vol_alignment=1
vol_size=1MiB
vol_flags=autoresize
EOF

mkdir -p "$(dirname "$OUT")"
ubinize -o "$OUT" -p "$PEB" -m "$MINIO" "$WORK/ubinize.cfg"
[ "$(head -c4 "$OUT")" = "UBI#" ] || die "output UBI header missing"
[ "$(dd if="$OUT" bs=1 skip=$PEB count=4 2>/dev/null)" = "UBI#" ] || die "second PEB header missing"
[ "$(stat -c%s "$OUT")" -le "$SLOT_MAX" ] || die "output exceeds flash slot"

# Re-extract the finished artifact and prove that its kernel matches the
# selected FIT. The FIT itself retains the base DTB byte-for-byte.
mkdir -p "$WORK/verify"
python3 "$HERE/ubi-extract.py" "$OUT" "$WORK/verify" >/dev/null
cmp -n "$(stat -c%s "$WORK/kernel")" "$WORK/kernel" "$WORK/verify/kernel" \
	|| die "finished-image kernel payload differs from selected FIT"
[ "$(head -c4 "$WORK/verify/rootfs")" = "hsqs" ] || die "finished rootfs is not squashfs"

step "Hybrid complete"
echo "  $OUT"
echo "  size $(stat -c%s "$OUT")"
echo "  sha256 $(sha256sum "$OUT" | awk '{print $1}')"
echo "  kernel FIT $(sha256sum "$WORK/kernel" | awk '{print $1}')"
