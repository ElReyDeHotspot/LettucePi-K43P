#!/usr/bin/env python3
"""Deduplicate captured FITs without changing either reconstructed profile."""
import base64,hashlib,json
from pathlib import Path

def compact(root):
    folder=Path(root)/'usr/lib/chester'
    paths={name:folder/f'kernel-profile-{name}.fit' for name in ['pcie','usb3']}
    if not all(p.exists() for p in paths.values()):
        assert (folder/'kernel-profiles.json').is_file(),'Missing captured modem profiles'
        return
    data={name:p.read_bytes() for name,p in paths.items()}
    assert all(x.startswith(b'\xd0\x0d\xfe\xed') for x in data.values())
    metadata={'profiles':{},'patches':{}}
    for name,target in data.items():
        source=data['usb3' if name=='pcie' else 'pcie'];patches=[];start=None;last=None
        for i,value in enumerate(target):
            if i>=len(source) or value!=source[i]:
                if start is None:start=i
                elif i-last>16:
                    patches.append({'offset':start,'data':base64.b64encode(target[start:last+1]).decode()});start=i
                last=i
        if start is not None:patches.append({'offset':start,'data':base64.b64encode(target[start:last+1]).decode()})
        reconstructed=bytearray(source[:len(target)]);reconstructed.extend(b'\0'*(len(target)-len(reconstructed)))
        for patch in patches:
            chunk=base64.b64decode(patch['data']);reconstructed[patch['offset']:patch['offset']+len(chunk)]=chunk
        assert bytes(reconstructed)==target,'Profile reconstruction must be byte-identical'
        metadata['profiles'][name]={'size':len(target),'sha256':hashlib.sha256(target).hexdigest()};metadata['patches'][name]=patches
    encoded=(json.dumps(metadata,separators=(',',':'))+'\n').encode();assert len(encoded)<131072
    (folder/'kernel-profiles.json').write_bytes(encoded)
    for path in paths.values():path.unlink()
    print('Captured profiles compacted:',sum(map(len,data.values())),'->',len(encoded),'bytes; both reconstructed profiles verified identical')
if __name__=='__main__':
    import sys
    compact(sys.argv[1])
