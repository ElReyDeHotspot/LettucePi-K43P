#!/bin/bash
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
work=${1:?Provide a fresh absolute Linux build directory}
sdk=${2:?Provide the ImmortalWrt 25.12.1 filogic SDK directory}
references=${3:?Provide BIN60 lib/modules/6.12.85}
[[ "$work" = /* && ! -e "$work" ]]
sdk=$(realpath -e "$sdk")
references=$(realpath -e "$references")
revision=f08ddcbc32c60d84e6116bc700fbab226994423f
mkdir "$work"
cd "$work"

curl -fsSL --retry 2 -o linux.tar.xz https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.85.tar.xz
printf '%s\n' 'e35ac999f40a6874493d8d60f33f1150d7a89ae5841c428da82257fbcd070aed  linux.tar.xz' | sha256sum -c -
tar -xf linux.tar.xz
git init -q source
git -C source remote add origin https://github.com/immortalwrt/immortalwrt.git
git -C source fetch --depth 1 origin "$revision"
git -C source checkout --detach FETCH_HEAD
for directory in source/target/linux/generic/files source/target/linux/mediatek/{files,files-6.12}; do
    cp -a "$directory/." linux-6.12.85/
done
for directory in source/target/linux/generic/{backport,pending,hack}-6.12 source/target/linux/mediatek/patches-6.12; do
    source/scripts/patch-kernel.sh linux-6.12.85 "$directory"
done

cp "$here/kernel.config" linux-6.12.85/.config
# The reference kernel has MODVERSIONS disabled. This is a symbol inventory for
# modpost only. The reference comparison below is the ABI check for these objects.
cp "$sdk/build_dir/target-aarch64_cortex-a53_musl/linux-mediatek_filogic/linux-6.12.94/Module.symvers" linux-6.12.85/Module.symvers
export STAGING_DIR="$sdk/staging_dir"
export PATH="$STAGING_DIR/toolchain-aarch64_cortex-a53_gcc-14.3.0_musl/bin:$PATH"
cd linux-6.12.85
make_args=(ARCH=arm64 CROSS_COMPILE=aarch64-openwrt-linux-musl- KCFLAGS=-fno-caller-saves)
make "${make_args[@]}" olddefconfig modules_prepare
grep -qx '# CONFIG_MODVERSIONS is not set' .config
make "${make_args[@]}" -j"${JOBS:-8}" net/netfilter/{nfnetlink,nf_conntrack,nf_tables,nft_ct}.o
python3 "$here/verify-reference.py" "$references" "$PWD" > "$work/reference-validation.json"
make "${make_args[@]}" -j"${JOBS:-8}" M=net/netfilter nfnetlink_queue.ko nft_queue.ko
mkdir "$work/modules"
cp net/netfilter/{nfnetlink_queue,nft_queue}.ko "$work/modules/"
aarch64-openwrt-linux-musl-strip --strip-debug "$work/modules/"*.ko
(cd "$work/modules"; sha256sum nfnetlink_queue.ko nft_queue.ko)
