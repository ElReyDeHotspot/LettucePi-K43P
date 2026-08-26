#!/bin/bash
# Build a Chester K43P .bin, start to finish.
#
#     ./build-bin.sh [base.bin] [version]
#
# Run it from Windows with:
#
#     wsl -d Ubuntu -u root -- bash /mnt/c/.../immortalwrt25/build-bin.sh
#
# What it does:
#
#   1. extracts the kernel and rootfs volumes out of a stock UBI image
#   2. stages everything onto ext4
#   3. runs rebrand.sh, which rebrands the rootfs and bakes in our packages
#   4. writes a dated .bin into ChesterK43P-Bin/ and prints its sha256
#
# Why the staging step: rebrand.sh has to create device nodes and symlinks
# inside the rootfs, and DrvFs (/mnt/c) cannot do either. Building directly on
# the Windows drive produces an image that boots to a broken /dev. Everything
# therefore happens under /root and only the finished .bin is copied back.
#
# Why the extract step: kernel.bin and rootfs.raw used to be produced by hand
# and left lying in this directory. That worked exactly once. Extracting them
# from a named base image on every run is what makes the build repeatable --
# and it means the base is a stated input rather than whatever was left over.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

BASE="${1:-$REPO/ChesterK43P-Bin/01-2026-07-01-immortalwrt-25.12-upstream-ubi.bin}"
VERSION="${2:-25.12}"
BRAND="${BRAND:-Chester K43P}"

# ext4. Not /mnt/c -- see above.
WORK="${WORK:-/root/k43p-build}"
STAGE="$WORK/stage"
OUTDIR="$REPO/ChesterK43P-Bin"

step(){ printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die(){ printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

case "$WORK" in
	/mnt/*) die "WORK is on DrvFs ($WORK). rebrand.sh cannot create device nodes there." ;;
esac

[ -f "$BASE" ] || die "base image not found: $BASE"
for t in unsquashfs mksquashfs ubinize python3 curl; do
	command -v "$t" >/dev/null || die "$t missing"
done

step "Base image"
echo "  $BASE"
echo "  $(stat -c%s "$BASE") bytes, sha256 $(sha256sum "$BASE" | cut -c1-16)..."
[ "$(head -c4 "$BASE")" = "UBI#" ] || die "not a raw UBI image"

step "Extracting volumes"
rm -rf "$WORK/extract"; mkdir -p "$WORK/extract"
python3 "$HERE/ubi-extract.py" "$BASE" "$WORK/extract"
[ -f "$WORK/extract/kernel" ] || die "no kernel volume in the base image"
[ -f "$WORK/extract/rootfs" ] || die "no rootfs volume in the base image"
[ "$(head -c4 "$WORK/extract/rootfs")" = "hsqs" ] || die "rootfs volume is not squashfs"

step "Staging onto ext4"
rm -rf "$STAGE"; mkdir -p "$STAGE"

# rebrand.sh reads every input as a sibling of itself, so the staging area has
# to be assembled deliberately. These used to be scattered across three
# directories and copied by hand, which is why a build would get most of the
# way through and then die on a missing file. Everything is listed here, and
# anything absent is reported up front rather than eight minutes in.
#
#   <name>:<source>    -- source is relative to the repo, or absolute
STAGE_INPUTS="
rebrand.sh:$HERE/rebrand.sh
ubi-extract.py:$HERE/ubi-extract.py
header.ut:$HERE/header.ut
footer.ut:$HERE/footer.ut
apn-us.json:$HERE/apn-us.json
chester-ui:$HERE/chester-ui
lettucepi-theme:$HERE/lettucepi-theme
chester-apk.pem:$REPO/chesterAPK/chester-apk.pem
luci-chester-update:$REPO/luci-chester-update
wizard-patches:$HERE/wizard-patches
"

missing=""
for spec in $STAGE_INPUTS; do
	name="${spec%%:*}"; src="${spec#*:}"
	[ -e "$src" ] || missing="$missing $name"
done
# lettucepi-theme is only read when WITH_LETTUCEPI=1, so its absence is not
# fatal at the default setting.
if [ -n "$missing" ]; then
	for m in $missing; do
		[ "$m" = "lettucepi-theme" ] && [ "${WITH_LETTUCEPI:-0}" = 0 ] && continue
		die "build input missing: $m (looked beside $HERE and in $REPO)"
	done
fi

for spec in $STAGE_INPUTS; do
	name="${spec%%:*}"; src="${spec#*:}"
	[ -e "$src" ] || continue
	cp -a "$src" "$STAGE/$name"
	printf '  %-22s %s\n' "$name" \
		"$([ -d "$src" ] && echo "$(find "$src" -type f | wc -l) files" || stat -c'%s bytes' "$src")"
done

# The System Update page reflashes with the same both-banks writer the
# installer uses. rebrand.sh looks for it at a path relative to itself that
# only resolved from the old hand-run location, so it is placed where the
# in-tree fallback finds it.
if [ -f "$REPO/openwrt25/platform.sh" ]; then
	cp "$REPO/openwrt25/platform.sh" "$STAGE/luci-chester-update/platform.sh"
	printf '  %-22s %s bytes\n' "platform.sh" "$(stat -c%s "$STAGE/luci-chester-update/platform.sh")"
else
	die "openwrt25/platform.sh missing - the System Update page cannot flash both banks without it"
fi

cp "$WORK/extract/kernel" "$STAGE/kernel.bin"
cp "$WORK/extract/rootfs" "$STAGE/rootfs.raw"
chmod +x "$STAGE/rebrand.sh"
printf '  %-22s %s bytes\n' "kernel.bin" "$(stat -c%s "$STAGE/kernel.bin")"
printf '  %-22s %s bytes\n' "rootfs.raw" "$(stat -c%s "$STAGE/rootfs.raw")"

step "Rebranding"
# Point the package source at this checkout, so a package built minutes ago is
# picked up without having to publish it first.
# Work out the sequence number NOW, not at publish time. rebrand.sh writes
# /etc/chester-version, so the number has to exist before it runs or it
# cannot be stamped into the image -- and a router that cannot read its own
# bin number cannot show it on the update page.
N=$(ls "$OUTDIR" 2>/dev/null | sed -n 's/^\([0-9]\{2\}\)-.*/\1/p' | sort -n | tail -1)
N=$(printf '%02d' $(( 10#${N:-0} + 1 )))
echo "  this build will be bin $N"

APKSRC="$REPO/chesterAPK" BIN_NUMBER="$N" bash "$STAGE/rebrand.sh" "$BRAND" "$VERSION"

BIN=$(ls -t "$STAGE/out"/*.bin 2>/dev/null | head -1)
[ -n "$BIN" ] || die "rebrand.sh produced no image"

step "Publishing the image"
mkdir -p "$OUTDIR"
# $N was fixed before the build so it could be stamped into the image;
# recomputing it here would risk the filename disagreeing with the stamp.
OUT="$OUTDIR/$N-$(date +%Y-%m-%d)-ChesterK43P-$VERSION.bin"
cp "$BIN" "$OUT"

echo "  $OUT"
echo "  $(stat -c%s "$OUT") bytes"
echo "  sha256 $(sha256sum "$OUT" | awk '{print $1}')"
printf '\n\033[1mDone.\033[0m Flash with: sysupgrade -n <image>  (writes both banks)\n\n'
