# OpenWrt 21 → Chester Upgrade

Upgrade a **factory-stock Chester K43P** from OpenWrt 21 to the current Chester
build. Run the command below on the router over SSH.

---

## 1. Factory-stock OpenWrt 21

One line, on the router, over SSH:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sed 's#wget -q -O "$IMG" "$URL"#curl -fsSL "$URL" -o "$IMG"#; s#wget -q -O /tmp/platform.sh.new "$PLATFORM_URL"#curl -fsSL "$PLATFORM_URL" -o /tmp/platform.sh.new#' | sh
```

When prompted, type **`YES` (ALL CAPS)** before it writes anything. Anything
else cancels the installation.

That script does four things that matter, and **all four are required**:

1. downloads the image and checks **size and sha256** before touching flash
2. **replaces `/lib/upgrade/platform.sh` with the correct flash writer**
3. `sysupgrade -n`
4. our writer puts the image in **both banks**


---

## 2. After the flash

* **The 2.5G socket goes back to WAN mode.** If your cable is in it you lose
  access — move to a LAN socket or join Wi-Fi, then flip it back with the
  **WAN square** on the Overview.
* **The admin password resets** to the image default.
* The **4K/HD engine ships staged, not running.** Turn it on from the Overview.


---

## 3. If it goes wrong

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

Already running a Chester build? Use **System Update** under **Overview**. See
[UPGRADING.md](UPGRADING.md) for both upgrade paths.
