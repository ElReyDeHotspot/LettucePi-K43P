# Upgrade your Chester K43P to OpenWrt 25

Your router downloads, verifies, and installs the current firmware itself.
Allow about five minutes.

---

## ⚠ Before you start

- **This erases everything on the router** — settings, Wi-Fi names, passwords,
  APN settings, installed packages, VPN profiles, and port forwards.
- **Both firmware banks are overwritten.** The previous firmware will not
  remain as a fallback.
- **Do not unplug the router while it is installing.**
- **The router must be connected to the internet.**
- Move your Ethernet cable to a LAN socket before starting. The 2.5G socket
  returns to WAN mode after installation.

---

## Step 1 — Connect to the router

Open Terminal (Mac) or PuTTY / Windows Terminal (Windows) and run:

```sh
ssh root@192.168.100.1
```

On factory firmware, the default password is `admin`. The first connection may
ask whether you trust the router's SSH host key; verify it is your router before
accepting it.

## Step 2 — Paste this one line

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

## Step 3 — Type YES

The installer displays the detected board, firmware, checks, and everything
that will be erased. It then asks:

```text
Type YES to continue (anything else cancels):
```

Type **`YES` (ALL CAPS)** and press Enter. Anything else cancels.

## Step 4 — Wait

The installer downloads the firmware, verifies its exact size, SHA-256
checksum, and UBI headers, stages the correct two-bank flash writer, and then
asks for confirmation.

After you type `YES`, do not disconnect power. The router flashes both banks
and restarts automatically.

---

## After installation

Connect at:

- <http://192.168.100.1>
- Username: `root`
- Default password: `admin`

The installation resets the password to the image default; it does **not**
preserve the previous password. Change `admin` immediately after signing in.

Wi-Fi returns to `5G_CPE` with the image's default key. Change the Wi-Fi key
immediately as well.

---

## If it stops before confirmation

Do not assume every error has the same effect. Failures during board, space,
download, size, checksum, or UBI validation occur before flashing. A later
failure may occur after the flash writer has been staged.

| Message | What it means |
|---|---|
| `curl not found` | This firmware does not provide the downloader required by the installer. |
| `download failed` | Check the router's internet connection and DNS. |
| `checksum mismatch` | The download did not match the published firmware; do not flash it. |
| `not enough space` | Restart the router to clear `/tmp`, then try again. |
| `this is not a Chester K43P` | The reported board identity is unsupported; do not force it. |

If the installer has started flashing, do not interrupt it. Wait for the
router to restart before attempting recovery.

---

## Technical note

The factory flash writer is not suitable for this raw UBI image. The installer
downloads and verifies the firmware before replacing
`/lib/upgrade/platform.sh`. The replacement writer locates partitions by
name and writes both `ubi` and `ubi2`; never substitute hard-coded MTD
numbers or use `sysupgrade -F`.

For both supported upgrade paths, see [UPGRADING.md](../UPGRADING.md).
