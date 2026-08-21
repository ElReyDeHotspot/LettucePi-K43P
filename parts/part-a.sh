#!/bin/sh
# ============================================================================
#  Lettuce Pi MAIN EVENT - firmware validator wrapper
#  Board: M01K43P
#
#  Installs a wrapper at /sbin/wtcheck so the stock web UI
#  (Settings -> Version) accepts Lettuce Pi firmware images.
#
#  Genuine vendor images are NOT affected: they are handed straight to the
#  untouched factory validator at /rom/sbin/wtcheck.
#
#  Run it:
#      curl -fsSL @RAW_URL@ | sh
#
#  You get a menu: 1) Install  2) Uninstall  3) Cancel
#  Non-interactive:  ... | sh -s -- --install   (or --uninstall)
# ============================================================================
set -u

EXPECTED_BOARD=M01K43P
WTCHECK=/sbin/wtcheck
ROM_WTCHECK=/rom/sbin/wtcheck
KEYDIR=/etc/lettucepi
PUBKEY=$KEYDIR/main-event-update.pub
MARKER='Lettuce Pi MAIN EVENT wtcheck'
TMP=/tmp/lp-install.$$

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; rm -rf "$TMP"; exit 1; }

# ---------------------------------------------------------------- payloads
# Written only when we actually act, and always into $TMP first.
emit_payloads() {
    mkdir -p "$TMP" || die "cannot create $TMP"
