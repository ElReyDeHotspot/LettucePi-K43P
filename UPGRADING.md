# Upgrading a Chester K43P

Two ways to move a router forward. Pick by what it is running now.

| Router is on | Do this | Settings |
|---|---|---|
| ImmortalWrt, any older build | **Nothing.** System Update offers the stepping stone | Kept |
| ImmortalWrt, final build (`20260824041540`) | System Update, once `next.json` points at OpenWrt 25 | **Erased** |
| Anything, want OpenWrt 25 now | The one-liner below | **Erased** |

---

## The one-liner

Run it on the router over SSH:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

It lists the firmware choices, checks the download, and asks you to type `YES`
before anything is written. Nothing is copied by hand.

Straight to OpenWrt 25, no questions asked:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh -s -- --choice 2 --yes
```

Check everything and write nothing — safe to run any time:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh -s -- --choice 2 --dry-run
```

The installer refuses to run if the board is not a K43P, if the flash layout is
not what it expects, if the download is the wrong size, if the sha256 does not
match, or if the image is not a valid UBI image. Every one of those checks
happens **before** anything is erased, because once the flash is wiped the only
way back is TFTP or serial.

---

## Crossing firmware families erases everything

ImmortalWrt and OpenWrt lay out their configuration differently — ImmortalWrt
calls the modem interface `pcie0`, OpenWrt names it after the PCI slot
(`0000_01_00_0`). Carrying one config onto the other produces a router that
boots to no network at all. So a family change is always a clean install:

- Wi-Fi name and password → back to `5G_CPE` / `123456789`
- LAN address and DHCP → back to `192.168.100.1`
- admin password → back to none, **set one immediately after**
- APN and modem settings
- installed packages, VPN profiles, port forwards

Write down anything you still need first. The installer prints this list and
names the family change before it asks you to confirm.

---

## Why there is a stepping stone

Older ImmortalWrt builds update themselves with `sysupgrade -k`, which **keeps**
settings. There is no way to tell them otherwise — the instruction is compiled
into the firmware already on the router, not something the server can change.
If those routers were pointed straight at OpenWrt 25 they would install it while
preserving an ImmortalWrt config, which is exactly the combination that strands
a box.

So there are two manifests:

- **`openwrt25/latest.json`** — read by every older ImmortalWrt build. Pinned at
  the final ImmortalWrt build and left there. Those routers only ever see the
  stepping stone, and they take it safely because it is the same family.
- **`openwrt25/next.json`** — read only by the final build, which updates with
  `sysupgrade -n`. Pointing this at OpenWrt 25 migrates exactly the routers that
  can survive the crossing, and nothing else.

A router therefore reaches OpenWrt 25 in two safe hops rather than one unsafe
one: old ImmortalWrt → final ImmortalWrt (settings kept) → OpenWrt 25 (wiped).

---

## After the upgrade

The router comes back on **`192.168.100.1`**, Wi-Fi `5G_CPE` / `123456789`,
with **no admin password** — set one straight away under
*System → Settings → Administration*.

Give the modem a minute; the dashboard fills in once it registers and dials.

## Verifying a download yourself

Every published image has its sha256 recorded next to it — in
[`ChesterK43P-Bin/README.md`](ChesterK43P-Bin/README.md) for ImmortalWrt, and in
`openwrt25/install.sh` for OpenWrt 25. The installer checks it for you and
refuses to flash on a mismatch, but you can confirm by hand:

```sh
sha256sum /tmp/snand-ubi.bin
```

## If it goes wrong

Both flash banks are written, so there is no fallback bank to boot from. The
vendor dropbear on port **2222** has been the way back into a half-broken box
more than once. Failing that, recovery is TFTP or serial.
