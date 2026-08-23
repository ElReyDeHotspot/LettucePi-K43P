#!/bin/bash
# Publish the image that rebrand.sh just built.
#
#   ./publish.sh ["release notes"]
#
# Firmware is served straight out of the git repo (raw.githubusercontent), NOT
# from a GitHub release. Release assets need the API, which means a token or the
# gh CLI and a manual upload step; committing the image needs only `git push`,
# so the whole publish is one command. The cost is ~22 MB of git history per
# build, which is accepted -- ChesterK43P-Bin is a deliberate archive anyway.
#
# Steps, in the order that matters:
#   1. copy the new image into ChesterK43P-Bin with the next sequence number
#   2. refresh that folder's README (table + checksums, computed from the files)
#   3. write openwrt25/latest.json pointing at the new file
#   4. commit and push
#
# The image is pushed in the SAME commit as the manifest, so the manifest can
# never advertise a file that is not there yet.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${REPO:-/c/Users/CTR/claude/k43p-wrapper}"
[ -d "$REPO/.git" ] || REPO="C:/Users/CTR/claude/k43p-wrapper"
ARCH="$REPO/ChesterK43P-Bin"
OUT="$HERE/out"
RAW="https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/ChesterK43P-Bin"
NOTES="${1:-}"

step(){ printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die(){ printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

BIN="$OUT/immortalwrt-25.12-ChesterK43P-ubi.bin"
[ -f "$BIN" ] || die "no image at $BIN - run wsl-rebrand.sh first"
[ -f "$OUT/.build-id" ] || die "no $OUT/.build-id - the build did not stamp one"
[ "$(head -c4 "$BIN")" = "UBI#" ] || die "$BIN is not a UBI image"
[ -d "$ARCH" ] || die "archive dir not found: $ARCH"

BID=$(cat "$OUT/.build-id")
SHA=$(sha256sum "$BIN" | awk '{print $1}')
SZ=$(stat -c%s "$BIN")
DATE=$(date +%Y-%m-%d)
# Build id is YYYYMMDDHHMMSS in UTC; render it the way the manifest wants.
BUILT="${BID:0:4}-${BID:4:2}-${BID:6:2}T${BID:8:2}:${BID:10:2}Z"

step "Checking this build is not already published"
if grep -q "\"build\": \"$BID\"" "$REPO/openwrt25/latest.json" 2>/dev/null; then
	die "build $BID is already the published manifest - rebuild before publishing"
fi

step "Archiving as the next sequence number"
LAST=$(ls "$ARCH" | sed -n 's/^\([0-9][0-9]\)-.*\.bin$/\1/p' | sort -n | tail -1)
SEQ=$(printf '%02d' $((10#${LAST:-0} + 1)))
NAME="$SEQ-$DATE-ChesterK43P-25.12.bin"
[ -e "$ARCH/$NAME" ] && die "$NAME already exists - refusing to overwrite a published file"
cp "$BIN" "$ARCH/$NAME"
echo "  $NAME ($SZ bytes)"

step "Refreshing the archive README"
python3 - "$ARCH" "$NAME" "$SEQ" "$DATE" "$NOTES" <<'PYEOF'
import os,re,sys,hashlib
NL=chr(10)
arch,name,seq,date,notes=sys.argv[1:6]
p=os.path.join(arch,"README.md")
s=open(p,encoding="utf-8").read()
mib="%.1f MB"%(os.path.getsize(os.path.join(arch,name))/1048576)
desc=notes or "Built by rebrand.sh."
# Demote whatever currently claims to be current, then add this build.
s=s.replace(" | ✅ **Current.** "," | Superseded. ")
row="| %s | %s | `%s-...-ChesterK43P-25.12` | %s | ✅ **Current.** %s |"%(seq,date,seq,mib,desc)
lines=s.split(NL)
last=max(i for i,l in enumerate(lines) if re.match(r"^\| \d\d \| ",l))
lines.insert(last+1,row)
s=NL.join(lines)
def sha(f):
    h=hashlib.sha256()
    with open(f,"rb") as fh:
        for b in iter(lambda: fh.read(1<<20), b""): h.update(b)
    return h.hexdigest()
files=sorted(f for f in os.listdir(arch) if f.endswith(".bin"))
block=NL.join("%s  %s"%(sha(os.path.join(arch,f)),f) for f in files)
s=re.sub(r"```"+NL+r"[0-9a-f]{64}  .*?"+NL+r"```","```"+NL+block+NL+"```",s,count=1,flags=re.S)
open(p,"w",encoding="utf-8",newline=NL).write(s)
print("  table row added, %d checksums recomputed"%len(files))
PYEOF

step "Writing the manifest"
python3 - "$REPO/openwrt25/latest.json" "$BID" "$BUILT" "$SHA" "$SZ" "$RAW/$NAME" "$NOTES" <<'PYEOF'
import json,sys
p,bid,built,sha,sz,url,notes=sys.argv[1:8]
d={"version":"25.12","built":built,"build":bid,"sha256":sha,"size":sz,"url":url,
   "notes":notes or "Routine build."}
open(p,"w",encoding="utf-8",newline=chr(10)).write(json.dumps(d,indent=2)+chr(10))
print("  build %s -> %s"%(bid,url))
PYEOF

step "Committing and pushing"
cd "$REPO"
git add -A
if git diff --cached --quiet; then
	echo "  nothing to commit"
else
	git commit -q -m "Publish build $BID${NOTES:+ - $NOTES}" \
	           -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
	echo "  $(git rev-parse --short HEAD)"
fi
git push -q origin main
echo "  pushed"

step "Verifying what customers will actually fetch"
# Poll: raw.githubusercontent needs a moment to see a new commit.
i=0
while [ "$i" -lt 30 ]; do
	got=$(curl -fsSL --max-time 60 "$RAW/$NAME?cb=$(date +%s)" 2>/dev/null | sha256sum | awk '{print $1}')
	[ "$got" = "$SHA" ] && break
	sleep 5; i=$((i+1))
done
[ "$got" = "$SHA" ] || die "the published image does not match: got $got, expected $SHA"
echo "  image sha256 matches ($SZ bytes)"
mb=$(curl -fsSL --max-time 30 "https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/openwrt25/latest.json?cb=$(date +%s)")
echo "$mb" | grep -q "\"build\": \"$BID\"" || die "the published manifest still advertises an older build"
echo "  manifest advertises $BID"

printf '\n\033[1m==> Published\033[0m\n  routers will now see build %s\n\n' "$BID"
