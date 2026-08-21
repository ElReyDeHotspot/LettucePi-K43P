# chesterAPK — package feed for the Chester K43P

An `apk` package feed served straight from this repo. Routers running the
Chester OpenWrt 25 image have it configured already, so packages published here
can be installed with `apk add <name>`.

## For customers

Nothing to set up — the feed and its signing key ship in the firmware:

```sh
apk update
apk search chester
apk add <package>
```

## Contents

| | |
|---|---|
| `packages.adb` | the signed index — regenerate whenever packages change |
| `*.apk` | the packages themselves |
| `chester-apk.pem` | the **public** signing key (also baked into the firmware) |
| `make-index.sh` | rebuilds and signs the index |

The **private** key is not in this repo and must never be committed. It lives
with the other build secrets in `k43p-factory/keys/chester-apk.key`.

## Publishing a package

```sh
./make-index.sh /path/to/chester-apk.key
git add chesterAPK && git commit && git push
```

Drop new `.apk` files into this folder first. `make-index.sh` re-indexes
everything here and signs the result.

## Notes worth knowing

**apk here is v3.** OpenWrt 25 replaced `opkg` with `apk`, and v3 uses a
`packages.adb` index — not the v2 `APKINDEX.tar.gz`. Ubuntu's `apk-tools`
package is v2 and **cannot** produce this format; `make-index.sh` expects an
apk-tools 3 binary (build it from
<https://gitlab.alpinelinux.org/alpine/apk-tools>).

**Packages must be signed to be indexed.** `apk mkndx` refuses an unsigned
package with `UNTRUSTED signature`. Sign at build time
(`apk mkpkg --sign-key ...`) — `make-index.sh` passes `--allow-untrusted` to the
indexer so it can read packages signed by a key it does not have in its local
trust store, then signs the finished index itself.

**An empty index is not valid.** `apk mkndx` with no packages produces a 17-byte
file that cannot be signed (`ADB block error`). The feed needs at least one
package, which is what `chester-release` is for.

**Packages resolve next to the index.** `apk` fetches `<name>-<version>.apk`
from the same directory as `packages.adb`, so keep them together in this folder.

**Do not let git normalise these files.** `.gitattributes` marks this folder
`-text`; `packages.adb` and `.apk` files are binary and line-ending conversion
would corrupt them.
