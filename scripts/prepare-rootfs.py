#!/usr/bin/env python3
"""Stage next-BIN payload and remove retired VPN clients before squashfs packing."""
from pathlib import Path
import runpy
import shutil
import sys

root = Path(sys.argv[1]).resolve()
repo = Path(__file__).resolve().parents[1]
assert root != Path(root.anchor) and (root / 'etc/openwrt_release').is_file()
# Replace only our known multicall aliases before overlaying regular payloads.
aliases = ['usr/libexec/chester-traffic','usr/libexec/chester-ndt7','usr/libexec/chester-scan','usr/libexec/chester-app-update','usr/sbin/chester-simd']
for name in aliases:
    path=root/name
    if path.is_symlink():
        assert path.resolve()==(root/'usr/libexec/chester-engine').resolve()
        path.unlink()
shutil.copytree(repo / 'payload', root, dirs_exist_ok=True)
# Ookla is optional; M-Lab remains in the compact native suite.
for name in ['usr/bin/speedtest', 'usr/sbin/speedtest', 'sbin/speedtest']:
    binary=root/name
    if binary.is_file() or binary.is_symlink():
        binary.unlink()

# Set runtime permissions explicitly, including when staged from a Windows checkout.
for folder in ['usr/libexec', 'usr/sbin', 'usr/bin', 'etc/init.d', 'etc/hotplug.d', 'etc/uci-defaults', 'etc/odhcp6c.user.d', 'lib/netifd', 'www/cgi-bin']:
    for source in (repo / 'payload' / folder).rglob('*'):
        if source.is_file():
            (root / source.relative_to(repo / 'payload')).chmod(0o755)
runpy.run_path(str(repo / 'scripts/prune-legacy-vpn.py'))['prune'](root)
assert (root / 'www/luci-static/resources/view/misectel-vpn/chester-client.js').is_file()

rc=root / "etc/rc.d/S04chester_app_recover"
rc.parent.mkdir(parents=True, exist_ok=True)
if not rc.exists():
    rc.symlink_to("../init.d/chester_app_recover")

# Both vendor FITs remain reconstructable byte for byte from the kernel volume.
runpy.run_path(str(repo / "scripts/compact-kernel-profiles.py"))["compact"](root)

engine=root/'usr/libexec/chester-engine'
assert engine.is_file(), 'Build the native suite before staging firmware'
engine.chmod(0o755)
for name in aliases:
    path=root/name
    path.unlink(missing_ok=True)
    path.symlink_to('../libexec/chester-engine' if name.startswith('usr/sbin/') else 'chester-engine')
