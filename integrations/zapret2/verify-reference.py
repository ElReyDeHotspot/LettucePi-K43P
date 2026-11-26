#!/usr/bin/env python3
"""Compare relevant ELF sections in vendor .ko files and rebuilt reference .o files."""
from pathlib import Path
import hashlib
import json
import struct
import sys


def sections(path):
    data = path.read_bytes()
    assert data[:6] == b'\x7fELF\x02\x01', 'Expected little-endian ELF64'
    offset = struct.unpack_from('<Q', data, 40)[0]
    size, count, names = struct.unpack_from('<HHH', data, 58)
    headers = [struct.unpack_from('<IIQQQQIIQQ', data, offset + i * size) for i in range(count)]
    strings = data[headers[names][4]:headers[names][4] + headers[names][5]]
    return {strings[h[0]:].split(b'\0')[0].decode(): data[h[4]:h[4] + h[5]]
            for h in headers if h[1] != 8}


vendor = Path(sys.argv[1])  # directory containing nfnetlink.ko, nf_conntrack.ko, etc.
rebuilt = Path(sys.argv[2]) / 'net/netfilter'
report = {}
for module in ('nfnetlink', 'nf_conntrack', 'nf_tables', 'nft_ct'):
    original = sections(vendor / (module + '.ko'))
    candidate = sections(rebuilt / (module + '.o'))
    report[module] = {}
    for name in ('.text', '.rodata', '.data', '.init.text', '.exit.text'):
        assert name in original and name in candidate
        match = original[name] == candidate[name]
        report[module][name] = {'match': match, 'bytes': len(original[name]),
                                'sha256': hashlib.sha256(original[name]).hexdigest()}
        assert match, f'{module}: {name} differs; do not load the queue modules'
print(json.dumps(report, indent=2))
