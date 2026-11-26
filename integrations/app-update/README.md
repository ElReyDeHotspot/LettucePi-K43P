# Small App Updates

Routine System Update releases install independently signed changed files instead of reflashing firmware. Customer settings, kernel, modules and calibration are excluded. Firmware BIN and App Revision are shown separately.

The installer verifies Ed25519 signatures, exact board/kernel/ROM base, archive and individual file hashes, writable flash space and local file conflicts. Releases are cumulative against a ROM base and must retain all paths changed by previous app releases. Symlinks, traversal, configuration paths, kernel profiles and updates to the bootstrap trust mechanism are rejected. Release directories are immutable.

Files are staged and backed up on writable flash before installation. A durable journal rolls back interrupted transactions at early boot. A committed update restarts the router and the existing update window confirms its new build. Factory reset returns to the baked-in firmware and removes overlay app updates.

The bootstrap binary, public key and early recovery service ship in future full firmware. Existing devices need that bootstrap once through an authenticated deployment. The private signing key stays outside this repository. Use `scripts/make-app-update.py` against an extracted ROM and a reviewed prepared payload; `--include` restricts a release to exact reviewed files.

`chester-update firmware-status` and `firmware-install` retain the explicit full-firmware path for base changes. The normal update path never silently falls back to a full flash when an app package fails or is incompatible. UI app releases do not increase the full-firmware BIN number.

Each ROM build has its own signed channel under `apps/bases/<ROM build>/latest.json`. Publish a signed revision-zero baseline using `scripts/sign-app-baseline.py` with every full firmware release. Revision zero has no downloadable payload and cannot be installed. Existing BIN63 bootstrap clients also use the original top-level app channel.

K43P full images share one native executable between the scanner, SIM policy, traffic monitor, M-Lab and app updater. Applet names and detached worker identities are preserved. The two vendor modem FIT profiles are reconstructed from the existing kernel volume and compact patch data, then checked against their original hashes before the unchanged profile writer can use them. `scripts/build-firmware.sh` enforces a 32 MiB image limit. The build preserves radio firmware, kernel modules and calibration.

Overview Update uses a lightweight local status helper and the verified app channel. Checks are cached for 15 minutes (one minute after failure), independently of page loading. The cache is invalidated by an installed build change; app revisions are compared within the same firmware base. App Update 1 includes this fix for the current K43P BIN64 and K45P Rev.20 bases.

The bootstrap now consumes one signed metadata envelope and pins each install request, preventing mixed manifest/signature CDN versions or a concurrent check from changing an accepted update. The connected router received this bootstrap through authenticated SSH; future full builds bake it in. Older clients retain the separate signed files for compatibility.
