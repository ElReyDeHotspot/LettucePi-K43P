# Small App Updates

Routine System Update releases install independently signed changed files instead of reflashing firmware. Customer settings, kernel, modules and calibration are excluded. Firmware BIN and App Revision are shown separately.

The installer verifies Ed25519 signatures, exact board/kernel/ROM base, archive and individual file hashes, writable flash space and local file conflicts. Releases are cumulative against a ROM base and must retain all paths changed by previous app releases. Symlinks, traversal, configuration paths, kernel profiles and updates to the bootstrap trust mechanism are rejected. Release directories are immutable.

Files are staged and backed up on writable flash before installation. A durable journal rolls back interrupted transactions at early boot. A committed update restarts the router and the existing update window confirms its new build. Factory reset returns to the baked-in firmware and removes overlay app updates.

The bootstrap binary, public key and early recovery service ship in future full firmware. Existing devices need that bootstrap once through an authenticated deployment. The private signing key stays outside this repository. Use `scripts/make-app-update.py` against an extracted ROM and a reviewed prepared payload; `--include` restricts a release to exact reviewed files.

`chester-update firmware-status` and `firmware-install` retain the explicit full-firmware path for base changes. The normal update path never silently falls back to a full flash when an app package fails or is incompatible. UI app releases do not increase the full-firmware BIN number.
