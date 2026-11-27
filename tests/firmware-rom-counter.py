"""Exercise full-firmware discovery independently of overlay app timestamps."""
from pathlib import Path
import json,os,subprocess,tempfile
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='chester-rom-counter-') as temp:
    root=Path(temp);(root/'bin').mkdir()
    (root/'rom-version').write_text('version=25.12\nbuild=20261126152923\nbin=64\nbuilt=2026-11-26\n')
    (root/'app-version').write_text('version=25.12\nbuild=20261201000000\nbin=64\napp_revision=2\n')
    release={'family':'Immortal-Chester-25','version':'25.12','build':'20261127003030','built':'2026-11-27','bin':'65','sha256':'a'*64,'size':29491200,'url':'https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/BIN/65.bin','notes':'Firmware fixture'}
    (root/'manifest').write_text(json.dumps(release))
    curl=root/'bin/curl';curl.write_text('#!/bin/sh\ncat "$TEST_MANIFEST"\n');curl.chmod(0o755)
    source=(repo/'payload/usr/sbin/chester-update').read_text(encoding='utf-8').replace('/rom/etc/chester-version',str(root/'rom-version')).replace('/etc/chester-version',str(root/'app-version')).replace('. /usr/lib/chester/ota-resources.sh',': # isolated status fixture')
    script=root/'updater';script.write_text(source);script.chmod(0o755)
    result=json.loads(subprocess.check_output([str(script),'firmware-status'],env=dict(os.environ,PATH=str(root/'bin')+':'+os.environ['PATH'],TEST_MANIFEST=str(root/'manifest'))))
    assert result['installed_build']=='20261126152923' and result['latest_bin']=='65' and result['update_available'] is True,result
    (root/'rom-version').write_text('version=25.12\nbuild=20261127003030\nbin=65\n')
    result=json.loads(subprocess.check_output([str(script),'firmware-status'],env=dict(os.environ,PATH=str(root/'bin')+':'+os.environ['PATH'],TEST_MANIFEST=str(root/'manifest'))))
    assert result['update_available'] is False,result
    print('PASS full firmware: BIN64 sees BIN65 even with later overlay app timestamp; installed BIN65 is current. No install command executed.')
