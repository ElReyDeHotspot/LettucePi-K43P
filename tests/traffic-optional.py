"""Exercise optional installation and rollback using isolated files/services."""
from pathlib import Path
import os,subprocess,tempfile,json
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='chester-traffic-package-') as temp:
    root=Path(temp);engine=root/'chester-engine';engine.write_text('shared engine fixture');engine.chmod(0o755)
    service=root/'service';service.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$SERVICE_LOG"\n[ "$1" != start ] || [ "${FAIL_START:-0}" = 0 ]\n');service.chmod(0o755)
    source=(repo/'payload/usr/libexec/chester-traffic-package').read_text(encoding='utf-8')
    replacements={'/etc/chester-traffic.installed':str(root/'installed'),'/usr/libexec/chester-traffic':str(root/'chester-traffic'),'/usr/libexec/chester-engine':str(engine),'/var/lock/chester-traffic-package.lock':str(root/'lock'),'/etc/init.d/chester_traffic':str(service)}
    for old,new in replacements.items():source=source.replace(old,new)
    helper=root/'package';helper.write_text(source);helper.chmod(0o755)
    env=dict(os.environ,SERVICE_LOG=str(root/'calls'))
    def run(action,**extra):return subprocess.run([str(helper),action],env=env|extra,capture_output=True,text=True)
    assert json.loads(run('status').stdout)=={'installed':False}
    assert run('install').returncode==0
    assert (root/'chester-traffic').is_symlink() and (root/'installed').exists()
    assert json.loads(run('status').stdout)=={'installed':True}
    assert run('uninstall').returncode==0
    assert not (root/'chester-traffic').exists() and not (root/'installed').exists()
    assert run('install',FAIL_START='1').returncode!=0
    assert not (root/'installed').exists() and not (root/'chester-traffic').exists()
    assert engine.read_text()=='shared engine fixture'
    assert run('install;reboot').returncode==2
    print('PASS optional Live Traffic: absent by default, explicit install/uninstall, failed-start rollback and shared engine preserved.')
