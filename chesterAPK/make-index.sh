#!/bin/bash
# Rebuild and sign the chesterAPK index.
#
#   ./make-index.sh /path/to/chester-apk.key [/path/to/apk-tools3/apk]
#
# Needs apk-tools 3 (v3 writes packages.adb; Ubuntu's apk-tools is v2 and
# writes APKINDEX.tar.gz, which OpenWrt 25 cannot read).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KEY="${1:-}"
APK="${2:-/root/apk-tools/build/src/apk}"

[ -n "$KEY" ] && [ -f "$KEY" ] || { echo "usage: $0 <signing-key.key> [apk-tools3-binary]" >&2; exit 2; }
[ -x "$APK" ] || { echo "ERROR: apk-tools 3 not found at $APK" >&2; exit 1; }

cd "$HERE"
shopt -s nullglob
pkgs=(*.apk)
[ ${#pkgs[@]} -gt 0 ] || { echo "ERROR: no .apk files here - an empty index cannot be signed" >&2; exit 1; }

echo "indexing ${#pkgs[@]} package(s)"
# --allow-untrusted: the packages are signed with OUR key, which this build
# host does not carry in its trust store. The index itself is signed below.
"$APK" mkndx --allow-untrusted --output packages.adb "${pkgs[@]}"
"$APK" adbsign --allow-untrusted --sign-key "$KEY" packages.adb

echo "signed index: $(stat -c%s packages.adb) bytes"
"$APK" adbdump packages.adb | sed -n '/^packages:/,$p' | head -20
echo
echo "sha256 $(sha256sum packages.adb | awk '{print $1}')"
echo "Commit packages.adb together with the .apk files."
