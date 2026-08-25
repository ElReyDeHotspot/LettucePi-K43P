#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APK="${APK_TOOLS:-/root/apk-tools/build/src/apk}"
KEY="${1:-/mnt/c/Users/CTR/claude/k43p-factory/keys/chester-apk.key}"
VERSION="${VERSION:-1.0.2-r1}"
OUT="$HERE/../luci-app-lettucepi-zapret-$VERSION.apk"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -x "$APK" ] || { echo "apk-tools 3 not found: $APK" >&2; exit 1; }
[ -f "$KEY" ] || { echo "signing key not found: $KEY" >&2; exit 1; }

cp -a "$HERE/files/." "$STAGE/files/"
cp -a "$HERE/scripts/." "$STAGE/scripts/"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
# Windows checkouts can carry CRLF; a shell script with CRLF fails with a
# confusing "not found" on the target. The tpws binary is excluded -- sed
# would corrupt it.
find "$STAGE/files" -type f ! -name tpws -exec sed -i 's/\r$//' {} +
find "$STAGE/scripts" -type f -exec sed -i 's/\r$//' {} +
chmod 0755 "$STAGE/files/usr/sbin/tpws" \
           "$STAGE/files/usr/sbin/chester-zapret" \
           "$STAGE/files/usr/sbin/chester-videotest" \
           "$STAGE/files/etc/init.d/chester-tpws" \
           "$STAGE/scripts/"*

"$APK" mkpkg \
  --info "name:luci-app-lettucepi-zapret" \
  --info "version:$VERSION" \
  --info "description:4K/HD video engine (tpws) - defeats carrier video throttling, with an A/B streaming test" \
  --info "arch:aarch64_cortex-a53" \
  --info "license:MIT" \
  --info "origin:luci-app-lettucepi-zapret" \
  --info "maintainer:ElReyDeHotspot" \
  --info "url:https://github.com/ElReyDeHotspot/LettucePi-K43P" \
  --info "depends:luci-base rpcd nftables-json" \
  --files "$STAGE/files" \
  --script "post-install:$STAGE/scripts/post-install" \
  --script "pre-deinstall:$STAGE/scripts/pre-deinstall" \
  --sign-key "$KEY" \
  --output "$OUT"

echo "built $OUT"
sha256sum "$OUT"
