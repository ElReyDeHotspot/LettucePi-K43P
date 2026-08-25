#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APK="${APK_TOOLS:-/root/apk-tools/build/src/apk}"
KEY="${1:-/mnt/c/Users/CTR/claude/k43p-factory/keys/chester-apk.key}"
VERSION="${VERSION:-1.0.0-r1}"
OUT="$HERE/../luci-app-lettucepi-dashboard-$VERSION.apk"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -x "$APK" ] || { echo "apk-tools 3 not found: $APK" >&2; exit 1; }
[ -f "$KEY" ] || { echo "signing key not found: $KEY" >&2; exit 1; }

cp -a "$HERE/files/." "$STAGE/files/"
cp -a "$HERE/scripts/." "$STAGE/scripts/"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
find "$STAGE" -type f -exec sed -i 's/\r$//' {} +
chmod 0755 "$STAGE/files/usr/share/rpcd/ucode/misectel" \
           "$STAGE/files/usr/sbin/chester-modem-temp" \
           "$STAGE/files/usr/sbin/chester-phy-led" \
           "$STAGE/files/etc/init.d/chester-phy-led" \
           "$STAGE/scripts/"*

"$APK" mkpkg \
  --info "name:luci-app-lettucepi-dashboard" \
  --info "version:$VERSION" \
  --info "description:LettucePi dashboard for the Chester K43P - Overview with LED/TTL/4K-HD switches, LTE+5G signal, modem temperature, System Update, and the WAN socket LED watchdog" \
  --info "arch:aarch64_cortex-a53" \
  --info "license:MIT" \
  --info "origin:luci-app-lettucepi-dashboard" \
  --info "maintainer:ElReyDeHotspot" \
  --info "url:https://github.com/ElReyDeHotspot/LettucePi-K43P" \
  --info "depends:luci-base rpcd phytool" \
  --files "$STAGE/files" \
  --script "post-install:$STAGE/scripts/post-install" \
  --script "pre-deinstall:$STAGE/scripts/pre-deinstall" \
  --sign-key "$KEY" \
  --output "$OUT"

echo "built $OUT"
sha256sum "$OUT"
