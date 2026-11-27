# Speeds, Failover and SIM tests

The K43P Speeds page retains the existing three-provider layout: M-Lab,
Fast.com and Ookla. M-Lab remains in the compact native engine; Fast.com loads
the official site only on request. Neither depends on an optional installer
JavaScript module.

Ookla is optional starting with full image BIN65. Its existing RPC starts the
bounded background installer and status polling reports progress/errors. The
installer downloads the official ARM64 1.2.0 archive over HTTPS, verifies pinned
SHA-256 `3953d231da3783e2bf8904b6dd72767c5c6e533e163d3742fd0437affa431bd3`,
checks writable flash space and atomically installs the executable. It keeps an
existing executable. The page retains the explicit terms review before install.
The already installed engine in BIN64 is not removed by this development fix.

On-demand M-Lab availability uses `failover.status.link_connections` when
present, with legacy monitor status as fallback. Turning off failover monitoring
therefore does not disable tests on an otherwise ready uplink. Disconnected WAN,
WAN in LAN mode, unsaved connection order and another active test still block
inappropriate tests. A queued Failover test remains cancellable before its first
result is written.

SIM Selection creates its runtime directory before queuing the first request.
Opening the page initializes an inactive service when a modem is configured.
The existing native SIM dispatcher, timeout, manual selection, measurement,
restoration and cancellation logic is preserved.

## Validation

Live K43P BIN64 / App Revision 1 tests completed M-Lab download/upload from
Speeds, Failover and SIM 1 Selection. Failover cancellation/restart and SIM
cancellation/restoration were exercised. An empty SIM 2 was detected and a SIM
test restored SIM 1. A separate Manual selection retained the empty SIM 2
without automatic rollback; SIM 1 was then explicitly restored.

Automatic failover selected cellular backup with disconnected WAN primary.
Its private policy table was installed and removed correctly without changing
the main IPv4 routes. Original Failover and SIM preferences were restored.
Router and LAN-client IPv4/IPv6 connectivity passed after the SIM operations.

Successful SIM 2 measurement, comparison of two working SIMs, handover from a
working Ethernet WAN and recovery of that WAN were **not tested**: the second
slot was empty and Ethernet WAN was disconnected. No claim of flawless behavior
under all conditions follows from these checks.

Tests:

- `node tests/speeds.cjs`: page rendering, provider dispatch, monitor-off
  readiness, roles, disabled links and optional Ookla installation flow.
- `node tests/failover-tests.cjs`: fresh readiness over stale monitor data,
  unsaved priority, WAN in LAN mode and queued cancellation.
- `python tests/sim-bootstrap-native.py`: emits isolated native ucode fixtures
  for first-use initialization and pending-request exclusion.
- `python3 tests/ookla-install.py`: isolated download/hash/space/board tests and
  preservation of an existing executable. The real pinned archive was separately
  downloaded and verified; a fresh live install was unnecessary because BIN64
  already contains the engine.

The existing SIM Go tests also passed, and their main source hash matches the
recorded source used by the installed K43P native suite. Browser checks covered
desktop/mobile layouts and Sun/Night appearance. The connected unit received a
development overlay for those live tests. BIN65 subsequently bakes these fixes
into a full image; it was validated offline and was not flashed during release
preparation.
