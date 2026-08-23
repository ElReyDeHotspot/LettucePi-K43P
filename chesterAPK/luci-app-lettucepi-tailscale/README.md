# luci-app-lettucepi-tailscale

Tailscale control panel for the Chester K43P, under **Apps > Tailscale**.

Tailscale itself is not shipped in the firmware (~25 MB against a ~25 MB
writable overlay). This page installs it from the package feed on demand and
then manages it:

| Action | What it does |
|---|---|
| Install | `apk add tailscale`, enable and start the service |
| Update | `apk add -u tailscale`, restart |
| Connect | `tailscale up`, returns the sign-in link |
| Connect + SSH | as above with `--ssh`, allowing SSH over the tailnet |
| Log out | drops the node identity, keeps Tailscale installed |
| Uninstall | logs out, stops, removes the package and the identity |
| Tailnet DNS | off by default, so the router keeps serving its own DNS |

## Two traps this package works around

**`pgrep -x` does not work here.** busybox anchors `-x` against the whole
command line, not the process name, so `pgrep -x tailscaled` never matches
`/usr/sbin/tailscaled --port 41641 --state ...` and reports a running daemon as
stopped. Detection matches the absolute binary path instead.

**A crashed daemon blocks every restart.** It leaves both its control socket
and the `tailscale0` TUN device behind; the next start dies with
`address already in use`, then `device or resource busy`, and neither `start`
nor `restart` prints anything at all. Both are cleared before starting.
