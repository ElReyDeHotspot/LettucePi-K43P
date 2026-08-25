#!/usr/bin/env python3
"""Pull the named volumes out of a raw UBI image.

    ubi-extract.py <image.bin> <outdir> [--peb 131072]

Writes one file per volume, named after the volume ("kernel", "rootfs", ...),
and prints a table of what it found.

Why this exists rather than ubi_reader: the daily image build needs to unpack
a stock .bin every time, and this is the only step that was never scripted --
kernel.bin and rootfs.raw were produced by hand once and then assumed to be
lying around. A dependency that has to be pip-installed on every build host is
a worse answer than eighty lines that only use the standard library.

UBI layout, briefly: the image is a flat run of physical erase blocks. Each one
opens with an EC header giving the offsets of the two things after it; at
vid_hdr_offset sits a VID header naming the volume and the logical block index;
at data_offset sits the payload. Volume *names* live in their own volume
(0x7FFFEFFF), as a table of 172-byte records.
"""

import struct
import sys
import os

EC_MAGIC = b'UBI#'
VID_MAGIC = b'UBI!'
LAYOUT_VOL = 0x7FFFEFFF
VTBL_REC = 172


def parse(image, peb_size):
    blocks = {}          # vol_id -> {lnum: bytes}
    with open(image, 'rb') as fh:
        data = fh.read()

    if len(data) % peb_size:
        sys.stderr.write("warning: image is not a whole number of %d-byte PEBs\n"
                         % peb_size)

    for off in range(0, len(data) - peb_size + 1, peb_size):
        peb = data[off:off + peb_size]
        if peb[:4] != EC_MAGIC:
            continue                      # erased or padding

        vid_off, data_off = struct.unpack_from('>II', peb, 0x10)
        if peb[vid_off:vid_off + 4] != VID_MAGIC:
            continue                      # EC header only: a free block

        vol_id, lnum = struct.unpack_from('>II', peb, vid_off + 0x08)
        data_size, = struct.unpack_from('>I', peb, vid_off + 0x14)

        # Dynamic volumes leave data_size 0 and fill the block; static ones
        # (the kernel) declare the real length and pad the rest.
        payload = peb[data_off:data_off + data_size] if data_size else peb[data_off:]
        blocks.setdefault(vol_id, {})[lnum] = payload

    return blocks


def volume_names(blocks):
    names = {}
    layout = blocks.get(LAYOUT_VOL)
    if not layout:
        return names
    tbl = b''.join(layout[k] for k in sorted(layout))
    for i in range(0, len(tbl) - VTBL_REC + 1, VTBL_REC):
        rec = tbl[i:i + VTBL_REC]
        reserved, = struct.unpack_from('>I', rec, 0)
        name_len, = struct.unpack_from('>H', rec, 0x0E)
        if not reserved or not 0 < name_len <= 127:
            continue
        name = rec[0x10:0x10 + name_len].decode('utf-8', 'replace')
        if name:
            names[i // VTBL_REC] = name
    return names


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    peb = 131072
    for a in sys.argv[1:]:
        if a.startswith('--peb'):
            peb = int(a.split('=', 1)[1]) if '=' in a else peb

    if len(args) < 2:
        sys.exit(__doc__)

    image, outdir = args[0], args[1]
    os.makedirs(outdir, exist_ok=True)

    blocks = parse(image, peb)
    names = volume_names(blocks)

    if not blocks:
        sys.exit("ERROR: no UBI blocks found - wrong PEB size, or not a raw UBI image")

    print("  %-6s %-14s %8s  %s" % ("vol", "name", "blocks", "output"))
    wrote = 0
    for vol_id in sorted(blocks):
        if vol_id == LAYOUT_VOL:
            print("  %-6s %-14s %8d  (volume table)" % (vol_id, "layout", len(blocks[vol_id])))
            continue
        name = names.get(vol_id, "vol%d" % vol_id)
        body = b''.join(blocks[vol_id][k] for k in sorted(blocks[vol_id]))
        path = os.path.join(outdir, name)
        with open(path, 'wb') as fh:
            fh.write(body)
        print("  %-6s %-14s %8d  %s (%d bytes)"
              % (vol_id, name, len(blocks[vol_id]), path, len(body)))
        wrote += 1

    if not wrote:
        sys.exit("ERROR: volume table found but no data volumes extracted")


if __name__ == '__main__':
    main()
