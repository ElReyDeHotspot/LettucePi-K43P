#!/bin/sh
# Stage the matching dual-bank writer before uploading the sysupgrade image in LuCI.
set -eu

URL="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/25-Base-Image/platform.sh"
DEST=/lib/upgrade/platform.sh
TMP=/tmp/platform.sh.m01k43

[ "$(id -u)" = 0 ] || { echo "Run as root" >&2; exit 1; }
[ -r /etc/chester-version ] || { echo "This is only for an existing Chester build" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

curl -fsSL "$URL" -o "$TMP"
grep -q 'BASE_UBI_SHA256="491591f36efd91979775bc19b9e7253ac3b9ab645543eb181904e98f497e20aa"' "$TMP" || {
	echo "Downloaded writer failed identity check" >&2
	rm -f "$TMP"
	exit 1
}
grep -q 'base_extract_ubi' "$TMP" || { echo "Downloaded writer is incomplete" >&2; rm -f "$TMP"; exit 1; }
cp "$DEST" "$DEST.before-m01k43-base" 2>/dev/null || true
cp "$TMP" "$DEST"
rm -f "$TMP"
echo "Writer staged. Upload m01k43-5g-openwrt25-sysupgrade.bin in LuCI."
echo "Do not upload the raw *-base.bin file in LuCI."
