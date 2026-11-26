#!/usr/bin/env python3
"""Publish a signed no-update baseline alongside every new firmware base."""
import argparse,base64,hashlib,json
from pathlib import Path
from cryptography.hazmat.primitives import serialization
p=argparse.ArgumentParser()
for arg in ['root','board','kernel','key','channel']:p.add_argument('--'+arg,required=True)
a=p.parse_args();fields=dict(line.split('=',1) for line in (Path(a.root)/'etc/chester-version').read_text().splitlines() if '=' in line)
key=serialization.load_pem_private_key(Path(a.key).read_bytes(),password=None)
m={'format':1,'product':fields['product'],'board':a.board,'kernel':a.kernel,'base_build':fields['build'],'revision':0,
   'target':{k:fields[k] for k in ['version','build','built','bin']},'url':'','sha256':hashlib.sha256(b'').hexdigest(),'size':0,'files':[],
   'notes':'All current app updates are included in this firmware. Your settings are preserved during routine app updates.'}
raw=(json.dumps(m,sort_keys=True,separators=(',',':'))+'\n').encode();dest=Path(a.channel)/'bases'/fields['build'];dest.mkdir(parents=True,exist_ok=True)
(dest/'latest.json').write_bytes(raw);(dest/'latest.json.sig').write_bytes(base64.b64encode(key.sign(raw))+b'\n')
print('Signed app baseline prepared for',fields['product'],fields['build'])
