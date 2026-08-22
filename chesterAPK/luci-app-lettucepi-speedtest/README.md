# luci-app-lettucepi-speedtest

A standalone LuCI application for running the official Ookla Speedtest CLI on
the K43P under OpenWrt/ImmortalWrt 25.

The package provides the LuCI page, RPC permissions, backend, live polling,
cancel support, and result presentation. It deliberately does **not** redistribute
Ookla's proprietary CLI binary. The official executable must exist at one of:

- `/usr/bin/speedtest`
- `/usr/sbin/speedtest`
- `/sbin/speedtest`

When the engine is absent, the page provides **Install Ookla Engine**. It
downloads the official Ookla 1.2.0 ARM64 archive over HTTPS and refuses to
extract it unless its SHA-256 equals
`3953d231da3783e2bf8904b6dd72767c5c6e533e163d3742fd0437affa431bd3`.

Build with apk-tools 3 and the private Chester feed signing key:

```sh
./build.sh /path/to/chester-apk.key
```

After installation, open **Apps → Speedtest by Ookla** in LuCI. The app uses
an `admin/apps` route because the stock Chester theme force-hides the complete
standard `admin/status` menu tree.
