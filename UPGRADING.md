# Upgrading a Chester K43P

Two ways to move a router forward. Pick by what it is running now.

| Router is on | Do this | Settings |
|---|---|---|
| **OpenWrt 25** | **Nothing.** System Update updates it over the air | Kept |
| ImmortalWrt, any older build | **Nothing.** System Update offers the stepping stone | Kept |
| ImmortalWrt, final build (`20260824041540`) | System Update, once `next.json` points at OpenWrt 25 | **Erased** |
| Anything, want OpenWrt 25 now | The one-liner below | **Erased** |
| A stale build with no System Update page | The one-liner below | **Erased** |

---

## Already on OpenWrt 25? It updates itself

Go to **System → Settings → System Update**. The router checks
`openwrt25/ota.json`, tells you what it is running and what is published, and
installs with one click. **Settings are kept** — this is a same-family update.

Nothing needs to be typed and nobody needs to SSH in. That page is the normal
way a router moves forward from here.

The updater refuses an image whose manifest is not marked `"family":
"OpenWrt"`, so a router can never be walked backwards onto ImmortalWrt by a
mistake in a published manifest.

---

## The one-liner — for a stale router

Use this when the router **has no System Update page**, or is too old to reach
the current build on its own. Builds before `20260824232739` shipped no updater
at all, so they cannot update themselves and this is the only way forward.

Run it on the router over SSH:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

It installs **OpenWrt 25**. It checks the download and asks you to type `YES`
before anything is written. Nothing is copied by hand.

No questions asked, for when you are driving it yourself:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh -s -- --yes
```

Check everything and write nothing — safe to run any time:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh -s -- --dry-run
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
- admin password → back to `admin`, **change it immediately after**
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
admin password **`admin`** — change it straight away under
*System → Settings → Administration*.

The WAN socket ships bridged into the LAN, so all four sockets are LAN ports
out of the box. Switch it back under *Network → Settings → Port Mode*.

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
