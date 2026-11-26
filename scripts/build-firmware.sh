#!/bin/sh
# Explicit full-image builder. Routine app updates use make-app-update.py.
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
base=${1:?extracted vendor-compatible root required}
kernel=${2:?captured kernel UBI volume image required}
output=${3:?new output image required}
bin=${4:?new firmware BIN number required}
case "$bin" in ''|*[!0-9]*) exit 2;; esac
[ ! -e "$output" ] || { echo 'Refusing to overwrite an existing image' >&2; exit 1; }
work=$(mktemp -d /var/tmp/chester-k43-build.XXXXXX)
cp -a "$base" "$work/root"
python3 "$repo/scripts/prepare-rootfs.py" "$work/root"
for name in lib/modules lib/firmware etc/board.d etc/config/network etc/config/wireless lib/upgrade/platform.sh; do
 diff -qr "$base/$name" "$work/root/$name"
done
printf 'version=25.12\nbuilt=%s\nbuild=%s\nbin=%s\nproduct=K43P\n' "$(date -u +%FT%H:%MZ)" "$(date -u +%Y%m%d%H%M%S)" "$bin" > "$work/root/etc/chester-version"
mksquashfs "$work/root" "$work/rootfs" -comp xz -Xdict-size 1M -b 1048576 -noappend -nopad -no-xattrs -no-progress
# Empty rootfs_data reserves space at attach time and contributes no data PEBs.
python3 - "$kernel" "$work/rootfs" <<'PY'
from pathlib import Path
import sys
pebs=sum((Path(p).stat().st_size+126975)//126976 for p in sys.argv[1:])+2
size=pebs*131072
assert size<=32*1048576, f'K43P image would exceed the 32 MiB limit: {size} bytes'
print(f'Image size preflight: {size/1048576:.3f} MiB; limit 32 MiB')
PY
cat > "$work/ubinize.cfg" <<EOF
[kernel]
mode=ubi
image=$kernel
vol_id=0
vol_type=dynamic
vol_name=kernel
vol_alignment=1
[rootfs]
mode=ubi
image=$work/rootfs
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
ubinize -o "$output" -p 128KiB -m 2048 -s 2048 "$work/ubinize.cfg"
[ "$(stat -c %s "$output")" -le 33554432 ]
python3 -m ubireader.scripts.ubireader_extract_images -o "$work/check" "$output"
cmp "$kernel" "$work"/check/*/*_vol-kernel.ubifs
cmp -n "$(stat -c %s "$work/rootfs")" "$work/rootfs" "$work"/check/*/*_vol-rootfs.ubifs
sha256sum "$output"
echo "Build validation retained at $work"
