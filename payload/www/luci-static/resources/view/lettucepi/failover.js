'use strict';
'require view';
'require chester-ui.link-result as linkResult';
'require rpc';
'require poll';
'require ui';
'require uci';

var status = rpc.declare({object:'failover', method:'status', expect:{}});
var startLinkTest = rpc.declare({object:'failover',method:'test_start',params:['role','notice'],expect:{}});
var cancelLinkTest = rpc.declare({object:'failover',method:'test_cancel',expect:{}});
var interfaces = rpc.declare({object:'network.interface', method:'dump', expect:{interface:[]}});
var save = rpc.declare({object:'failover', method:'set_config', params:['enabled','mode','primary','backup','targets','interval','fail_count','recover_count','timeout'], expect:{}});
var builtinPorts = rpc.declare({object:'luci', method:'getBuiltinEthernetPorts', expect:{result:[]}});
var devices = rpc.declare({object:'network.device', method:'status', expect:{'':{}}});
var wanRole = rpc.declare({object:'misectel', method:'wan_to_lan', expect:{}});
var setWanRole = rpc.declare({object:'misectel', method:'set_wan_to_lan', params:['enabled'], expect:{}});

var CSS = `
.fo-page{max-width:1040px;margin:auto;padding:18px 8px 30px;color:#172033;font-size:14px}
.fo-page *{box-sizing:border-box}.fo-heading,.fo-between{display:flex;align-items:center;justify-content:space-between;gap:14px}.fo-heading{margin-bottom:20px}.fo-heading h2{margin:0 0 5px;font-size:27px}.fo-muted{color:#68768a;font-size:13px;line-height:1.5}.fo-card{border:1px solid #dfe6ee;border-radius:20px;padding:22px;margin-bottom:18px;background:#fff;box-shadow:0 5px 20px #20365406}.fo-card h3{font-size:17px;margin:0 0 9px}.fo-page button{font-family:inherit;cursor:pointer;line-height:1.25}.fo-heading h2{border:0;padding:0}.fo-slot{display:flex;flex-direction:column}.fo-uplink{flex:1}.fo-page button:focus-visible,.fo-page summary:focus-visible,.fo-page input:focus-visible,.fo-page select:focus-visible{outline:3px solid #76a6ef;outline-offset:3px}.fo-page button:disabled{opacity:.55;cursor:wait}.fo-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:20px;background:#edf1f6;color:#59677a;font-size:12px;font-weight:700;white-space:nowrap}.fo-pill.online{background:#e4f6ec;color:#137448}.fo-pill.offline{background:#fbebed;color:#b53643}.fo-state{font-size:21px;font-weight:750;margin-bottom:5px}.fo-enable{display:flex;align-items:center;gap:14px;min-height:60px;cursor:pointer}.fo-enable strong{display:block;font-size:18px;margin-bottom:3px}.fo-enable input{appearance:none;flex:none;width:54px;height:32px;margin:0;border:0;border-radius:20px;background:#c1cbd7;position:relative;cursor:pointer;transition:background .18s}.fo-enable input:before{content:'';position:absolute;left:4px;top:4px;width:24px;height:24px;border-radius:50%;background:white;box-shadow:0 1px 5px #17203326;transition:transform .18s}.fo-enable input:checked{background:#d8273e}.fo-enable input:checked:before{transform:translateX(22px)}
.fo-page .fo-ports{grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-flow:row;grid-auto-columns:auto;gap:8px}.fo-ports .misectel-dashboard-port-panel__port{min-width:0;min-height:86px;padding:16px 8px 12px;font-family:inherit;display:flex;flex-direction:column;align-items:stretch}.fo-ports button{appearance:none;width:100%;font-size:inherit}.fo-ports .misectel-dashboard-port-panel__name{font-size:16px}.fo-ports .misectel-dashboard-port-panel__speed{font-size:12px}.fo-help{padding:14px 16px;border-radius:14px;background:#edf5ff;color:#345778;line-height:1.5;margin-bottom:18px}
.fo-order-heading{margin-bottom:20px}.fo-order-heading p{margin:0}.fo-order{display:grid;grid-template-columns:1fr 1fr;gap:18px}.fo-slot{min-width:0;border:2px solid transparent;border-radius:18px;padding:5px;transition:background .15s,border-color .15s}.fo-slot.is-drop{border-color:#d8273e;background:#fff0f2}.fo-role{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:15px;font-weight:750}.fo-role-number{display:grid;place-items:center;width:28px;height:28px;background:#edf1f6;border-radius:50%;font-size:13px}.fo-slot:first-child .fo-role-number{background:#e6efff;color:#255a9c}.fo-uplink{position:relative;display:flex;flex-direction:column;min-height:282px;padding:20px;border:1px solid #d7e0eb;border-radius:16px;background:#f8fafc;will-change:transform;user-select:none;-webkit-user-select:none}.fo-slot:first-child .fo-uplink{background:#f2f6ff;border-color:#bdcfe9}.fo-uplink.is-lifted{z-index:5;box-shadow:0 18px 40px #17203330;opacity:.95}.fo-uplink.is-native-drag{opacity:.45}.fo-uplink-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:18px}.fo-icon{width:52px;height:52px;display:grid;place-items:center;border-radius:14px;background:#e7edf5;color:#325778}.fo-icon svg{width:30px;height:30px}.fo-grip{display:grid;place-items:center;touch-action:none;width:44px;height:44px;min-width:44px;border:1px solid #d7e0eb;border-radius:12px;background:#fff;color:#64788e;cursor:grab!important}.fo-grip:active{cursor:grabbing!important}.fo-grip svg{width:22px;height:22px}.fo-uplink h4{margin:0 0 8px;font-size:23px;font-weight:750;line-height:1.2;overflow-wrap:anywhere}.fo-uplink-status{align-self:flex-start;margin-bottom:9px}.fo-uplink-detail{min-height:40px;font-size:13px;color:#62738a;line-height:1.45;margin-bottom:17px;overflow-wrap:anywhere}.fo-uplink-action{min-height:48px;width:100%;padding:10px 8px;border:1px solid #bfcddd;background:white;border-radius:12px;color:#294c72;font-size:13px;font-weight:700;margin-top:auto}.fo-uplink-action:hover{background:#eaf1fa}.fo-in-use{display:none;color:#225fa5;font-weight:700;font-size:12px;margin-bottom:8px}.fo-in-use.visible{display:block}.fo-order-note{margin-top:16px;min-height:20px;font-size:13px;color:#60748c;line-height:1.5}
.fo-test-button{min-height:46px;width:100%;margin:0 0 10px;padding:10px 5px;border:1px solid #aac3e2;border-radius:12px;background:#eaf3ff;color:#215d98;font-size:13px;font-weight:700}.fo-test-result{font-size:12px;line-height:1.5;margin-bottom:12px;overflow-wrap:anywhere;user-select:text}.fo-test-row{display:flex;justify-content:space-between;gap:5px;flex-wrap:wrap}.fo-test-row strong{color:#254c71}.fo-test-result.error{color:#b53643}.fo-test-notice{margin:0 0 16px}.fo-test-notice a{color:#255f9e;text-decoration:underline}
.fo-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px}.fo-mode{min-height:56px;border:1px solid #d7e0eb;border-radius:13px;padding:10px 7px;background:#f8fafc;color:#52657e;font-size:14px;font-weight:650}.fo-mode[aria-pressed=true]{border-color:#d8273e;background:#fff0f2;color:#b71e34;box-shadow:inset 0 0 0 1px #d8273e}.fo-mode-note{margin-top:12px;min-height:22px}
.fo-page .fo-lan-action{min-height:44px;border:1px solid #b8cbe2;background:#edf4ff;color:#23588b;gap:7px;padding:8px 10px;cursor:pointer}.fo-page .fo-lan-action:hover{background:#deebff;border-color:#7c9fca}
.fo-uplink h4{min-height:56px}.fo-test-row{display:grid;grid-template-columns:1fr;gap:0;margin-bottom:6px}.fo-test-row strong{font-size:15px}
.fo-details{padding:0}.fo-details summary{min-height:60px;padding:19px 22px;font-size:15px;font-weight:700;cursor:pointer}.fo-details-body{padding:0 22px 22px}.fo-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.fo-field{display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:18px}.fo-page input:not([type=checkbox]),.fo-page select{width:100%;min-width:0;min-height:48px;border:1px solid #cad5e2;border-radius:11px;padding:10px 12px;background:#fafcff;font-size:15px}.fo-kv{display:grid;grid-template-columns:90px 1fr;gap:8px;font-size:13px}.fo-kv span:nth-child(odd){color:#69778b}.fo-kv span:nth-child(even){overflow-wrap:anywhere}.fo-link-detail h4{font-size:15px;margin:0 0 14px}.fo-log{max-height:210px;overflow:auto;white-space:pre-wrap;font-size:12px;color:#53647b;margin:0}.fo-actions{position:sticky;bottom:12px;z-index:8;display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:76px;padding:13px 16px;border:1px solid #dfe6ee;border-radius:16px;background:#fffffff5;box-shadow:0 8px 26px #17203312;margin:20px 0}.fo-save{min-height:48px;padding:12px 24px;border:0;border-radius:12px;background:#d8273e;color:white;font-size:15px;font-weight:700;white-space:nowrap}.fo-result{color:#63748b;font-size:13px;line-height:1.4}.fo-result.error{color:#b53643}
@media(max-width:600px){.fo-page{padding:12px 0 24px}.fo-card{padding:16px;border-radius:17px}.fo-heading h2{font-size:25px}.fo-order{gap:8px}.fo-slot{padding:2px}.fo-uplink{padding:12px;min-height:288px;border-radius:13px}.fo-uplink h4{font-size:20px}.fo-icon{width:43px;height:43px;border-radius:11px}.fo-icon svg{width:26px;height:26px}.fo-uplink-top{gap:4px;margin-bottom:15px}.fo-role{font-size:13px;gap:6px}.fo-role-number{width:25px;height:25px}.fo-uplink-detail{font-size:12px;min-height:49px}.fo-pill{padding:6px 9px;font-size:11px}.fo-modes{gap:7px}.fo-mode{font-size:12px;min-height:55px}.fo-grid{grid-template-columns:1fr;gap:0}.fo-details{padding:0}.fo-details summary{padding:18px 16px}.fo-details-body{padding:0 16px 16px}.fo-actions{bottom:8px;padding:11px 12px;gap:10px}.fo-save{padding:12px 17px}.fo-enable strong{font-size:17px}}
@media(prefers-reduced-motion:reduce){.fo-page *{transition:none!important}}
`;

function icon(kind) {
    var node = E('span', {'class':'fo-icon','aria-hidden':'true'});
    node.innerHTML = kind === 'wan'
        ? '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="7" width="22" height="18" rx="3"/><path d="M10 12v5m4-5v5m4-5v5m4-5v5M11 25v-4h10v4"/></svg>'
        : '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 25v-4m6 4V16m6 9V11m6 14V6"/></svg>';
    return node;
}

return view.extend({
    load: function() { return Promise.all([status(), interfaces(), builtinPorts(), devices(), wanRole(), uci.load('misectel')]); },
    render: function(data) {
        var oldStyle = document.getElementById('k45p-failover-css');
        if (oldStyle) oldStyle.remove();
        document.head.appendChild(E('style', {id:'k45p-failover-css'}, [CSS]));
        if (!document.getElementById('misectel-dashboard-css')) document.head.appendChild(E('link', {id:'misectel-dashboard-css',rel:'stylesheet',href:L.resource('misectel-dashboard/dashboard.css')}));
        var self = this, s = data[0] || {}, c = s.config || {};
        this.interfaceData = data[1] || [];
        var names = ['wan', c.primary || 'wan', c.backup || 'pcie0'];
        this.interfaceData.forEach(function(i) { if (i.interface !== 'lan' && i.interface !== 'loopback' && i.proto !== 'dhcpv6') names.push(i.interface); });
        names = names.filter(function(n,i,a) { return a.indexOf(n) === i; });
        function select(value, options) {
            var e = E('select');
            options.forEach(function(o) { e.appendChild(E('option', {value:o[0]}, [o[1]])); });
            e.value = value; return e;
        }
        function field(label, node) { return E('label', {'class':'fo-field'}, [E('span', {}, [label]), node]); }
        function number(value,min,max) { return E('input', {type:'number',value:String(value),min:min,max:max,inputmode:'numeric'}); }
        this.wanIsLan = !!(data[4] || {}).enabled;
        this.portBusy = false; this.saving = false; this.dirty = false;
        this.portBox = E('div', {'class':'misectel-dashboard-port-panel fo-ports','aria-label':'Ethernet Ports'});
        var labels = {}, rawLabels = uci.get('misectel','clients','port_labels') || '';
        String(Array.isArray(rawLabels) ? rawLabels.join(' ') : rawLabels).split(/[\s,]+/).forEach(function(pair) { var kv=pair.split('='); if(kv.length===2) labels[kv[0].toLowerCase()]=kv[1]; });
        this.portEntries = (data[2] || []).filter(function(p) { return /^lan[123]$|^wan$/.test(p.device); }).sort(function(a,b) { return (a.device==='wan'?99:-Number(a.device.replace('lan','')))-(b.device==='wan'?99:-Number(b.device.replace('lan',''))); }).map(function(p) {
            var isWan = p.device === 'wan', label = E('strong', {'class':'misectel-dashboard-port-panel__name'}), speed = E('div', {'class':'misectel-dashboard-port-panel__speed'});
            var node = E(isWan?'button':'div', isWan?{type:'button',click:ui.createHandlerFn(self,function() { return self.toggleWanPort(); })}:{}, [label,speed]);
            self.portBox.appendChild(node); return {device:p.device,isWan:isWan,label:label,speed:speed,node:node,name:labels[p.device]||p.device.toUpperCase()};
        });
        this.wanNotice = E('div', {'class':'fo-help'}, ['The WAN socket is in LAN mode. Tap its icon above to use it for internet.']);
        this.enable = E('input', {type:'checkbox',role:'switch','aria-label':'Enable Failover'}); this.enable.checked = !!c.enabled;
        this.enableNote = E('div', {'class':'fo-muted'});
        this.mode = select(c.mode || 'auto', [['auto','Automatic'],['balance','Load Balance'],['wan','Primary Only'],['cell','Secondary Only']]);
        var opts = names.map(function(n) { return [n,self.connectionName(n)+' ('+n+')']; });
        this.primary = select(c.primary || 'wan',opts); this.backup = select(c.backup || 'pcie0',opts);
        this.draftOrder = [this.primary.value,this.backup.value];
        this.targets = E('input', {type:'text',value:(c.targets||[]).join(', '),inputmode:'decimal'});
        this.interval = number(c.interval||2,2,300); this.fail = number(c.fail_count||1,1,60); this.recover = number(c.recover_count||3,1,120); this.probeTimeout = number(c.timeout||1,1,5);
        this.headline = E('div', {'class':'fo-state'}); this.description = E('div', {'class':'fo-muted'}); this.badge = E('span', {'class':'fo-pill'});
        this.orderBox = E('div', {'class':'fo-order','aria-label':'Connection Priority'});
        this.orderNote = E('div', {'class':'fo-order-note','aria-live':'polite'});
        this.wanCard = E('div', {'class':'fo-link-detail'}); this.cellCard = E('div', {'class':'fo-link-detail'});
        this.events = E('pre', {'class':'fo-log'}); this.message = E('span', {'class':'fo-result','aria-live':'polite'}, []);
        this.modeButtons = [['auto','Automatic'],['balance','Load Balance'],['wan','Primary Only'],['cell','Secondary Only']].map(function(m) {
            return E('button', {type:'button','class':'fo-mode','aria-pressed':String(self.mode.value===m[0]),click:function() { self.mode.value=m[0]; self.refreshMode(); self.markDirty(); }}, [m[1]]);
        });
        this.modeNote = E('div', {'class':'fo-muted fo-mode-note'});
        this.saveButton = E('button', {'class':'fo-save',type:'button',click:ui.createHandlerFn(this,this.saveSettings)}, ['Save Changes']);
        this.primary.addEventListener('change', function() { if(self.primary.value===self.backup.value) self.backup.value=self.draftOrder[0]; self.drawOrder(); self.markDirty(); });
        this.backup.addEventListener('change', function() { if(self.backup.value===self.primary.value) self.primary.value=self.draftOrder[1]; self.drawOrder(); self.markDirty(); });
        var root = E('div', {'class':'fo-page chester-ios'}, [
            E('link',{rel:'stylesheet',href:L.resource('chester-ui/ios.css')+'?v=20261124-4'}),
            E('div', {'class':'fo-heading'}, [E('div', {}, [E('div',{'class':'ios-title',role:'heading','aria-level':'2'},['Failover']),E('div', {'class':'fo-muted'}, ['Choose a backup connection or use both together.'])]),this.badge]),
            E('div', {'class':'fo-card'}, [this.portBox,E('div', {'class':'fo-muted',style:'margin-top:14px'}, ['Tap WAN to switch this socket between internet and LAN.'])]),
            this.wanNotice,
            E('section', {'class':'fo-card fo-order-card','aria-label':'Set Connection Priority'}, [
                E('div', {'class':'fo-order-heading'}, [E('h3', {}, ['Your Connection Order']),E('p', {'class':'fo-muted'}, ['Drag a handle to change priority, or use the button on either card.'])]),
                E('div',{'class':'fo-muted fo-test-notice'},['Test each link with M-Lab NDT. Tests use data and may slow other traffic. M-Lab publishes results and your public IP address. ',E('a',{href:'https://www.measurementlab.net/privacy/',target:'_blank',rel:'noopener noreferrer'},['Privacy policy'])]),this.orderBox,this.orderNote
            ]),
            E('div', {'class':'fo-card'}, [
                E('label', {'class':'fo-enable misectel-inline-check'}, [this.enable,E('div', {}, [E('strong', {}, ['Failover']),this.enableNote])]),
                E('div', {style:'border-top:1px solid #e8edf3;margin-top:16px;padding-top:18px'}, [this.headline,this.description])
            ]),
            E('section', {'class':'fo-card'}, [E('h3', {}, ['How Should It Connect?']),E('div', {'class':'fo-modes','aria-label':'Operating Mode'}, this.modeButtons),this.modeNote]),
            E('details', {'class':'fo-card fo-details'}, [E('summary', {}, ['Advanced Settings']),E('div', {'class':'fo-details-body'}, [
                E('div', {'class':'fo-grid'}, [field('Primary Interface',this.primary),field('Secondary Interface',this.backup)]),
                field('Ping Targets',this.targets),
                E('div', {'class':'fo-grid'}, [field('Seconds Between Checks',this.interval),field('Probe Timeout (Seconds)',this.probeTimeout),field('Failed Checks Before Switching',this.fail),field('Healthy Checks Before Returning to Primary',this.recover)]),
                E('div', {'class':'fo-muted'}, ['Use one to six IPv4 addresses, separated by commas. Load Balance applies to devices on this LAN and shares connections, not individual packets or one download. Existing sessions may reconnect if their uplink fails. These modes manage IPv4; IPv6 keeps its existing settings.'])
            ])]),
            E('details', {'class':'fo-card fo-details'}, [E('summary', {}, ['Connection Details']),E('div', {'class':'fo-details-body fo-grid'}, [this.wanCard,this.cellCard])]),
            E('details', {'class':'fo-card fo-details'}, [E('summary', {}, ['Recent Events']),E('div', {'class':'fo-details-body'}, [this.events])]),
            E('div', {'class':'fo-actions'}, [this.message,this.saveButton])
        ]);
        root.addEventListener('input',function() { self.refreshMode(); self.markDirty(); });
        root.addEventListener('change',function() { self.refreshMode(); self.markDirty(); });
        this.drawOrder(); this.refreshMode(); this.updatePorts(data[3]||{},data[4]||{}); this.update(s);
        poll.add(async function() { if(self.portBusy)return; try { var d=await Promise.all([devices(),wanRole()]); if(!self.portBusy)self.updatePorts(d[0],d[1]); } catch(e){} },10);
        poll.add(async function() { try { self.update(await status()); } catch(e) { self.badge.textContent='Status unavailable'; } },3);
        return root;
    },
    connectionKind: function(name) {
        var info = (this.interfaceData||[]).find(function(i) { return i.interface===name; }) || {};
        if(name==='wan' || info.device==='wan' || info.l3_device==='wan') return 'wan';
        if(/pcie|wwan|cell|modem/i.test(name) || /rmnet|wwan/i.test(info.l3_device||'') || info.proto==='qmodem') return 'cell';
        return 'other';
    },
    connectionName: function(name) { var k=this.connectionKind(name); return k==='wan'?'Ethernet WAN':k==='cell'?'Cellular':name||'Connection'; },
    drawOrder: function() {
        var self=this;
        this.draftOrder=[this.primary.value,this.backup.value]; this.priorityRefs=[];
        this.orderBox.replaceChildren.apply(this.orderBox,this.draftOrder.map(function(name,index) {
            var slot=E('div', {'class':'fo-slot','data-priority-slot':String(index)});
            var title=self.connectionName(name), card=E('div', {'class':'fo-uplink','data-interface':name,draggable:'true'});
            var grip=E('button', {type:'button','class':'fo-grip','aria-label':'Drag '+title+' to Change Priority',title:'Drag to the Other Side'});
            grip.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
            var health=E('span', {'class':'fo-pill fo-uplink-status'}), detail=E('div', {'class':'fo-uplink-detail'}), active=E('div', {'class':'fo-in-use'}, ['Currently in use']);
            var testResult=E('div',{'class':'fo-test-result','aria-live':'polite'});
            var testButton=E('button',{type:'button','class':'fo-test-button',click:ui.createHandlerFn(self,function(){return self.runLinkTest(index);})},[index?'Test Secondary':'Test Primary']);
            var lanAction=E('button', {type:'button','class':'fo-pill fo-uplink-status fo-lan-action','aria-label':'Switch Ethernet Socket from LAN to WAN',title:'Tap to Use This Socket for Internet',click:ui.createHandlerFn(self,function() { return self.toggleWanPort(); })}, ['LAN Mode',E('span',{'aria-hidden':'true'},['↗'])]);
            card.append(E('div', {'class':'fo-uplink-top'}, [icon(self.connectionKind(name)),grip]),E('h4', {}, [title]),health,lanAction,active,detail,testButton,testResult,
                E('button', {type:'button','class':'fo-uplink-action','aria-label':'Make '+title+' '+(index?'Primary':'Secondary'),click:function() { self.swapOrder(); }}, [index?'Make Primary':'Make Secondary']));
            slot.append(E('div', {'class':'fo-role'}, [E('span', {'class':'fo-role-number'}, [String(index+1)]),E('span', {}, [index?'Secondary':'Primary'])]),card);
            self.priorityRefs.push({name:name,card:card,health:health,lanAction:lanAction,detail:detail,active:active,slot:slot,testButton:testButton,testResult:testResult,index:index});
            self.bindDrag(card,grip,index);
            slot.addEventListener('dragover',function(e) { if(self.nativeDragFrom==null)return; e.preventDefault(); e.dataTransfer.dropEffect='move'; self.showDrop(index); });
            slot.addEventListener('drop',function(e) { if(self.nativeDragFrom==null)return; e.preventDefault(); var from=self.nativeDragFrom; self.clearDrag(); if(from!==index)self.swapOrder(); });
            return slot;
        }));
        this.refreshMode(); this.updatePriorityVitals();
    },
    swapOrder: function() {
        var old=this.primary.value; this.primary.value=this.backup.value; this.backup.value=old;
        this.drawOrder(); this.markDirty();
        this.orderNote.textContent=this.connectionName(this.primary.value)+' is Primary. Save changes to apply this order.';
    },
    showDrop: function(index) { (this.priorityRefs||[]).forEach(function(r,i) { r.slot.classList.toggle('is-drop',i===index); }); },
    clearDrag: function() {
        this.nativeDragFrom=null;
        (this.priorityRefs||[]).forEach(function(r) { r.slot.classList.remove('is-drop'); r.card.classList.remove('is-lifted','is-native-drag'); r.card.style.transform=''; });
    },
    bindDrag: function(card,grip,index) {
        var self=this, drag=null;
        card.addEventListener('dragstart',function(e) {
            if(e.target.closest('button')) { e.preventDefault(); return; }
            self.nativeDragFrom=index; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(index)); card.classList.add('is-native-drag');
        });
        card.addEventListener('dragend',function() { self.clearDrag(); });
        grip.addEventListener('pointerdown',function(e) {
            if(e.button!==0 || self.saving)return;
            e.preventDefault(); e.stopPropagation();
            drag={id:e.pointerId,x:e.clientX,y:e.clientY,target:index,moved:false};
            grip.setPointerCapture(e.pointerId);
        });
        grip.addEventListener('pointermove',function(e) {
            if(!drag || e.pointerId!==drag.id)return;
            var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
            if(!drag.moved && Math.hypot(dx,dy)<8)return;
            drag.moved=true; e.preventDefault(); card.classList.add('is-lifted');
            card.style.transform='translate('+dx+'px,'+dy+'px) scale(1.025)';
            var rect=self.orderBox.getBoundingClientRect();
            drag.target=e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top-40||e.clientY>rect.bottom+40 ? -1 : e.clientX<rect.left+rect.width/2 ? 0 : 1;
            self.showDrop(drag.target);
        },{passive:false});
        function finish(e,cancel) {
            if(!drag || e.pointerId!==drag.id)return;
            var apply=!cancel && drag.moved && drag.target>=0 && drag.target!==index;
            e.preventDefault(); e.stopPropagation();
            if(grip.hasPointerCapture(e.pointerId))grip.releasePointerCapture(e.pointerId);
            drag=null; self.clearDrag(); if(apply)self.swapOrder();
        }
        grip.addEventListener('pointerup',function(e) { finish(e,false); });
        grip.addEventListener('pointercancel',function(e) { finish(e,true); });
        grip.addEventListener('lostpointercapture',function() { if(drag) { drag=null; self.clearDrag(); } });
    },
    markDirty: function() { this.dirty=true; this.message.className='fo-result'; this.message.textContent='Unsaved Changes'; },
    refreshMode: function() {
        if(!this.modeButtons)return;
        var self=this;
        ['auto','balance','wan','cell'].forEach(function(m,i) { self.modeButtons[i].setAttribute('aria-pressed',String(self.mode.value===m)); });
        this.enableNote.textContent=this.enable.checked?'Use the order and mode below.':'Off · your existing routing stays unchanged.';
        this.modeNote.textContent=this.mode.value==='balance'?'Use both connections. New connections are shared roughly 50/50; if one fails, new traffic uses the healthy connection. One download uses one connection.':this.mode.value==='auto'?'Use Primary first. Switch to Secondary if needed, then return when Primary recovers.':this.mode.value==='wan'?'Use only your Primary connection. No automatic switching.':'Use only your Secondary connection. No automatic switching.';
        this.orderNote.textContent=this.mode.value==='balance'?'Both connections share traffic equally. Left and right do not set priority in Load Balance.':'Primary is tried first. Secondary takes over if Primary loses internet.';
    },
    saveSettings: async function() {
        if(this.saving)return;
        this.saving=true; this.saveButton.disabled=true; this.message.textContent='Saving…'; this.message.className='fo-result';
        try {
            var r=await save(this.enable.checked?'1':'0',this.mode.value,this.primary.value,this.backup.value,this.targets.value,this.interval.value,this.fail.value,this.recover.value,this.probeTimeout.value);
            if(!r.success)throw new Error(r.error||'Could not save settings.');
            this.dirty=false; this.message.textContent='Saved'; this.refreshMode(); this.update(await status());
        } catch(e) { this.message.className='fo-result error'; this.message.textContent=e.message; }
        finally { this.saving=false; this.saveButton.disabled=false; }
    },
    runLinkTest: async function(index) {
        if(this.testRequest)return;
        var tests=(this.lastStatus||{}).link_tests||{},c=(this.lastStatus||{}).config||{};
        this.testRequest=true;this.updatePriorityVitals();
        try {
            var r;
            if(tests.running)r=await cancelLinkTest();
            else {
                if(this.primary.value!==c.primary || this.backup.value!==c.backup)throw new Error('Save your connection order before testing.');
                r=await startLinkTest(index?'secondary':'primary','1');
            }
            if(!r.success)throw new Error(r.error||'Could not start the link test.');
            this.update(await status());
        } catch(e) {ui.addNotification(null,E('p',{},[e.message]));}
        finally {this.testRequest=false;this.updatePriorityVitals();}
    },
    updatePriorityVitals: function() {
        var s=this.lastStatus||{}, c=s.config||{}, self=this;
        var inUse=s.active==='cell'?c.backup:s.active==='none'?null:c.primary;
        (this.priorityRefs||[]).forEach(function(r) {
            var v=[s.wan,s.cell].find(function(v) { return v && v.iface===r.name; }) || {};
            var known=!!s.running && typeof v.up==='boolean',healthy=known && v.up && v.health==='up';
            var lanMode=self.connectionKind(r.name)==='wan' && self.wanIsLan;
            var tests=s.link_tests||{},result=(tests.results||[]).filter(function(t){return t.iface===r.name;}).sort(function(a,b){return b.timestamp-a.timestamp;})[0];
            var activeTest=!!tests.running && ((result && result.role===tests.role) || tests.role===(r.index?'secondary':'primary'));
            var readiness=s.link_connections?.[r.name],ready=readiness?readiness.ready===true:v.up===true;
            r.testButton.disabled=!!self.testRequest || !!self.portBusy || lanMode || (!!tests.running && !activeTest) || (!activeTest && (self.primary.value!==c.primary || self.backup.value!==c.backup || !ready));
            r.testButton.textContent=activeTest?'Cancel Test':r.index?'Test Secondary':'Test Primary';
            linkResult.render(r.testResult,result?.phase==='completed'?{timestamp:result.timestamp,download:result.download_mbps,upload:result.upload_mbps,latency:result.latency_ms,server:result.server}:null,
                result&&result.phase!=='completed'?{message:result.phase==='failed'?result.error:result.phase==='cancelled'?'Test cancelled':result.phase==='download'?'Testing download…':result.phase==='upload'?'Testing upload…':'Finding an M-Lab server…',error:result.phase==='failed'}:null);
            r.health.style.display=lanMode?'none':'';
            r.lanAction.style.display=lanMode?'inline-flex':'none';
            r.lanAction.disabled=self.portBusy;
            var recovering=known && v.up && v.health==='down' && v.rtt!=='' && v.rtt!=null;
            r.health.className='fo-pill fo-uplink-status'+(lanMode?'':healthy?' online':known && (!v.up || v.health==='down') && !recovering?' offline':'');
            r.health.textContent=lanMode?'LAN mode':!known?'Not checked':!v.up?'Not connected':healthy?'Online':recovering?'Recovering':v.health==='down'?'No internet':'Checking…';
            r.active.classList.toggle('visible',!!c.enabled && !s.error && (s.active==='both' || inUse===r.name));
            r.detail.textContent=lanMode?'Tap LAN mode to use this socket for internet.':v.ip && v.ip!=='-' ? v.ip+(v.rtt?' · '+v.rtt+' ms':'') : self.connectionKind(r.name)==='wan'?'Connect your internet cable to WAN.':self.connectionKind(r.name)==='cell'?'Your mobile data connection.':r.name;
        });
    },
    updatePorts: function(map,role) {
        this.wanIsLan=!!role.enabled;
        this.portEntries.forEach(function(p) {
            var info=map[p.device]||{},on=info.carrier===true,rate=parseFloat((String(info.speed||'').match(/[0-9.]+/)||['0'])[0]),tier=!on?'offline':rate>=1000?'gigabit':rate>=100?'fast':'slow';
            p.node.className='misectel-dashboard-port-panel__port is-'+tier+' is-'+(on?'online':info.carrier===false?'offline':'warn')+(p.isWan?' is-switchable':'');
            p.label.textContent=p.isWan?(role.enabled?'LAN':'WAN'):p.name;
            p.speed.textContent=on?(rate>=1000?((rate/1000)%1?(rate/1000).toFixed(1):rate/1000)+'Gbps':rate?rate+'Mbps':'Connected'):'';
            p.node.title=p.isWan?(role.enabled?'This socket is LAN. Tap to make it WAN.':'This socket is WAN. Tap to make it LAN.'):(on?'Connected':'Not connected');
            if(p.isWan) { p.node.disabled=this.portBusy; p.node.setAttribute('aria-label',role.enabled?'Switch LAN Socket to WAN':'Switch WAN Socket to LAN'); }
        },this);
        this.wanNotice.style.display=role.enabled?'':'none';
        this.updatePriorityVitals();
    },
    toggleWanPort: async function() {
        if(this.portBusy)return;
        var c=(this.lastStatus||{}).config||{};
        var usesWan=(c.mode!=='cell' && this.connectionKind(c.primary)==='wan') || (c.mode!=='wan' && this.connectionKind(c.backup)==='wan');
        if(!this.wanIsLan && c.enabled && usesWan) {
            this.message.className='fo-result error'; this.message.textContent='Turn Failover off, or select a mode that uses only Cellular and save, before making this socket LAN.';
            ui.addNotification(null,E('p',{},[this.message.textContent])); return;
        }
        this.portBusy=true; this.portEntries.forEach(function(p) { if(p.isWan)p.node.disabled=true; }); this.updatePriorityVitals();
        try {
            var r=await setWanRole(this.wanIsLan?'0':'1');
            if(!r.success)throw new Error(r.message||'Could not change the socket role.');
            this.wanIsLan=!!r.enabled;
            if(this.lastStatus)this.lastStatus.wan_is_lan=!!r.enabled;
            this.portEntries.forEach(function(p) { if(p.isWan) { p.label.textContent=r.enabled?'LAN':'WAN'; p.node.setAttribute('aria-label',r.enabled?'Switch LAN Socket to WAN':'Switch WAN Socket to LAN'); } });
            this.wanNotice.style.display=r.enabled?'':'none';
        } catch(e) { ui.addNotification(null,E('p',{},[e.message])); }
        finally { this.portBusy=false; this.portEntries.forEach(function(p) { if(p.isWan)p.node.disabled=false; }); this.updatePriorityVitals(); }
    },
    update: function(s) {
        this.lastStatus=s;
        var c=s.config||{},enabled=!!c.enabled;
        this.wanNotice.style.display=s.wan_is_lan?'':'none';
        this.badge.className='fo-pill'+(enabled?' online':''); this.badge.textContent=enabled?'On':'Off';
        var active=s.active==='cell'?c.backup:c.primary;
        this.headline.textContent=!enabled?'Failover is off':!s.running?'Starting connection checks':s.error?'Connection setup needs attention':s.active==='both'?'Using both connections':s.active==='none'?'No internet connection':'Using '+this.connectionName(active);
        this.description.textContent=s.error||(!s.running?'Connection monitoring is stopped.':!enabled?'Arrange your connections below, then turn Failover on and save.':c.mode==='balance'?'Load Balance shares new IPv4 connections across both uplinks. If one fails, the healthy link carries new traffic.':c.mode==='auto'?'Returns to '+this.connectionName(c.primary)+' after '+c.recover_count+' healthy checks.':c.mode==='wan'?'Primary only is selected.':'Secondary only is selected.');
        function details(card,title,v) {
            v=v||{}; card.replaceChildren(E('h4',{},[title]),E('div',{'class':'fo-kv'},[
                E('span',{},['Interface']),E('span',{},[v.iface||'—']),E('span',{},['Device']),E('span',{},[v.dev==='-'?'—':v.dev||'—']),
                E('span',{},['IPv4']),E('span',{},[v.ip==='-'?'—':v.ip||'—']),E('span',{},['Gateway']),E('span',{},[v.gateway==='-'?'—':v.gateway||'—'])
            ]));
        }
        details(this.wanCard,'Primary · '+this.connectionName(c.primary),s.wan); details(this.cellCard,'Secondary · '+this.connectionName(c.backup),s.cell);
        this.events.textContent=(s.log||[]).slice().reverse().join('\n').replace(/switch: wan -> cell/g,'switch: Primary → Secondary').replace(/switch: cell -> wan/g,'switch: Secondary → Primary')||'No events yet.';
        this.updatePriorityVitals();
    },
    handleSaveApply:null,handleSave:null,handleReset:null
});
