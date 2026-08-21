# Lettuce Pi MAIN EVENT — firmware validator for M10K43P

Lets a stock **M10K43P** router accept Lettuce Pi firmware from its own web UI
(**Settings → Version**), instead of rejecting it.

## Where this fits

This is **step 1 of 2**, and it is the only part that is public:

1. **This installer** — makes the router trust Lettuce Pi software. Carries no
   token and no private key, so it is safe to publish and safe for anyone to
   run.
2. **The Lettuce Pi package (`.ipk`)** — sent to the customer directly. It
   carries their update token, so the router can pull future updates on its
   own.

## For customers

SSH into the router as `root`, then paste **one line**:

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh
```

You get a menu:

```
   Router : M01K43P
   Status : not installed - this router is on stock firmware validation

   1) Install    - let this router accept Lettuce Pi firmware
   2) Uninstall  - restore stock firmware validation
   3) Cancel     - change nothing

   Choose 1, 2 or 3:
```

Pick **1**, then upload the Lettuce Pi `.bin` in the web UI as normal. To undo
it later, run the same line again and pick **2**.

Pick **1**, then upload the Lettuce Pi `.bin` in the web UI as normal. To undo
it later, run the same line again and pick **2**.

The menu works even through `curl | sh`, because the answer is read from
`/dev/tty` rather than stdin — stdin is the script itself.

### One-shot, without the menu

```sh
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh -s -- --install
curl -fsSL https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/main/install.sh | sh -s -- --uninstall
```

### If the router has no internet yet

Pipe the script in from your PC instead. A pipe has no terminal, so the choice
has to be explicit:

```sh
ssh root@192.168.100.1 'sh -s -- --install' < install.sh
```

Run with no choice over a pipe and it prints instructions and exits without
touching anything.

## What it actually changes

Two files, and nothing else:

| path | what |
|---|---|
| `/sbin/wtcheck` | replaced with the Lettuce Pi wrapper |
| `/etc/lettucepi/main-event-update.pub` | the Lettuce Pi public key |

**Genuine vendor firmware is unaffected.** The wrapper looks at the first 7
bytes of any image: anything that is not a Lettuce Pi image is handed straight
to the untouched factory validator at `/rom/sbin/wtcheck`, which still does its
full RSA check. Vendor updates keep working exactly as before.

`/sbin/wtcheck` lives in a read-only squashfs with an overlay on top, so the
factory binary is never actually destroyed — uninstall copies it back from
`/rom` and verifies the result is byte-identical.

## Safety

The installer refuses to do anything it cannot verify first:

- refuses if the board is not `M01K43P`
- refuses if `/rom/sbin/wtcheck` is missing (nothing to delegate to)
- refuses if `usign` or `sha256sum` are missing
- verifies an **embedded signed test vector** with `usign` first, proving the
  key works on that box before the wrapper is given the job of gating firmware
- runs the wrapper from `/tmp` and confirms it **rejects** a random file and
  **rejects** an unsigned Lettuce Pi image — before installing it
- installs by atomic rename, then re-checks the live binary and **automatically
  restores the factory validator** if that check fails

Uninstall verifies the restored binary with `cmp` against `/rom`.

Only the **public** key is ever shipped. The signing secret stays offline.

## For maintainers

`install.sh` is **generated** — do not hand-edit it.

```sh
wsl -d Ubuntu -u root -- bash /mnt/c/Users/CTR/claude/k43p-wrapper/make-installer.sh
```

It embeds, from `../k43p-factory`:

- `payload/sbin/wtcheck` — the wrapper (same file the factory image ships)
- `keys/lp-update.pub` — the public key
- a freshly signed test vector, minted with `keys/lp-update.sec`

so the installer and the factory image can never drift apart. Regenerate and
commit `install.sh` whenever the wrapper or the key changes.

Set the URL baked into the help text with:

```sh
REPO_RAW_URL=https://raw.githubusercontent.com/OWNER/REPO/main/install.sh ./make-installer.sh
```

⚠️ This repo is **public on purpose**, so the router can fetch `install.sh`
anonymously over HTTPS. Keep it that way — a private repo returns 404 to an
unauthenticated router, not a login prompt.

⚠️ **Never commit an update token or the signing secret here.** The token
belongs in the `.ipk` that is sent to the customer directly; the secret key
never leaves the build machine. This repo ships the *public* key only.

⚠️ On the router, `wget` is a symlink to `uclient-fetch` and has **no SSL**.
Only `curl` can fetch over HTTPS there. Do not "simplify" any one-liner to
`wget`.

⚠️ `scp` does not work against these routers — dropbear has no sftp-server.
Stream over ssh: `ssh root@host 'cat > /tmp/f' < localfile`.

## Verified

Exercised against real M01K43P hardware (OpenWrt 21.02-SNAPSHOT r2.6.0), with
every write redirected into `/tmp`:

| case | result |
|---|---|
| board / tool / `/rom` preflight | all pass, correct board reported |
| embedded key vector | verified by the router's own `usign` |
| random file offered to the wrapper | rejected (delegated to factory validator) |
| unsigned Lettuce Pi image | rejected |
| install | wrapper + key installed, live re-check passes |
| menu option 1 / 2 / 3 | install / uninstall / cancel all behave |
| uninstall | restored binary byte-identical to `/rom` (`cd37bdcf…`) |
| status detection | flips correctly both ways |
| piped with no terminal | clean guidance + exit 1, nothing changed |
| unknown flag | usage + exit 2, nothing changed |
