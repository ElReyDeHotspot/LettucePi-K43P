#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APK="${APK_TOOLS:-/root/apk-tools/build/src/apk}"
KEY="${1:-/mnt/c/Users/CTR/claude/k43p-factory/keys/chester-apk.key}"
VERSION="${VERSION:-1.0.1-r1}"
OUT="$HERE/../luci-app-lettucepi-sqm-$VERSION.apk"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -x "$APK" ] || { echo "apk-tools 3 not found: $APK" >&2; exit 1; }
[ -f "$KEY" ] || { echo "signing key not found: $KEY" >&2; exit 1; }

cp -a "$HERE/files/." "$STAGE/files/"
cp -a "$HERE/scripts/." "$STAGE/scripts/"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
# Windows checkouts carry CRLF, and a shell script with CRLF fails on the target
# with a "not found" that names the interpreter rather than the problem.
find "$STAGE" -type f -exec sed -i 's/\r$//' {} +
chmod 0755 "$STAGE/files/etc/init.d/chester-sqm" \
           "$STAGE/files/etc/hotplug.d/iface/95-chester-sqm" \
           "$STAGE/scripts/"*

# Checked here rather than discovered on a flashed box: a CRLF or a missing
# execute bit on the init script produces a service that simply never runs.
sh -n "$STAGE/files/etc/init.d/chester-sqm" || { echo "init script does not parse" >&2; exit 1; }
sh -n "$STAGE/scripts/post-install"          || { echo "post-install does not parse" >&2; exit 1; }
sh -n "$STAGE/scripts/pre-deinstall"         || { echo "pre-deinstall does not parse" >&2; exit 1; }
# All three off, not just the master. The rates in this file are placeholders,
# not measurements, so no direction may shape until someone chooses it.
for k in enabled upload_enabled download_enabled; do
	grep -q "option $k '0'" "$STAGE/files/usr/share/chester-sqm/chester_sqm.default" \
		|| { echo "default config must ship $k='0' - a guessed rate is a silent throttle" >&2; exit 1; }
done

# tc-full is NOT a declared dependency. It conflicts with the tc-tiny the image
# ships, so apk would refuse the install rather than resolve it; the image build
# swaps the two instead. The service probes for every qdisc it uses and reports
# what is missing, so on a box without it the page says so rather than lying.
"$APK" mkpkg \
  --info "name:luci-app-lettucepi-sqm" \
  --info "version:$VERSION" \
  --info "description:Smart Queue - upload shaping (tbf + fq_codel) and download policing (nftables), sized for the cellular uplink" \
  --info "arch:aarch64_cortex-a53" \
  --info "license:MIT" \
  --info "origin:luci-app-lettucepi-sqm" \
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
