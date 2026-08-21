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
    printf '       curl -fsSL @RAW_URL@ | sh -s -- --install\n'
    printf '       curl -fsSL @RAW_URL@ | sh -s -- --uninstall\n\n'
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
