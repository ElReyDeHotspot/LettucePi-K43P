import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8', errors='surrogateescape').read()
fails = []
def need(c, m):
    if not c: fails.append(m)
    return c

# A. the two dropdowns, built from the wizard context (see buildChesterContext
#    in the backend for why the data arrives this way and not over misectel/luci)
METHOD = (
"buildChesterExtras(){"
"const chester=this.data?.chester||{};"
"const zones=chester.timezones||{};"
"const current=chester.zonename||'';"
"this.chesterZoneMap=zones;"
"this.chesterApnMap={};"
"const apnSelect=E('select',{'class':'misectel-select'},[E('option',{'value':''},[_('Automatic')])]);"
"for(const preset of (chester.apn_presets||[])){"
"if(!preset?.apn)continue;"
"this.chesterApnMap[preset.apn]=preset;"
"apnSelect.appendChild(E('option',{'value':preset.apn},[`${preset.operator} - ${preset.apn}`]));}"
"const tzSelect=E('select',{'class':'misectel-select'},[E('option',{'value':''},[_('Leave unchanged')])]);"
"for(const name of Object.keys(zones).sort())"
"tzSelect.appendChild(E('option',{'value':name,'selected':name===current?'selected':null},[name]));"
"this.chesterApnSelect=apnSelect;"
"this.chesterZoneSelect=tzSelect;"
"this.chesterExtras=E('div',{'class':'misectel-form-grid'},["
"misectel.createField(_('APN'),E('div',{'class':'misectel-select-wrap'},[apnSelect])),"
"misectel.createField(_('Time Zone'),E('div',{'class':'misectel-select-wrap'},[tzSelect]))]);},"
"collectChesterPayload(){"
"const apn=this.chesterApnSelect?.value||'';"
"const zone=this.chesterZoneSelect?.value||'';"
"const preset=this.chesterApnMap?.[apn]||{};"
"return{apn:apn,auth:preset.auth||'none',username:'',password:'',"
"zonename:zone,timezone:zone?(this.chesterZoneMap?.[zone]||''):''};},"
)
a = "renderNetworkStep(){"
if need(a in s, "renderNetworkStep anchor missing"):
    s = s.replace(a, METHOD + a, 1)

# B. build them while the step renders
a = "this.renderProtocolFields();return this.createShell(_('Internet Setup')"
if need(a in s, "renderProtocolFields/createShell anchor missing"):
    s = s.replace(a, "this.renderProtocolFields();this.buildChesterExtras();return this.createShell(_('Internet Setup')", 1)

# C. into the stack, NOT the form grid: the grid only renders when a physical
#    WAN port exists, and APN and timezone matter on a cellular-only unit too.
a = ",this.networkProtocolBody]),[this.createWizardButton(_('Next')"
if need(a in s, "network stack anchor missing"):
    s = s.replace(a, ",this.networkProtocolBody,this.chesterExtras]),[this.createWizardButton(_('Next')", 1)

# D. ship the values with the rest of the draft
a = "buildDraftPayload(){return{"
if need(a in s, "buildDraftPayload anchor missing"):
    s = s.replace(a, "buildDraftPayload(){return{chester:this.collectChesterPayload(),", 1)

if fails:
    for f in fails: print("  [FAIL]", f)
    sys.exit(1)

io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s)
print("  buildChesterExtras:      ", s.count('buildChesterExtras'))
print("  collectChesterPayload:   ", s.count('collectChesterPayload'))
print("  node in the network step:", s.count('this.chesterExtras]'))
print("  payload key:             ", s.count('chester:this.collectChesterPayload()'))

# ---- brand the first screen, and stop the stray "null" under its title
s2 = io.open(p, encoding='utf-8', errors='surrogateescape').read()
f2 = []

# The head array is [titleDiv, subtitle ? div : null]; with no subtitle that
# null is handed to E() as a child and rendered as the literal text "null".
# compactNodes is the vendor's own helper for exactly this, already used two
# lines below for the body.
a = ("E('div',{'class':'misectel-setup-card__head'},[E('div',{'class':'misectel-setup-card__title'},[title]),"
     "subtitle?E('div',{'class':'misectel-setup-card__subtitle'},[subtitle]):null])")
b = ("E('div',{'class':'misectel-setup-card__head'},misectel.compactNodes([E('div',{'class':'misectel-setup-card__title'},[title]),"
     "subtitle?E('div',{'class':'misectel-setup-card__subtitle'},[subtitle]):null]))")
if a in s2: s2 = s2.replace(a, b, 1)
else: f2.append("createShell head anchor missing")

# The product, not the generic vendor string. Inline sizing rather than a new
# cascade.css rule so the markup and its styling ship in one file.
BRAND = ("E('span',{'style':'display:inline-flex;align-items:center;gap:.42em;'},["
         "E('img',{'src':'/luci-static/misectel/logo.svg','alt':'',"
         "'style':'height:1em;width:1em;display:block;'}),"
         "E('span',{},['LettucePi'])])")
a = "renderStartStep(){return this.createShell(_('5G Wireless Data Terminal'),null,"
b = "renderStartStep(){return this.createShell(" + BRAND + ",null,"
if a in s2: s2 = s2.replace(a, b, 1)
else: f2.append("renderStartStep title anchor missing")

if f2:
    for f in f2: print("  [FAIL]", f)
    sys.exit(1)

io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s2)
print("  start title branded:  ", s2.count("'LettucePi'"))
print("  logo.svg referenced:  ", s2.count('logo.svg'))
print("  vendor string gone:   ", s2.count('5G Wireless Data Terminal'))
print("  null subtitle guarded:", s2.count('compactNodes([E(\'div\',{\'class\':\'misectel-setup-card__title\'}'))

# ---- Port Mode was chosen and not applied
s5 = io.open(p, encoding='utf-8', errors='surrogateescape').read()

# state.wan.mode is read to decide which option is `selected` and never written
# back, so the choice lives only in the DOM element. Any re-render of the step
# silently reverts it to the value the router booted with -- which is what made
# a wizard run that selected LAN come back still on WAN.
a = "this.networkControls.mode.addEventListener('change',()=>this.renderProtocolFields());"
b = ("this.networkControls.mode.addEventListener('change',()=>{"
     "this.state.wan.mode=this.networkControls.mode.value;"
     "this.renderProtocolFields();});")
if a in s5:
    s5 = s5.replace(a, b, 1)
    io.open(p, 'w', encoding='utf-8', errors='surrogateescape', newline='\n').write(s5)
    print("  port mode written back to state:", s5.count('this.state.wan.mode=this.networkControls.mode.value'))
else:
    print("  [FAIL] port mode change handler not found")
    sys.exit(1)
