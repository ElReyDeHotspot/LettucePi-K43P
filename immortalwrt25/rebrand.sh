#!/bin/bash
# Rebrand the ImmortalWrt image for the Chester K43P.
#
#   ./rebrand.sh "Chester K43P" [version]
#
# Does, inside the rootfs:
#   1. model name shown in the UI            -> "Chester K43P"
#   2. "misectel" removed from every menu URL
#   3. visible "Misectel" text               -> "Chester"
#   4. Chinese language removed
#   5. Wi-Fi country code                    -> US on both radios
#
# Run under WSL, on ext4 (see wsl-rebrand.sh) -- DrvFs cannot create the
# device nodes in the rootfs.
set -euo pipefail

BRAND="${1:-Chester K43P}"
SHORT="${BRAND%% *}"            # "Chester"
VERSION="${2:-25.12}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/.work"; OUT="$HERE/out"
PEB=131072; MINIO=2048; SLOT_MAX=58720256
CHESTER_FEED="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/chesterAPK/packages.adb"
R="$WORK/rootfs"

# apk-tools 3 (v3 indexes/packages; Ubuntu's apk-tools is v2 and cannot read them)
APKBIN="${APKBIN:-/root/apk-tools/build/src/apk}"
FEED="${FEED:-https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/chesterAPK}"
# Where our packages are built. They land here before being published, so this
# is the only place the newest build is guaranteed to exist.
APKSRC="${APKSRC:-/mnt/c/Users/CTR/Documents/Codex/2026-08-14/usi/LettucePi-K43P/chesterAPK}"

step(){ printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die(){ printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

for t in unsquashfs mksquashfs ubinize; do command -v $t >/dev/null || die "$t missing"; done
[ -f "$HERE/kernel.bin" ] || die "missing kernel.bin"
[ -f "$HERE/rootfs.raw" ] || die "missing rootfs.raw"
[ "$(head -c4 "$HERE/rootfs.raw")" = "hsqs" ] || die "rootfs.raw is not squashfs"

rm -rf "$WORK"; mkdir -p "$WORK" "$OUT"

step "Unpacking rootfs"
unsquashfs -no-progress -dest "$R" "$HERE/rootfs.raw" >/dev/null
echo "  $(find "$R" | wc -l) entries"

# ---------------------------------------------------------------- 1. model
step "Model name -> $BRAND"
cat > "$R/lib/preinit/01_lettucepi_model" <<HOOK
# Runs before 02_sysinfo, which only writes /tmp/sysinfo/model when that file
# is absent -- so setting it here wins without patching any stock file.
# board_name is deliberately NOT touched: board.d keys network and LED setup
# off it, and changing it would break the device profile.
do_lettucepi_model() {
	mkdir -p /tmp/sysinfo
	echo "$BRAND" > /tmp/sysinfo/model
}

boot_hook_add preinit_main do_lettucepi_model
HOOK
chmod 0644 "$R/lib/preinit/01_lettucepi_model"
echo "  /lib/preinit/01_lettucepi_model"

# ------------------------------------------------------------- 2. menu URLs
# Only the menu KEYS are rewritten -- they are the address bar. "action.path"
# (the view file on disk) and the acl names are left alone, so nothing has to
# be moved or renamed.
#
# Three stripped names collide with stock LuCI pages that already exist, so
# those get a different name instead of the bare one:
#     admin/network/wireless  (luci-mod-network)  -> admin/network/wifi
#     admin/network/network   (luci-mod-network)  -> admin/network/settings
#     admin/system/system     (luci-mod-system)   -> admin/system/settings
step "Removing \"misectel\" from menu URLs"
M="$R/usr/share/luci/menu.d"
sed -i \
	-e 's|"admin/misectel-dashboard|"admin/dashboard|g' \
	-e 's|"admin/network/misectel-network"|"admin/network/settings"|g' \
	-e 's|"admin/network/misectel-portmap"|"admin/network/portmap"|g' \
	-e 's|"admin/network/misectel-wireless"|"admin/network/wifi"|g' \
	-e 's|"admin/system/misectel-system|"admin/system/settings|g' \
	-e 's|"admin/vpn/misectel-|"admin/vpn/|g' \
	"$M"/*.json
# the sub-tab literally named "misectel"
sed -i 's|"admin/system/settings/misectel"|"admin/system/settings/general"|g' "$M"/*.json

# Renaming the menu keys is only half the job: the theme template, the theme
# CSS and some views BUILD these URLs too, and a stale one there is not a
# cosmetic problem -- the post-login redirect lands on a dead URL and the whole
# UI 404s ("No page is registered at /admin/misectel-dashboard").
#
# The dashed forms (admin-misectel-dashboard-setup-wizard) are body-class
# selectors derived from the URL, so they have to track the rename or the page
# loses its styling.
for f in "$R"/usr/share/ucode/luci/template/themes/*/header.ut \
         "$R"/www/luci-static/*/cascade.css \
         "$R"/www/luci-static/resources/menu-misectel.js \
         "$R"/www/luci-static/resources/view/*/*.js; do
	[ -f "$f" ] || continue
	sed -i -e "s|admin/system/misectel-system|admin/system/settings|g" \
	       -e "s|admin-misectel-dashboard|admin-dashboard|g" \
	       -e "s|admin-misectel-system|admin-settings|g" \
	       -e "s|admin/misectel-dashboard|admin/dashboard|g" "$f"
done
# Land on /cgi-bin/luci/admin/ after login. The 'admin' node is
# firstchild+recurse, so it falls through to the dashboard on its own.
sed -i "s|build_url('admin/dashboard')|build_url('admin')|g" \
	"$R"/usr/share/ucode/luci/template/themes/*/header.ut

# L.url() takes the path as SEPARATE arguments --
#     L.url('admin','misectel-dashboard','overview')
# -- so the URL never appears as one 'admin/misectel-...' string and a
# whole-string search walks straight past it. That is how the setup wizard's
# skip button kept landing on a dead URL after the rename.
#
# Rewriting the bare quoted token is safe: view paths carry a slash
# ('misectel-dashboard/overview') and CSS classes carry a dash
# ('misectel-dashboard-badge'), so neither matches the exact quoted form.
for f in "$R"/www/luci-static/resources/view/*/*.js \
         "$R"/www/luci-static/resources/*.js; do
	[ -f "$f" ] || continue
	sed -i -e "s|'misectel-dashboard'|'dashboard'|g" \
	       -e "s|'misectel-system'|'settings'|g" \
	       -e "s|'misectel-network'|'settings'|g" \
	       -e "s|'misectel-wireless'|'wifi'|g" \
	       -e "s|'misectel-portmap'|'portmap'|g" "$f"
done

# Guard: nothing anywhere may still reference a misectel URL. Scans the WHOLE
# rootfs, because the file that broke this the first time (header.ut) was not
# in any of the directories being checked.
left=$(grep -rhoE "(admin/(network/|system/|vpn/)?misectel[a-z0-9_-]*|admin-misectel[a-z0-9_-]*)" \
	"$R/usr" "$R/www" "$R/etc" 2>/dev/null | sort -u || true)
[ -z "$left" ] || die "URLs still referencing misectel: $(echo $left)"

# Second guard, for the segment-style form the whole-string search cannot see.
seg=$(grep -rhoE "(L\.url|build_url)\([^)]*misectel[^)]*\)" \
	"$R/usr" "$R/www" 2>/dev/null | sort -u || true)
[ -z "$seg" ] || die "URL built from misectel segments: $(echo $seg)"
echo "  all URLs clean (menus, theme template, css, views); view paths and acl untouched"

# /etc/config/misectel lists the dashboard's app whitelist / always-show /
# blacklist as MENU ROUTES with the "admin/" prefix stripped -- not as view
# paths. The giveaway is entries like 'modem/cellular-info', which is a route;
# the view for it would be 'misectel-modem/cellular-info'. So these went stale
# with the URL rename and have to track it, or the dashboard filters against
# routes that no longer exist.
step "Updating dashboard route lists in /etc/config/misectel"
C="$R/etc/config/misectel"
[ -f "$C" ] || die "/etc/config/misectel missing - image layout changed"
sed -i \
	-e "s|system/misectel-system/misectel|system/settings/general|g" \
	-e "s|system/misectel-system/|system/settings/|g" \
	-e "s|misectel-dashboard/|dashboard/|g" \
	-e "s|network/misectel-wireless|network/wifi|g" \
	-e "s|network/misectel-portmap|network/portmap|g" \
	-e "s|network/misectel-network|network/settings|g" \
	-e "s|vpn/misectel-|vpn/|g" \
	"$C"
stale=$(grep -E "^[[:space:]]*list[[:space:]]+(app_whitelist|app_blacklist|always_show)" "$C" | grep misectel || true)
[ -z "$stale" ] || die "stale misectel routes remain in /etc/config/misectel: $stale"
echo "  $(grep -cE "^[[:space:]]*list[[:space:]]+(app_whitelist|app_blacklist|always_show)" "$C") route entries, none stale"

# --------------------------------------------------------- 3. visible text
step "Visible \"Misectel\" text -> $SHORT"
# Replace the CAPITALISED name everywhere; leave lowercase "misectel" alone.
#
# That split is the whole trick. Capital "Misectel" is display text - the theme
# footer brand, the ACL descriptions LuCI lists, comments - plus one JS helper
# (readMisectelOption). Lowercase "misectel" is structural: view directories
# under /www, the ubus object name, /etc/config/misectel, menu.d and acl.d
# filenames, CSS classes. Renaming those would mean rewriting every reference
# in lockstep across menus, ACLs, rpcd and the views, which is how the URL
# rename broke the whole UI once already.
#
# Replacing an identifier is safe here only because it is done in EVERY file at
# once, so a definition and its call sites move together.
n=0
while IFS= read -r f; do
	case "$(file -b --mime-type "$f" 2>/dev/null)" in
		text/*|application/json|application/javascript|inode/x-empty) ;;
		*) continue ;;
	esac
	sed -i "s/Misectel/$SHORT/g" "$f"
	n=$((n+1))
done <<< "$(grep -rl "Misectel" "$R/www" "$R/usr" "$R/etc" 2>/dev/null || true)"
echo "  $n files rebranded"

# Check only what the replacement could touch. Compiled .lmo catalogs are
# binary and must not be sed'ed -- the zh-cn ones carry the old name and are
# deleted outright by the Chinese-removal step below.
left=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	case "$(file -b --mime-type "$f" 2>/dev/null)" in
		text/*|application/json|application/javascript) left="$left $f" ;;
	esac
done <<< "$(grep -rl "Misectel" "$R/www" "$R/usr" "$R/etc" 2>/dev/null || true)"
[ -z "$left" ] || die "capitalised Misectel survived in text files:$left"
# The structural name must NOT have been touched, or menus and ACLs break.
[ -d "$R/www/luci-static/resources/view/misectel-dashboard" ] \
	|| die "view directories were renamed - menus and ACLs will not resolve"
[ -f "$R/usr/share/rpcd/ucode/misectel" ] || die "the misectel ubus object was renamed"
# Theme name in the theme picker. This is NOT in /etc/config/luci in the image
# -- it is registered on first boot by a uci-defaults script, so that is what
# has to be patched. The path value stays /luci-static/misectel (it is a
# directory name, not a label).
T="$R/etc/uci-defaults/30_luci-theme-misectel"
[ -f "$T" ] || die "theme uci-default missing - image layout changed"
sed -i "s|luci\.themes\.Misectel|luci.themes.$SHORT|g" "$T"
grep -q "luci.themes.$SHORT" "$T" || die "theme rename did not apply"
# and the copy in /etc/config/luci, if this image ships one already populated
sed -i -E "s|^([[:space:]]*option )'?Misectel'?([[:space:]].*)|\1$SHORT\2|" "$R/etc/config/luci" 2>/dev/null || true
echo "  theme registered as \"$SHORT\""

# ------------------------------------------------------------- 4. Chinese
step "Removing Chinese language"
# Remove the PACKAGES, not just their files. Deleting the .lmo files alone
# leaves /lib/apk/db/installed still claiming 18 packages are installed whose
# files are gone -- `apk info` then lies, and anything reasoning about the
# installed set gets it wrong. apk del updates the database properly.
if [ -x "$APKBIN" ]; then
	ZH=$("$APKBIN" --root "$R" info 2>/dev/null | grep -E '^luci-i18n-.*-zh-cn$' | tr '\n' ' ' || true)
	if [ -n "$ZH" ]; then
		"$APKBIN" --root "$R" del --no-network --no-scripts $ZH >/dev/null 2>&1 || true
		LEFT=$("$APKBIN" --root "$R" info 2>/dev/null | grep -cE '^luci-i18n-.*-zh-cn$' || true)
		[ "${LEFT:-0}" = 0 ] || die "$LEFT Chinese i18n packages survived removal"
		echo "  removed $(echo $ZH | wc -w) Chinese i18n packages (files + apk database)"
	fi
	# Nothing non-Chinese should be caught by this.
	KEPT=$("$APKBIN" --root "$R" info 2>/dev/null | grep -E '^luci-i18n-' | grep -v zh-cn || true)
	[ -z "$KEPT" ] || echo "  kept non-Chinese i18n: $(echo $KEPT | tr '\n' ' ')"
fi
# Belt and braces: any stray translation file the package db did not own.
n=$(find "$R" \( -name '*.zh-cn.lmo' -o -name '*.zh_cn.lmo' \) | wc -l)
find "$R" \( -name '*.zh-cn.lmo' -o -name '*.zh_cn.lmo' \) -delete
[ "$n" = 0 ] || echo "  deleted $n orphaned translation files"

# Each luci-i18n-*-zh-cn uci-default does
#     uci set luci.languages.zh_cn='...'
# on first boot, which puts Chinese back into the picker no matter what the
# shipped config says. Delete them.
d=$(find "$R/etc/uci-defaults" -name '*zh-cn*' -o -name '*zh_cn*' | wc -l)
find "$R/etc/uci-defaults" \( -name '*zh-cn*' -o -name '*zh_cn*' \) -delete
echo "  deleted $d Chinese first-boot scripts"

# 99-default-settings sets luci.main.lang=auto on first boot, which would
# override the shipped config -- so it has to be changed too, not just the
# config file.
sed -i 's|set luci\.main\.lang="auto"|set luci.main.lang="en"|' "$R/etc/uci-defaults/99-default-settings"
grep -q 'set luci\.main\.lang="en"' "$R/etc/uci-defaults/99-default-settings" || die "first-boot lang not forced to en"

# The shipped config, quote-tolerant: it is UNQUOTED in the image
# ("option lang auto") but quoted on a running box, so patterns must take both.
#
# Delete ONLY the zh_cn option line. Do NOT range-delete the whole
# 'languages' section: in the image these blocks are not separated by blank
# lines, so a /^$/ range runs on and takes 'sauth', 'ccache' and 'themes' with
# it. An empty languages section is harmless.
sed -i -E "/^[[:space:]]*option[[:space:]]+'?zh[_-]cn'?[[:space:]]/d" "$R/etc/config/luci"
sed -i -E "s|^([[:space:]]*option lang ).*|\1en|" "$R/etc/config/luci"
grep -qE "^[[:space:]]*option lang en$" "$R/etc/config/luci" || die "lang was not forced to en"
if grep -qiE "zh[_-]cn" "$R/etc/config/luci"; then die "Chinese still referenced in /etc/config/luci"; fi
# the blocks that a careless range delete would have eaten
for blk in themes sauth ccache; do
	grep -qE "^config internal '?$blk'?" "$R/etc/config/luci" || die "clobbered the '$blk' block in /etc/config/luci"
done
echo "  language list cleared, lang forced to en (config + first boot)"

# --------------------------------------------------------- 5. package feeds
# The shipped list has nine feeds. Three of them -- misectel, qmodem and
# video -- are build-time feeds that do not exist on the download server, so
# every `apk update` ends in
#   ERROR: wget: exited with error 8 ... unexpected end of file
# Verified live: those three 404, the other six return 200.
step "Package feeds -> immortalwrt.org"
F="$R/etc/apk/repositories.d/distfeeds.list"
[ -f "$F" ] || die "distfeeds.list missing - image layout changed"
before=$(grep -c . "$F")

# ImmortalWrt, not OpenWrt.
#
# This was pointed at downloads.openwrt.org for a while and it does not work:
# this rootfs IS ImmortalWrt, and OpenWrt's 25.12.5 feed is built against a
# different tree, so installs fail rather than merely missing kmods. The
# image already trusts immortalwrt-25.12.pem, so signatures verify with no
# new key.
#
# The TARGET feed (mediatek/filogic) is still left out, and it is worth being
# precise about why, because it DOES resolve:
#
#     this image                 kernel 6.12.85
#     ImmortalWrt target feed    kernel 6.12.87
#
# It cannot supply a matching kmod either way, so listing it buys nothing --
# while inviting `apk upgrade` to pull 6.12.87 over a working 6.12.85, which
# takes wifi and the modem with it. Checked at the same time: neither that
# feed nor OpenWrt's carries kmod-nft-queue or kmod-nfnetlink-queue at all,
# which is why the 4K/HD engine uses tpws (no kernel module) rather than
# nfqws. Userspace packages have no such dependency and install normally.
IWBASE="https://downloads.immortalwrt.org/releases/25.12-SNAPSHOT/packages/aarch64_cortex-a53"
cat > "$F" <<FEEDS
$IWBASE/base/packages.adb
$IWBASE/luci/packages.adb
$IWBASE/packages/packages.adb
$IWBASE/routing/packages.adb
$IWBASE/telephony/packages.adb
FEEDS
after=$(grep -c . "$F")
grep -q 'downloads\.immortalwrt\.org' "$F" || die "immortalwrt feeds not written"
grep -q 'downloads\.openwrt\.org' "$F" && die "an openwrt feed is still listed"
for dead in misectel qmodem video; do
	grep -q "/$dead/" "$F" && die "the $dead feed 404s - it must not be listed"
done
[ -f "$R/etc/apk/keys/immortalwrt-25.12.pem" ] || die "immortalwrt signing key missing from the image"
echo "  $before -> $after feeds, all on downloads.immortalwrt.org (25.12-SNAPSHOT)"
echo "  misectel/qmodem/video dropped (they 404); target feed omitted - see above"

# Our own feed, served from the GitHub repo. Its public key goes into
# /etc/apk/keys so signed packages from it are trusted; the private key never
# leaves the build machine. apk fetches <name>-<version>.apk from the same
# directory as the index, which is why the packages sit beside packages.adb.
if [ -f "$HERE/chester-apk.pem" ]; then
	install -d "$R/etc/apk/keys"
	install -m 0644 "$HERE/chester-apk.pem" "$R/etc/apk/keys/chester-apk.pem"
	echo "$CHESTER_FEED" > "$R/etc/apk/repositories.d/chester.list"
	echo "  added chesterAPK feed + signing key"
else
	die "chester-apk.pem is not beside the script - the Chester feed would be missing"
fi

# A terminal in the browser. Pulled from the feed rather than vendored so it
# tracks upstream, and installed with --no-scripts because the build host is
# x86_64 and this rootfs is aarch64 -- apk cannot chroot in to run them.
step "Terminal (ttyd)"
if "$APKBIN" add --root "$R" --no-scripts --arch aarch64_cortex-a53 \
		--allow-untrusted ttyd luci-app-ttyd 2>&1 | sed 's/^/  /'; then
	[ -x "$R/usr/bin/ttyd" ] || die "ttyd did not land in the rootfs"
	echo "  ttyd $("$APKBIN" list --root "$R" --installed 2>/dev/null | sed -n 's/^ttyd-\([^ ]*\).*/\1/p') installed"
else
	die "could not install ttyd from the feed"
fi

# ------------------------------- 5b. IPv6 on the LAN: nothing to do here
# There was a step here that added `ra`, `dhcpv6` and `ra_slaac` to the lan
# stanza of /etc/config/dhcp, on the theory that ImmortalWrt shipped that
# section without them and OpenWrt 25 shipped it with them. The file
# difference is real; the conclusion drawn from it was not.
#
# /rom/etc/uci-defaults/15_odhcpd runs on first boot and sets them
# unconditionally, whatever the file says:
#
#     set dhcp.lan.dhcpv4=$V4MODE
#     set dhcp.lan.dhcpv6=disabled
#     set dhcp.lan.ra=$V6MODE
#     set dhcp.lan.ra_slaac=1
#
# So editing the shipped file achieves nothing -- it is overwritten before
# anything reads it, and `dhcpv6=server` is actively undone.
#
# Measured on a bench unit running bin 18, which predates all of this and
# has never had the NAT6 tool applied (delegate, sourcefilter, ip6class and
# masq6 all unset): br-lan holds a global carrier prefix and LAN clients
# hold global addresses from Router Advertisement. IPv6 already works out of
# the box on this firmware wherever the carrier delegates a prefix.
#
# The Cellular > IPv6 tool is for the other case -- a carrier that hands over
# one address and NO delegated prefix, leaving no subnet to advertise, where
# a ULA has to be masqueraded instead. That is a real scenario and a real
# toggle; it is just not what a missing line in /etc/config/dhcp causes.

# ------------------------- 5c. the TTL tool must not rewrite NDP or MLD
# The TTL tool (Cellular > TTL) normalises the hop count of LAN traffic so the
# carrier cannot spot tethering. It did that to EVERY IPv6 packet leaving
# br-lan, including neighbour discovery -- and NDP carries hop limit 255
# precisely so it cannot be spoofed from off-link. RFC 4861 s7.1.2: a receiver
# MUST silently discard a neighbour advertisement that arrives with any other
# value.
#
# So with the TTL tool on, every client threw away this router's advertisements
# and re-solicited forever. Measured on the bench: solicitations arrived with
# hlim 255, advertisements went back out with hlim 64, the client re-asked
# roughly once a second, and IPv6 was unusable on the LAN -- while the router
# itself pinged the v6 internet fine and nothing appeared in any log, because
# the discard happens on the client.
#
# MLD is excluded for the same reason: it is defined to use hop limit 1.
#
# Everything else is still normalised, which is all the carrier can see anyway.
step "TTL tool: exclude neighbour discovery"
TTLINIT="$R/etc/init.d/qmodem_ttl"
[ -f "$TTLINIT" ] || die "qmodem_ttl init script missing - the TTL tool moved"
grep -q 'ip6 hoplimit set $ttl' "$TTLINIT" \
	|| die "the TTL tool no longer emits the rule this patch rewrites - recheck it by hand"
sed -i 's|^\( *\)iifname "br-lan" ip6 hoplimit set \$ttl comment "Reset Hop Limit for br-lan IPv6"$|\1iifname "br-lan" meta l4proto != ipv6-icmp ip6 hoplimit set $ttl comment "Reset Hop Limit for br-lan IPv6"\n\1iifname "br-lan" icmpv6 type { destination-unreachable, packet-too-big, time-exceeded, parameter-problem, echo-request, echo-reply } ip6 hoplimit set $ttl comment "Reset Hop Limit for br-lan ICMPv6 (NDP/MLD excluded, RFC 4861)"|' "$TTLINIT"
grep -q 'meta l4proto != ipv6-icmp' "$TTLINIT" \
	|| die "the NDP exclusion did not apply to qmodem_ttl"
[ "$(grep -c 'ip6 hoplimit set' "$TTLINIT")" = 2 ] \
	|| die "expected exactly 2 IPv6 hop-limit rules after the split, got $(grep -c 'ip6 hoplimit set' "$TTLINIT")"
echo "  NDP and MLD excluded from the hop-limit rewrite"

# ------------------- 5d. Setup Wizard: timezone, APN, and the password
# The vendor wizard configures internet, Wi-Fi and the admin password. Three
# things are added here, all in vendor files, so all of them are applied as
# anchored patches that DIE if their anchor moves -- a silently skipped patch
# would ship a wizard that looks right and quietly does nothing.
#
#   1. an APN dropdown and a Time Zone dropdown on the Internet step
#   2. the first screen shows the product and its mark, not "5G Wireless
#      Data Terminal", and no longer prints a stray "null" under the title
#      (createShell hands E() a null child when a step has no subtitle)
#   3. skipping the password step now CLEARS the root password
#
# On (3): the image ships root with a real hash, so skipping previously left
# every unit on the same published default -- the one printed in the upgrade
# guide. An obviously-unset password is better than a shared secret that looks
# set. It is bounded to the LAN by the firewall, not by luck: dropbear binds
# to the lan address only and the wan zone input policy is REJECT.
#
# On the dropdown data: it is served through the wizard's OWN context method,
# not misectel/luci. The wizard runs unauthenticated -- it exists to be used
# before a password is set -- and misectel-unauthenticated grants only the six
# misectel_setup_wizard methods, so calling apn_presets_get or getTimezones
# from the page would work while logged in and be denied at first boot, which
# is the only time the wizard actually runs.
step "Setup Wizard: timezone + APN + password"
WIZBE="$R/usr/share/rpcd/ucode/misectel_setup_wizard"
WIZFE="$R/www/luci-static/resources/view/misectel-dashboard/setup-wizard.js"
[ -f "$WIZBE" ] || die "setup wizard backend missing - the wizard moved"
[ -f "$WIZFE" ] || die "setup wizard view missing - the wizard moved"
command -v python3 >/dev/null 2>&1 || die "python3 is needed to patch the setup wizard"

python3 "$HERE/wizard-patches/patch-wizard-backend.py" "$WIZBE" | sed 's/^/  /' 	|| die "the setup wizard backend patch did not apply"
python3 "$HERE/wizard-patches/patch-wizard-view.py" "$WIZFE" | sed 's/^/  /' 	|| die "the setup wizard view patch did not apply"

grep -q 'function applyChesterExtras' "$WIZBE" || die "wizard backend: applyChesterExtras missing"
grep -q 'passwd -d root'              "$WIZBE" || die "wizard backend: skip does not clear the password"
grep -q 'buildChesterContext'         "$WIZBE" || die "wizard backend: dropdown context missing"
grep -q 'buildChesterExtras'          "$WIZFE" || die "wizard view: dropdowns missing"
grep -q 'LettucePi'                   "$WIZFE" || die "wizard view: start screen not branded"
grep -q '5G Wireless Data Terminal'   "$WIZFE" && die "wizard view: vendor string still on the start screen"
echo "  APN + Time Zone dropdowns, branded start screen, skip clears the password"

# ------------------------------------------------------ 6. root password
# A sysupgrade -n leaves /etc/shadow with an EMPTY root password, which the
# login banner warns about and which contradicts the guide (root/admin).
# Hash generated with busybox passwd on the target, so the format ($5$,
# SHA-256 crypt) is exactly what this firmware produces.
step "Setting the default root password"
[ -n "${ROOT_HASH:-}" ] || ROOT_HASH='$5$MvnJarVIBlXg2KtV$jXgqH2st5Bs.hA8rY3m3p8l0VQ15xSWS95CiHqPjsYB'
awk -v h="$ROOT_HASH" -F: 'BEGIN{OFS=":"} $1=="root"{$2=h} {print}' "$R/etc/shadow" > "$R/etc/shadow.new"
mv "$R/etc/shadow.new" "$R/etc/shadow"; chmod 0600 "$R/etc/shadow"
grep -q '^root:\$5\$' "$R/etc/shadow" || die "root password hash not applied"
echo "  root password set (default: admin - tell customers to change it)"

# ------------------------------------------------ 7. first-boot fixups
step "First-boot settings (country code, board.json)"
mkdir -p "$R/etc/uci-defaults"
cat > "$R/etc/uci-defaults/99-lettucepi-brand" <<UCID
#!/bin/sh
# board.json is written on first boot from the device tree, which still says
# the stock name. Bring it in line with /tmp/sysinfo/model.
[ -f /etc/board.json ] && sed -i 's/"name": "[^"]*"/"name": "$BRAND"/' /etc/board.json

# Wi-Fi regulatory domain. The stock image ships CN on both radios, which is
# the wrong channel/power set for the US. /etc/config/wireless is generated on
# first boot, so generate it here if it does not exist yet, then force US.
[ -f /etc/config/wireless ] || wifi config
for r in \$(uci show wireless 2>/dev/null | sed -n 's/^wireless\.\([a-z0-9]*\)=wifi-device\$/\1/p'); do
	uci set wireless.\$r.country='US'
done
uci commit wireless

# APN preset country. Written here rather than spliced in later by a sed with a
# multi-line replacement -- that is fragile (a raw newline in the replacement is
# an "unterminated \`s' command") and it broke the build once already.
uci -q set misectel.main.apn_country='US'
uci -q commit misectel
exit 0
UCID
chmod 0755 "$R/etc/uci-defaults/99-lettucepi-brand"
echo "  /etc/uci-defaults/99-lettucepi-brand (board.json + country US + apn_country US)"

# ------------------------------------------- 8. LuCI system-update page
# A page inside LuCI that pulls the image from GitHub and installs it keeping
# settings. The build id stamped here is what the page compares against the
# published manifest -- not the image's own sha256, which cannot be known
# before the stamp is written.
step "Installing the System Update page"
LU="$HERE/luci-chester-update"
if [ -d "$LU" ]; then
	BUILD_ID="${BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}"
	# bin= is the image's sequence number in ChesterK43P-Bin. It is passed in
	# by build-bin.sh, which has to decide it before calling this script.
	# Unknown is stamped rather than omitted, so the update page shows an
	# honest gap instead of a blank where a number should be.
	BIN_NUMBER="${BIN_NUMBER:-unknown}"
	printf 'version=%s\nbuilt=%s\nbuild=%s\nbin=%s\n' \
		"$VERSION" "$(date -u +%Y-%m-%dT%H:%MZ)" "$BUILD_ID" "$BIN_NUMBER" \
		> "$R/etc/chester-version"
	chmod 0644 "$R/etc/chester-version"

	install -m 0755 "$LU/chester-update" "$R/usr/sbin/chester-update"
	install -d "$R/www/luci-static/resources/view/chester-update"
	install -m 0644 "$LU/index.js" "$R/www/luci-static/resources/view/chester-update/index.js"
	install -m 0644 "$LU/menu.json" "$R/usr/share/luci/menu.d/luci-app-chester-update.json"
	install -m 0644 "$LU/acl.json"  "$R/usr/share/rpcd/acl.d/luci-app-chester-update.json"

	# The page reflashes with the same both-banks method the installer uses;
	# keep a copy where it can reach it.
	install -d "$R/usr/share/chester"
	install -m 0644 "$HERE/../../k43p-wrapper/openwrt25/platform.sh" "$R/usr/share/chester/platform.sh" 2>/dev/null \
		|| install -m 0644 "$LU/platform.sh" "$R/usr/share/chester/platform.sh"
	[ -s "$R/usr/share/chester/platform.sh" ] || die "flash method not staged for the update page"

	# Put back packages the customer installed themselves. A sysupgrade
	# replaces the rootfs, so `apk add`ed packages vanish even when settings
	# are kept; sysupgrade -k leaves the list and this reinstalls from it.
	if [ -f "$LU/chester-restore-pkgs" ]; then
		install -m 0755 "$LU/chester-restore-pkgs" "$R/etc/init.d/chester-restore-pkgs"
		install -d "$R/etc/rc.d"
		ln -sf ../init.d/chester-restore-pkgs "$R/etc/rc.d/S99chester-restore-pkgs"
		echo "  package restore service (S99chester-restore-pkgs)"
	fi

	# Tailscale is deliberately NOT in the image.
	#
	# It used to ship dormant (binary present, no rc.d symlink) so that turning
	# it on cost nothing writable. That was ~7.7 MB of squashfs for something
	# most units never switch on, so the payload is gone and the page installs
	# it from the package feed on demand instead -- these units are online.
	#
	# The MENU ENTRY STAYS (Apps > Tailscale). Only the payload is removed.
	rm -rf "$R/usr/sbin/tailscaled" "$R/usr/sbin/tailscale" \
	       "$R/etc/init.d/tailscale" "$R/etc/config/tailscale" \
	       "$R/etc/tailscale" "$R/usr/share/tailscale"
	rm -f "$R/etc/rc.d/"*tailscale 2>/dev/null || true
	for p in "$R/usr/sbin/tailscaled" "$R/usr/sbin/tailscale" "$R/etc/init.d/tailscale"; do
		[ -e "$p" ] && die "tailscale payload still in the image: ${p#$R}"
	done
	echo "  tailscale payload NOT shipped (installed on demand from the feed)"

	# its install/uninstall control
	if [ -f "$LU/chester-tailscale" ]; then
		install -m 0755 "$LU/chester-tailscale" "$R/usr/sbin/chester-tailscale"
		install -d "$R/www/luci-static/resources/view/chester-tailscale"
		install -m 0644 "$LU/tailscale-index.js" "$R/www/luci-static/resources/view/chester-tailscale/index.js"
		install -m 0644 "$LU/tailscale-menu.json" "$R/usr/share/luci/menu.d/luci-app-chester-tailscale.json"
		install -m 0644 "$LU/tailscale-acl.json"  "$R/usr/share/rpcd/acl.d/luci-app-chester-tailscale.json"
		echo "  Apps > Tailscale install/uninstall page"
	fi

	echo "  build id $BUILD_ID"
	echo "  /usr/sbin/chester-update, LuCI view, menu + acl, /usr/share/chester/platform.sh"
	printf '%s\n' "$BUILD_ID" > "$OUT/.build-id"
else
	echo "  (luci-chester-update/ not found beside the script - page not added)"
fi

# --------------------------------------------------------- 9. remove boost
# Not used. Removing the page alone would leave the service running and the
# first-boot script re-adding it, so take the whole thing out.
step "Removing Modem Boost"
BOOST_MENU="$M/luci-app-misectel-modem.json"
python3 - "$BOOST_MENU" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
gone=[k for k in list(d) if k.endswith("/boost")]
for k in gone: del d[k]
open(p,"w",newline="\n").write(json.dumps(d,indent="\t")+"\n")
print("  menu nodes removed:", gone or "none")
PY
rm -f "$R/etc/init.d/misectel_modem_boost" \
      "$R/etc/rc.d/"*misectel_modem_boost \
      "$R/www/luci-static/resources/view/misectel-modem/boost.js"
# the first-boot script sets boost_* and re-adds modem/boost to the whitelist
# on EVERY boot (its duplicate check can never match, which is why the live box
# had the entry five times)
UD="$R/etc/uci-defaults/90_luci-app-misectel-modem"
if [ -f "$UD" ]; then
	sed -i -e "/boost_gpio/d" -e "/boost_cap/d" -e "/boost_mode/d" -e "/boost_manual_value/d" \
	       -e "/app_whitelist='modem\/boost'/d" -e "/misectel_modem_boost/d" "$UD"
	grep -q "boost" "$UD" && echo "  note: boost still referenced in $UD" || echo "  first-boot boost setup removed"
fi
sed -i "/list app_whitelist 'modem\/boost'/d" "$R/etc/config/misectel"
grep -rq "misectel_modem_boost" "$R/etc" 2>/dev/null && die "boost service still referenced" || true
echo "  service, view, menu entry and first-boot setup all removed"

# ------------------------------------------------- 10. LettucePi theme
# Shipped IN the image, not left as a package: a flash replaces the rootfs and
# does not keep self-installed packages, so a default pointing at a
# package-only theme would come up with no theme at all.
# Set WITH_LETTUCEPI=1 to ship the LettucePi theme again. Off by default: its
# package overrode admin/dashboard/overview globally (see install_theme_apk),
# and it is still moving fast enough that pinning it into a customer image is
# not useful yet. With it absent the 99- script registers Footstrap, finds no
# lettucepi directory and exits, so 30_luci-theme-misectel's setting stands and
# Chester is the default.
step "Footstrap theme"
# Footstrap: an extra theme the customer can select. Not the default.
# Tracks the newest upstream release rather than pinning a version. It is
# ucode-based (11 .ut templates, no legacy Lua), which is what LuCI on
# OpenWrt 25 needs -- a Lua-template theme would simply not render.
if [ -x "$APKBIN" ]; then
	FSVER=$(curl -fsSL --max-time 60 "https://api.github.com/repos/VizzleTF/luci-theme-footstrap/releases/latest" 2>/dev/null \
		| sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
	if [ -n "$FSVER" ] && curl -fsSL --max-time 180 \
		"https://github.com/VizzleTF/luci-theme-footstrap/releases/download/v$FSVER/luci-theme-footstrap-$FSVER-r1.apk" \
		-o "$WORK/fs.apk" 2>/dev/null; then
		rm -rf "$WORK/fs"; mkdir -p "$WORK/fs"
		if "$APKBIN" extract --allow-untrusted --destination "$WORK/fs" "$WORK/fs.apk" >/dev/null 2>&1 \
			&& [ -f "$WORK/fs/www/luci-static/footstrap/cascade.css" ]; then
			cp -a "$WORK/fs/www/." "$R/www/" 2>/dev/null || true
			cp -a "$WORK/fs/usr/." "$R/usr/" 2>/dev/null || true
			echo "  footstrap $FSVER added (selectable, not default)"
		else
			echo "  NOTE: footstrap package did not extract cleanly - skipped"
		fi
	else
		echo "  NOTE: could not fetch footstrap - skipped"
	fi
fi

WITH_LETTUCEPI="${WITH_LETTUCEPI:-0}"
step "LettucePi theme (WITH_LETTUCEPI=$WITH_LETTUCEPI)"
if [ "$WITH_LETTUCEPI" != 1 ]; then
	echo "  skipped - Chester remains the default theme"
else
LT="$HERE/lettucepi-theme"

# Prefer the newest build published to chesterAPK, so every image carries the
# current theme instead of whatever snapshot happens to sit in this directory.
# Falls back to the bundled snapshot, loudly, if the package is not in the feed.
THEME_PKG=luci-theme-lettucepi
FETCHED=0

install_theme_apk() {   # install_theme_apk <apk-file> <label>
	rm -rf "$WORK/theme"; mkdir -p "$WORK/theme"
	"$APKBIN" extract --allow-untrusted --destination "$WORK/theme" "$1" >/dev/null 2>&1 || return 1
	[ -d "$WORK/theme/www/luci-static/lettucepi" ] || return 1
	cp -a "$WORK/theme/www/." "$R/www/" 2>/dev/null || true
	cp -a "$WORK/theme/usr/." "$R/usr/" 2>/dev/null || true

	# The theme package ships zzzz-lettucepi-home.json, which REDEFINES
	# admin/dashboard/overview to point at the LettucePi launcher. Menu files
	# merge in filename order and "zzzz" sorts last, so it wins -- globally,
	# for EVERY theme. The Chester dashboard then stops showing the Chester
	# dashboard.
	#
	# LuCI menus have no "only for this theme" concept, so the only way to keep
	# Chester intact is not to ship the override. Consequence, stated plainly:
	# the LettucePi theme lands on the stock dashboard too. The proper fix
	# belongs in the theme package -- register the launcher at its own path
	# (e.g. admin/lettucepi/home) and point the theme's home link there, rather
	# than overriding a page another theme owns.
	if [ -f "$R/usr/share/luci/menu.d/zzzz-lettucepi-home.json" ]; then
		rm -f "$R/usr/share/luci/menu.d/zzzz-lettucepi-home.json"
		echo "  dropped zzzz-lettucepi-home.json (it overrode Chester's dashboard)"
	fi
	echo "  using $(basename "$1")  ($2)"
	return 0
}

# 1. newest build in the package source directory (version-sorted, so
#    0.2.0-r1 wins over 0.1.0-r2)
if [ "$FETCHED" = 0 ] && [ -x "$APKBIN" ] && [ -d "$APKSRC" ]; then
	CAND=$(ls "$APKSRC"/$THEME_PKG-*.apk 2>/dev/null | sort -V | tail -1)
	if [ -n "$CAND" ] && install_theme_apk "$CAND" "newest local build"; then FETCHED=1; fi
fi

# 2. otherwise whatever is published to the feed
if [ "$FETCHED" = 0 ] && [ -x "$APKBIN" ] && curl -fsSL --max-time 40 "$FEED/packages.adb?cb=$(date +%s)" -o "$WORK/feed.adb" 2>/dev/null; then
	# adbdump prints "  - name: X" then "    version: Y"
	VER=$("$APKBIN" adbdump "$WORK/feed.adb" 2>/dev/null \
		| awk -v p="$THEME_PKG" '/name:/{n=$NF} /version:/{if(n==p) v=$NF} END{print v}')
	if [ -n "$VER" ]; then
		if curl -fsSL --max-time 120 "$FEED/$THEME_PKG-$VER.apk" -o "$WORK/theme.apk" 2>/dev/null; then
			install_theme_apk "$WORK/theme.apk" "latest published to chesterAPK" && FETCHED=1
		fi
	else
		echo "  NOTE: $THEME_PKG is not published to chesterAPK"
	fi
fi

if [ "$FETCHED" = 0 ] && [ -d "$LT/www" ] && [ -d "$LT/tpl" ]; then
	printf '\033[33m  WARNING: falling back to the bundled theme snapshot -- this image may not\n'
	printf '           carry the newest theme. Publish %s to chesterAPK.\033[0m\n' "$THEME_PKG"
	install -d "$R/www/luci-static/lettucepi" "$R/usr/share/ucode/luci/template/themes/lettucepi"
	cp -a "$LT/www/." "$R/www/luci-static/lettucepi/"
	cp -a "$LT/tpl/." "$R/usr/share/ucode/luci/template/themes/lettucepi/"
fi


if [ -d "$R/www/luci-static/lettucepi" ]; then
	find "$R/www/luci-static/lettucepi" "$R/usr/share/ucode/luci/template/themes/lettucepi" -type f -exec chmod 0644 {} + 2>/dev/null
	[ -f "$R/usr/share/ucode/luci/template/themes/lettucepi/header.ut" ] || die "theme installed without its header template"

	# Registered and made default on first boot, AFTER 30_luci-theme-misectel
	# has set Chester. Guarded on the files actually being present so a bad
	# build cannot leave the UI themeless.
	echo "  theme files + 99-lettucepi-theme (default, Chester still selectable)"
else
	die "lettucepi-theme/ not found beside the script"
fi

fi


# Register whichever themes actually shipped, and pick the default. Written
# unconditionally: Footstrap ships even when LettucePi does not, and it still
# has to appear in the theme list.
step "Registering themes"
cat > "$R/etc/uci-defaults/99-chester-themes" <<'UCID'
#!/bin/sh
# Each guard matters: pointing mediaurlbase at a directory that is not there
# leaves LuCI with no styling at all.
[ -d /www/luci-static/footstrap ] && uci -q set luci.themes.Footstrap='/luci-static/footstrap'

if [ -d /www/luci-static/lettucepi ] &&    [ -f /usr/share/ucode/luci/template/themes/lettucepi/header.ut ]; then
	uci -q set luci.themes.LettucePi='/luci-static/lettucepi'
	uci -q set luci.main.mediaurlbase='/luci-static/lettucepi'
fi
# No LettucePi -> 30_luci-theme-misectel's setting stands and Chester is default.
uci commit luci
exit 0
UCID
chmod 0755 "$R/etc/uci-defaults/99-chester-themes"
echo "  99-chester-themes (Footstrap always; LettucePi default only if shipped)"

# Chester force-hides the stock System page, which is where LuCI keeps the
# hostname/timezone settings AND the Language & Style theme picker -- so with
# it hidden there is no way to switch themes from the UI at all. Unhide it.
# system/flash (Backup / Flash Firmware) stays hidden deliberately: it flashes
# images without the checks the System Update page performs.
step "Unhiding the stock System page in the Chester theme"
MM="$R/www/luci-static/resources/menu-misectel.js"
if [ -f "$MM" ]; then
	sed -i "s|'system/system',||; s|,'system/system'||" "$MM"
	if grep -q "'system/system'" "$MM"; then
		die "system/system is still force-hidden"
	fi
	grep -q "'system/flash'" "$MM" || echo "  note: system/flash is no longer hidden either"
	echo "  system/system now reachable (theme picker); system/flash still hidden"
fi

# admin/system/settings and the stock admin/system/system were BOTH titled
# "System", so the menu showed two identical entries under System Settings --
# only visible once the stock page was unhidden. Rename ours to "Settings".
step "Disambiguating the System menu"
# NB: TAB and NL are built with chr() on purpose. Writing them as backslash
# escapes here is how this block got corrupted once already: the escape is
# consumed before it reaches the file, leaving a literal newline inside a
# string literal and a SyntaxError that aborts the whole build.
python3 - "$M/luci-app-misectel-system.json" <<'PYEOF'
import json,sys
TAB=chr(9); NL=chr(10)
p=sys.argv[1]; d=json.load(open(p,encoding="utf-8"))
k="admin/system/settings"
if k in d and d[k].get("title")=="System":
    d[k]["title"]="Settings"
    open(p,"w",encoding="utf-8",newline=NL).write(json.dumps(d,indent=TAB)+NL)
    print("  admin/system/settings retitled 'System' -> 'Settings'")
else:
    print("  admin/system/settings title is %r (unchanged)" % d.get(k,{}).get("title"))
PYEOF

# APN presets. The US list already shipped but was never reachable: the picker
# resolves misectel.main.apn_country, that option was unset, so it fell back to
# unknown.json ("Generic Internet") and the US carriers stayed hidden. Set the
# country AND extend the list with the APNs this hardware is actually used on.
step "APN presets"
# Hard failure, not a skip. This file lives beside the script on the Windows
# side and has to be copied into the build dir by wsl-rebrand.sh; when that
# copy was missing the whole step silently did nothing and the image shipped
# the stock preset list while the build still reported success.
[ -f "$HERE/apn-us.json" ] || die "apn-us.json missing from $HERE (wsl-rebrand.sh must copy it)"
PD="$R/usr/share/misectel/apn-presets/defaults"
[ -d "$PD" ] || die "$PD missing - preset layout changed"
install -m 0644 "$HERE/apn-us.json" "$PD/us.json"
n=$(grep -c '"apn"' "$PD/us.json")
[ "$n" -ge 1 ] || die "us.json contains no presets"
echo "  us.json installed ($n presets)"
# The picker only reads the list once misectel.main.apn_country is set; that is
# written by the first-boot script built in step 7. Verified here because this
# is the step that would be wrong if it ever went missing.
grep -q "apn_country='US'" "$R/etc/uci-defaults/99-lettucepi-brand" || die "apn_country not set for first boot"
echo "  apn_country=US set at first boot (was unset -> fell back to Generic Internet)"

# The QModem "Dial Configuration" dialog (Cellular -> QModem -> Network Config
# -> Edit) has its own APN and APN 2 dropdowns, and those are NOT fed by
# apn-presets or by /usr/share/qmodem/apns.json -- the entries are hardcoded
# literals inside the view. So the preset work above does not touch them and
# they kept offering 33 China/Russia/Malaysia/Philippines APNs each.
#
# Driven from apn-us.json so the picker and these dropdowns cannot drift apart:
# edit that one file and both follow.
step "US APN dropdowns in QModem dial config"
NC="$R/www/luci-static/resources/view/qmodem/network_config.js"
[ -f "$NC" ] || die "qmodem network_config.js missing - image layout changed"
python3 - "$HERE/apn-us.json" "$NC" <<'PYEOF'
import json,re,sys
presets=json.load(open(sys.argv[1],encoding="utf-8"))["presets"]
p=sys.argv[2]
s=open(p,encoding="utf-8").read()
BS=chr(92)
def esc(x): return x.replace(BS,BS+BS).replace("'",BS+"'")
# "Auto Choose" stays first: it is the empty value, i.e. let the modem decide.
opts="o.value('',_('Auto Choose'));"+"".join(
    "o.value('%s','%s');"%(esc(e["apn"]),esc(e["operator"])) for e in presets)
# Matches both o.value('x',_('y')); and o.value('x','y'); -- the vendor list
# uses both forms, and a pattern that only handles _() silently leaves the
# plain-string entries behind.
VAL=re.compile(r"o\.value\('[^']*',(?:_\()?'[^']*'\)?\);")
total=0
for name in ("apn","apn2"):
    m=re.search(r"o=s\.option\(form\.Value,'"+name+r"',",s)
    if not m: sys.exit("no '%s' option block found" % name)
    start=m.start()
    nxt=s.find("o=s.option(",start+5)
    end=nxt if nxt>0 else len(s)
    blk=s[start:end]
    first=VAL.search(blk)
    if not first: sys.exit("no o.value entries in the '%s' block" % name)
    total+=len(VAL.findall(blk))
    # Rebuild in place at the position of the first entry, so the new list sits
    # exactly where the old one did and the rest of the block is untouched.
    blk=blk[:first.start()]+opts+VAL.sub("",blk[first.start():])
    s=s[:start]+blk+s[end:]
open(p,"w",encoding="utf-8",newline="").write(s)
print("  replaced %d hardcoded options with %d US entries across apn + apn2"
      % (total,len(presets)+1))
PYEOF
for bad in "(CN)" "(RU)" "(MY)" "(PH)" cmnet 3gnet ctnet celcom3g; do
	grep -qF "$bad" "$NC" && die "foreign APN entry '$bad' survived in network_config.js"
done
grep -qF "fast.t-mobile.com" "$NC" || die "US APN list not present in network_config.js"
echo "  no foreign APN entries remain in the dial-config dropdowns"

# Two country defaults that both fall back to the wrong region.
#
# 1. 99_misectel-oem-defaults runs AFTER our 99-lettucepi-brand ("-" sorts
#    before "_"), reads owrt_country from the u-boot env -- which is NOT set on
#    this hardware, the env has a bad CRC -- and falls back to 'unknown'. It
#    then resets misectel.main.apn_country AND copies unknown.json over the
#    user preset list. So setting apn_country ourselves is undone on every
#    fresh boot. Fix it at the source instead.
# 2. /lib/wifi/mac80211.uc hardcodes "CN" as the country when the board
#    provides none, which is where the CN regulatory domain came from. Our
#    uci-defaults corrects the radios after generation, but anything that
#    regenerates wireless config later would produce CN again.
step "Fixing country fallbacks"
OEM="$R/etc/uci-defaults/99_misectel-oem-defaults"
if [ -f "$OEM" ]; then
	sed -i "s|DEFAULT_APN_COUNTRY='unknown'|DEFAULT_APN_COUNTRY='us'|" "$OEM"
	grep -q "DEFAULT_APN_COUNTRY='us'" "$OEM" || die "APN country fallback not patched"
	echo "  APN country fallback: unknown -> us (was overwriting our setting)"
fi
# 3. The self-signed HTTPS certificate is issued with country "ZZ".
U="$R/etc/config/uhttpd"
if [ -f "$U" ]; then
	sed -i -E "s#^([[:space:]]*option[[:space:]]+country[[:space:]]+)ZZ#\1US#" "$U"
	grep -qE "^[[:space:]]*option[[:space:]]+country[[:space:]]+US" "$U" || die "uhttpd cert country not patched"
	echo "  https certificate country: ZZ -> US"
fi

W="$R/lib/wifi/mac80211.uc"
if [ -f "$W" ]; then
	# NB: the pattern contains "||", so "|" cannot be the sed delimiter.
	sed -i 's#country || "CN"#country || "US"#' "$W"
	grep -q 'country || "US"' "$W" || die "wifi country fallback not patched"
	grep -q 'country || "CN"' "$W" && die "CN wifi fallback still present"
	echo "  wifi country fallback: CN -> US"
fi

# The modem connectivity check defaults to http://www.baidu.com -- in the SIM
# and QModem monitor pages, and in two LED scripts that probe it with wget.
# A US product should not be reaching a Chinese site to decide whether its data
# link is up. Swap in the standard 204 endpoint (same family as the NTP servers
# this image already uses).
step "Replacing the Baidu connectivity check"
CHECK_HOST="connectivitycheck.gstatic.com"
CHECK_URL="http://$CHECK_HOST/generate_204"
n=0
for f in "$R"/www/luci-static/resources/view/misectel-modem/sim.js          "$R"/www/luci-static/resources/view/qmodem/monitor.js          "$R"/usr/share/qmodem/led_scripts/connectivity.sh          "$R"/usr/share/qmodem/led_scripts/c2000_max.sh; do
	[ -f "$f" ] || continue
	sed -i -e "s#http://www\.baidu\.com/#$CHECK_URL#g" 	       -e "s#http://www\.baidu\.com#$CHECK_URL#g" 	       -e "s#\bwww\.baidu\.com\b#$CHECK_HOST#g" "$f"
	n=$((n+1))
done
# The dashboard's own connectivity probe lives in the misectel rpcd backend
# and pings Baidu first, Alibaba second. It is a ucode target LIST rather
# than a URL, so the substitutions above never touched it - and the guard
# below used to be case-sensitive, so 'Baidu' with a capital B slipped past
# it for several builds. Replace the list outright.
BE="$R/usr/share/rpcd/ucode/misectel"
if [ -f "$BE" ]; then
	python3 - "$BE" <<'PYBAIDU'
import sys
NL = chr(10); T = chr(9)
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old = (3*T + 'let targets = [' + NL +
       4*T + "{ name: 'Baidu', ip: '180.76.76.76' }," + NL +
       4*T + "{ name: 'Alibaba', ip: '223.5.5.5' }," + NL +
       4*T + "{ name: 'Google', ip: '8.8.8.8' }" + NL +
       3*T + '];')
new = (3*T + 'let targets = [' + NL +
       4*T + "{ name: 'Cloudflare', ip: '1.1.1.1' }," + NL +
       4*T + "{ name: 'Google', ip: '8.8.8.8' }," + NL +
       4*T + "{ name: 'Quad9', ip: '9.9.9.9' }" + NL +
       3*T + '];')
if new in s:
    print('  dashboard probe already on non-Chinese targets')
elif old in s:
    open(p, 'w', encoding='utf-8', newline=NL).write(s.replace(old, new, 1))
    print('  dashboard probe: Baidu/Alibaba/Google -> Cloudflare/Google/Quad9')
else:
    sys.exit('dashboard connectivity target list not found - backend changed')
PYBAIDU
fi

# Case-INSENSITIVE now. pci.ids is a hardware vendor database that lists
# Baidu as a PCI vendor; it is data and is never contacted.
left=$(grep -ril baidu "$R/www" "$R/usr" "$R/etc" "$R/lib" 2>/dev/null | grep -v "/usr/share/hwdata/pci.ids" || true)
[ -z "$left" ] || die "baidu still referenced in: $(echo $left)"
echo "  $n files updated; zero baidu references remain"

# QModem pages were hidden in the Chester theme; show them.
step "Unhiding QModem in Cellular"
MM="$R/www/luci-static/resources/menu-misectel.js"
if [ -f "$MM" ]; then
	sed -i -e "s#'modem/qmodem/settings',##" -e "s#,'modem/qmodem/settings'##" 	       -e "s#'modem/qmodem',##"          -e "s#,'modem/qmodem'##" "$MM"
	grep -q "'modem/qmodem'" "$MM" && die "modem/qmodem still hidden"
	echo "  QModem menu now visible in the Chester theme"
fi

# The stock client list can only name a device through "Add Static IP", which
# refuses to save without an IPv4 address -- so naming a phone also meant
# reserving an address for it. Ours writes a dhcp 'host' section carrying just
# mac + name, which dnsmasq turns into --dhcp-host=<mac>,<name>: a name, no
# reservation. Also drops a duplicated status column and adds a filter.
step "Client list with custom device names"
CV="$R/www/luci-static/resources/view/misectel-device/index.js"
[ -f "$CV" ] || die "client list view missing - image layout changed"
[ -f "$LU/clients-index.js" ] || die "clients-index.js missing from $LU"
install -m 0644 "$LU/clients-index.js" "$CV"
grep -q "saveClientName" "$CV" || die "client list view did not take"
# The page writes uci dhcp; without that ACL every save fails with a
# permission error that surfaces only when the user clicks Save.
A="$R/usr/share/rpcd/acl.d/luci-app-misectel-device.json"
python3 - "$A" <<'PYEOF'
import json,sys
p=sys.argv[1]; d=json.load(open(p,encoding="utf-8"))
node=d.setdefault("luci-app-misectel-device",{}).setdefault("write",{}).setdefault("uci",[])
if "dhcp" not in node:
    node.append("dhcp")
    open(p,"w",encoding="utf-8",newline=chr(10)).write(json.dumps(d,indent="\t")+chr(10))
    print("  added uci:dhcp write permission")
else:
    print("  uci:dhcp write permission already present")
PYEOF
echo "  devices can be named without reserving an IP"

# The Wi-Fi page had the same control labelled two different ways ("Enable
# Wireless" / "WiFi Enable"), a stray lowercase "band width", and card
# subtitles built from the INTERNAL radio name, so customers read
# "radio0 Separate Configuration". Layout is fixed in CSS; see wifi-tidy.css
# for why the rows were ragged.
step "Tidying the Wi-Fi page"
WV="$R/www/luci-static/resources/view/misectel-wifi/index.js"
BC="$R/www/luci-static/resources/misectel/base.css"
[ -f "$WV" ] || die "wifi view missing - image layout changed"
[ -f "$BC" ] || die "misectel base.css missing - image layout changed"
[ -f "$LU/wifi-tidy.css" ] || die "wifi-tidy.css missing from $LU"

python3 - "$WV" <<'PYEOF'
import sys
p=sys.argv[1]
s=open(p,encoding="utf-8").read()
# (find, replace, expected_count). A count mismatch means the vendor changed
# the file and the patch would silently do nothing -- fail the build instead.
subs=[
 ("_('Enable Wireless')", "_('Enable Wi-Fi')", 1),
 ("_('WiFi Enable')",     "_('Enable Wi-Fi')", 1),
 ("_('band width')",      "_('Bandwidth')",    2),
 ("_('Unified WiFi Settings')", "_('Unified Wi-Fi Settings')", 1),
 ("_('Select WiFi Country or Region Regulatory Domain')",
  "_('Regulatory domain - sets the legal channels and power limits')", 2),
 # Card titles/subtitles that leaked radio0 / radio1 at the customer.
 ("_('%s Setting').format(radio.bandLabel)", "_('%s Radio').format(radio.bandLabel)", 1),
 ("_('%s Separate Configuration').format(radio.name)",
  "_('Independent SSID, password and encryption for this band.')", 1),
 ("_('%s Use a unified SSID, password, and encryption method.').format(radio.name)",
  "_('Uses the shared SSID, password and encryption above.')", 1),
]
for find,repl,n in subs:
    got=s.count(find)
    if got!=n:
        sys.exit("expected %d of %r, found %d" % (n,find[:60],got))
    s=s.replace(find,repl)
open(p,"w",encoding="utf-8",newline=chr(10)).write(s)
print("  %d label fixes applied" % len(subs))
PYEOF

for bad in "Enable Wireless" "WiFi Enable" "band width" "%s Separate Configuration"; do
	grep -qF "$bad" "$WV" && die "wifi label '$bad' survived"
done

# Appended rather than injected from the view: base.css is already loaded on
# every misectel page and the rules are scoped to .misectel-page--wifi, so no
# JS surgery is needed for a layout-only change.
if ! grep -q 'Chester: Wi-Fi page layout' "$BC"; then
	cat "$LU/wifi-tidy.css" >> "$BC"
fi
grep -q 'misectel-page--wifi .misectel-field__help' "$BC" || die "wifi css did not land in base.css"
echo "  labels normalised, hints left-aligned, rows and band cards squared up"

# Theme/branding, Wi-Fi decoration and the cellular IPv6 page, per
# K43P-BIN-BUILDER-HANDOFF-2026-08-23. These were developed live on the bench
# unit; without this step they exist only in that router's overlay and the next
# build silently drops them.
#
# The Wi-Fi work DECORATES the stock page (wifi-polish-plain.js, loaded from
# footer.ut) rather than replacing its backend, so the functional view stays as
# the step above leaves it.
step "Chester UI payload (theme, Wi-Fi polish, cellular IPv6)"
UI="$HERE/chester-ui"
[ -d "$UI" ] || die "chester-ui payload missing from $HERE (wsl-rebrand.sh must copy it)"

# Checksums from section 4 of the handoff. These two carry the branding, so a
# silent substitution is worth failing the build over.
#
# Re-pinned 2026-08-26: header.ut gained the top-right account menu and the
# LettucePi login mark, and cascade.css the styles for those plus the band
# and network-mode panels. The guard caught both, which is the point of it --
# update these hashes only alongside a deliberate edit to those files.
verify_sha() {
	got=$(sha256sum "$1" | awk '{print toupper($1)}')
	[ "$got" = "$2" ] || die "$(basename "$1") sha256 mismatch: got $got want $2"
}
verify_sha "$UI/usr/share/ucode/luci/template/themes/misectel/header.ut" \
	0646027C947FC13FEE9306229A57F60D7FE1F79C948FE3A348D4AA68FF90099E
verify_sha "$UI/www/luci-static/misectel/cascade.css" \
	9A1E311AAF61A74838B0F10E4B3A6401CBEE4E216710C060A8A3C72D5243CC39

n=0
while IFS= read -r f; do
	rel="${f#$UI}"
	install -d "$R$(dirname "$rel")"
	install -m 0644 "$f" "$R$rel"
	n=$((n+1))
done <<< "$(find "$UI" -type f)"
# rpcd backends are exec'd by rpcd; a 0644 file here is a page that silently
# returns nothing.
chmod 0755 "$R/usr/libexec/rpcd/chester_ipv6"
[ -x "$R/usr/libexec/rpcd/chester_ipv6" ] || die "chester_ipv6 is not executable"
echo "  $n files installed"

# The IPv6 route must point at a view that exists, or the menu entry 404s.
VP=$(sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
	"$R/usr/share/luci/menu.d/luci-app-chester-ipv6.json" | head -1)
[ -f "$R/www/luci-static/resources/view/$VP.js" ] || die "IPv6 menu points at missing view: $VP"
echo "  IPv6 route -> view/$VP.js, backend + acl in place"

# footer.ut is what pulls the Wi-Fi decoration in; if the reference is missing
# the page renders unstyled and nothing else complains.
FU="$R/usr/share/ucode/luci/template/themes/misectel/footer.ut"
grep -q 'wifi-polish-plain\.js' "$FU" || die "footer.ut does not load wifi-polish-plain.js"
[ -f "$R/www/luci-static/resources/wifi-polish-plain.js" ] || die "wifi-polish-plain.js missing"

# MAC address, uptime and temperature were listed BOTH as stat cards and again
# in the System Information panel below them.
OV="$R/www/luci-static/resources/view/misectel-dashboard/overview.js"
python3 - "$OV" <<'PYEOF'
import sys
p=sys.argv[1]
s=open(p,encoding="utf-8").read()
dupes=("{label:_('MAC Address'),value:primaryMac},"
       "{label:_('Uptime'),value:formatDuration(systemInfo.uptime)},"
       "{label:_('Temperature'),value:extractTempText(data.tempInfo)||'--'}")
if dupes in s:
    open(p,"w",encoding="utf-8",newline=chr(10)).write(s.replace(dupes,"",1))
    print("  overview: dropped the duplicated MAC/uptime/temperature fields")
elif "{label:_('MAC Address'),value:primaryMac}" in s:
    sys.exit("overview.js duplicate-field block changed shape - re-check by hand")
else:
    print("  overview: duplicated fields already absent")
PYEOF

# The theme files were captured from a running unit, so they are already past
# the URL rename in step 2 -- but that guard ran long before this step, so
# re-check rather than assume.
left=$(grep -rhoE "(admin/(network/|system/|vpn/)?misectel[a-z0-9_-]*|admin-misectel[a-z0-9_-]*)" \
	"$R/usr/share/ucode" "$R/www/luci-static/misectel" "$R/www/luci-static/resources" 2>/dev/null | sort -u || true)
[ -z "$left" ] || die "payload reintroduced misectel URLs: $(echo $left)"
echo "  no stale misectel URLs reintroduced"

# Speedtest 1.1.2 preinstalled: the acceptance tests expect its menu present on
# a first boot, which a feed-only package would not give.
SPD=$(ls "$APKSRC"/luci-app-lettucepi-speedtest-*.apk 2>/dev/null | sort -V | tail -1)
if [ -n "$SPD" ] && [ -x "$APKBIN" ]; then
	if "$APKBIN" --root "$R" add --no-network --no-scripts "$SPD" >/dev/null 2>&1; then
		V=$("$APKBIN" --root "$R" info 2>/dev/null | grep '^luci-app-lettucepi-speedtest' || true)
		echo "  preinstalled $(basename "$SPD")"
	else
		die "could not preinstall $(basename "$SPD")"
	fi
else
	echo "  NOTE: no speedtest apk in $APKSRC - not preinstalled"
fi

# The fourth Ethernet jack.
#
# kernel.bin carries a device tree patched to declare switch ports 0-3 as
# lan1..lan4, matching the AlwayLink M01K43 tree (a working OpenWrt build for
# this hardware) and the stock vendor tree. The stock ImmortalWrt tree omitted
# port@0 entirely, so one physical jack was never instantiated - no netdev, and
# nothing configurable could bring it back - and it labelled the remaining
# three in reverse (port@3 was called "lan1").
#
# Two userspace pieces have to follow the tree or the new port stays unused:
# ------------------------------------------- 11b. NO fourth LAN port
# There used to be a step here that declared a fourth LAN port. This board
# does not have one. It has three 1G sockets (lan1-lan3) plus the 2.5G
# socket, which is `wan` -- and that socket is made into a LAN port by
# optional_wan_mode, not by inventing an interface.
#
# The step patched board.d to
#     ucidef_set_interfaces_lan_wan "lan1 lan2 lan3 lan4" "wan"
# unconditionally, so first boot wrote lan4 into /etc/config/network on
# every unit. There is no lan4 netdev, so the kernel simply left it out of
# the bridge: uci listed a port that could never carry a packet, and the
# dashboard showed a socket that does not exist.
#
# Its uci-defaults companion was guarded with
#     [ -e /sys/class/net/lan4 ] || exit 0
# and therefore correctly did nothing -- which is exactly why the fault
# was easy to miss: the guarded half behaved, the unguarded half did not.

# What a customer sees on SSH and in Status -> Overview.
#
# The image is built from ImmortalWrt, a downstream fork of OpenWrt, so every
# identity string says "ImmortalWrt". This presents the product as OpenWrt 25
# instead. The upstream revision is kept verbatim so the build stays traceable.
step "Identity -> OpenWrt 25"
REL="$R/etc/openwrt_release"
[ -f "$REL" ] || die "/etc/openwrt_release missing - image layout changed"
REV=$(sed -n "s/^DISTRIB_REVISION='\(.*\)'$/\1/p" "$REL")
VER=$(sed -n "s/^DISTRIB_RELEASE='\(.*\)'$/\1/p" "$REL")
[ -n "$REV" ] && [ -n "$VER" ] || die "could not read release/revision from $REL"

sed -i -e "s/^DISTRIB_ID='.*'$/DISTRIB_ID='OpenWrt'/" \
       -e "s/^DISTRIB_DESCRIPTION='.*'$/DISTRIB_DESCRIPTION='OpenWrt $VER $REV'/" "$REL"

for OSR in "$R/usr/lib/os-release" "$R/etc/os-release"; do
	[ -f "$OSR" ] || continue
	sed -i -e 's|^NAME=.*|NAME="OpenWrt"|' \
	       -e 's|^ID=.*|ID="openwrt"|' \
	       -e 's|^ID_LIKE=.*|ID_LIKE="lede openwrt"|' \
	       -e "s|^PRETTY_NAME=.*|PRETTY_NAME=\"OpenWrt $VER\"|" \
	       -e "s|^OPENWRT_RELEASE=.*|OPENWRT_RELEASE=\"OpenWrt $VER $REV\"|" \
	       -e 's|^HOME_URL=.*|HOME_URL="https://openwrt.org/"|' \
	       -e 's|^BUG_URL=.*|BUG_URL="https://github.com/ElReyDeHotspot/LettucePi-K43P/issues"|' \
	       -e 's|^SUPPORT_URL=.*|SUPPORT_URL="https://github.com/ElReyDeHotspot/LettucePi-K43P"|' \
	       -e 's|^FIRMWARE_URL=.*|FIRMWARE_URL="https://github.com/ElReyDeHotspot/LettucePi-K43P"|' \
	       -e "s|^OPENWRT_DEVICE_MANUFACTURER=.*|OPENWRT_DEVICE_MANUFACTURER=\"$SHORT\"|" \
	       -e 's|^OPENWRT_DEVICE_MANUFACTURER_URL=.*|OPENWRT_DEVICE_MANUFACTURER_URL="https://openwrt.org/"|' \
	       -e "s|^OPENWRT_DEVICE_PRODUCT=.*|OPENWRT_DEVICE_PRODUCT=\"$BRAND\"|" "$OSR"
done

# device_info feeds the LuCI overview and some scripts.
DI="$R/etc/device_info"
if [ -f "$DI" ]; then
	sed -i -e "s|^DEVICE_MANUFACTURER=.*|DEVICE_MANUFACTURER='$SHORT'|" \
	       -e "s|^DEVICE_MANUFACTURER_URL=.*|DEVICE_MANUFACTURER_URL='https://openwrt.org/'|" \
	       -e "s|^DEVICE_PRODUCT=.*|DEVICE_PRODUCT='$BRAND'|" "$DI"
fi

# The self-signed HTTPS certificate is issued to "ImmortalWrt".
U="$R/etc/config/uhttpd"
[ -f "$U" ] && sed -i "s/ImmortalWrt/OpenWrt/g" "$U"

cat > "$R/etc/banner" <<BANNER
   ____ _               _
  / ___| |__   ___  ___| |_ ___ _ __
 | |   | '_ \\ / _ \\/ __| __/ _ \\ '__|
 | |___| | | |  __/\\__ \\ ||  __/ |
  \\____|_| |_|\\___||___/\\__\\___|_|

 ------------------------------------------------------
 $BRAND  -  OpenWrt $VER, $REV
 ------------------------------------------------------
BANNER

grep -q "OpenWrt $VER" "$R/etc/banner" || die "banner not written"
grep -q "^DISTRIB_ID='OpenWrt'$" "$REL" || die "DISTRIB_ID not set to OpenWrt"
grep -qi immortal "$R/etc/banner" "$REL" "$R/usr/lib/os-release" && die "ImmortalWrt still present in an identity file"
# The identity says OpenWrt, but the packages come from ImmortalWrt, and that
# is correct rather than a contradiction: the identity is branding, the feed
# has to match the tree this rootfs was actually built from. Pointing the feed
# at openwrt.org to agree with the banner is what broke package installs.
grep -q 'downloads\.immortalwrt\.org' "$R/etc/apk/repositories.d/distfeeds.list" \
	|| die "package feeds are not on downloads.immortalwrt.org"
grep -q 'downloads\.openwrt\.org' "$R/etc/apk/repositories.d/distfeeds.list" \
	&& die "an openwrt feed is listed - it cannot serve this tree"
[ -s "$R/etc/apk/repositories.d/chester.list" ] \
	|| die "the chesterAPK feed is missing"
echo "  banner, openwrt_release, os-release, device_info -> OpenWrt $VER ($REV)"
echo "  package feeds on downloads.immortalwrt.org, plus chesterAPK"

# ------------------------------------------- 11. our own LuCI packages
# Baked in LAST, on purpose. These packages carry files that earlier steps in
# this script also patch (overview.js, dashboard.css, cascade.css). Their
# contents were harvested from a working bench box that was itself built by
# this script, so they are a superset of what those steps produce -- letting
# them land last means the image matches the box that was actually tested,
# rather than a merge of two sources that was never run anywhere.
#
# apk extract only unpacks; it does not run post-install. Anything those
# scripts would have done is handled by the uci-defaults entry below.
step "LettucePi LuCI packages"

install_feed_apk() {    # install_feed_apk <package-name>
	pkg="$1"

	# Prefer a local build: when packaging and imaging in the same sitting,
	# the newest package exists here before it is ever published.
	src=""
	if [ -d "$APKSRC" ]; then
		src=$(ls "$APKSRC"/$pkg-*.apk 2>/dev/null | sort -V | tail -1)
	fi

	if [ -z "$src" ]; then
		ver=$("$APKBIN" adbdump "$WORK/feed.adb" 2>/dev/null \
			| awk -v p="$pkg" '/name:/{n=$NF} /version:/{if(n==p) v=$NF} END{print v}')
		[ -n "$ver" ] || { echo "  SKIP $pkg (not local, not published)"; return 1; }
		curl -fsSL --max-time 120 "$FEED/$pkg-$ver.apk" -o "$WORK/$pkg.apk" \
			|| { echo "  SKIP $pkg (download failed)"; return 1; }
		src="$WORK/$pkg.apk"
	fi

	# apk add --root, not extract + cp.
	#
	# extract only unpacks the archive: it resolves no dependencies and writes
	# no database entry. That bit us twice. phytool is a dependency of the
	# dashboard package, so it never reached the image, and chester-phy-led
	# opens with `command -v phytool || exit 0` -- the WAN LED watchdog started,
	# found nothing, and exited 0 on every flashed box without logging a word.
	# And with no database entry `apk list --installed` never showed these
	# packages, so `apk upgrade` would never have updated them in the field.
	#
	#   --no-scripts : the host is x86_64 and this rootfs is aarch64, so apk
	#                  cannot chroot in to run post-install. Everything those
	#                  scripts would do is handled by the uci-defaults entry
	#                  written below, which runs on the target at first boot.
	#   --arch       : without it apk assumes the host architecture and finds
	#                  no candidate.
	"$APKBIN" add --root "$R" --no-scripts --arch aarch64_cortex-a53 \
		--allow-untrusted "$src" 2>&1 | sed 's/^/    /' \
		|| { echo "  SKIP $pkg (install failed)"; return 1; }

	echo "  $(basename "$src")"
	return 0
}

# The feed index, for whichever packages are not built locally.
curl -fsSL --max-time 40 "$FEED/packages.adb?cb=$(date +%s)" -o "$WORK/feed.adb" 2>/dev/null || true

install_feed_apk luci-app-lettucepi-dashboard || true
install_feed_apk luci-app-lettucepi-zapret    || true

# Smart Queue attaches tbf and fq_codel, and the image ships tc-tiny, which
# does not carry them. tc-full conflicts with tc-tiny, so apk will not resolve
# the two -- the vendor package has to come out before ours goes in, which is
# also why our package does not simply declare tc-full as a dependency.
#
# How we know the image ships the tiny one: on a bench box /sbin/tc carried the
# apk archive's own mtime rather than the squashfs build date, which is what a
# hand-installed package looks like next to an image-time one.
TCAPK=$(ls "$APKSRC"/tc-full-*.apk 2>/dev/null | sort -V | tail -1)
[ -n "$TCAPK" ] || die "tc-full apk not in $APKSRC - Smart Queue would ship without its qdiscs"
"$APKBIN" del --root "$R" --no-scripts tc-tiny >/dev/null 2>&1 || true
"$APKBIN" add --root "$R" --no-scripts --arch aarch64_cortex-a53 \
	--allow-untrusted "$TCAPK" 2>&1 | sed 's/^/    /' || die "tc-full failed to install"
# tc-full delivers /usr/libexec/tc-full plus an apk "alternatives" entry that
# would create the tc command: 400:/sbin/tc:/usr/libexec/tc-full. Alternatives
# are wired up by a script, and this install is --no-scripts because the build
# host is x86_64 and cannot chroot into an aarch64 rootfs -- so the link never
# appears and tc is simply absent, with the package showing as installed.
#
# It is written into usr/sbin because /sbin is itself a symlink to usr/sbin in
# this rootfs, and given a RELATIVE target: an absolute one would resolve
# against the build host while the image is still being assembled.
[ -f "$R/usr/libexec/tc-full" ] || die "tc-full did not deliver /usr/libexec/tc-full"
install -d "$R/usr/sbin"
ln -sf ../libexec/tc-full "$R/usr/sbin/tc"
[ -L "$R/usr/sbin/tc" ] || die "the tc alternatives link was not created"
echo "  $(basename "$TCAPK") + /usr/sbin/tc alternatives link"

install_feed_apk luci-app-lettucepi-sqm       || true

# Services these packages own. Enabling by hand here would mean writing
# /etc/rc.d symlinks into the rootfs, and a plain file there (rather than a
# symlink) makes procd register the service under its rc.d name, so a later
# restart runs two daemons. Letting the target enable them on first boot
# avoids that class of mistake entirely.
#
# The 4K/HD engine is deliberately NOT started: it ships staged so the
# operator turns it on from the Overview.
cat > "$R/etc/uci-defaults/98-lettucepi-services" <<'UCID'
#!/bin/sh
# The WAN socket LED watchdog is deliberately NOT started any more.
#
# It poked the RTL8221B's LED registers over MDIO because ImmortalWrt's managed
# PHY path left the socket dark. The device tree now declares that port as a
# fixed-link, so nothing binds the PHY and it falls back to its own power-on LED
# behaviour -- which lights correctly. The watchdog can no longer reach the PHY
# at all and would just log "gave up: no RTL8221B on wan after 60s" every boot.
if [ -x /etc/init.d/chester-phy-led ]; then
	/etc/init.d/chester-phy-led disable 2>/dev/null
	/etc/init.d/chester-phy-led stop 2>/dev/null
fi
# Terminal (ttyd). It is installed into the rootfs with --no-scripts, because
# the build host is x86_64 and this rootfs is aarch64, so apk cannot chroot in
# to run the package's own post-install. Nothing else enables it -- the files
# and /etc/config/ttyd land correctly and the service simply never starts, so
# the Terminal page loads and shows a sad face where the websocket should be.
if [ -x /etc/init.d/ttyd ]; then
	/etc/init.d/ttyd enable
	/etc/init.d/ttyd start
fi
# Smart Queue. Installed with --no-scripts, so its own post-install never ran:
# the config has to be laid down here and the service enabled. It ships with
# enabled='0' inside that config, so enabling the init script starts no shaping
# until the operator sets their real line rates on the Smart Queue page -- a
# shaper running at a guessed rate is a silent throttle.
#
# The test is -s rather than -e: a config that exists but is empty reads as
# "present with empty values", which is how a LAN once lost DHCP.
if [ -x /etc/init.d/chester-sqm ]; then
	[ -s /etc/config/chester_sqm ] || \
		cp /usr/share/chester-sqm/chester_sqm.default /etc/config/chester_sqm
	/etc/init.d/chester-sqm enable
fi
# Prime the modem temperature cache so the Overview shows a number on first
# paint rather than a dash.
[ -x /usr/sbin/chester-modem-temp ] && /usr/sbin/chester-modem-temp refresh >/dev/null 2>&1 &
exit 0
UCID
chmod 0755 "$R/etc/uci-defaults/98-lettucepi-services"
echo "  /etc/uci-defaults/98-lettucepi-services (phy-led + ttyd enable, temp cache)"

# --no-scripts means nothing in the image enables the services these packages
# ship. Fail the build if the first-boot script does not cover each one, rather
# than shipping a Terminal page that loads and cannot connect.
for svc in ttyd chester-sqm; do
	grep -q "/etc/init.d/$svc enable" "$R/etc/uci-defaults/98-lettucepi-services" \
		|| die "$svc is installed but nothing enables it at first boot"
done

# ------------------------------------------------------------------ repack
step "Repacking squashfs"
mksquashfs "$R" "$WORK/rootfs.squashfs" \
	-comp xz -Xdict-size 256K -b 262144 -noappend -nopad -no-xattrs \
	-processors "$(nproc)" 2>&1 | tail -3
OLD=$(stat -c%s "$HERE/rootfs.raw"); NEW=$(stat -c%s "$WORK/rootfs.squashfs")
printf '  %s -> %s bytes (%+d)\n' "$OLD" "$NEW" "$((NEW-OLD))"

step "Building UBI"
cat > "$WORK/ubinize.cfg" <<CFG
[kernel]
mode=ubi
image=$HERE/kernel.bin
vol_id=0
vol_type=dynamic
vol_name=kernel
vol_alignment=1

[rootfs]
mode=ubi
image=$WORK/rootfs.squashfs
vol_id=1
vol_type=dynamic
vol_name=rootfs
vol_alignment=1

[rootfs_data]
mode=ubi
vol_id=2
vol_type=dynamic
vol_name=rootfs_data
vol_alignment=1
vol_size=1MiB
vol_flags=autoresize
CFG
BIN="$OUT/immortalwrt-$VERSION-ChesterK43P-ubi.bin"
ubinize -o "$BIN" -p "$PEB" -m "$MINIO" "$WORK/ubinize.cfg"

SZ=$(stat -c%s "$BIN")
[ "$(head -c4 "$BIN")" = "UBI#" ] || die "output is not UBI"
[ "$SZ" -le "$SLOT_MAX" ] || die "$SZ bytes is over the $SLOT_MAX slot"
[ "$(dd if="$BIN" bs=1 skip=$PEB count=4 2>/dev/null)" = "UBI#" ] || die "PEB size is not $PEB"

step "Done"
printf '  %s\n  %s bytes (%.1f MiB), %.0f%% of the slot\n  sha256 %s\n\n' \
	"$BIN" "$SZ" "$(echo "$SZ/1048576"|bc -l)" "$(echo "100*$SZ/$SLOT_MAX"|bc -l)" \
	"$(sha256sum "$BIN" | awk '{print $1}')"
