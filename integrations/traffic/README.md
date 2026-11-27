# K43P Live Traffic

The local module retains the shared Chester collector and protection backend,
with a board-specific correction for the 256 MiB K43P. Monitoring pauses below
16 MiB of available RAM on `misectel,m01k43`; K45P and unknown boards retain the
original 64 MiB threshold. This changes the reserve check, not the reported
memory value or traffic counters.

The existing 1,000-row display cap, 16,384-entry rate cache, adaptive refresh,
view-only sampling and idle-cache expiration are unchanged. No apps are removed,
no cache-dropping kernel command is used, and the real low-memory safeguard
remains enabled. Large protection-list downloads retain their separate existing
memory checks.

`scripts/build-native-suite.py` uses this local traffic source while retaining
the shared SIM/NDT implementations. The native traffic, SIM, scanner and app
update tests passed. Memory-boundary tests cover K43P, K45P and unknown boards.
The live collector and browser resumed with approximately 38 MiB available RAM,
and settings hashes remained identical across the native update. See
`../app-update/firmware65-validation.json` for the sanitized release record.
