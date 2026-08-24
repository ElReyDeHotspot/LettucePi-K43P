# LettucePi — Chester K43P

Firmware for the **Chester K43P** 5G router (MediaTek MT7981, board
`alwaylink,m01k43`).

The router downloads, verifies and installs everything itself. Nothing to copy
by hand.

## Upgrading

SSH into the router and paste one line:

```sh
wget -qO- https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/install.sh | sh
```

It offers a choice of firmware, checks the download, tells you what a firmware
change erases, and asks you to type `YES` before writing anything.

**[Read the upgrade guide first](UPGRADING.md)** — it covers which routers can
upgrade in place, which need the one-liner, and what a firmware change erases.

---

## What's in here

| | |
|---|---|
| [`UPGRADING.md`](UPGRADING.md) | Which upgrade path applies, and what it erases |
| [`openwrt25/install.sh`](openwrt25/install.sh) | The one-liner. Offers ImmortalWrt 25 or OpenWrt 25 |
| [`openwrt25/README.md`](openwrt25/README.md) | Longer guide for the OpenWrt 25 build |
| `openwrt25/firmware/` | OpenWrt 25 images |
| `openwrt25/overlay-files/` | Exactly what the OpenWrt 25 build ships on top of stock |
| `openwrt25/platform.sh` | The flash method, for installing by hand |
| [`ChesterK43P-Bin/`](ChesterK43P-Bin/README.md) | ImmortalWrt image archive, with checksums |

Firmware is served straight out of this repository over `raw.githubusercontent`,
not from GitHub Releases — so a router needs nothing but `wget` to fetch it.

## Update manifests

Routers running ImmortalWrt check for updates themselves. Two manifests, so a
router is only ever offered a build it can install safely:

| | Read by | Flashes with |
|---|---|---|
| `openwrt25/latest.json` | every older ImmortalWrt build | `sysupgrade -k`, settings kept |
| `openwrt25/next.json` | the final ImmortalWrt build only | `sysupgrade -n`, settings erased |

`latest.json` stays pinned at the final ImmortalWrt build, so older routers only
ever see that one. Only routers already on it read `next.json`, and only those
can cross to OpenWrt 25 without carrying a config that would strand them.
[The reasoning is in UPGRADING.md](UPGRADING.md#why-there-is-a-stepping-stone).
