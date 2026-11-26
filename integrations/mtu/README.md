# MTU & MSS

Smart is the recommended selectable profile: it uses the carrier limit and bounded IPv4/IPv6 nonfragmenting ICMP tests, with automatic TCP MSS clamping. Automatic follows the modem/network MTU without packet tests. Custom supports 1280–1500 bytes. No fixed MTU is inferred from LTE versus 5G.

Probes run on request or a changed connection, not continuously. Results are private RAM state. A previously verified limit is bound to its connection; missing or inconclusive ICMP results do not count as a successful measurement. Each test covers one destination per active IP family, not every Internet path. UDP and QUIC are unaffected by TCP MSS clamping.

The native ucode service validates firewall rules and journals network/firewall changes before applying. It preserves other uplinks and restores the transaction on failure. A small static C probe uses the selected cellular interface and nonfragmenting packets. Vendor kernels, device trees and calibration are unchanged.

## Validation

Both K43P and K45P: MTU 1280/1400/1500; IPv4/IPv6 connectivity; packet captures of automatic/custom/disabled MSS in both directions; invalid/stale request rejection; firewall failure rollback and interrupted transaction recovery; service restart and lease refresh; Smart dual-stack minimum, stale/different-network rejection and inconclusive fallback. Live cellular M-Lab tests completed on both. Live Ethernet testing was skipped because WAN was disconnected.

`tests/mtu.uc` runs on the router with ucode. `tests/smart-policy.uc` is a fixture appended to the helper definitions before its CLI dispatch, with RUN redirected to an isolated temporary directory. `tests/speeds.cjs` runs with Node and exercises provider order, role labels, disconnected/LAN WAN handling and per-link dispatch.

## References

- [RFC 7849](https://www.rfc-editor.org/rfc/rfc7849.html): cellular IPv6 MTU recommendations.
- [3GPP TS 23.501 section 5.6.10.4](https://www.etsi.org/deliver/etsi_ts/123500_123599/123501/19.05.00_60/ts_123501v190500p.pdf): network-provided MTU.
- [nftables TCP MSS guidance](https://wiki.nftables.org/wiki-nftables/index.php/Mangling_packet_headers): clamping in both directions.
