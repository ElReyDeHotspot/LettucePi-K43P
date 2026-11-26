# Band / Tower Scan

The K43P port uses the scanner, parser tests, and results view from the
[K45P scan revision](https://github.com/ElReyDeHotspot/LettucePi-K45/commit/d1c1ae9a89cbf4747bd06e520a51f6fb84a677a6).
The imported and hardware-tested ARM64 executable has SHA-256
`25dff5c7f29072c6b5724410dd69d66f7df390f5241bbc6aac7cda33159cfbf7`.
Use Go 1.27.4 with `scripts/build-scan.sh` to rebuild it without embedding
checkout metadata. The scanner uses the existing QModem AT daemon and modem
lock, including the PCIe `/dev/mhi_DUN` port and supported USB serial ports.

The page is under **Cellular → Band / Tower Scan**. A live K43P Nearby scan
verified band grouping, search, CSV export, and release of the SIM lock.
The modem reported LTE, NR, and combined Full Scan support. Full Scan requires
confirmation because it can interrupt cellular service.
