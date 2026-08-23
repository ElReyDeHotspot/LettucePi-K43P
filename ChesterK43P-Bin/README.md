# ChesterK43P-Bin — firmware image archive

Every image built for the Chester K43P, oldest first. Filenames carry the
sequence and build date so the folder lists chronologically.

**Filenames never change once published.** The System Update page points
`openwrt25/latest.json` straight at the current entry here, so renaming one
would break the download for anyone mid-update. Which build is current is
recorded in the table below, not in the filename.

**To install firmware, use the [guide](../openwrt25/README.md), not this
folder.** This is an archive for reference and rollback.

| # | Date | Image | Size | What it is |
|---|---|---|---|---|
| 01 | 2026-07-01 | `immortalwrt-25.12-upstream-ubi` | 24.1 MB | Upstream ImmortalWrt 25.12 for this board. Not built here — the base everything else derives from. |
| 02 | 2026-08-20 | `LettucePi-1.0.0-vendorfw` | 21.6 MB | ⛔ First factory image for the **vendor** firmware. **Do not flash** — see below. |
| 03 | 2026-08-21 | `LettucePi-1.0.1-vendorfw` | 21.6 MB | Same, with the recursion bug fixed. |
| 04 | 2026-08-21 | `LettucePi-1.0.2-vendorfw` | 21.6 MB | Built outside the session that produced the others; contents not verified here. |
| 05 | 2026-08-21 | `LettucePi-1.0.3-vendorfw` | 21.6 MB | As above. |
| 06 | 2026-08-21 | `immortalwrt-25.12-LPMAIN1wrapped` | 24.2 MB | Upstream ImmortalWrt wrapped as a signed LPMAIN1 image. Validated by the wrapper on hardware, never booted. |
| 07 | 2026-08-21 | `07-...-ChesterK43P-25.12` | 30.0 MB | Superseded. Shipped Tailscale inside the image, which is why it is 7.5 MB larger. |
| 08 | 2026-08-22 | `08-...-ChesterK43P-25.12` | 22.5 MB | ✅ **Current.** US APN dropdowns; Tailscale removed from the image and installed on demand. |

## SHA-256

```
8223b357e9cd98b22a5824689f04fccd678f3d39170dae7f126009b3720cb5ed  01-2026-07-01-immortalwrt-25.12-upstream-ubi.bin
c9e46eaadb0ccb1166aac96a15726c460c05fad4636731c5bbfc7066e36e78d2  02-2026-08-20-LettucePi-1.0.0-vendorfw.bin
43f43cf7dd2660ed70dd2f455fa7f9f8789e7e6f9817799abb5548c846811e17  03-2026-08-21-LettucePi-1.0.1-vendorfw.bin
1bca77ffb71eee2d2cc616184218e121910e40c6a8094f5cdc09491c234563d3  04-2026-08-21-LettucePi-1.0.2-vendorfw.bin
a634b5838cf63aa05d4a821620e668684db2f473949fa3a4ab596f203e9d5268  05-2026-08-21-LettucePi-1.0.3-vendorfw.bin
ed780b13ed23b705f5418d3b4e927435bd12bdd1c494ac796948e09f92907e01  06-2026-08-21-immortalwrt-25.12-LPMAIN1wrapped.bin
659dc1760a03ceb8528eb0920c0c6e3becd0cfde4eb8aac1eebb7d76c09d01d7  07-2026-08-21-ChesterK43P-25.12.bin
81fef58b48d88a524a4edf96c89e243f67ad7b9b1af0991f8d389a2bda8ccfd8  08-2026-08-22-ChesterK43P-25.12.bin
```

## Two different formats in here

**01, 07 and 08 are raw UBI** (`UBI#` at offset 0). These are what `sysupgrade`
flashes via the OpenWrt 25 method.

**02–06 are LPMAIN1** — a 64 KiB signed header followed by a raw UBI payload.
They only validate on a router carrying the wtcheck wrapper, which is
**discontinued**. Kept for the record.

## ⛔ Why 1.0.0 must not be flashed

Its wtcheck wrapper delegates non-LettucePi images to `/rom/sbin/wtcheck` — but
once the wrapper is baked into the image it *is* `/rom/sbin/wtcheck`, so it
exec'd itself forever. Observed on hardware: load climbing 1.9 → 4.5, five stuck
processes, the upgrade never returning. It also overwrote the vendor validator
without keeping a copy, leaving the router unable to validate genuine vendor
firmware at all.

Fixed in 1.0.1: the wrapper prefers `/sbin/wtcheck.vendor`, skips any candidate
containing its own marker, and refuses to delegate twice.

## Rolling back

These are firmware images, not a revert button. Flashing writes **both** flash
banks, so there is no fallback afterwards, and 02–06 need the wrapper installed
to validate at all. The genuine escape hatch is the raw bank dumps taken before
the first flash — they live outside this repo with the build secrets.
