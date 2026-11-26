from pathlib import Path
import tempfile,runpy,json
prune=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/prune-legacy-vpn.py'))['prune']
with tempfile.TemporaryDirectory(prefix='chester-vpn-prune-') as tmp:
 root=Path(tmp);(root/'etc').mkdir();(root/'etc/openwrt_release').write_text('test')
 for rel in ['usr/sbin/xl2tpd','lib/netifd/proto/pptp.sh','usr/lib/pppd/2.5.2/pptp.so','www/luci-static/resources/protocol/l2tp.js','lib/modules/6.12.94/pptp.ko','lib/firmware/mediatek/eeprom.bin','lib/netifd/proto/pppoe.sh','usr/sbin/openvpn']:
  p=root/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'preserve-or-remove-test')
 menu=root/'usr/share/luci/menu.d/vpn.json';menu.parent.mkdir(parents=True);menu.write_text(json.dumps({'admin/vpn/pptp':{},'admin/vpn/l2tp':{},'admin/vpn':{},'admin/developer/zerotier':{}}))
 prune(root)
 assert not (root/'usr/sbin/xl2tpd').exists();assert not (root/'usr/lib/pppd/2.5.2/pptp.so').exists()
 for rel in ['lib/modules/6.12.94/pptp.ko','lib/firmware/mediatek/eeprom.bin','lib/netifd/proto/pppoe.sh','usr/sbin/openvpn']:assert (root/rel).read_bytes()==b'preserve-or-remove-test'
 assert set(json.loads(menu.read_text()))=={'admin/vpn','admin/developer/zerotier'}
 prune(root)
print('PASS legacy client pruning, idempotence, kernel/calibration/PPPoE/OpenVPN preservation and menu relocation.')
