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
#  SSH into the router as root and paste one line:
#
#      curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh
#
#  You get a menu: 1) Install  2) Uninstall  3) Cancel
#  Non-interactive:  ... | sh -s -- --install   (or --uninstall)
#
#  This installer carries NO account token and NO private key. It only makes
#  the router trust Lettuce Pi software; the Lettuce Pi package itself is
#  supplied separately.
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
cat > "$TMP/pub" <<'__LP_EOF__'
untrusted comment: public key bd8f21e8e1aed84a
RWS9jyHo4a7YSoK2mJfPQfne0NUMePKdC7Rb5Shi3Cwy+kMBYmyR7Eo7
__LP_EOF__
chmod 0644 "$TMP/pub"
    cat > "$TMP/tv" <<'__LP_EOF__'
lettucepi-key-selftest
__LP_EOF__
    cat > "$TMP/tv.sig" <<'__LP_EOF__'
untrusted comment: verify with lp-update.pub
RWS9jyHo4a7YStElHtjqoXqEDZx6Z3l4X7fy+Zqeh2ksXtXhC2HWQB3AkbQC/KlyQ7VBjh7+iAVdjvmDROwtYTZutNOIqaU5uwE=
__LP_EOF__
cat > "$TMP/wtcheck" <<'__LP_EOF__'
#!/bin/sh
# Lettuce Pi MAIN EVENT wtcheck compatibility validator for M01K43P.
# Vendor images are always delegated to the immutable factory validator.
# Lettuce Pi images use a 64 KiB tar header followed by a raw UBI payload.
set -u

ROM_WTCHECK=/rom/sbin/wtcheck
PUBKEY=/etc/lettucepi/main-event-update.pub
HEADER_SIZE=65536
EXPECTED_BOARD=M01K43P

board=
image=
bootloader_size=
rsa_only=0

usage() {
    echo "Usage: $0 -b <board_name> [-o <bootloader_size>] [-r] -f <image>" >&2
    exit 2
}

while getopts 'b:o:f:r' opt; do
    case "$opt" in
        b) board=$OPTARG ;;
        o) bootloader_size=$OPTARG ;;
        f) image=$OPTARG ;;
        r) rsa_only=1 ;;
        *) usage ;;
    esac
done

[ -n "$board" ] || usage
[ -n "$image" ] || usage
[ -f "$image" ] || { echo "wt: open $image file error" >&2; exit 1; }

# The first tar member name occupies the first bytes of a POSIX tar header.
magic=$(dd if="$image" bs=7 count=1 2>/dev/null || true)
if [ "$magic" != LPMAIN1 ]; then
    [ -x "$ROM_WTCHECK" ] || { echo "wt: immutable factory validator missing" >&2; exit 1; }
    set -- -b "$board"
    [ -n "$bootloader_size" ] && set -- "$@" -o "$bootloader_size"
    [ "$rsa_only" -eq 1 ] && set -- "$@" -r
    set -- "$@" -f "$image"
    exec "$ROM_WTCHECK" "$@"
fi

[ "$board" = "$EXPECTED_BOARD" ] || { echo "wt: board name failed($board/$EXPECTED_BOARD)" >&2; exit 1; }
[ -f "$PUBKEY" ] || { echo "wt: Lettuce Pi public key missing" >&2; exit 1; }
command -v usign >/dev/null 2>&1 || { echo "wt: usign missing" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "wt: sha256sum missing" >&2; exit 1; }

tmp=/tmp/lp-wtcheck.$$
trap 'rm -rf "$tmp"' EXIT INT TERM
mkdir -p "$tmp" || exit 1

dd if="$image" of="$tmp/header.tar" bs=$HEADER_SIZE count=1 2>/dev/null || exit 1
tar -xf "$tmp/header.tar" -C "$tmp" LPMAIN1 manifest manifest.sig 2>/dev/null || {
    echo "wt: Lettuce Pi header format error" >&2
    exit 1
}

usign -V -q -p "$PUBKEY" -m "$tmp/manifest" -x "$tmp/manifest.sig" || {
    echo "wt: Lettuce Pi signature verification failed" >&2
    exit 1
}

format=$(sed -n 's/^format=//p' "$tmp/manifest")
manifest_board=$(sed -n 's/^board=//p' "$tmp/manifest")
payload_size=$(sed -n 's/^payload_size=//p' "$tmp/manifest")
payload_sha256=$(sed -n 's/^payload_sha256=//p' "$tmp/manifest")

[ "$format" = 1 ] || { echo "wt: unsupported Lettuce Pi format" >&2; exit 1; }
[ "$manifest_board" = "$EXPECTED_BOARD" ] || { echo "wt: manifest board mismatch" >&2; exit 1; }
case "$payload_size" in ''|*[!0-9]*) echo "wt: invalid payload size" >&2; exit 1;; esac
case "$payload_sha256" in
    [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]*) ;;
    *) echo "wt: invalid payload digest" >&2; exit 1 ;;
esac
[ ${#payload_sha256} -eq 64 ] || { echo "wt: invalid payload digest length" >&2; exit 1; }

actual_total=$(wc -c < "$image" | tr -d ' ')
actual_payload=$((actual_total - HEADER_SIZE))
[ "$actual_payload" -eq "$payload_size" ] || {
    echo "wt: payload size mismatch($actual_payload/$payload_size)" >&2
    exit 1
}
[ "$actual_payload" -gt 1048576 ] && [ "$actual_payload" -le 58720256 ] || {
    echo "wt: payload is outside M01K43P slot limits" >&2
    exit 1
}

dd if="$image" of="$tmp/payload.ubi" bs=$HEADER_SIZE skip=1 2>/dev/null || exit 1
[ "$(dd if="$tmp/payload.ubi" bs=4 count=1 2>/dev/null)" = 'UBI#' ] || {
    echo "wt: payload is not raw UBI" >&2
    exit 1
}
actual_sha256=$(sha256sum "$tmp/payload.ubi" | awk '{print $1}')
[ "$actual_sha256" = "$payload_sha256" ] || {
    echo "wt: payload SHA-256 mismatch" >&2
    exit 1
}

echo "wt: Lettuce Pi firmware verify ok"
exit 0
__LP_EOF__
chmod 0755 "$TMP/wtcheck"
}

# ---------------------------------------------------------------- install
do_install() {
    printf '\n  Installing...\n\n'

    board=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
    [ "$board" = "$EXPECTED_BOARD" ] || die "wrong board: this is '$board', expected '$EXPECTED_BOARD'"
    ok "board is $board"

    [ -f "$ROM_WTCHECK" ] || die "$ROM_WTCHECK not found - this firmware is not supported"
    ok "factory validator present at $ROM_WTCHECK"

    for t in usign sha256sum dd tar; do
        command -v "$t" >/dev/null 2>&1 || die "required tool missing: $t"
    done
    ok "required tools present (usign, sha256sum, dd, tar)"

    emit_payloads
    mkdir -p "$KEYDIR" || die "cannot create $KEYDIR"

    # Prove usign + this key actually verify on THIS box before we hand it the
    # job of gating firmware.
    usign -V -q -p "$TMP/pub" -m "$TMP/tv" -x "$TMP/tv.sig" \
        || die "usign could not verify the bundled test vector - refusing to install"
    ok "signing key verified by usign on this box"

    # Exercise the wrapper from $TMP BEFORE it becomes the system validator.
    head -c 4096 /dev/urandom > "$TMP/notours.bin" 2>/dev/null || die "cannot write $TMP"
    if "$TMP/wtcheck" -b "$EXPECTED_BOARD" -r -f "$TMP/notours.bin" >/dev/null 2>&1; then
        die "wrapper accepted a random file - refusing to install"
    fi
    ok "non-Lettuce images are rejected/delegated correctly"

    # An LPMAIN1-magic image with a bogus signature must be refused by our path.
    cd "$TMP" || die "cannot enter $TMP"
    : > LPMAIN1
    printf 'format=1\nboard=%s\n' "$EXPECTED_BOARD" > manifest
    printf 'bogus\n' > manifest.sig
    # busybox tar has no --format=ustar; its default output is fine. What
    # matters is that LPMAIN1 is the FIRST member, so the image's first 7
    # bytes are the magic the wrapper keys on.
    tar -cf hdr.tar LPMAIN1 manifest manifest.sig 2>/dev/null || die "cannot build self-test image"
    cd / || die "cannot leave $TMP"
    cp "$TMP/hdr.tar" "$TMP/forged.bin"
    dd if=/dev/zero bs=1024 count=64 >> "$TMP/forged.bin" 2>/dev/null
    if "$TMP/wtcheck" -b "$EXPECTED_BOARD" -r -f "$TMP/forged.bin" >/dev/null 2>&1; then
        die "wrapper accepted an unsigned Lettuce image - refusing to install"
    fi
    ok "unsigned Lettuce images are rejected"

    cp "$TMP/pub" "$PUBKEY.new" && chmod 0644 "$PUBKEY.new" && mv "$PUBKEY.new" "$PUBKEY" \
        || die "could not install the public key"
    ok "public key installed at $PUBKEY"

    # Atomic swap: stage beside the target, then rename over it.
    cp "$TMP/wtcheck" "$WTCHECK.new" || die "could not stage the wrapper"
    chmod 0755 "$WTCHECK.new"
    mv "$WTCHECK.new" "$WTCHECK" || die "could not install the wrapper"
    sync
    ok "wrapper installed at $WTCHECK"

    if "$WTCHECK" -b "$EXPECTED_BOARD" -r -f "$TMP/notours.bin" >/dev/null 2>&1; then
        cp "$ROM_WTCHECK" "$WTCHECK"; chmod 0755 "$WTCHECK"; sync
        die "post-install check failed - the factory validator has been restored"
    fi
    ok "installed wrapper responds correctly"

    rm -rf "$TMP"
    cat <<'DONE'

  ------------------------------------------------------------------
   Done. Your router will now accept Lettuce Pi firmware:

       Settings -> Version -> upload the Lettuce Pi .bin

   Genuine vendor firmware still works, and is still checked by the
   untouched factory validator.

   To undo this, run the same command again and choose 2.
  ------------------------------------------------------------------

DONE
}

# -------------------------------------------------------------- uninstall
do_uninstall() {
    printf '\n  Uninstalling...\n\n'
    [ -f "$ROM_WTCHECK" ] || die "$ROM_WTCHECK missing - cannot restore"
    # NEVER 'rm' here: /sbin/wtcheck lives in the read-only squashfs with an
    # overlay on top, so rm would write a whiteout and the file would vanish
    # completely instead of reverting. Copy the factory binary back over it.
    cp "$ROM_WTCHECK" "$WTCHECK" || die "restore failed"
    chmod 0755 "$WTCHECK"; sync
    cmp -s "$WTCHECK" "$ROM_WTCHECK" || die "restore did not verify"
    ok "factory validator restored at $WTCHECK"
    info "the public key at $PUBKEY was left in place (harmless)"
    cat <<'DONE'

  ------------------------------------------------------------------
   Done. Your router is back to stock firmware validation.
  ------------------------------------------------------------------

DONE
}

# ------------------------------------------------------------------- main
[ "$(id -u)" = 0 ] || { printf '\n  This must be run as root.\n\n' >&2; exit 1; }

if head -c 400 "$WTCHECK" 2>/dev/null | grep -q "$MARKER"; then
    STATUS='INSTALLED - this router already accepts Lettuce Pi firmware'
else
    STATUS='not installed - this router is on stock firmware validation'
fi

case "${1:-}" in
    --install)   do_install;   exit 0 ;;
    --uninstall) do_uninstall; exit 0 ;;
    --cancel)    printf '\n  Cancelled. Nothing was changed.\n\n'; exit 0 ;;
    "")          ;;
    *)           printf '\n  Unknown option: %s\n  Use --install, --uninstall, or no option for the menu.\n\n' "$1" >&2; exit 2 ;;
esac

cat <<BANNER

  ==================================================================
   Lettuce Pi MAIN EVENT - firmware validator
  ==================================================================

   Router : $EXPECTED_BOARD
   Status : $STATUS

   1) Install    - let this router accept Lettuce Pi firmware
   2) Uninstall  - restore stock firmware validation
   3) Cancel     - change nothing

BANNER

# When this script is piped in (curl ... | sh), stdin IS the script, so the
# answer has to come from the terminal instead.
#
# Test it by actually OPENING it: '[ -r /dev/tty ]' reports readable even when
# there is no controlling terminal, and the open then fails with "No such
# device or address" -- leaking a raw shell error to the client.
if ( : < /dev/tty ) 2>/dev/null; then
    :
else
    printf '   No terminal available for the menu (input is not a terminal).\n'
    printf '   Re-run with the choice made explicitly:\n\n'
    printf '       curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh -s -- --install\n'
    printf '       curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh -s -- --uninstall\n\n'
    exit 1
fi

printf '   Choose 1, 2 or 3: '
read choice < /dev/tty || choice=3

case "$choice" in
    1) do_install ;;
    2) do_uninstall ;;
    3|"") printf '\n  Cancelled. Nothing was changed.\n\n' ;;
    *) printf '\n  "%s" is not one of the options. Nothing was changed.\n\n' "$choice"; exit 2 ;;
esac
