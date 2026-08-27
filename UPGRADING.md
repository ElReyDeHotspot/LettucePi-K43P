# Upgrading a Chester K43P

Every step here was run against a real unit on 2026-08-25: a factory-stock
M01K43P on OpenWrt 21.02-SNAPSHOT 2.6.0, taken to build `20260825163208`.
Where something failed, the failure is written down rather than tidied away —
that is the part worth reading.

---

## 1. Path A — factory stock OpenWrt 21

One line, on the router, over SSH:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

When prompted, type **`YES` (ALL CAPS)** before it writes anything. Anything
else cancels the installation.

That script does four things that matter, and **all four are required**:

1. downloads the image and checks **size and sha256** before touching flash
2. **replaces `/lib/upgrade/platform.sh` with ours** (see below — this is the
   step everyone misses)
3. `sysupgrade -n`
4. our writer puts the image in **both banks**

---

## 2. Path B — already on a Chester build

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

## 3. After a clean flash

* **The 2.5G socket goes back to WAN mode.** If your cable is in it you lose
  access — move to a LAN socket or join Wi-Fi, then flip it back with the
  **WAN square** on the Overview.
* **The admin password resets** to the image default.
* The **4K/HD engine ships staged, not running.** Turn it on from the Overview.

---

## 4. If it goes wrong

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

