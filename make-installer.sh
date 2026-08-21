#!/bin/bash
# Generate the self-contained client installer from the canonical sources in
# ../k43p-factory. Single source of truth: the wrapper and pubkey that go into
# the factory image are the same ones the installer ships.
#
#   ./make-installer.sh                 # writes install.sh
#   REPO_RAW_URL=... ./make-installer.sh
#
# Needs signify-openbsd (or usign) to mint the embedded key self-test vector,
# so run it under WSL, not Git Bash.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FACTORY="${FACTORY:-$HERE/../k43p-factory}"
WRAPPER="$FACTORY/payload/sbin/wtcheck"
PUBKEY="$FACTORY/keys/lp-update.pub"
SECKEY="$FACTORY/keys/lp-update.sec"
OUT="$HERE/install.sh"
REPO_RAW_URL="${REPO_RAW_URL:-https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh}"

for f in "$WRAPPER" "$PUBKEY" "$SECKEY"; do
    [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 1; }
done
SIGNER=""
command -v usign >/dev/null && SIGNER=usign
[ -n "$SIGNER" ] || { command -v signify-openbsd >/dev/null && SIGNER=signify-openbsd; }
[ -n "$SIGNER" ] || { echo "ERROR: need usign or signify-openbsd" >&2; exit 1; }

# A tiny signed vector, embedded so the installer can prove on the client's box
# that usign + our public key actually verify -- without shipping a 21 MB image.
TV=$(mktemp -d)
trap 'rm -rf "$TV"' EXIT
printf 'lettucepi-key-selftest\n' > "$TV/tv"
case "$SIGNER" in
  usign) usign -S -s "$SECKEY" -m "$TV/tv" -x "$TV/tv.sig" ;;
  *)     "$SIGNER" -S -s "$SECKEY" -m "$TV/tv" -x "$TV/tv.sig" ;;
esac

emit_file() {   # emit_file <target-expr> <local-file> <mode>
    printf "cat > %s <<'__LP_EOF__'\n" "$1"
    cat "$2"
    printf "__LP_EOF__\n"
    printf "chmod %s %s\n" "$3" "$1"
}

{
cat "$HERE/parts/part-a.sh"
emit_file '"$TMP/pub"' "$PUBKEY" 0644
cat "$HERE/parts/part-b.sh"
printf "    cat > \"\$TMP/tv.sig\" <<'__LP_EOF__'\n"
cat "$TV/tv.sig"
printf "__LP_EOF__\n"
emit_file '"$TMP/wtcheck"' "$WRAPPER" 0755
cat "$HERE/parts/part-c.sh"
} > "$OUT"

sed -i "s|@RAW_URL@|$REPO_RAW_URL|g" "$OUT"
chmod +x "$OUT"
sh -n "$OUT" && echo "install.sh syntax OK"
printf 'generated %s (%s bytes)\n' "$OUT" "$(stat -c%s "$OUT")"
