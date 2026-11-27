# Changelog

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
