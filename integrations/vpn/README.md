# VPN client

Shared Day/Night VPN page with WireGuard and OpenVPN client profiles.
ZeroTier is under LuCi Pages. PPTP/L2TP clients are retired.

Before packing the next BIN, stage the payload and prune retired clients:

```sh
python3 scripts/prepare-rootfs.py /absolute/path/to/extracted-root
```

Keep the captured vendor kernel, modules and Wi-Fi calibration unchanged.
