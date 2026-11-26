# Upgrading a Chester K43P

The factory OpenWrt 21 migration was originally tested on a real M10K43P
running OpenWrt 21.02-SNAPSHOT 2.6.0. The current installer follows the latest
published full firmware instead of a fixed BIN number.

---

## 1. Path A — factory stock OpenWrt 21

One line, on the router, over SSH:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/refs/heads/main/openwrt25/install.sh | sh
```

The installer selects the **latest published full BIN** on each run. It fetches
the manifest, image and flash writer from one Git commit, then checks the image
size, SHA-256 and UBI headers.

**This is a clean OpenWrt 21 → 25 migration: settings are erased and both firmware
banks are overwritten.** When prompted, type **`YES` (ALL CAPS)** to continue.
Anything else cancels before the flash writer is replaced or firmware is written.

That script does four things that matter, and **all four are required**:

1. downloads the image and checks **size and sha256** before touching flash
2. **replaces `/lib/upgrade/platform.sh` with ours** (see below — this is the
   step everyone misses)
3. `sysupgrade -n`
4. our writer puts the image in **both banks**

---

## 2. Path B — already on a Chester build

Open **Overview → Update** or **System → System Update**.

Current builds check the signed app-update channel. Small app updates verify
firmware compatibility and file checksums, preserve settings, and restart the
router without replacing its kernel or calibration.

Older builds may first offer a full BIN update. Keep **Keep My Settings** enabled
when that option is offered. The migration command in Path A always performs a
clean installation and erases settings.

If no update appears, use **Check for Updates** on the System Update page.
Overview caches successful checks for up to 15 minutes and retries failed checks
after one minute.

---

## 3. After a clean flash

* **The 2.5G socket goes back to WAN mode.** If your cable is in it you lose
  access — move to a LAN socket or join Wi-Fi, then flip it back with the
  **WAN square** on the Overview.
* **The admin password resets** to the image default.
* The **4K/HD engine ships staged, not running.** Turn it on from the Overview.

---

## 4. If it goes wrong

The migration writer overwrites both firmware banks, so the old firmware is
**not retained as a fallback**. Do not disconnect power during installation.
Recovery from an interrupted flash may require TFTP or serial access.

Verify a download by hand at any time:

```sh
sha256sum /tmp/your-image.bin
wc -c    < /tmp/your-image.bin
```

against the `sha256` and `size` in
[`openwrt25/next.json`](openwrt25/next.json).

