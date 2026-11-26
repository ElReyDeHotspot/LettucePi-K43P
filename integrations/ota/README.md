# OTA preparation

The K43/K43P updater keeps its 12 MiB RAM reserve and image hash, size, board and partition checks. If staging needs more RAM, it reclaims clean caches and pauses only running SIM polling, Live Traffic collection and browser terminal services as needed. Routing, DNS, Wi-Fi, SSH, VPN and web management remain running. It aborts if pausing changes firewall rules or if safe memory is still unavailable.

A private RAM journal records the original running services. Failure and cancellation restore those services; previously stopped services remain stopped. An orphan watchdog stops abandoned download processes and retries service recovery. It respects native sysupgrade handoff and does not restart services into an active flash. A download cache can be discarded if needed to restore normal operation safely. No boot-enable flags or network settings are changed.

`tests/ota-resources.py` exercises download, checksum, RAM, firewall, signal, orphan and flash-rejection failures with isolated fixtures. On K43P, a real full-size OTA download was hash-verified with IPv4/IPv6 available and all paused services restored. Real forced-error, SIGTERM and SIGKILL recovery tests also passed. `chester-update download-only` is a root CLI diagnostic; it verifies a release download and restores services without installing it.

Preparation targets 8 MiB of transport headroom and accepts a minimum of 4 MiB after optional services have been considered. The separate 12 MiB safety reserve remains mandatory, with active download cancellation if that reserve is crossed.
