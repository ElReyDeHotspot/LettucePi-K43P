#!/usr/bin/env python3
"""Run migration installer fixtures without router or flash access."""
from pathlib import Path
import hashlib,json,os,subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
source=(repo/'openwrt25/install.sh').read_text(encoding='utf-8')
base='https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P'
commit='a'*40
with tempfile.TemporaryDirectory(prefix='chester-migration-') as tmp:
 root=Path(tmp);(root/'bin').mkdir();(root/'sysinfo').mkdir();(root/'sysinfo/board_name').write_text('M01K43P\n');(root/'sysinfo/model').write_text('Chester K43P\n')
 (root/'mtd').write_text('mtd8: 04000000 00020000 "ubi"\nmtd9: 04000000 00020000 "ubi2"\n')
 image=bytearray(1048576);image[:4]=b'UBI#';image[131072:131076]=b'UBI#';(root/'image.bin').write_bytes(image)
 default={'family':'Immortal-Chester-25','version':'25.12','build':'20261126152923','bin':'64','size':str(len(image)),'sha256':hashlib.sha256(image).hexdigest(),'url':base+'/main/ChesterK43P-Bin/64-2026-11-26-ChesterK43P-25.12.bin'}
 (root/'ref.json').write_text(json.dumps({'object':{'sha':commit}}));(root/'writer').write_text('snand_do_upgrade() { :; }\n')
 (root/'bin/curl').write_text('''#!/bin/sh
url=; out=
while [ "$#" -gt 0 ]; do
 case "$1" in -o) shift;out=$1;; https:*) url=$1;; esac
 shift
done
printf '%s\n' "$url" >> "$TEST_ROOT/requests"
case "$url" in
 https://api.github.com/*) file=ref.json;;
 */aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/openwrt25/latest.json) file=manifest.json;;
 */aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ChesterK43P-Bin/*.bin) file=image.bin;;
 */aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/openwrt25/platform.sh) file=writer;;
 *) exit 22;;
esac
if [ -n "$out" ]; then cp "$TEST_ROOT/$file" "$out";else cat "$TEST_ROOT/$file";fi
''')
 (root/'bin/id').write_text('#!/bin/sh\necho 0\n');(root/'bin/df').write_text('#!/bin/sh\nprintf "Filesystem 1K-blocks Used Available Use%% Mounted\\ntmpfs 100000 1000 99000 1%% /tmp\\n"\n')
 (root/'bin/sysupgrade').write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$TEST_ROOT/flashed"\n')
 # Explicitly test the vendor fallback parser even if jsonfilter exists on host.
 (root/'bin/jsonfilter').write_text('#!/bin/sh\nexit 127\n')
 for p in (root/'bin').iterdir():p.chmod(0o755)
 script=source.replace('/tmp/sysinfo/',str(root/'sysinfo')+'/').replace('/proc/mtd',str(root/'mtd')).replace('/etc/chester-family',str(root/'family')).replace('/etc/chester-version',str(root/'version')).replace('/etc/openwrt_release',str(root/'openwrt_release')).replace('/usr/sbin/chester-update',str(root/'updater')).replace('/lib/upgrade/platform.sh',str(root/'platform.sh')).replace('/tmp/snand-ubi.bin',str(root/'download.bin')).replace('/tmp/platform.sh.new',str(root/'platform.new')).replace('/dev/tty',str(root/'no-tty')).replace('command -v jsonfilter','command -v no_jsonfilter_fixture')
 (root/'install.sh').write_text(script);env=dict(os.environ,PATH=str(root/'bin')+':'+os.environ['PATH'],TEST_ROOT=str(root))
 def run(mode,changes=None,args=('--dry-run',),image_data=None,expect=True):
  m=dict(default);m.update(changes or {});(root/'manifest.json').write_text(json.dumps(m,indent=2));(root/'platform.sh').write_text('original writer\n');(root/'image.bin').write_bytes(image_data if image_data is not None else image)
  for name in ['flashed','requests']:(root/name).unlink(missing_ok=True)
  proc=subprocess.run(['sh',str(root/'install.sh'),*args],env=env,capture_output=True,text=True,timeout=15)
  assert (proc.returncode==0)==expect,(mode,proc.stdout,proc.stderr)
  if expect and args==('--yes',):assert (root/'flashed').read_text().splitlines()==['-n',str(root/'download.bin')]
  else:
   assert not (root/'flashed').exists(),mode
   assert (root/'platform.sh').read_text()=='original writer\n',mode
  return proc
 run('latest-bin64')
 future=dict(bin='65',build='20261127120000',url=base+'/main/ChesterK43P-Bin/65-2026-11-27-ChesterK43P-25.12.bin');run('future-bin65',future)
 run('unattended-approved-fixture',args=('--yes',))
 for mode,changes in [('wrong-family',{'family':'Other'}),('wrong-host',{'url':'https://example.com/image.bin'}),('wrong-board-image',{'url':base+'/main/ChesterK43P-Bin/64-K45P.bin'}),('invalid-sha',{'sha256':'x'*64}),('invalid-build',{'build':'oops'}),('oversized',{'size':'33554433'}),('bad-size',{'size':'1048577'}),('checksum',{'sha256':'0'*64})]:run(mode,changes,expect=False)
 bad=bytearray(image);bad[131072:131076]=b'NOPE';run('bad-ubi-header',{'sha256':hashlib.sha256(bad).hexdigest()},image_data=bad,expect=False)
 (root/'sysinfo/board_name').write_text('misectel,m02k45\n');run('reject-k45p',expect=False);(root/'sysinfo/board_name').write_text('M01K43P\n')
 run('no-confirmation-no-write',args=(),expect=False)
 truncated=script.rsplit('lp_main "$@"',1)[0];(root/'install.sh').write_text(truncated);run('truncated-download-no-execution');assert not (root/'requests').exists()
 print('PASS migration: dynamic BIN64/BIN65, immutable commit URLs, size/hash/UBI checks, board guard, dry-run/cancel without staging, and explicit clean-install invocation.')
