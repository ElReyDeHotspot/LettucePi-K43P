#!/usr/bin/env python3
"""Exercise the real updater with isolated fake services, downloads and flash."""
from pathlib import Path
import hashlib
import json
import os
import signal
import subprocess
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]


def wait_for(check, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if check():
            return
        time.sleep(.04)
    raise AssertionError('Timed out waiting for the test condition')


def fixture(root, mode='success', memory=18000, gain=12000, off=()):
    root.mkdir()
    for name in ['bin', 'init', 'services']:
        (root / name).mkdir()
    (root / 'memory').write_text(str(memory))
    (root / 'rules').write_text('unchanged')
    (root / 'version').write_text('version=25.12\nbuild=20261126061312\nbin=61\n')
    (root / 'board').write_text('misectel,m01k43\n')
    (root / 'mtd').write_text('mtd7: 03800000 00020000 "ubi"\nmtd8: 03800000 00020000 "ubi2"\n')
    image = b'UBI#' + bytes(range(256)) * 256
    (root / 'image').write_bytes(image)
    sha = hashlib.sha256(image).hexdigest()
    release = dict(family='Immortal-Chester-25', version='25.12', build='20261126999999',
                   bin='62', size=str(len(image)), sha256=sha,
                   url='https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/test.bin')
    (root / 'manifest').write_text(json.dumps(release, indent=2))
    for name in ['chester_sim', 'chester_traffic', 'ttyd']:
        (root / 'services' / name).write_text('0' if name in off else '1')
        service = f'''#!/bin/sh
r={str(root)!r}
n={name}
case "$1" in
status) [ "$(cat "$r/services/$n")" = 1 ];;
stop)
 printf 'stop %s\\n' "$n" >> "$r/events"
 if [ "$(cat "$r/services/$n")" = 1 ]; then
  echo 0 > "$r/services/$n"
  echo "$(( $(cat "$r/memory") + {gain} ))" > "$r/memory"
 fi
 [ "$n" != chester_traffic ] || [ "{mode}" != firewall-change ] || echo changed > "$r/rules"
 ;;
start)
 printf 'start %s\\n' "$n" >> "$r/events"
 if [ "$(cat "$r/services/$n")" = 0 ]; then
  echo 1 > "$r/services/$n"
  echo "$(( $(cat "$r/memory") - {gain} ))" > "$r/memory"
 fi
 echo unchanged > "$r/rules"
 ;;
esac
'''
        (root / 'init' / name).write_text(service)
        (root / 'init' / name).chmod(0o755)
    curl = f'''#!/bin/sh
r={str(root)!r}
dest=
while [ "$#" -gt 0 ]; do
 case "$1" in -o) shift; dest=$1;; esac
 shift
done
if [ -z "$dest" ]; then cat "$r/manifest"; exit 0; fi
echo download >> "$r/events"
case {mode!r} in
download-failure) head -c 4096 "$r/image" > "$dest"; exit 7;;
hang) head -c 4096 "$r/image" > "$dest"; exec sleep 60;;
checksum-failure) cp "$r/image" "$dest"; printf X | dd of="$dest" bs=1 seek=12 conv=notrunc 2>/dev/null;;
*) cp "$r/image" "$dest";;
esac
'''
    (root / 'bin/curl').write_text(curl)
    (root / 'bin/curl').chmod(0o755)
    (root / 'flash').write_text(f'#!/bin/sh\necho flash >> {str(root / "events")!r}\nexit 9\n')
    (root / 'flash').chmod(0o755)
    library = (REPO / 'payload/usr/lib/chester/ota-resources.sh').read_text()
    library += f'''
ota_available() {{ cat {str(root / 'memory')!r}; }}
ota_reclaim_cache() {{ :; }}
ota_service_rss() {{ echo 1024; }}
ota_rules_hash() {{ cat {str(root / 'rules')!r}; }}
'''
    (root / 'resources.sh').write_text(library)
    source = (REPO / 'payload/usr/sbin/chester-update').read_text()
    replacements = {
        '/usr/lib/chester/ota-resources.sh': str(root / 'resources.sh'),
        '/etc/chester-version': str(root / 'version'),
        '/tmp/chester-update.log': str(root / 'log'),
        '/tmp/snand-ubi.bin': str(root / 'staged.bin'),
        '/tmp/chester-update-job.json': str(root / 'job.json'),
        '/var/lock/chester-update.lock': str(root / 'update.lock'),
        '/var/lock': str(root / 'locks'),
        '/tmp/sysinfo/board_name': str(root / 'board'),
        '/proc/mtd': str(root / 'mtd'),
        'sysupgrade -F': str(root / 'flash') + ' -F',
    }
    for old, new in replacements.items():
        source = source.replace(old, new)
    (root / 'update').write_text(source)
    (root / 'update').chmod(0o755)
    env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'],
               OTA_RES_DIR=str(root / 'state'), OTA_INIT_DIR=str(root / 'init'))
    return env, sha, len(image)


def restored(root, off=()):
    assert not (root / 'state').exists(), 'Recovery journal was not cleaned'
    for file in (root / 'services').iterdir():
        assert file.read_text().strip() == ('0' if file.name in off else '1'), file
    assert (root / 'rules').read_text().strip() == 'unchanged'


with tempfile.TemporaryDirectory(prefix='chester-ota-tests-') as tmp:
    top = Path(tmp)
    for mode, memory, gain, off in [
        ('success', 18000, 12000, ('ttyd',)),
        ('download-failure', 18000, 12000, ()),
        ('checksum-failure', 18000, 12000, ()),
        ('insufficient-memory', 10000, 1000, ()),
        ('firewall-change', 10000, 10000, ()),
    ]:
        root = top / mode
        env, sha, size = fixture(root, mode, memory, gain, off)
        result = subprocess.run([str(root / 'update'), 'download-only'], env=env,
                                capture_output=True, text=True, timeout=15)
        assert (result.returncode == 0) == (mode == 'success'), (mode, result.stdout, result.stderr)
        wait_for(lambda: not (root / 'state').exists())
        restored(root, off)
        events = (root / 'events').read_text()
        assert 'flash' not in events
        if mode == 'insufficient-memory':
            assert 'download' not in events
        if off:
            assert 'stop ttyd' not in events and 'start ttyd' not in events
        print('PASS', mode, flush=True)

    for sig in [signal.SIGTERM, signal.SIGKILL]:
        root = top / ('signal-' + str(int(sig)))
        env, _, _ = fixture(root, 'hang')
        process = subprocess.Popen([str(root / 'update'), 'download-only'], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_for(lambda: (root / 'state/downloader').exists())
        downloader = int((root / 'state/downloader').read_text().split()[0])
        process.send_signal(sig)
        process.wait(timeout=8)
        wait_for(lambda: not (root / 'state').exists(), timeout=12)
        restored(root)
        stat = Path('/proc') / str(downloader) / 'stat'
        assert not stat.exists() or stat.read_text().split()[2] == 'Z', 'Orphan downloader still running'
        print('PASS signal recovery', sig.name, flush=True)

    root = top / 'memory-pressure'
    env, _, _ = fixture(root, 'hang')
    process = subprocess.Popen([str(root / 'update'), 'download-only'], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: (root / 'state/downloader').exists())
    (root / 'memory').write_text('1000')
    process.wait(timeout=12)
    wait_for(lambda: not (root / 'state').exists())
    restored(root)
    assert process.returncode != 0
    assert 'preserve the RAM safety reserve' in (root / 'log').read_text()
    print('PASS memory-pressure download cancellation and restoration', flush=True)

    root = top / 'flash-failure'
    env, sha, size = fixture(root, memory=18000)
    (root / 'staged.bin').write_bytes((root / 'image').read_bytes())
    result = subprocess.run(['/bin/sh', '-c', 'exec 9>"$1/update.lock"; exec "$1/update" run-local "$2" "$3" 1',
                             'test', str(root), sha, str(size)], env=env,
                            capture_output=True, text=True, timeout=15)
    assert result.returncode != 0, result
    wait_for(lambda: not (root / 'state').exists())
    restored(root)
    assert 'flash' in (root / 'events').read_text()
    assert 'Sysupgrade did not accept' in (root / 'job.json').read_text()
    print('PASS flash rejection restores services', flush=True)

    root = top / 'flash-handoff'
    env, sha, size = fixture(root, memory=18000)
    (root / 'staged.bin').write_bytes((root / 'image').read_bytes())
    library = (root / 'resources.sh').read_text().replace('sleep 30', 'sleep .1')
    library += f'\nota_upgrade_active() {{ [ -f {str(root / "flash-active")!r} ]; }}\n'
    (root / 'resources.sh').write_text(library)
    (root / 'flash').write_text(f'''#!/bin/sh
echo $$ > {str(root / 'flash-pid')!r}
touch {str(root / 'flash-active')!r}
exec sleep 60
''')
    process = subprocess.Popen(['/bin/sh', '-c', 'exec 9>"$1/update.lock"; exec "$1/update" run-local "$2" "$3" 1',
                                'test', str(root), sha, str(size)], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(lambda: (root / 'flash-active').exists())
    process.kill()
    process.wait(timeout=5)
    time.sleep(.5)
    assert (root / 'state/phase').read_text().strip() == 'flashing'
    assert (root / 'services/chester_sim').read_text().strip() == '0', 'Restored services into an active flash'
    (root / 'flash-active').unlink()
    os.kill(int((root / 'flash-pid').read_text()), signal.SIGTERM)
    wait_for(lambda: not (root / 'state').exists())
    restored(root)
    print('PASS native flash handoff never restarts services into a flash', flush=True)

    root = top / 'restore-retry'
    env, _, _ = fixture(root, 'download-failure')
    (root / 'fail-start-once').touch()
    service = root / 'init/chester_sim'
    service.write_text(service.read_text().replace('start)\n',
                       'start)\n if [ -f "$r/fail-start-once" ]; then rm -f "$r/fail-start-once"; exit 1; fi\n'))
    result = subprocess.run([str(root / 'update'), 'download-only'], env=env,
                            capture_output=True, text=True, timeout=15)
    assert result.returncode != 0
    wait_for(lambda: not (root / 'state').exists(), timeout=12)
    restored(root)
    assert 'Retry needed to restore chester_sim' in (root / 'log').read_text()
    print('PASS failed service restart is retried by recovery watchdog', flush=True)

print('PASS OTA resource tests; no real network, services, firewall or flash accessed.')
