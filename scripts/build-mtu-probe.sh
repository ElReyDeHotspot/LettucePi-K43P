#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
: "${CC:=aarch64-openwrt-linux-musl-gcc}"
"$CC" -Os -static -s -Wall -Wextra -Werror -fstack-protector-strong -D_FORTIFY_SOURCE=2 -o "$repo/payload/usr/libexec/chester-mtu-probe" "$repo/integrations/mtu/probe.c"
sha256sum "$repo/payload/usr/libexec/chester-mtu-probe"
