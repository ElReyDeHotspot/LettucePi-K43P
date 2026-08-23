# Device tree: the fourth LAN port

The stock ImmortalWrt tree for `misectel,m01k43` declares only switch ports
1, 2 and 3, and labels them in reverse (`port@3` is called `lan1`). Switch
**port 0 is omitted entirely**, so one physical jack is never instantiated —
no netdev exists for it, and no amount of UCI configuration can create one.
That is why the fourth jack "did not work" and why `wan` looked like the
culprit.

Two other trees for this same hardware both declare all four:

| port | stock vendor (OpenWrt 21) | AlwayLink M01K43 (working OpenWrt) | ImmortalWrt 25.12 (broken) |
|------|---------------------------|------------------------------------|----------------------------|
| 0 | lan1 | lan1 | **missing** |
| 1 | lan2 | lan2 | lan3 |
| 2 | lan3 | lan3 | lan2 |
| 3 | lan4 | lan4 | lan1 |
| 5 | wan (fixed-link, no PHY) | wan (2500base-x + C45 PHY) | wan (2500base-x + C45 PHY) |

`m01k43-4port.dts` is our corrected tree, following the AlwayLink mapping.

## Rebuilding after a kernel bump

`kernel.bin` is a FIT image. The kernel payload is never modified — only the
`fdt-1` sub-image is replaced and the hashes recomputed:

```sh
dumpimage -T flat_dt -p 0 -o kernel.lzma kernel.bin   # untouched
dumpimage -T flat_dt -p 1 -o fdt.dtb     kernel.bin
dtc -I dtb -O dts -o fdt.dts fdt.dtb
# apply the port@0..port@3 block from m01k43-4port.dts
dtc -I dts -O dtb -o fdt-new.dtb fdt.dts
mkimage -f kernel.its kernel-new.bin
```

Verify with `dumpimage -l`: the kernel sub-image size and both hashes must be
unchanged from the original, and only `fdt-1` should differ.

## Two userspace pieces must follow the tree

- `/etc/board.d/02_network` — the `misectel,m01k43` case listed only three LAN
  ports, so a first boot builds a three-port bridge regardless of the tree.
- `/etc/uci-defaults/99-chester-lan4` — an upgrade keeps `/etc/config/network`,
  so board.d never re-runs; this adds `lan4` to the bridge if it is absent.

Both are applied by `rebrand.sh`.

## Note on hardware variants

`wan` (port 5) is an external 2.5G PHY (RTL8221B, C45, MDIO address 6). It is
populated on some units and not others — where it is absent the port never
registers and no `wan` netdev appears. That is expected and costs nothing: the
four jacks are ports 0-3. The stock vendor tree declares port 5 as a
`fixed-link` with no PHY at all, which matches the units where it is absent.
