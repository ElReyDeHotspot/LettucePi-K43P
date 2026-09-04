# OpenWrt 25 Base Image

This folder contains the tested M01K43 OpenWrt 25 base image. Its displayed
device-tree model is `M01K43 (5G PCIe)` while the internal
`alwaylink,m01k43` compatibility remains unchanged for driver binding. It exposes
`lan1` through `lan4` plus `wan` and boots with these defaults:

- Address: `192.168.1.1`
- Username: `root`
- Password: `internet`

The installer is only for a router already running a Chester build. Run this
one line from your computer:

```sh
ssh -t root@192.168.100.1 'curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/25-Base-Image/install.sh | sh'
```

It prompts for the router's SSH password, then runs the guarded installer on
the router. If you are already at the router's SSH prompt, run only the quoted
`curl ... | sh` portion.

The installer validates the Chester stamp and K43P board identity, checks the
named `ubi` and `ubi2` partitions, verifies the exact image size, SHA-256 and
both UBI headers, then requires **`YES` (ALL CAPS)** before writing anything.

> **Warning:** This erases all settings and writes both firmware banks. The
> prior Chester image will not remain as a fallback. Do not disconnect power
> after confirming the flash.

Image verification:

```text
file:   m01k43-5g-openwrt25-base.bin
size:   18087936 bytes
sha256: 491591f36efd91979775bc19b9e7253ac3b9ab645543eb181904e98f497e20aa
```

