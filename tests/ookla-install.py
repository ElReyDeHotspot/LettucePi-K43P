"""Exercise the installer in an isolated filesystem with mocked downloads."""
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SOURCE=Path(__file__).resolve().parents[1]/'payload/usr/libexec/chester-ookla-install'
PIN='3953d231da3783e2bf8904b6dd72767c5c6e533e163d3742fd0437affa431bd3'

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='chester-ookla-')
        self.root=Path(self.temp.name)
        for rel in ['usr/bin','usr/sbin','sbin','tmp/sysinfo','mockbin']:
            (self.root/rel).mkdir(parents=True,exist_ok=True)
        (self.root/'tmp/sysinfo/board_name').write_text('misectel,m01k43')
        archive=self.root/'download.tgz'
        self.engine=b'#!/bin/sh\necho fixture\n'
        with tarfile.open(archive,'w:gz') as tar:
            info=tarfile.TarInfo('speedtest');info.size=len(self.engine);info.mode=0o755
            tar.addfile(info,io.BytesIO(self.engine))
        source=SOURCE.read_text();self.assertIn('SHA='+PIN,source)
        source=source.replace(PIN,hashlib.sha256(archive.read_bytes()).hexdigest())
        source=re.sub(r'/usr/bin|/usr/sbin|/sbin|/tmp|/overlay',lambda m:str(self.root/m[0].lstrip('/')),source)
        self.script=self.root/'chester-ookla-install';self.script.write_text(source);self.script.chmod(0o755)
        self.free='16000'
        self.command('curl',f'''while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then out=$2; shift; fi; shift; done
cp '{archive}' "$out"
''')
        self.set_space('16000')
        self.env={**os.environ,'PATH':str(self.root/'mockbin')+':'+os.environ['PATH']}
    def command(self,name,body):
        p=self.root/'mockbin'/name;p.write_text('#!/bin/sh\n'+body);p.chmod(0o755)
    def set_space(self,kib):
        self.command('df',f"printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 20000 0 {kib} 0 /overlay\\n'\n")
    def run_action(self,action):
        return subprocess.run(['/bin/sh',str(self.script),action],env=self.env,capture_output=True,text=True)
    def worker(self):
        (self.root/'tmp/chester-ookla-install/lock').mkdir(parents=True)
        return self.run_action('worker')
    def tearDown(self):self.temp.cleanup()
    def test_verified_archive_installs_and_cleans_transaction(self):
        r=self.worker();self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual((self.root/'usr/bin/speedtest').read_bytes(),self.engine)
        self.assertFalse((self.root/'tmp/chester-ookla-install/lock').exists())
        self.assertFalse((self.root/'tmp/chester-ookla-install/archive.tgz').exists())
        self.assertEqual(json.loads(self.run_action('start').stdout),{'ok':True,'installed':True})
    def test_bad_hash_never_installs(self):
        (self.root/'download.tgz').write_bytes(b'wrong archive')
        self.assertNotEqual(self.worker().returncode,0)
        self.assertFalse((self.root/'usr/bin/speedtest').exists())
        self.assertIn('checksum',json.loads(self.run_action('status').stdout)['install_error'])
    def test_low_flash_never_installs(self):
        self.set_space('1024');self.assertNotEqual(self.worker().returncode,0)
        self.assertFalse((self.root/'usr/bin/speedtest').exists())
        self.assertIn('4 MiB',json.loads(self.run_action('status').stdout)['install_error'])
    def test_wrong_board_rejected(self):
        (self.root/'tmp/sysinfo/board_name').write_text('misectel,m02k45')
        self.assertFalse(json.loads(self.run_action('start').stdout)['ok'])
    def test_existing_engine_preserved(self):
        target=self.root/'usr/bin/speedtest';target.write_bytes(b'customer existing engine');target.chmod(0o755)
        self.assertEqual(self.worker().returncode,0)
        self.assertEqual(target.read_bytes(),b'customer existing engine')

if __name__=='__main__':unittest.main()
