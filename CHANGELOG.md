# Changelog

## November 27, 2026 — Live OpenWrt 21 → BIN66 verification

- The user ran the corrected one-line installer on a newly connected K43P
  reporting OpenWrt 21.02-SNAPSHOT 2.6.0 and confirmed YES. Post-reboot checks
  verified ROM BIN66/build `20261127155405`, matching overlay identity, kernel
  6.12.85 and all required RPC backends with safe script permissions.
- Completed real M-Lab tests from each browser page on this migrated unit:
  Speeds 155.2/2.9 Mbps, 18.2 ms; Failover 84.5/2.9 Mbps, 24.0 ms with monitoring
  off; SIM Selection SIM 1 160.4/4.4 Mbps, 18.1 ms. Backend completion and the
  displayed results were verified separately.
- SIM 1 was restored, Manual mode and the original Failover preferences were
  preserved, and tests became idle with no test routing rules remaining. Router
  cellular HTTPS and interface-bound LAN-client HTTPS passed over IPv4 and IPv6.
- Network Topology discovered the LAN client and ports. System Update reported
  BIN66/App Revision 0 up to date. Live Traffic remained Not Installed with no
  collector process. Overview initially showed Offline and later correctly
  showed Online/Connected after reload; no firmware repair was applied.
- Network/wireless/firewall files differed during the session, so an all-settings
  byte-identical claim is not made. No configuration was overwritten to force
  matching hashes. No new build, flash or reboot was performed by the checks.
- WAN handover/recovery, SIM 2, wireless-client association and VPN/paid-service
  features were not tested. This successful migration evidence is separate from
  the earlier clean-flash test without a SIM. See
  `integrations/app-update/migration66-live-validation.json`.

## November 27, 2026 — OpenWrt 21 one-line installer correction

- Fixed the migration installer's rejection of the current `BIN/` image path.
  It accepts that exact repository folder and the legacy `ChesterK43P-Bin/`
  archive, while rejecting other hosts, folders, filenames and traversal paths.
  Metadata, image and writer remain pinned to one resolved immutable commit.
- Updated the upgrade guide's one-liner with a fresh-request query string and
  added a download/check-only command. Board/layout, size, SHA-256, UBI headers,
  explicit YES confirmation and clean two-bank migration checks remain in place.
- Regression fixtures cover BIN66's canonical folder, older archive releases,
  immutable URLs, invalid paths, dry-run/cancellation and clean-install dispatch.
  This is an installer/documentation update; published firmware bytes are unchanged.

## BIN66 — November 27, 2026

Full firmware `25.12`, ROM build `20261127155405`, 28.125 MiB.

- Baked in the local fixes documented below: safe RPC module/ACL permissions,
  restored Failover/Network Topology/Speeds/SIM backends, optional Live Traffic,
  and full-firmware discovery with explicit installation routing and ROM counters.
- Live Traffic is uninstalled by default, with no collector alias/startup link.
  Its install prompt makes no client/counter requests. Ookla remains optional;
  M-Lab and Fast.com remain available in Speeds.
- Added the signed revision-zero app baseline for this exact ROM build.
  Existing release images and signing trust are unchanged.
- Clean-flashed the local K43P with keep-settings disabled. A pre-flash saved
  configuration probe was absent afterward, the ROM/overlay identity matched
  BIN66, and the per-device Factory partition hash was unchanged. No private
  backup was restored. Kernel, matching modules, radio firmware and board
  artifacts were preserved in the extracted-image comparison.
- Required RPC objects registered directly from the clean firmware with no
  world-writable modules or manual permission repairs. Failover controls loaded,
  topology discovered the LAN device/ports, and Speeds correctly disabled tests
  on disconnected links. Live Traffic showed Not Installed and Ookla offered
  installation. PC-to-router LAN access passed over IPv4 and IPv6.
- The user removed the SIM and requested continued testing without it. No BIN66
  cellular Internet or M-Lab throughput result is claimed; Ethernet WAN was also
  disconnected. The earlier BIN65 measurements below remain distinct evidence.
  An empty-SIM test was started, but final timeout/recovery completion was not
  verified after its SSH connection closed.
- Source regressions passed for Speeds, Failover, optional traffic lifecycle and
  no-polling gate, RPC staging permissions, update channels/progress and ROM
  counters. Publication was explicitly requested after these available checks.

## Local BIN65 M-Lab verification — November 27, 2026 (included in BIN66)

- Started real cellular M-Lab tests from each browser page and verified both
  backend completion and displayed download/upload/latency results:
  - Speeds: 48.0 Mbps down, 2.3 Mbps up, 24.1 ms latency.
  - Failover: 49.0 Mbps down, 5.6 Mbps up, 27.3 ms latency, with monitoring off.
  - SIM Selection, SIM 1: 77.3 Mbps down, 4.7 Mbps up, 28.4 ms latency.
- SIM Selection reported Original SIM Restored and became idle. Original SIM 1,
  Manual mode and disabled Failover configuration remained in place. Network,
  wireless, firewall, Failover, SIM and qmodem configuration hashes matched the
  pre-test snapshot; no pending UCI changes were introduced. Temporary test
  routing rules were absent after completion.
- Interface-bound cellular IPv4 and IPv6 HTTPS returned 204 after all tests.
  Live Traffic remained uninstalled. Boot ID and ROM BIN65 identity were
  unchanged. No new BIN was built, flashed or published.
- These checks used the local RPC permission repairs documented below.
  Ethernet WAN and SIM 2 measurements were not tested in this run. Results
  demonstrate successful real measurements, not guaranteed cellular speeds or
  comprehensive failover/SIM interoperability under every condition.

## Local review — November 27, 2026 (included in BIN66)

- Repaired BIN65's missing RPC objects affecting Failover, Network Topology,
  Speeds, SIM, scanning and related pages. Windows-derived staging permissions
  left modules world-writable; rpcd intentionally ignores those files. Restored
  safe permissions on the local router and normalized RPC module/ACL modes to
  0644 in the staging script for future builds.
- Verified the local Failover page renders its priority, mode and M-Lab test
  controls; Network Topology discovers the connected device/ports; Speeds loads
  M-Lab with cellular ready and offers optional Ookla installation. These are
  page/backend recovery checks, not a new handover or throughput test.
- Made Live Traffic optional on K43P. Its page shows Not Installed and Install
  Live Traffic before any client reads, snapshots or polling. Explicit install
  activates the collector; uninstall stops/disables it and removes its alias.
  The shared native engine remains available to M-Lab, SIM and other tools.
- The local BIN65 collector is stopped/disabled and the installation flag and
  traffic alias are absent. Added a guarded service, upgrade preservation for
  the optional installation flag and isolated install/uninstall/rollback tests.
  Future clean builds omit the traffic alias and startup link by default.
- Customer network, wireless, Failover and SIM preferences, shared-engine bytes
  and boot ID remained unchanged during these local repairs. RPC service was
  restarted; the router was not rebooted or flashed.
- These changes are local development overlays/source only. At the user's
  request, no new firmware is built or published while review continues.
  Published BIN65 remains unchanged and retains the original packaging issue.

## November 27, 2026 — BIN65 discovery and download location

- Added the unchanged BIN65 image under `BIN/` and pointed the full-firmware
  manifests there. The previously published archive URL remains available.
- Fixed System Update checking only the installed BIN's app channel. It now
  checks both channels and offers a newer full BIN before a same-base app
  update. Failed full-firmware checks do not report all software up to date.
- Added exact RPC permissions and explicit full-firmware install routing,
  retained across progress-window reloads. App installs keep their existing
  route. Keep My Settings is visible for full updates.
- Full-firmware comparisons now use the ROM build rather than an independently
  advancing overlay app timestamp. Updated the browser cache tag and update-type
  explanation so the new page loads and describes the selected update correctly.
- Verified on the identified K43P: installed BIN64, latest BIN65, Update Now
  available and Keep My Settings on. Settings and boot ID were unchanged;
  no firmware install was started. Channel-selection, progress and ROM-counter
  regression fixtures passed.
- These updater fixes are installed as a local BIN64 overlay and committed for
  future full builds. Published BIN65 bytes were not rebuilt or overwritten;
  its ROM updater still has the earlier channel-selection behavior.

## BIN65 — November 27, 2026

Full firmware: `25.12`, ROM build `20261127003030` (UTC), 28.125 MiB.

### Fixed

- Restored the complete Chester Speeds page by removing its dependency on a
  missing optional-installer JavaScript module. Retained the M-Lab, Fast.com and
  Ookla provider order and the existing Chester appearance and navigation.
- Enabled M-Lab tests from Speeds and Failover when failover monitoring is off
  but the selected uplink has a usable IPv4 connection. Fresh link readiness
  takes precedence over stale monitor data. Disconnected WAN, LAN-mode WAN,
  unsaved priority and concurrent-test guards remain in place.
- Kept a queued Failover test cancellable before its first measurement appears.
- Fixed SIM Selection's first-use initialization: create its runtime directory
  before queuing a request, and initialize an inactive service when the page
  opens with a configured modem.
- Corrected Live Traffic's inherited memory cutoff. K43P retains a 16 MiB
  available-memory reserve; K45P and unknown boards retain 64 MiB. Existing
  1,000-row display, 16,384-entry rate cache and adaptive refresh are unchanged.
  The low-memory safeguard remains enabled.
- Made rootfs staging handle already compacted native-app aliases safely.

### Changed

- Made the official Ookla engine optional in new full images. The background
  installer checks board identity, HTTPS download, pinned SHA-256 and free
  writable flash before atomic installation. Existing installed engines are
  preserved. M-Lab remains in the native suite and Fast.com remains built in.
- Retained local traffic source and memory-boundary regression tests so K43P's
  collector fix is reproducible independently of the K45P checkout.
- Baked the earlier Overview App Update 1 detection fixes and coherent
  app-manifest/signature bootstrap into this full image. Added a signed
  revision-zero application baseline for its exact ROM build.

### Validation and limits

- Live BIN64 overlay tests completed M-Lab download/upload from Speeds,
  Failover and SIM 1 Selection. Cancel/restart, SIM cancellation/restoration,
  empty-SIM detection and Manual retention of an offline selected SIM passed.
- Automatic failover selected cellular backup with disconnected WAN primary;
  its policy was removed afterward and the main IPv4 routes stayed unchanged.
  Original Failover and SIM preferences were restored. Router and LAN-client
  IPv4/IPv6 connectivity passed after testing.
- Live Traffic resumed at approximately 38 MiB available memory, with its
  original detail and refresh limits. Customer settings were byte-identical
  across the native-engine update.
- Native scanner, SIM, traffic and app-update tests passed, alongside Speeds,
  Failover, SIM initialization and isolated Ookla installer tests. The real
  official Ookla archive matched its pinned hash.
- The built image passed extraction/hash/size checks and preserves the captured
  vendor kernel, device trees, matching modules, radio firmware and calibration
  artifacts. No router was flashed with BIN65 during this release preparation.
- Working-WAN handover/recovery, successful SIM 2 measurement and comparison of
  two working SIMs remain unverified: Ethernet WAN was disconnected and the
  second SIM slot was empty. These checks do not establish flawless operation
  under every condition.

K45P MLO work is recorded separately in the K45P repository changelog; it is
hardware-specific and is not included in this Wi-Fi 6 K43P image.
