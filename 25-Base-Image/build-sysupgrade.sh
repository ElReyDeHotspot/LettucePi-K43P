#!/bin/sh
# Build the LuCI/sysupgrade container without modifying the raw UBI artifact.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RAW="$HERE/m01k43-5g-openwrt25-base.bin"
OUT="$HERE/m01k43-5g-openwrt25-sysupgrade.bin"
FWTOOL=${FWTOOL:-fwtool}
EXPECTED_SHA256="491591f36efd91979775bc19b9e7253ac3b9ab645543eb181904e98f497e20aa"

command -v "$FWTOOL" >/dev/null 2>&1 || {
	echo "fwtool is required (OpenWrt project/fwtool)" >&2
	exit 1
}
[ "$(sha256sum "$RAW" | awk '{print $1}')" = "$EXPECTED_SHA256" ] || {
	echo "raw UBI SHA-256 mismatch" >&2
	exit 1
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM
DIR="$WORK/sysupgrade-m01k43_5g"
mkdir -p "$DIR"
printf 'BOARD=m01k43_5g\n' > "$DIR/CONTROL"
cp "$RAW" "$DIR/ubi"

(cd "$WORK" && tar --format=ustar -cf "$OUT" sysupgrade-m01k43_5g)
"$FWTOOL" -I "$HERE/metadata.json" "$OUT"

"$FWTOOL" -i "$WORK/metadata.check.json" "$OUT"
cmp "$HERE/metadata.json" "$WORK/metadata.check.json"
tar -xOf "$OUT" sysupgrade-m01k43_5g/ubi > "$WORK/ubi.check"
[ "$(sha256sum "$WORK/ubi.check" | awk '{print $1}')" = "$EXPECTED_SHA256" ]
sha256sum "$OUT"
