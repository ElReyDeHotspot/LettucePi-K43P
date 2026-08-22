# luci-app-lettucepi-speedtest

A standalone LuCI application for running the official Ookla Speedtest CLI on
the K43P under OpenWrt/ImmortalWrt 25.

The package provides the LuCI page, RPC permissions, backend, live polling,
cancel support, and result presentation. It deliberately does **not** redistribute
Ookla's proprietary CLI binary. The official executable must exist at one of:

- `/usr/bin/speedtest`
- `/usr/sbin/speedtest`
- `/sbin/speedtest`

Build with apk-tools 3 and the private Chester feed signing key:

```sh
./build.sh /path/to/chester-apk.key
```

After installation, open **Status → Speedtest** in LuCI.
