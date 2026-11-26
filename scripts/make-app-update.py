#!/usr/bin/env python3
"""Build an immutable signed cumulative app release against an extracted ROM.

The private key is external to the repository. Kernel, calibration and customer
configuration never enter this package. Keep every previously changed path in
subsequent cumulative releases, including when restoring its ROM contents.
"""
import argparse, base64, gzip, hashlib, io, json, re, tarfile
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives import serialization

def allowed(path):
    prefixes=('www/luci-static/resources/','www/luci-static/misectel/','www/cgi-bin/chester-',
              'usr/share/luci/menu.d/','usr/share/rpcd/acl.d/','usr/share/ucode/luci/template/',
              'usr/libexec/chester-','usr/sbin/chester-','usr/lib/chester/')
    return (re.fullmatch(r'[A-Za-z0-9_./+-]+',path) and '..' not in path
            and path.startswith(prefixes) and 'kernel-profile' not in path
            and 'app-update' not in path and path not in ('usr/sbin/chester-update','usr/libexec/chester-engine'))

def main():
    p=argparse.ArgumentParser()
    for arg in ['base','payload','key','out','product','board','kernel','revision']:
        p.add_argument('--'+arg,required=True)
    p.add_argument('--notes',required=True)
    p.add_argument('--include',action='append',default=[],help='Restrict a reviewed app release to these exact paths')
    args=p.parse_args();base=Path(args.base);payload=Path(args.payload);out=Path(args.out)
    assert not out.exists(),'Published app release directories must never be overwritten'
    fields=dict(line.split('=',1) for line in (base/'etc/chester-version').read_text().splitlines() if '=' in line)
    assert fields['product']==args.product and int(args.revision)>0
    key=serialization.load_pem_private_key(Path(args.key).read_bytes(),password=None)
    entries=[];stream=io.BytesIO()
    with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,compresslevel=9) as gz:
        with tarfile.open(fileobj=gz,mode='w',format=tarfile.USTAR_FORMAT) as archive:
            for source in sorted(payload.rglob('*')):
                if not source.is_file() or source.is_symlink():continue
                rel=source.relative_to(payload).as_posix()
                if args.include and rel not in args.include:continue
                if not allowed(rel):continue
                data=source.read_bytes();old=base/rel
                old_data=old.read_bytes() if old.is_file() else None
                if data==old_data:continue
                mode=0o755 if rel.startswith(('usr/libexec/','usr/sbin/','www/cgi-bin/')) else 0o644
                entry={'path':rel,'mode':mode,'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),
                       'base_sha256':hashlib.sha256(old_data).hexdigest() if old_data is not None else ''}
                entries.append(entry);info=tarfile.TarInfo(rel);info.size=len(data);info.mode=mode;info.mtime=0
                archive.addfile(info,io.BytesIO(data))
    assert entries and len(entries)<=512 and sum(x['size'] for x in entries)<=8*1048576
    package=stream.getvalue();assert len(package)<=8*1048576
    now=datetime.now(timezone.utc);build=now.strftime('%Y%m%d%H%M%S');assert build>fields['build']
    name=f"{args.product.lower()}-apps-{args.revision}-{build}"
    repo='LettucePi-K43P' if args.product=='K43P' else 'LettucePi-K45'
    manifest={'format':1,'product':args.product,'board':args.board,'kernel':args.kernel,
              'base_build':fields['build'],'revision':int(args.revision),
              'target':{'version':fields['version'],'bin':fields['bin'],'build':build,'built':now.strftime('%Y-%m-%dT%H:%MZ')},
              'url':f'https://raw.githubusercontent.com/ElReyDeHotspot/{repo}/refs/heads/main/apps/releases/{name}/package.tgz',
              'sha256':hashlib.sha256(package).hexdigest(),'size':len(package),'notes':args.notes,'files':entries}
    raw=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
    sig=base64.b64encode(key.sign(raw))+b'\n'
    release=out/name;release.mkdir(parents=True)
    (release/'package.tgz').write_bytes(package);(release/'manifest.json').write_bytes(raw);(release/'manifest.json.sig').write_bytes(sig)
    print(json.dumps({'release':str(release),'bytes':len(package),'files':len(entries),'expanded_bytes':sum(x['size'] for x in entries)}))
if __name__=='__main__':main()
