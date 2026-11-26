#!/usr/bin/env python3
"""Stage next-BIN payload and remove retired VPN clients before squashfs packing."""
from pathlib import Path
import runpy
import shutil
import sys

root = Path(sys.argv[1]).resolve()
repo = Path(__file__).resolve().parents[1]
assert root != Path(root.anchor) and (root / 'etc/openwrt_release').is_file()
shutil.copytree(repo / 'payload', root, dirs_exist_ok=True)
# Set runtime permissions explicitly, including when staged from a Windows checkout.
for folder in ['usr/libexec', 'usr/sbin', 'usr/bin', 'etc/init.d', 'etc/hotplug.d', 'etc/uci-defaults', 'etc/odhcp6c.user.d', 'lib/netifd']:
    for source in (repo / 'payload' / folder).rglob('*'):
        if source.is_file():
            (root / source.relative_to(repo / 'payload')).chmod(0o755)
runpy.run_path(str(repo / 'scripts/prune-legacy-vpn.py'))['prune'](root)
assert (root / 'www/luci-static/resources/view/misectel-vpn/chester-client.js').is_file()
