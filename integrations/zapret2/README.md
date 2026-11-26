# Zapret2 for Chester K43 and K43P

The next firmware build copies `payload/` over the BIN60 filesystem. Zapret2 is
under **Firewall → Zapret2**, below Block List. Its configuration lives in
`/etc/config/zapret2` and starts disabled on a clean installation. The boot
script honors an enabled setting restored by OTA and disables the legacy proxy.

## Provenance

- Engine `nfqws2` 1.0.5.2 is byte-for-byte identical to the K45P engine from
  [Zapret2 v1.0.5.2](https://github.com/bol-van/zapret2/releases/tag/v1.0.5.2).
  The K45P engine APK SHA-256 is
  `d250e372dfec302eb34ed9e0178c054babb83f03b463a86e9f82098126f0612f`.
- LuCI and service integration derive from [carp4/luci-app-zapret2](https://github.com/carp4/luci-app-zapret2)
  revision `36568c18fc0ad3153b4b99b2f1917833af81bb5d` and the LettucePi K45P
  port. The port uses the K45P LuaJIT and libnetfilter_queue shared libraries.
- Queue modules target `6.12.85~065c30ba02cfc355d354c324a517b6c9-r1` from
  [ImmortalWrt f08ddcbc32](https://github.com/immortalwrt/immortalwrt/commit/f08ddcbc32c60d84e6116bc700fbab226994423f).
  OpenWrt GCC 14.3.0 built them with `KCFLAGS=-fno-caller-saves`. The config
  is reconstructed. The reference report records the verified sections of the
  four original BIN60 modules. The Linux module loader accepted both modules
  without force-loading or changing the kernel taint state.

## Rebuild just the queue modules

Use Linux or WSL on a Linux filesystem, with the ImmortalWrt 25.12.1 filogic
SDK already extracted. The third argument points to modules extracted from
BIN60. The script compares the rebuilt reference objects before copying the
two queue modules into the build directory.

The rebuilt modules match the tested modules apart from the GNU build-ID
notes. Keep the BIN60 kernel and existing module files intact when applying
the overlay. The only additions under `lib/modules/6.12.85` are the two
queue modules.

```sh
bash integrations/zapret2/build-modules.sh /var/tmp/k43-queue-build \
    /path/to/immortalwrt-sdk /path/to/bin60/lib/modules/6.12.85
```

## K43P verification

- Real `nfqws2` processed IPv4 and IPv6 loopback packets through NFQUEUE.
- Cellular IPv4 and IPv6 HTTPS requests returned 204. The IPv4 request
  increased the Zapret2 queue counters, and the live queue reported zero
  drops.
- LuCI lists Zapret2 below Block List. Its main switch stopped and restarted
  the engine while retaining the streaming-host scope.
- The standard module loader reloaded both queue modules. Zapret2 restarted
  successfully and the legacy proxy stayed disabled.
