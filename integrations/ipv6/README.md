# Cellular IPv6

Shared native ucode backend and Chester Day/Night LuCI page for K43P and K45P.

- Automatic, Native /64 Relay and NAT66 were tested with router and real LAN-client traffic on both boards.
- Passthrough is excluded. Forced DHCPv6-PD is hidden and rejected unless the carrier actually delegates a prefix; an extended RA /64 is not reported as DHCPv6-PD. These test connections did not supply PD.
- Disable stops cellular IPv6 and LAN advertisements, and blocks LAN IPv6 forwarding. IPv4 remains enabled. Enable restores an available mode.
- Applies use a private persistent transaction journal, firewall validation, connection checks and rollback. Startup restores interrupted transactions. Pending UCI edits and stale browser revisions are rejected.
- IPv6 changes wait for SIM operations and link tests. Automatic mode checks for prefix changes every 30 seconds without AT commands. Optional connection recovery caps interface retries at three attempts per hour with a 120-second cooldown. Turning recovery off prevents retries while preserving automatic prefix adaptation.
- DHCPv6 startup restores a missing link-local address only on NOARP modem interfaces. It prevents a parallel kernel SLAAC address from creating a conflicting WAN /64 route. Prefix extension retains the modem address as /128 and the client /64 on LAN; point-to-point links do not use Ethernet NDP proxy learning. It derives a stable device-specific address from the LAN MAC; it does not change the modem, kernel or calibration.

Run `ucode tests/ipv6.uc` on a router with this payload installed. The firmware staging scripts set runtime permissions explicitly.

Diagnostics distinguish router/LAN-source checks from real client tests. The packet-size check confirms a 1280-byte IPv6 packet; it does not claim to measure complete path-MTU discovery. AAAA resolution does not prove the DNS request used IPv6 transport. SLAAC-free Stateful DHCPv6 requires compatible clients.

Validation: `validation.json`. Original IPv6 selections and IPv4 settings were restored. The new backend normalizes the IPv6 UCI options it owns; raw configuration files therefore include the intended IPv6 corrections. The AT service starts before modem discovery to avoid marking a slow-starting modem disabled. No firmware was built or flashed.
