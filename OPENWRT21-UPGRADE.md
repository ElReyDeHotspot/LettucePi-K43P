# OpenWrt 21 → Chester (ImmortalWrt / OpenWrt 25)

Taking a **factory-stock Chester K43P** off OpenWrt 21 and onto the current
build. One command. The detail below is there because the obvious way of doing
this fails, and fails quietly.

Validated end to end on 2026-08-25 against a real factory unit: an **M01K43P**
on `OpenWrt 21.02-SNAPSHOT 2.6.0`, kernel `5.4.238`, taken to build
`20260825163208`. Every output quoted here came off that unit.

---

## The one line

SSH into the router (`root`, password `admin` on stock) and run:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

It prints what it will erase and waits for you to type `YES`. To run it
unattended, add `-s -- --yes`.

That is the whole procedure. Everything below explains what it is doing and
why each step is load-bearing.

---

## What it does, and why every step matters

1. **Checks the board** — refuses to run on anything that is not a K43P.
2. **Downloads the image and verifies size *and* sha256** before touching
   flash. A truncated download must stop here, not half-way through an erase.
3. **Replaces `/lib/upgrade/platform.sh` with ours.** ← the step everyone
   misses. See below.
4. **`sysupgrade -n`**, then our writer fills **both** flash banks.

> ⚠️ **Settings are erased.** Wi-Fi name and password, LAN address, admin
> password, APN, port forwards, installed packages. Write down what you need
> first.

---

## Why you cannot just run `sysupgrade`

### It refuses the image

```
Image metadata not present
wt: board name failed(UBI#/M01K43P)
Image check failed.
```

Our images are raw UBI — no OpenWrt metadata, no vendor header. The stock `wt`
(wtcheck) validator reads the first bytes expecting a board name and finds
`UBI#`.

### Forcing it is worse — it *looks* like it worked

`sysupgrade -F -n` gets past that check. The unit reboots and comes back
**still on OpenWrt 21**, with no error anywhere. On the test unit it came back
on `2.5.2` having been on `2.6.0` — an *older* factory image.

The reason is the stock writer:

```sh
snand_do_upgrade() {                                  # STOCK OpenWrt 21
    local mtdname="ubi2"
    dd if=$1 of=/tmp/snand-ubi.bin bs=64k skip=1      # <-- discards 64 KiB
    ubiformat /dev/${mtdpart} -y -f /tmp/snand-ubi.bin
    wtoem -r                                          # flips the boot bank
}
```

**`skip=1` throws away the first 64 KiB.** Vendor images carry a 64 KiB signed
header in front of the UBI, so the vendor writer strips it before flashing.
Ours *is* the UBI, from byte 0 — so that `dd` cuts 64 KiB out of the middle of
real data, `ubiformat` writes a corrupt volume, `wtoem -r` flips the boot bank
into the corruption, and the bootloader falls back to the other bank.

You end up on whatever stale image was sitting in that bank, which is why it
looks like "nothing happened" rather than like a failure.

### The fix

Stage **our** writer first. It:

* does **not** skip 64 KiB — writes the image exactly as given
* verifies the `UBI#` magic **before erasing anything**
* looks partitions up **by name**, never by number
* writes **both** `ubi` and `ubi2`, so no stale bank is left to fall back to

By hand, if you are not using the one-liner:

```sh
wget -qO /lib/upgrade/platform.sh \
  https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/platform.sh
sysupgrade -n /tmp/your-image.bin
```

With ours staged, **`-F` is not needed** — our `platform_check_image` returns
0. Dry-run it first with `sysupgrade -T`: you should see only
`Image metadata not present`, and **no** `Image check failed`.

> ⚠️ **Never hardcode mtd numbers.** `ubi`/`ubi2` are **mtd8/mtd9** on stock
> OpenWrt 21 and **mtd7/mtd8** on the Chester build. A script with numbers in
> it writes the wrong partition — and on some layouts could land on the
> bootloader.

---

## What you are installing

**Immortal-Chester-25** — ImmortalWrt-derived, built here, published in
`ChesterK43P-Bin/`. One family, one path, no variants to choose between.

Its identity strings say `OpenWrt 25.12-SNAPSHOT` because `rebrand.sh`
rewrites them. The banner is therefore not a reliable way to tell builds
apart — trust the build id in `/etc/chester-version`.

> A genuine OpenWrt 25 snapshot build was trialled and abandoned: it did
> not bring the modem up on some units. It has been removed from this
> repository. Any reference you find to it elsewhere is stale.

---
## Confirming it worked

```sh
cat /etc/chester-version      # the new build id
uname -r                      # 6.12.x, not 5.4.x
ip -4 route show default      # via rmnet_mhi0.1
ping -c2 1.1.1.1
```

From the validated run:

```
kernel 6.12.85    OpenWrt 25.12-SNAPSHOT r37830+5    build 20260825163208
modem  0000:01:00.0, mhi_BHI/DIAG/DUN/QMI0, rmnet_mhi0.1 = 192.0.0.2, internet UP
```

### Two changes that look alarming and are not

* **The modem's PCI address moves.** `0001:01:00.0` on kernel 5.4 →
  `0000:01:00.0` on 6.12. Any check pinned to a PCI domain is wrong on one
  side or the other.
* **`lan4` disappears.** Kernel 5.4 declares four LAN netdevs on an M01K43P
  that has three wired; 6.12 declares three. The dashboard asks the kernel
  what exists rather than assuming, so the same image shows 3 LAN + WAN on an
  M01K43, 4 on an M02K43 and 5 on an M60K43 with no configuration.

---

## After the flash

* **The 2.5G socket returns to WAN mode.** If your cable is in it you lose
  access — move to a LAN socket or join Wi-Fi, then switch it back with the
  **WAN square** on the Overview.
* **Admin password resets** to the image default. Change it.
* **The 4K/HD engine ships staged, not running.** Turn it on from the Overview.
* Wi-Fi returns to the default SSID and key.

---

## If it goes wrong

These units have **two flash banks and the bootloader falls back to the good
one**, so a botched flash leaves a working router on an older image rather than
a brick. We landed on the fallback twice while working this out.

Get back in over SSH and try again — checking first that the writer was
actually staged:

```sh
sed -n '/snand_do_upgrade()/,/^}/p' /lib/upgrade/platform.sh | grep -c 'skip=1'
```

**`0` means ours is staged. `1` means the vendor's is still there** and the
flash will fail the same way again.

Verify a download by hand at any time:

```sh
sha256sum /tmp/your-image.bin
wc -c    < /tmp/your-image.bin
```

against `sha256` and `size` in
[`openwrt25/next.json`](openwrt25/next.json).

---

## Already on a Chester build?

You do not need any of this. Use **System Update** under **Overview** — it
checks, downloads, verifies and flashes on its own.

If it says *"up to date"* and you know it is not, **the manifest is stale, not
the router.** The check is a plain string comparison between the manifest's
`build` and the installed one, so an un-bumped `next.json` reads as "nothing to
do" rather than as an error.

Full detail for every upgrade path: [`UPGRADING.md`](UPGRADING.md).
