#!/bin/bash
# Replace the device tree inside the kernel FIT with the port-0 WAN version.
#
#     patch-kernel-dtb.sh <kernel-volume-in> <kernel-volume-out> <dtb>
#
# WHY THIS EXISTS
#
# K43P boards exist in two Ethernet layouts. On the affected production units,
# the WAN-labelled physical jack is MT7531 port 0 and the external RTL8221B at
# port 5 is not populated. ImmortalWrt 25.12 does the opposite: it omits port 0
# and declares a managed Clause-45 PHY at address 6 for port 5.
#
# On the port-0 units the phantom RTL8221B path fails during boot:
#
#   rtl822x_set_serdes_option_mode failed: -110
#   wan (uninitialized): failed to connect to PHY: -ETIMEDOUT
#   error -110 setting up PHY for tree 0, switch 0, port 5
#
# DSA never creates the physical port-0 netdev because the tree omitted it, so
# the socket disappears from the UI and client traffic. A bench unit with a
# populated port-5 RTL8221B works on the identical image, confirming the board
# variants.
#
# The production-unit fix is to expose MT7531 port 0 as `wan` and omit both
# port 5 and phy@6. The existing optional-WAN configuration already places the
# netdev named `wan` in br-lan, so clients behind that jack receive DHCP.
#
# WHY IT REBUILDS THE FIT RATHER THAN EDITING BYTES
#
# The kernel volume is a FIT whose fdt-1 node carries crc32 AND sha1 hashes over
# the device tree data. Patching the blob in place leaves both stale. So the FIT
# is rebuilt with mkimage, which recomputes them.
#
# Unlike the fixed-link workaround, this uses the internal MT7531 PHY and thus
# reports real cable carrier, speed, counters, and link transitions.
set -euo pipefail

IN="${1:?usage: patch-kernel-dtb.sh <in> <out> <dtb>}"
OUT="${2:?}"
DTB="${3:?}"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

for t in mkimage dumpimage dtc; do
	command -v "$t" >/dev/null || die "$t missing (install u-boot-tools and device-tree-compiler)"
done
[ -f "$IN" ]  || die "kernel volume not found: $IN"
[ -f "$DTB" ] || die "replacement dtb not found: $DTB"
[ "$(head -c4 "$IN" | xxd -p)" = "d00dfeed" ] || die "$IN is not a FIT image"

W=$(mktemp -d); trap 'rm -rf "$W"' EXIT

# Read the descriptions out of the original rather than hardcoding them, so a
# change of base image cannot silently mislabel the rebuilt FIT.
dtc -I dtb -O dts "$IN" 2>/dev/null \
	| sed 's/data = \[[^]]*\]/data = <STRIPPED>/' \
	| grep -vE '^\s*[0-9a-f]{2} ' > "$W/orig.dts"

kdesc=$(awk '/kernel-1 \{/,/type =/' "$W/orig.dts" | sed -n 's/.*description = "\(.*\)".*/\1/p' | head -1)
fdesc=$(awk '/fdt-1 \{/,/type =/'    "$W/orig.dts" | sed -n 's/.*description = "\(.*\)".*/\1/p' | head -1)
cdesc=$(awk '/config-1 \{/,/};/'     "$W/orig.dts" | sed -n 's/.*description = "\(.*\)".*/\1/p' | head -1)
load=$(sed -n 's/.*load = <\(0x[0-9a-f]*\)>.*/\1/p'  "$W/orig.dts" | head -1)
entry=$(sed -n 's/.*entry = <\(0x[0-9a-f]*\)>.*/\1/p' "$W/orig.dts" | head -1)
comp=$(awk '/kernel-1 \{/,/hash-1/' "$W/orig.dts" | sed -n 's/.*compression = "\(.*\)".*/\1/p' | head -1)

[ -n "$kdesc" ] && [ -n "$fdesc" ] && [ -n "$cdesc" ] || die "could not read FIT descriptions"
[ -n "$load" ]  && [ -n "$entry" ] && [ -n "$comp" ]  || die "could not read kernel load/entry/compression"

# Index 0 is the kernel payload, index 1 the device tree, matching the node
# order in the images node above.
# The image is a POSITIONAL argument here; this dumpimage has no -i option, and
# passing one makes it print usage and exit 0, leaving an empty output file that
# looks like a successful extraction of nothing.
dumpimage -T flat_dt -p 0 -o "$W/kernel.payload" "$IN" >/dev/null 2>&1 \
	|| die "could not extract the kernel payload from the FIT"
[ -s "$W/kernel.payload" ] || die "extracted kernel payload is empty"

cat > "$W/fit.its" <<ITS
/dts-v1/;
/ {
	description = "ARM64 OpenWrt FIT (Flattened Image Tree)";
	#address-cells = <1>;
	images {
		kernel-1 {
			description = "$kdesc";
			data = /incbin/("$W/kernel.payload");
			type = "kernel";
			arch = "arm64";
			os = "linux";
			compression = "$comp";
			load = <$load>;
			entry = <$entry>;
			hash-1 { algo = "crc32"; };
			hash-2 { algo = "sha1"; };
		};
		fdt-1 {
			description = "$fdesc";
			data = /incbin/("$DTB");
			type = "flat_dt";
			arch = "arm64";
			compression = "none";
			hash-1 { algo = "crc32"; };
			hash-2 { algo = "sha1"; };
		};
	};
	configurations {
		default = "config-1";
		config-1 {
			description = "$cdesc";
			kernel = "kernel-1";
			fdt = "fdt-1";
		};
	};
};
ITS

mkimage -f "$W/fit.its" "$OUT" >/dev/null 2>&1 || die "mkimage failed to build the patched FIT"

# Verify the result rather than trusting it: a FIT that builds but still carries
# the managed PHY would ship a regression that looks like a hardware fault.
off=$(grep -abo $'\xd0\x0d\xfe\xed' "$OUT" | tail -1 | cut -d: -f1)
ts=$(dd if="$OUT" bs=1 skip=$((off+4)) count=4 2>/dev/null | xxd -p)
dd if="$OUT" bs=1 skip="$off" count="$((16#$ts))" of="$W/out.dtb" 2>/dev/null
dtc -I dtb -O dts "$W/out.dtb" 2>/dev/null > "$W/out.dts"

grep -q 'phy@6'  "$W/out.dts" && die "patched FIT still contains phy@6"
grep -q 'port@5' "$W/out.dts" && die "patched FIT still contains port@5"
awk '/port@0 \{/,/^\t*\};/' "$W/out.dts" | grep -q 'label = "wan"' \
	|| die "patched FIT has no wan label on port@0"

printf '  kernel FIT rebuilt with the MT7531 port-0 WAN device tree\n'
printf '  %-22s %s bytes\n' "$(basename "$OUT")" "$(stat -c%s "$OUT")"
printf '  dtb sha256 %s\n' "$(sha256sum "$DTB" | cut -c1-16)"
