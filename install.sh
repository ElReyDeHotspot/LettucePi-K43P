#!/bin/sh
# ============================================================================
#  Lettuce Pi MAIN EVENT - firmware validator wrapper
#  Router: M10K43P (board id M01K43P)
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
DISPLAY_NAME=M10K43P          # product name; EXPECTED_BOARD is the board id the hardware reports
WTCHECK=/sbin/wtcheck
ROM_WTCHECK=/rom/sbin/wtcheck
KEYDIR=/etc/lettucepi
PUBKEY=$KEYDIR/main-event-update.pub
WEBDIR=/www/lettucepi
CGI=/www/cgi-bin/lettucepi-ipk
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
cat > "$TMP/index.html" <<'__LP_EOF__'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lettuce Pi</title>
<style>
/* Everything inline: the router may have no WAN, so no external assets. */
:root{
  --bg:#0f1511; --card:#18211b; --line:#2a3a2e; --ink:#e8f0e9;
  --dim:#9bb0a1; --accent:#6ec46a; --accent-ink:#0f1511;
  --bad:#e2685f; --good:#6ec46a; --step:#22302a;
}
@media (prefers-color-scheme:light){
  :root{ --bg:#f2f5f2; --card:#fff; --line:#d9e2db; --ink:#16211a;
         --dim:#5c6f62; --accent:#2f8f43; --accent-ink:#fff; --step:#eef3ef; }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{width:100%;max-width:540px;background:var(--card);border:1px solid var(--line);
  border-radius:14px;padding:28px}
h1{margin:0 0 4px;font-size:22px;letter-spacing:.2px}
.sub{color:var(--dim);font-size:14px;margin-bottom:18px}
.meta{color:var(--dim);font-size:13px;margin-bottom:20px}
.steps{display:flex;gap:8px;margin-bottom:20px}
.steps div{flex:1;text-align:center;font-size:12px;padding:7px 4px;border-radius:8px;
  background:var(--step);color:var(--dim)}
.steps div.on{background:var(--accent);color:var(--accent-ink);font-weight:600}
.steps div.done{color:var(--accent)}
/* display:block is load-bearing. A <label> is inline by default, so the
   padding and border do not lay out, the dashed box renders as fragments and
   the label overlaps the Verify button underneath it -- clicking Verify then
   opens the file dialog instead of verifying. */
.drop{display:block;border:2px dashed var(--line);border-radius:12px;
  padding:26px 18px;text-align:center;
  cursor:pointer;transition:border-color .15s,background .15s}
.drop:hover,.drop.over{border-color:var(--accent);background:rgba(110,196,106,.07)}
.drop input{display:none}
.fname{margin-top:12px;font-size:14px;word-break:break-all}
button{width:100%;margin-top:14px;padding:13px 18px;border:0;border-radius:10px;
  background:var(--accent);color:var(--accent-ink);font-size:16px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--dim);border:1px solid var(--line);font-weight:500}
button:disabled{opacity:.45;cursor:not-allowed}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td{padding:7px 0;border-bottom:1px solid var(--line);vertical-align:top}
td:first-child{color:var(--dim);width:38%}
td.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.22);
  border:1px solid var(--line);border-radius:10px;padding:14px;font-size:13px;
  margin-top:16px;max-height:240px;overflow:auto}
.ok{color:var(--good);font-weight:600}
.bad{color:var(--bad);font-weight:600}
.hide{display:none}
</style>
</head>
<body>
<div class="card">
  <h1>Lettuce Pi</h1>
  <div class="sub">Install the package you were sent.</div>
  <div class="meta" id="meta">Checking router&hellip;</div>

  <div class="steps">
    <div id="s1" class="on">1 &middot; Browse</div>
    <div id="s2">2 &middot; Verify</div>
    <div id="s3">3 &middot; Install</div>
  </div>

  <div id="pane1">
    <label class="drop" id="drop">
      <input type="file" id="file" accept=".ipk">
      <div><strong>Choose the .ipk file</strong></div>
      <div style="color:var(--dim);font-size:13px;margin-top:6px">or drag it here</div>
      <div class="fname" id="fname"></div>
    </label>
    <button id="verify" disabled>Verify package</button>
  </div>

  <div id="pane2" class="hide">
    <table id="details"></table>
    <button id="install">Install this package</button>
    <button id="back" class="ghost">Choose a different file</button>
  </div>

  <pre id="out" class="hide"></pre>
</div>

<script>
var CGI = "/cgi-bin/lettucepi-ipk";
var file = null;
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s).replace(/[&<>]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]; }); }

function step(n){
  [1,2,3].forEach(function(i){
    var el = $("s" + i);
    el.className = i === n ? "on" : (i < n ? "done" : "");
  });
}
function say(msg, cls){
  var o = $("out");
  o.className = "";
  o.innerHTML = (cls ? '<span class="' + cls + '">' +
      (cls === "ok" ? "Success" : "Problem") + '</span>\n\n' : "") + esc(msg);
}
function hideOut(){ $("out").className = "hide"; }

// Parse the plain-text reply: first line OK/FAIL, rest key=value or free text.
function parse(t){
  var lines = t.replace(/\r/g, "").split("\n");
  var status = (lines.shift() || "").trim();
  var kv = {}, rest = [];
  lines.forEach(function(l){
    var i = l.indexOf("=");
    if (i > 0 && /^[a-z0-9_]+$/.test(l.slice(0, i))) kv[l.slice(0, i)] = l.slice(i + 1);
    else if (l.trim() !== "") rest.push(l);
  });
  return { status: status, kv: kv, text: rest.join("\n") };
}

fetch(CGI).then(function(r){ return r.text(); }).then(function(t){
  var p = parse(t);
  if (p.status !== "OK") { $("meta").textContent = "Router did not respond correctly."; return; }
  $("meta").textContent = "Router " + (p.kv.model || p.kv.board || "?") +
      (p.kv.installed && p.kv.installed !== "none"
        ? " — Lettuce Pi " + p.kv.installed + " installed"
        : " — nothing installed yet");
}).catch(function(){ $("meta").textContent = "Could not reach the router."; });

function pick(f){
  if (!f) return;
  file = f;
  $("fname").textContent = f.name + "  (" + Math.round(f.size / 1024) + " KB)";
  $("verify").disabled = false;
  hideOut();
}
$("file").addEventListener("change", function(e){ pick(e.target.files[0]); });

var drop = $("drop");
["dragenter","dragover"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("over"); }); });
["dragleave","drop"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("over"); }); });
drop.addEventListener("drop", function(e){ pick(e.dataTransfer.files[0]); });

$("verify").addEventListener("click", function(){
  if (!file) return;
  $("verify").disabled = true;
  $("verify").textContent = "Checking…";
  say("Uploading " + file.name + "…");

  // Raw bytes, not multipart: the router parses CONTENT_LENGTH bytes of stdin.
  fetch(CGI + "?action=verify", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file
  }).then(function(r){ return r.text(); }).then(function(t){
    var p = parse(t);
    $("verify").textContent = "Verify package";
    if (p.status !== "OK") {
      $("verify").disabled = false;
      say(p.text || "That package was rejected.", "bad");
      return;
    }
    var rows = [
      ["Package", p.kv.package],
      ["Version", p.kv.version],
      ["Built for", p.kv.arch],
      ["Size", Math.round((p.kv.size || 0) / 1024) + " KB"]
    ];
    if (p.kv.description) rows.push(["Description", p.kv.description]);
    var html = "";
    rows.forEach(function(r){
      if (r[1]) html += "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>";
    });
    if (p.kv.sha256) html += '<tr><td>SHA-256</td><td class="mono">' + esc(p.kv.sha256) + "</td></tr>";
    $("details").innerHTML = html;
    $("pane1").className = "hide";
    $("pane2").className = "";
    hideOut();
    step(3);
  }).catch(function(err){
    $("verify").textContent = "Verify package";
    $("verify").disabled = false;
    say(String(err), "bad");
  });
});

$("back").addEventListener("click", function(){
  $("pane2").className = "hide";
  $("pane1").className = "";
  $("verify").disabled = false;
  hideOut();
  step(1);
});

$("install").addEventListener("click", function(){
  $("install").disabled = true;
  $("back").disabled = true;
  $("install").textContent = "Installing…";
  say("Installing on the router…");

  // No re-upload: this installs exactly the bytes that were verified.
  fetch(CGI + "?action=install", { method: "POST" })
    .then(function(r){ return r.text(); }).then(function(t){
      var p = parse(t);
      say(p.text || p.status, p.status === "OK" ? "ok" : "bad");
      if (p.status === "OK") {
        $("install").textContent = "Installed";
        setTimeout(function(){ location.reload(); }, 3000);
      } else {
        $("install").textContent = "Install this package";
        $("install").disabled = false;
        $("back").disabled = false;
      }
    }).catch(function(err){
      say(String(err), "bad");
      $("install").textContent = "Install this package";
      $("install").disabled = false;
      $("back").disabled = false;
    });
});

step(1);
</script>
</body>
</html>
__LP_EOF__
chmod 0644 "$TMP/index.html"
cat > "$TMP/lettucepi-ipk" <<'__LP_EOF__'
#!/bin/sh
# Lettuce Pi MAIN EVENT package receiver.
#
# Three steps, so nothing is installed until the customer has seen what it is:
#   GET                  -> router status
#   POST ?action=verify  -> receive + inspect the package, stage it, report
#   POST ?action=install -> install the package staged by the verify step
#
# The browser sends the raw file bytes as the POST body. There is deliberately
# no multipart form: parsing multipart in ash on the router would be far more
# fragile than reading CONTENT_LENGTH bytes of stdin.
#
# Responses are plain text, never JSON: first line is OK or FAIL, the rest is
# detail. Escaping opkg output into JSON in ash is a bug farm and buys nothing.

MAX_BYTES=16777216          # 16 MiB
STAGED=/tmp/lp-staged.ipk
WORK=/tmp/lp-verify
LOG=/tmp/lettucepi-ipk.log

reply() {   # reply <http-status> <line>...
    printf 'Status: %s\r\n' "$1"
    printf 'Content-Type: text/plain; charset=utf-8\r\n'
    printf 'Cache-Control: no-store\r\n\r\n'
    shift
    printf '%s\n' "$@"
}

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG" 2>/dev/null; }

# ---------------------------------------------------------------- guards
# LAN only. uhttpd listens on 0.0.0.0 and this endpoint installs packages as
# root, so refuse anything that did not come from a private address.
case "${REMOTE_ADDR:-}" in
    10.*|192.168.*|127.*|::1) ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;;
    *) reply "403 Forbidden" "FAIL" "This page is only available from the local network."; exit 0 ;;
esac

action=""
case "${QUERY_STRING:-}" in
    *action=verify*)  action=verify ;;
    *action=install*) action=install ;;
esac

# ---------------------------------------------------------------- status
if [ "${REQUEST_METHOD:-GET}" = "GET" ]; then
    board=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
    # The hardware reports the board id M01K43P; the product is sold as
    # M10K43P. Show the customer the name on the box, keep the board id for
    # support. Do not "fix" the id: wtcheck compares against it.
    case "$board" in
        M01K43P) model=M10K43P ;;
        *)       model="$board" ;;
    esac
    arch=$(opkg print-architecture 2>/dev/null | awk '$1=="arch" && $2!="all" && $2!="noarch" {print $2; exit}')
    ver=$(opkg list-installed 2>/dev/null | sed -n 's/^lettucepi - //p' | head -1)
    reply "200 OK" "OK" "model=$model" "board=$board" "arch=${arch:-unknown}" "installed=${ver:-none}"
    exit 0
fi

[ "$REQUEST_METHOD" = "POST" ] || { reply "405 Method Not Allowed" "FAIL" "Use POST."; exit 0; }

# ---------------------------------------------------------------- install
# Installs only what a previous verify staged, so the bytes being installed are
# exactly the bytes that were inspected.
if [ "$action" = install ]; then
    [ -s "$STAGED" ] || { reply "409 Conflict" "FAIL" "Nothing staged. Verify a package first."; exit 0; }
    log "install $(wc -c < "$STAGED" | tr -d ' ') bytes from $REMOTE_ADDR"
    out=$(opkg install --force-reinstall --force-downgrade "$STAGED" 2>&1)
    rc=$?
    printf '%s\n' "$out" >> "$LOG" 2>/dev/null
    rm -f "$STAGED"; rm -rf "$WORK"
    if [ "$rc" -eq 0 ]; then
        reply "200 OK" "OK" "$out"
    else
        reply "200 OK" "FAIL" "$out"
    fi
    exit 0
fi

[ "$action" = verify ] || { reply "400 Bad Request" "FAIL" "Unknown action."; exit 0; }

# ---------------------------------------------------------------- verify
len="${CONTENT_LENGTH:-}"
case "$len" in
    ''|*[!0-9]*) reply "411 Length Required" "FAIL" "Missing or invalid Content-Length."; exit 0 ;;
esac
[ "$len" -gt 0 ] || { reply "400 Bad Request" "FAIL" "That file is empty."; exit 0; }
[ "$len" -le "$MAX_BYTES" ] || { reply "413 Payload Too Large" "FAIL" "That file is larger than 16 MB."; exit 0; }

rm -f "$STAGED"; rm -rf "$WORK"
head -c "$len" > "$STAGED" 2>/dev/null
got=$(wc -c < "$STAGED" 2>/dev/null | tr -d ' ')
[ "$got" = "$len" ] || { rm -f "$STAGED"; reply "400 Bad Request" "FAIL" "Upload was cut short ($got of $len bytes)."; exit 0; }

# An .ipk is a gzip stream (tar.gz holding control.tar.gz + data.tar.gz).
# Ask gzip rather than trusting the file name or a hexdump that may not exist.
if ! gzip -t "$STAGED" 2>/dev/null; then
    rm -f "$STAGED"
    reply "415 Unsupported Media Type" "FAIL" "That is not a .ipk package (it is not a valid archive)."
    exit 0
fi

mkdir -p "$WORK" || { rm -f "$STAGED"; reply "500 Internal Server Error" "FAIL" "Cannot use /tmp."; exit 0; }
if ! tar -xzf "$STAGED" -C "$WORK" 2>/dev/null; then
    rm -f "$STAGED"; rm -rf "$WORK"
    reply "415 Unsupported Media Type" "FAIL" "That is not a .ipk package (cannot read it)."
    exit 0
fi

ctl=""
for c in "$WORK/control.tar.gz" "$WORK/./control.tar.gz"; do
    [ -f "$c" ] && { ctl="$c"; break; }
done
[ -n "$ctl" ] || { rm -f "$STAGED"; rm -rf "$WORK"
    reply "415 Unsupported Media Type" "FAIL" "That is not a .ipk package (no control section)."; exit 0; }

tar -xzf "$ctl" -C "$WORK" 2>/dev/null
cfile=""
for c in "$WORK/control" "$WORK/./control"; do
    [ -f "$c" ] && { cfile="$c"; break; }
done
[ -n "$cfile" ] || { rm -f "$STAGED"; rm -rf "$WORK"
    reply "415 Unsupported Media Type" "FAIL" "That is not a .ipk package (control file missing)."; exit 0; }

pkg=$(sed -n 's/^Package: *//p'      "$cfile" | head -1)
pver=$(sed -n 's/^Version: *//p'     "$cfile" | head -1)
parch=$(sed -n 's/^Architecture: *//p' "$cfile" | head -1)
pdesc=$(sed -n 's/^Description: *//p'  "$cfile" | head -1)

[ -n "$pkg" ] || { rm -f "$STAGED"; rm -rf "$WORK"
    reply "415 Unsupported Media Type" "FAIL" "That package has no name and cannot be installed."; exit 0; }

# Architecture sanity: a mismatch here otherwise surfaces as a confusing opkg
# error after the customer has already committed to installing.
boxarch=$(opkg print-architecture 2>/dev/null | awk '$1=="arch" {print $2}')
archok=no
for a in $boxarch; do
    [ "$parch" = "$a" ] && archok=yes
done
[ "$parch" = "all" ] && archok=yes

if [ "$archok" != yes ]; then
    rm -f "$STAGED"; rm -rf "$WORK"
    reply "200 OK" "FAIL" "This package is built for '$parch', which this router cannot run." \
        "Supported here: $(echo $boxarch | tr '\n' ' ')"
    exit 0
fi

sha=$(sha256sum "$STAGED" 2>/dev/null | awk '{print $1}')
log "verify ok $pkg $pver ($parch, $len bytes) from $REMOTE_ADDR"

reply "200 OK" "OK" \
    "package=$pkg" \
    "version=$pver" \
    "arch=$parch" \
    "size=$len" \
    "sha256=$sha" \
    "description=$pdesc"
__LP_EOF__
chmod 0755 "$TMP/lettucepi-ipk"
}

# ---------------------------------------------------------------- install
do_install() {
    printf '\n  Installing...\n\n'

    board=$(cat /tmp/sysinfo/board_name 2>/dev/null || echo unknown)
    [ "$board" = "$EXPECTED_BOARD" ] || die "this router reports board '$board'; this installer is for the $DISPLAY_NAME ($EXPECTED_BOARD)"
    ok "router is $DISPLAY_NAME (board id $board)"

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

    # ---------------------------------------------------------- setup page
    mkdir -p "$WEBDIR" || die "cannot create $WEBDIR"
    cp "$TMP/index.html" "$WEBDIR/index.html.new" && chmod 0644 "$WEBDIR/index.html.new" \
        && mv "$WEBDIR/index.html.new" "$WEBDIR/index.html" || die "could not install the setup page"
    cp "$TMP/lettucepi-ipk" "$CGI.new" && chmod 0755 "$CGI.new" && mv "$CGI.new" "$CGI" \
        || die "could not install the upload handler"
    sync

    # The handler must actually answer, or the page is a dead end.
    if ! REQUEST_METHOD=GET REMOTE_ADDR=127.0.0.1 QUERY_STRING= "$CGI" 2>/dev/null | grep -q '^OK'; then
        die "the upload handler did not respond correctly"
    fi
    ok "setup page installed at http://$(uci -q get network.lan.ipaddr || echo 192.168.100.1)/lettucepi"

    rm -rf "$TMP"
    LANIP=$(uci -q get network.lan.ipaddr || echo 192.168.100.1)
    cat <<DONE

  ------------------------------------------------------------------
   Done.

   Open this page in your browser to install the Lettuce Pi
   package you were sent:

       http://$LANIP/lettucepi

   Browse to the .ipk, verify it, then install.

   This router will also accept Lettuce Pi firmware now
   (Settings -> Version). Genuine vendor firmware still works and is
   still checked by the untouched factory validator.

   To undo all of this, run the same command again and choose 2.
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

    # These live only in the overlay -- nothing of this name exists in the
    # factory squashfs -- so removing them leaves no whiteout behind.
    rm -f "$CGI" "$WEBDIR/index.html"
    rmdir "$WEBDIR" 2>/dev/null
    rm -f /tmp/lp-staged.ipk; rm -rf /tmp/lp-verify
    sync
    ok "setup page removed"
    info "the public key at $PUBKEY was left in place (harmless)"
    cat <<'DONE'

  ------------------------------------------------------------------
   Done. Your router is back to stock firmware validation.
  ------------------------------------------------------------------

DONE
}

# ------------------------------------------------------------------- main
# Everything executable lives in this function, and it is called on the very
# last line. That matters for `curl ... | sh`: the shell reads its script from
# the pipe as it goes, so if it exits early the rest of the download has
# nowhere to land and curl dies with "(23) Failed writing body" in the
# customer's face. Wrapping it forces the shell to read the whole script
# before it runs any of it.
lp_main() {
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

   Router : $DISPLAY_NAME
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
}

lp_main "$@"
