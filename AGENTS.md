# Firmware staging

For the next BIN, use `python3 scripts/prepare-rootfs.py <extracted-root>` before
packing SquashFS. This copies `payload/` and removes retired PPTP/L2TP clients.
Do not pack by copying the payload alone. Keep the captured vendor kernel,
modules, device tree, per-device calibration and existing release signing flow.
Only build or publish firmware when the user requests it.
