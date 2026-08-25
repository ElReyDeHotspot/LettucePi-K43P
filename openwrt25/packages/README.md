# Package store

Packages the router installs on demand, rather than baking into the firmware.
The overlay is only ~25 MB, so anything optional lives here and is fetched when
the customer asks for it.

`aarch64_cortex-a53/` — the arch the Chester K43P runs (MT7981, Cortex-A53).

| package | what it is |
|---|---|
| `zapret-*.apk` | the 4K/HD engine (nfqws). Upstream build from [remittor/zapret-openwrt](https://github.com/remittor/zapret-openwrt), mirrored so a customer install does not depend on a third-party release page staying up |
| `luci-app-zapret-*.apk` | its full settings UI, reachable under Developer |

Installed by `chester-zapret install`, which verifies the sha256 of each file
before handing it to `apk`. `kmod-nft-queue` and `kmod-nfnetlink-queue` come
from the official OpenWrt feed — nfqws cannot work without NFQUEUE and the
image ships neither.

These are **not** a signed apk index: apk-tools v3 needs `packages.adb` for
that, and nothing in the build environment can generate one. `apk add` takes a
file path, so the installer downloads first and installs from disk.
