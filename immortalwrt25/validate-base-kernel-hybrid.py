#!/usr/bin/env python3
"""Offline invariants for a Bin 42 userspace + base-kernel root filesystem."""

import pathlib
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: validate-base-kernel-hybrid.py EXTRACTED_ROOTFS")

root = pathlib.Path(sys.argv[1])
required = [
    "usr/sbin/chester-update",
    "www/luci-static/resources/view/misectel-dashboard/overview.js",
    "etc/config/misectel",
    "usr/sbin/chester-zapret",
    "etc/init.d/chester-sqm",
    "usr/libexec/lettucepi-speedtest",
    "lib/modules/6.18.31/pcie_mhi.ko",
    "etc/chester-base-kernel",
]
missing_files = [name for name in required if not (root / name).exists()]
if missing_files:
    raise SystemExit("required Chester/base files missing: " + ", ".join(missing_files))

module_releases = sorted(p.name for p in (root / "lib/modules").iterdir() if p.is_dir())
if module_releases != ["6.18.31"]:
    raise SystemExit(f"wrong module releases: {module_releases}")

module_dir = root / "lib/modules/6.18.31"
modules = {p.name: p for p in module_dir.glob("*.ko")}
required_modules = {
    "tun.ko", "wireguard.ko", "macvlan.ko", "ppp_mppe.ko", "pptp.ko",
    "l2tp_ppp.ko", "cls_bpf.ko", "cls_flower.ko", "act_vlan.ko",
    "nft_compat.ko", "ip6_tables.ko", "xfrm_user.ko", "cbc.ko",
    "echainiv.ko", "huawei_cdc_ncm.ko", "pcie_mhi.ko", "mt7915e.ko",
}
missing_modules = sorted(required_modules - modules.keys())
if missing_modules:
    raise SystemExit("required 6.18.31 modules missing: " + ", ".join(missing_modules))

vermagic = b"vermagic=6.18.31 SMP mod_unload aarch64"
bad_vermagic = sorted(name for name, path in modules.items() if vermagic not in path.read_bytes())
if bad_vermagic:
    raise SystemExit("modules with incompatible vermagic: " + ", ".join(bad_vermagic))

for path in [root / "lib/modules", root / "etc/modules.d", root / "etc/modules-boot.d"]:
    targets = [path] if path.is_file() else list(path.rglob("*"))
    for target in targets:
        if target.is_file() and b"6.12.85" in target.read_bytes():
            raise SystemExit(f"stale 6.12.85 reference: {target}")

leds = (root / "etc/board.d/01_leds").read_text(encoding="utf-8")
defaults = (root / "etc/board.d/99-misectel-config").read_text(encoding="utf-8")
if "alwaylink,m01k43)" not in leds:
    raise SystemExit("base board LED rule missing")
if "alwaylink,m01k43|\\\n" not in defaults:
    raise SystemExit("Chester defaults do not recognize the base board name")

print(f"validated {len(modules)} modules with exact 6.18.31 vermagic")
print("validated required Chester networking/VPN/modem module set")
print("validated Chester UI/services and base M01K43 board mapping")
