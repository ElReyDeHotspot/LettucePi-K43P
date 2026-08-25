# Upgrading a Chester K43P

Every step here was run against a real unit on 2026-08-25: a factory-stock
M01K43P on OpenWrt 21.02-SNAPSHOT 2.6.0, taken to build `20260825163208`.
Where something failed, the failure is written down rather than tidied away —
that is the part worth reading.

---

## 1. Work out what the router is running

SSH in (`root`, password `admin` on stock) and run:

```sh
cat /etc/openwrt_release | grep DISTRIB_DESCRIPTION
cat /etc/chester-version 2>/dev/null
uname -r
```

| What you see | Which path |
|---|---|
| `chester-version` exists | **Path A** — it updates itself |
| `OpenWrt 21.02-SNAPSHOT`, kernel `5.4.x`, no `chester-version` | **Path B** — factory stock |
| Anything else with no `chester-version` | **Path B** |

---

## 2. Path A — already on a Chester build

**System Update**, under **Overview**. It compares the build stamped in
`/etc/chester-version` against `openwrt25/next.json`, downloads, verifies size
**and** sha256, stages the correct flash writer, and reboots.

> ⚠️ **Settings are erased.** It flashes with `sysupgrade -n`. Wi-Fi name and
> password, LAN address, admin password, APN and port forwards all return to
> defaults.

**If it says "up to date" and you know it is not, the manifest is stale, not
the router.** The check is a plain string comparison between the manifest's
`build` and the installed one, so an un-bumped `next.json` reads as "nothing to
do" rather than as an error. Fix `next.json`, not the router. This has bitten
us once already.

---

## 3. Path B — factory stock OpenWrt 21

One line, on the router, over SSH:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

It asks you to type `YES` before writing anything. To drive it unattended, add
`-s -- --yes`.

That script does four things that matter, and **all four are required**:

1. downloads the image and checks **size and sha256** before touching flash
2. **replaces `/lib/upgrade/platform.sh` with ours** (see below — this is the
   step everyone misses)
3. `sysupgrade -n`
4. our writer puts the image in **both banks**

---

## 4. Why the obvious way fails

The natural thing to try is to copy the `.bin` over and run `sysupgrade`. It
does not work, and it fails in a way that looks like success.

### First failure: the vendor image check

```
Image metadata not present
wt: board name failed(UBI#/M01K43P)
Image check failed.
```

Our images are raw UBI with no OpenWrt metadata and no vendor header, so the
stock `wt` (wtcheck) validator reads the first bytes, expects a board name and
finds `UBI#`.

### Second failure: `-F` gets past the check and still does not flash

Forcing it (`sysupgrade -F -n`) gets past the check. The unit reboots and comes
back **still on OpenWrt 21** — in our test it came back on `2.5.2` when it had
been on `2.6.0`, because it had flipped to the other bank and found an older
factory image sitting there. Nothing announced a failure.

The reason is in the stock writer:

```sh
snand_do_upgrade() {
	local mtdname="ubi2"
	dd if=$1 of=/tmp/snand-ubi.bin bs=64k skip=1     # <-- strips 64 KiB
	ubiformat /dev/${mtdpart} -y -f /tmp/snand-ubi.bin
	wtoem -r
}
```

**`skip=1` throws away the first 64 KiB.** Vendor images carry a 64 KiB signed
header in front of the UBI, so the vendor writer strips it. Ours *is* the UBI,
starting at byte 0 — so that `dd` cuts 64 KiB out of the middle of real data
and `ubiformat` writes a corrupt volume. `wtoem -r` then flips the boot bank
into the corruption, the bootloader falls back, and you land on whatever stale
image was in the other bank.

It is a good failure mode in one respect: **the dual banks mean a botched
flash does not brick the unit.** We did it twice and recovered both times.

### The fix

Replace the writer before flashing. Ours:

* does **not** skip 64 KiB — it writes the image as given
* verifies the `UBI#` magic **before erasing anything**, so a truncated
  download stops early instead of half-way through
* looks partitions up **by name**, never by number
* writes **both** `ubi` and `ubi2`, so there is no stale bank to fall back to

```sh
wget -qO /lib/upgrade/platform.sh \
  https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/platform.sh
sysupgrade -n /tmp/your-image.bin
```

With ours staged, `-F` is not needed — our `platform_check_image` returns 0.
Confirm before committing with `sysupgrade -T`: you should see only
`Image metadata not present`, and **no** `Image check failed`.

> ⚠️ **Never hardcode mtd numbers.** On stock OpenWrt 21 `ubi` is **mtd8** and
> `ubi2` is **mtd9**. On our ImmortalWrt-derived build they are **mtd7** and
> **mtd8**. A script with numbers in it writes the wrong partition, and on some
> layouts could land on the bootloader.

---

## 5. Which image — the two things called "OpenWrt 25"

* **The genuine OpenWrt 25 snapshot** has an open PCIe fault: on some units the
  modem never appears (`PCIe link down, LTSSM state: detect.quiet`). Two
  migrated clients lost their modem. **Not shipped.**
* **The published Chester builds** in `ChesterK43P-Bin/` are ImmortalWrt-derived
  and *branded* OpenWrt 25 (`rebrand.sh` rewrites the identity strings). These
  are what `install.sh` and System Update install, and the modem works.

Both report `OpenWrt 25.12-SNAPSHOT`, so the banner cannot tell them apart.
Trust the build id in `/etc/chester-version`.

---

## 6. Check it worked

```sh
cat /etc/chester-version          # build should be the new one
uname -r                          # 6.12.x, not 5.4.x
ip -4 route show default          # via rmnet_mhi0.1
ping -c2 1.1.1.1
ls /sys/bus/pci/devices/          # the modem should be present
```

From the tested run, after the upgrade:

```
kernel 6.12.85    OpenWrt 25.12-SNAPSHOT r37830+5    build 20260825163208
modem  0000:01:00.0, mhi_BHI/DIAG/DUN/QMI0, rmnet_mhi0.1 = 192.0.0.2, internet UP
```

Two things change across the upgrade and are **not** faults:

* **The PCI address moves.** Stock (kernel 5.4) had the modem at
  `0001:01:00.0`; ours (6.12) has it at `0000:01:00.0`. Any check pinned to a
  domain is wrong on one side or the other.
* **`lan4` disappears.** Kernel 5.4 declares four LAN netdevs on the M01K43P;
  6.12 declares the three that are actually wired. The dashboard asks the
  kernel what exists rather than assuming, so it shows 3 LAN + WAN here, 4 on
  an M02K43 and 5 on an M60K43 — same image, no configuration.

---

## 7. After a clean flash

* **The 2.5G socket goes back to WAN mode.** If your cable is in it you lose
  access — move to a LAN socket or join Wi-Fi, then flip it back with the
  **WAN square** on the Overview.
* **The admin password resets** to the image default.
* The **4K/HD engine ships staged, not running.** Turn it on from the Overview.

---

## 8. If it goes wrong

The unit has two banks and the bootloader falls back to the good one, so a
failed flash leaves you with a working router on an older image rather than a
brick. Get in over SSH and try again — checking that the writer was actually
staged before you do.

Verify a download by hand at any time:

```sh
sha256sum /tmp/your-image.bin
wc -c    < /tmp/your-image.bin
```

against the `sha256` and `size` in
[`openwrt25/next.json`](openwrt25/next.json).
