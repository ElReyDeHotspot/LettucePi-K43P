# Upgrade your Chester K43P to OpenWrt 25

This replaces the router's firmware with **OpenWrt 25 (ImmortalWrt 25.12)**.

Your router downloads everything itself — you don't copy any files.

---

## ⚠ Read this first

This is not reversible.

- **Everything on the router is erased** — settings, packages, passwords, Wi-Fi names.
- **Both firmware banks are replaced**, so there is no "go back" option afterwards.
- **The router's address changes.** After it reboots it will no longer be at
  `192.168.100.1`.
- **Do not power the router off while it is flashing.** If it is interrupted,
  getting it working again needs special recovery equipment.

Your router must be **connected to the internet** for this to work.

If any of that is a problem, stop here.

---

## What you need

- The router powered on and **online**
- A computer on the same network
- An SSH program — **Terminal** on Mac/Linux, or **PuTTY** / Windows Terminal on Windows

---

## Step 1 — Connect to the router

```sh
ssh root@192.168.100.1
```

Password: `admin`

First time only, it asks whether to trust the router — answer `yes`.

## Step 2 — Paste this one line

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install-openwrt25.sh | sh
```

The router checks itself, downloads the firmware (23 MB), and checks the
download is complete and undamaged before it touches anything.

## Step 3 — Confirm

You'll see a summary of what is about to happen and:

```
  Type YES to continue:
```

Type **YES** in capitals and press Enter. Anything else cancels safely.

## Step 4 — Wait

Flashing takes a few minutes. **Do not unplug the router.** It reboots on its
own when finished.

## Step 5 — Reconnect

The router is now on OpenWrt 25 at its new default address:

```
http://192.168.1.1
```

You may need to disconnect and reconnect to the router's network first, so your
computer picks up an address on the new network.

---

## Just checking, not committing

To run every check and download the firmware **without flashing anything**:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install-openwrt25.sh | sh -s -- --dry-run
```

Useful for confirming the router is online and the firmware downloads cleanly
before committing.

---

## If something goes wrong

**"this router reports board ..."** — this upgrade is only for the Chester K43P.
Nothing was changed.

**"download failed"** — the router isn't online. Check its internet connection
and try again. Nothing was changed.

**"checksum mismatch"** or **"download is ... bytes, expected ..."** — the
download was damaged or cut short. The script refuses to flash a damaged file,
which is exactly what you want. Just run it again.

**"not enough space in /tmp"** — reboot the router and run it again.

In all of these cases the router is untouched and still working.

---

## For reference: doing it by hand

The one-liner automates the standard procedure. Manually it is:

1. Copy `platform.sh` from this folder to `/lib/upgrade/platform.sh` on the router
2. Copy the firmware to `/tmp/snand-ubi.bin` on the router
3. Run `sysupgrade -n /tmp/snand-ubi.bin`

Firmware image:
<https://github.com/ElReyDeHotspot/LettucePi-K43P/releases/download/immortalwrt-25.12/immortalwrt-M10K43P-ubi.bin>

`sha256 8223b357e9cd98b22a5824689f04fccd678f3d39170dae7f126009b3720cb5ed`

### Why platform.sh has to be replaced

The router's own upgrade routine writes only the **`ubi2`** partition (`mtd9`),
but this router **boots `ubi`** (`mtd8`). Using the stock routine, the upgrade
appears to succeed, the router reboots — and comes straight back on the old
firmware, because the new image was written to a bank nothing boots. This was
confirmed on hardware.

The `platform.sh` here writes **both** banks, which is what makes the new
firmware actually take. That is also why there is no fallback bank left
afterwards.

> `platform.sh` is embedded inside `install-openwrt25.sh` as well. If you change
> one, change the other.
