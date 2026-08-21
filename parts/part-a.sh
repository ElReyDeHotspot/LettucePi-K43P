#!/bin/sh
# ============================================================================
#  LettucePi - firmware validator wrapper
#  Router: Chester K43P (M10K43P, board id M01K43P)
#
#  Installs a wrapper at /sbin/wtcheck so the stock web UI
#  (Settings -> Version) accepts LettucePi firmware images.
#
#  Genuine vendor images are NOT affected: they are handed straight to the
#  untouched factory validator at /rom/sbin/wtcheck.
#
#  SSH into the router as root and paste one line:
#
#      curl -fsSL @RAW_URL@ | sh
#
#  You get a menu: 1) Install  2) Uninstall  3) Cancel
#  Non-interactive:  ... | sh -s -- --install   (or --uninstall)
#
#  This installer carries NO account token and NO private key. It only makes
#  the router trust LettucePi software; the LettucePi package itself is
#  supplied separately.
# ============================================================================
set -u

EXPECTED_BOARD=M01K43P
DISPLAY_NAME="Chester K43P"   # what the customer sees; EXPECTED_BOARD is the id the hardware reports
WTCHECK=/sbin/wtcheck
ROM_WTCHECK=/rom/sbin/wtcheck
KEYDIR=/etc/lettucepi
PUBKEY=$KEYDIR/main-event-update.pub
MARKER='wtcheck compatibility validator'   # matches old and new wrapper headers
TMP=/tmp/lp-install.$$

ok(){   printf '  [ok]   %s\n' "$*"; }
info(){ printf '         %s\n' "$*"; }
die(){  printf '\n  [FAIL] %s\n\n' "$*" >&2; rm -rf "$TMP"; exit 1; }

# ---------------------------------------------------------------- payloads
# Written only when we actually act, and always into $TMP first.
emit_payloads() {
    mkdir -p "$TMP" || die "cannot create $TMP"
