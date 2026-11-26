#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
upstream=${NDT7_SOURCE:-https://github.com/m-lab/ndt7-client-go.git}
revision=1f6adcf81a3f29cae933a2e317e86e24826e2900
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
git clone --quiet --no-checkout "$upstream" "$build/source"
git -C "$build/source" checkout --quiet --detach "$revision"
install -D -m 0644 "$repo/integrations/ndt7/main.go" "$build/source/cmd/chester-ndt7/main.go"

cd "$build/source"
GOTOOLCHAIN=go1.27.4 CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
    go build -mod=readonly -buildvcs=false -trimpath -ldflags='-s -w -buildid=' \
    -o "$build/chester-ndt7" ./cmd/chester-ndt7
install -D -m 0755 "$build/chester-ndt7" "${1:-$repo/payload/usr/libexec/chester-ndt7}"
