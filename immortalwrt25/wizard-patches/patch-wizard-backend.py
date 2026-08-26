import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8', errors='surrogateescape').read()
fails = []
def need(c, m):
    if not c: fails.append(m)
    return c

FUNC = '''// Timezone and APN, neither of which the vendor wizard knows about.
//
// Both are optional on purpose: a page that does not send them must leave the
// router exactly as it was, so an older UI against a newer backend degrades to
// the previous behaviour instead of blanking settings.
//
// No redial here. The apply already reloads the network, which re-dials, and
// redialling from inside the wizard would drop the very connection its
// apply-and-redirect loop is polling over.
function applyChesterExtras(extras) {
\tif (type(extras) != 'object')
\t\treturn { result: true, skipped: true };

\t// zonename is the readable name the UI shows; the POSIX string is what
\t// busybox actually reads out of /etc/TZ, and the daylight-saving rules live
\t// inside THAT string. Storing only the name gives a router whose clock never
\t// changes for DST, so it is both or neither.
\tlet zonename = trimSafe(extras.zonename);
\tlet tzstring = trimSafe(extras.timezone);

\tif (zonename && tzstring) {
\t\tlet tzResult = runCommand(
\t\t\t`uci -q set system.@system[0].zonename=${quoteArg(zonename)} && ` +
\t\t\t`uci -q set system.@system[0].timezone=${quoteArg(tzstring)} && ` +
\t\t\t`uci -q commit system`
\t\t);

\t\tif (!tzResult.result) {
\t\t\treturn {
\t\t\t\tresult: false,
\t\t\t\tcode: tzResult.code,
\t\t\t\tmessage: 'failed to set the timezone'
\t\t\t};
\t\t}
\t}

\t// An empty APN means leave the modem picking one automatically, which is
\t// what ships and what works for most carriers. That is a deliberate choice
\t// in the dropdown, not a missing value, so it must not be written as "".
\tlet apn = trimSafe(extras.apn);

\tif (!apn)
\t\treturn { result: true };

\tlet sections = findModemSections();

\tif (!length(sections))
\t\treturn { result: true, skipped: true };

\tfor (let name in sections) {
\t\tlet apnResult = runCommand(
\t\t\t`uci -q set qmodem.${name}.apn=${quoteArg(apn)} && ` +
\t\t\t`uci -q set qmodem.${name}.auth=${quoteArg(trimSafe(extras.auth) || 'none')} && ` +
\t\t\t`uci -q set qmodem.${name}.username=${quoteArg(trimSafe(extras.username))} && ` +
\t\t\t`uci -q set qmodem.${name}.password=${quoteArg(trimSafe(extras.password))}`
\t\t);

\t\tif (!apnResult.result) {
\t\t\treturn {
\t\t\t\tresult: false,
\t\t\t\tcode: apnResult.code,
\t\t\t\tmessage: 'failed to set the APN'
\t\t\t};
\t\t}
\t}

\tlet commitResult = runCommand(`uci -q commit qmodem`);

\treturn {
\t\tresult: commitResult.result,
\t\tcode: commitResult.code,
\t\tmessage: commitResult.result ? null : 'failed to save the APN'
\t};
}

'''

a = "function applySetupWizardConfig(configJson) {"
if need(a in s, "applySetupWizardConfig not found"):
    s = s.replace(a, FUNC + a, 1)

a = "\tlet admin = parsed.admin || {};"
if need(a in s, "admin parse line not found"):
    s = s.replace(a, a + "\n\tlet chester = parsed.chester || {};", 1)

a = "\tlet wizardResult = persistWizardState(true, skippedNetwork, skippedWifi, skippedAdmin);"
b = ("\t// After the vendor sections, so a failure here cannot leave the wizard\n"
     "\t// marked complete with half its own settings applied.\n"
     "\tlet chesterResult = applyChesterExtras(chester);\n"
     "\tif (!chesterResult.result)\n"
     "\t\treturn chesterResult;\n\n") + a
if need(a in s, "persistWizardState call not found"):
    s = s.replace(a, b, 1)

if fails:
    for f in fails: print("  [FAIL]", f)
    sys.exit(1)

io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s)
print("  applyChesterExtras added:", s.count('function applyChesterExtras'))
print("  chester payload parsed:  ", s.count('parsed.chester'))
print("  redial (must be 0):      ", s.count('redial'))

# ---- skipping the admin step clears the password instead of keeping the default
s2 = io.open(p, encoding='utf-8', errors='surrogateescape').read()
a = """function applyAdminConfig(admin) {
\tif (admin?.skipped === true)
\t\treturn { result: true, skipped: true };"""
b = """function applyAdminConfig(admin) {
\tif (admin?.skipped === true) {
\t\t// Skipping leaves NO password, not the shipped default.
\t\t//
\t\t// Deliberate: the image ships root with a real hash, so simply returning
\t\t// here left every skipped unit on the same published default password --
\t\t// the same one printed in the upgrade guide. An obviously-unset password
\t\t// is better than a shared secret that looks set, and the client can then
\t\t// choose one without having to know what it used to be.
\t\t//
\t\t// Bounded to the LAN by the firewall, not by luck: dropbear binds to the
\t\t// lan address only (dropbear.main.Interface=lan) and the wan zone input
\t\t// policy is REJECT with nothing opening 22/80/443, so this is not
\t\t// reachable from the carrier side.
\t\tlet cleared = runCommand('passwd -d root >/dev/null 2>&1');

\t\treturn {
\t\t\tresult: cleared.result,
\t\t\tcode: cleared.code,
\t\t\tskipped: true,
\t\t\tmessage: cleared.result ? null : 'failed to clear the administrator password'
\t\t};
\t}"""
if a in s2:
    s2 = s2.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s2)
    print("  admin skip -> blank password: applied")
else:
    print("  [FAIL] applyAdminConfig skip branch not found")
    sys.exit(1)

# ---- serve the dropdown data through the wizard's own (already granted) context
s3 = io.open(p, encoding='utf-8', errors='surrogateescape').read()

a = "import { popen } from 'fs';"
b = """import { popen, readfile } from 'fs';

// The same table luci's own rpcd uses for getTimezones. Imported rather than
// fetched over ubus on purpose: an rpcd method that makes a synchronous ubus
// call deadlocks rpcd against itself.
import timezones from 'luci.zoneinfo';"""
assert a in s3, "fs import not found"
s3 = s3.replace(a, b, 1)

HELPER = '''// Data for the Chester-added dropdowns, served through the wizard context.
//
// It has to come through THIS object. The wizard runs unauthenticated -- it
// exists to be used before a password is set -- and misectel-unauthenticated
// grants only the six misectel_setup_wizard methods. Calling misectel's
// apn_presets_get or luci's getTimezones from the page would work perfectly
// while logged in and be denied at first boot, which is the only time the
// wizard actually runs.
function buildChesterContext() {
\tlet zones = {};

\tfor (let zone, tzstring in timezones)
\t\tzones[zone] = tzstring;

\t// APN presets read straight off disk, with the credentials removed. This
\t// context is served pre-login, and a saved carrier username and password
\t// must not be readable by an unauthenticated caller.
\tlet country = lc(trimSafe(readCommandOutput('uci -q get misectel.main.apn_country 2>/dev/null')));

\tif (!match(country, /^[a-z0-9_-]+$/))
\t\tcountry = 'unknown';

\tlet raw = readfile(`/etc/misectel/apn-presets/${country}.json`)
\t\t|| readfile(`/usr/share/misectel/apn-presets/defaults/${country}.json`)
\t\t|| readfile('/usr/share/misectel/apn-presets/defaults/unknown.json');

\tlet doc = parseJsonSafe(raw, {});
\tlet presets = [];

\tfor (let entry in (doc?.presets || [])) {
\t\tlet apn = trimSafe(entry?.apn);

\t\tif (!apn)
\t\t\tcontinue;

\t\tpush(presets, {
\t\t\toperator: trimSafe(entry?.operator) || apn,
\t\t\tapn: apn,
\t\t\tauth: trimSafe(entry?.auth) || 'none'
\t\t});
\t}

\treturn {
\t\ttimezones: zones,
\t\tzonename: trimSafe(readCommandOutput('uci -q get system.@system[0].zonename 2>/dev/null')),
\t\tapn_presets: presets
\t};
}

'''

a = "function buildSetupContext() {"
assert a in s3, "buildSetupContext not found"
s3 = s3.replace(a, HELPER + a, 1)

a = """\t\t\tskipped_admin: trimSafe(readCommandOutput(`uci -q get misectel.setup.skipped_admin 2>/dev/null`) || '0') == '1'
\t\t}
\t};
}"""
b = """\t\t\tskipped_admin: trimSafe(readCommandOutput(`uci -q get misectel.setup.skipped_admin 2>/dev/null`) || '0') == '1'
\t\t},
\t\tchester: buildChesterContext()
\t};
}"""
assert a in s3, "buildSetupContext return not found"
s3 = s3.replace(a, b, 1)

io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s3)
print("  buildChesterContext added:", s3.count('function buildChesterContext'))
print("  served in context:        ", s3.count('chester: buildChesterContext()'))
