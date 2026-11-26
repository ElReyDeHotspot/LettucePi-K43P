#!/usr/bin/env python3
"""Run the real worker in isolated paths with a deterministic upstream stub."""
from pathlib import Path
import json,os,subprocess,tempfile,time
repo=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='chester-update-test-') as temp:
 root=Path(temp);(root/'version').write_text('build=202611260020\n');calls=root/'calls';mode=root/'mode';mode.write_text('success')
 mock=root/'updater';mock.write_text('''#!/bin/sh
printf x >> "$TEST_CALLS"
sleep 0.2
mode=$(cat "$TEST_MODE")
case "$mode" in
success) printf '{"ok":true,"release_verified":true,"latest_build":"202611240004","latest_bin":"20","installed_build":"202611260020","installed_bin":"20","installed_app":0,"latest_app":1,"app_update":true,"update_available":true}';;
failure) printf '{"ok":false}';;
malformed) printf '{broken';;
esac
''');mock.chmod(0o755)
 env=dict(os.environ,TEST_CALLS=str(calls),TEST_MODE=str(mode))
 source=(repo/'payload/usr/libexec/chester-update-refresh').read_text(encoding='utf-8')
 source=source.replace('/tmp/chester-update-',str(root/'chester-update-')).replace('/usr/sbin/chester-update',str(mock)).replace('/etc/chester-version',str(root/'version'))
 worker=root/'worker';worker.write_text(source);worker.chmod(0o755)
 def run():subprocess.run(['sh',str(worker)],check=True,env=env)
 cache=root/'chester-update-summary.json'
 jobs=[subprocess.Popen(['sh',str(worker)],env=env) for _ in range(8)]
 assert all(job.wait()==0 for job in jobs)
 assert calls.read_text()=='x',('Concurrent checks',calls.read_text(),cache.read_text())
 result=json.loads(cache.read_text());assert result['release_verified'] and result['latest_bin']=='20' and result['latest_app']==1 and result['app_update'] and result['update_available'] and result['installed_app']==0 and result['schema']==2
 run();assert calls.read_text()=='x','Fresh success was fetched again'
 result['schema']=1;cache.write_text(json.dumps(result));run();assert calls.read_text()=='xx','Old cache was not upgraded'
 calls.write_text('x');result=json.loads(cache.read_text())
 result['checked_at']=int(time.time())-901;cache.write_text(json.dumps(result));mode.write_text('failure');run()
 assert calls.read_text()=='xx' and not json.loads(cache.read_text())['ok']
 run();assert calls.read_text()=='xx','Fresh failure should briefly back off'
 result=json.loads(cache.read_text());result['checked_at']=int(time.time())-61;cache.write_text(json.dumps(result));mode.write_text('malformed');run()
 assert calls.read_text()=='xxx' and not json.loads(cache.read_text())['ok']
 assert (root/'chester-update-refresh.flock').is_file()
 assert not list(root.glob('chester-update-summary.*')) or list(root.glob('chester-update-summary.*'))==[cache]
 print('PASS update worker: single concurrent fetch, cached success, failure backoff, malformed-result fallback and cleanup.')
