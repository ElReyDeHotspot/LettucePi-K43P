#!/usr/bin/env python3
"""Remove retired PPTP/L2TP clients from an extracted image, preserving the vendor kernel."""
from pathlib import Path
import json
import sys

FILES = (
    'usr/sbin/xl2tpd', 'usr/sbin/xl2tpd-control', 'etc/init.d/xl2tpd',
    'etc/config/xl2tp', 'etc/ppp/options.pptp', 'etc/ppp/options.xl2tpd',
    'etc/xl2tpd/xl2tp-secrets', 'etc/xl2tpd/xl2tpd.conf',
    'lib/netifd/proto/l2tp.sh', 'lib/netifd/proto/pptp.sh',
    'www/luci-static/resources/protocol/l2tp.js', 'www/luci-static/resources/protocol/pptp.js',
    'www/luci-static/resources/view/misectel-vpn/l2tp.js',
    'www/luci-static/resources/view/misectel-vpn/pptp.js',
)


def prune(root):
    root = Path(root).resolve()
    if root == Path(root.anchor) or not (root / 'etc/openwrt_release').is_file():
        raise ValueError('An extracted OpenWrt image root is required')
    paths = [root / rel for rel in FILES]
    paths += list((root / 'usr/lib/pppd').glob('*/pptp.so'))
    paths += list((root / 'usr/lib/pppd').glob('*/pppol2tp.so'))
    paths += list((root / 'etc/rc.d').glob('*xl2tpd'))
    for path in paths:
        # Do not follow a symlinked parent out of the staging root.
        if not path.parent.resolve().is_relative_to(root):
            raise ValueError('Unsafe image path: ' + str(path))
        path.unlink(missing_ok=True)
    for path in (root / 'usr/share/luci/menu.d').glob('*.json'):
        if path.is_symlink():
            raise ValueError('Unexpected symlinked menu')
        data = json.loads(path.read_text())
        kept = {key: value for key, value in data.items()
                if not any(part in ('l2tp', 'pptp', 'gateway-l2tp', 'gateway-pptp', 'vpn-l2tp', 'vpn-pptp')
                           for part in key.split('/'))}
        if kept != data:
            path.write_text(json.dumps(kept, indent=2) + '\n')
    # Kernel modules, PPP/PPPoE, WireGuard, OpenVPN and all calibration stay untouched.


if __name__ == '__main__':
    prune(sys.argv[1])
