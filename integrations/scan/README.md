# Band / Tower Scan

The K43P port uses the scanner, parser tests, and results view from the
[K45P scan revision](https://github.com/ElReyDeHotspot/LettucePi-K45/commit/d1c1ae9a89cbf4747bd06e520a51f6fb84a677a6).
The imported and hardware-tested ARM64 executable has SHA-256
`f98b3ec558516695c487cd77221211f30b7c25d538d044d047dac694a24d2c5b`.
Use Go 1.27.4 with `scripts/build-scan.sh` to rebuild it without embedding
checkout metadata. The scanner uses the existing QModem AT daemon and modem
lock, including the PCIe `/dev/mhi_DUN` port and supported USB serial ports.

The page is under **Cellular → Band / Tower Scan**. A live K43P Nearby scan
verified band grouping, search, CSV export, and release of the SIM lock.
The modem reported LTE, NR, and combined Full Scan support. Full Scan requires
confirmation because it can interrupt cellular service.

Full Scan warns before taking cellular offline. The shared RM520/RM551 flow
preserves registration/radio settings, pauses competing SIM policy readers,
deregisters temporarily, then restores settings and verifies cellular IPv4/IPv6.
Previously unavailable address families are reported explicitly. A data-session
restart is attempted if recovery needs it; unsuccessful recovery stays visible.
An on-router guard and boot recovery service compensate interrupted operations.
The private recovery journal is removed after settings restoration and is never
included in the firmware payload. Nearby refresh remains nondisruptive.
