# Upgrade your Chester K43P to OpenWrt 25

Your router downloads and installs everything itself. You don't copy any files.

Takes about 5 minutes.

---

## ⚠ Before you start

- **This erases everything on the router** — settings, Wi-Fi names, passwords.
- **You cannot undo it.**
- **Do not unplug the router while it works.**
- **The router must be connected to the internet.**

---

## Step 1 — Connect to the router

Open Terminal (Mac) or PuTTY / Windows Terminal (Windows) and run:

```sh
ssh root@192.168.100.1
```

Password: `admin`

The first time, it asks if you trust the router. Type `yes`.

## Step 2 — Paste this one line

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install-openwrt25.sh | sh
```

## Step 3 — Type YES

It shows you what is about to happen, then asks:

```
  Type YES to continue:
```

Type `YES` in capitals and press Enter.

Anything else cancels safely.

## Step 4 — Wait

It downloads the firmware and installs it. **Do not unplug the router.**

It restarts on its own when it's done.

---

## That's it

The router keeps the same address and password:

- **http://192.168.100.1**
- Username `root`, password `admin`

Open that address in your browser and you're on OpenWrt 25.

---

## If it stops with an error

The router is fine. Nothing was changed. Just fix the problem and run it again.

| Message | What it means |
|---|---|
| `download failed` | The router isn't online. Check its internet, try again. |
| `checksum mismatch` | The download got damaged. Just run it again. |
| `not enough space` | Restart the router, then run it again. |
| `this router reports board ...` | This isn't a Chester K43P. |

The one line refuses to install anything it can't fully verify first, so an
error always means the router was left alone.

---

## Just testing?

To check everything works **without installing anything**:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install-openwrt25.sh | sh -s -- --dry-run
```

---

<details>
<summary><b>Technical notes</b> (not needed to do the upgrade)</summary>

### Installing by hand

1. Copy `platform.sh` from this folder to `/lib/upgrade/platform.sh`
2. Copy the firmware to `/tmp/snand-ubi.bin`
3. `sysupgrade -n /tmp/snand-ubi.bin`

Firmware:
<https://github.com/ElReyDeHotspot/LettucePi-K43P/releases/download/immortalwrt-25.12/immortalwrt-M10K43P-ubi.bin>

`sha256 8223b357e9cd98b22a5824689f04fccd678f3d39170dae7f126009b3720cb5ed`

### Why platform.sh has to be replaced

The router's own upgrade routine writes only the `ubi2` partition (`mtd9`), but
the router **boots `ubi`** (`mtd8`). With the stock routine the upgrade appears
to succeed, the router reboots — and comes straight back on the old firmware,
because the image went to a bank nothing boots. Confirmed on hardware.

The `platform.sh` here writes **both** banks, which is what makes the new
firmware take, and is why there is no fallback bank afterwards.

`platform.sh` is also embedded inside `install-openwrt25.sh`. Change one, change
the other.

### Verified result

Flashed on hardware: ImmortalWrt `25.12-SNAPSHOT r37830+5-f08ddcbc32`,
kernel 6.12.85, mediatek/filogic. LAN address and root password are unchanged
from the vendor firmware.

</details>
