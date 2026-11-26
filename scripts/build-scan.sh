#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
output=${1:-$repo/payload/usr/libexec/chester-scan}
case "$output" in /*) ;; *) output="$PWD/$output" ;; esac
cd "$repo/integrations/scan"
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -buildvcs=false \
    -ldflags='-s -w -buildid=' -o "$output" .
