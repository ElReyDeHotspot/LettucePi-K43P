'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require chester-ui.settings as kit';
const status=rpc.declare({object:'chester.ipv6',method:'status',expect:{}});
const save=rpc.declare({object:'chester.ipv6',method:'save',params:['settings'],expect:{}});
const test=rpc.declare({object:'chester.ipv6',method:'test',expect:{}});
const modes=[['auto','Automatic','Recommended'],['pd','Native DHCPv6-PD',''],['relay','Native /64 Relay',''],['nat66','NAT66',''],['disabled','Disabled','']];
const descriptions={auto:'Chooses delegated prefixes, shared /64 or NAT66 from the available cellular IPv6 connection.',pd:'Requests a delegated prefix from your carrier. Requires carrier DHCPv6-PD support.',relay:'Shares the cellular /64 with LAN devices using the appropriate modem-link configuration.',nat66:'Uses the local IPv6 prefix with outgoing IPv6 masquerading.',disabled:'Disables the cellular IPv6 interface and LAN IPv6 advertisements. IPv4 stays enabled.'};
const stateNames={passed:'Passed',failed:'Failed',partial:'Partial',unverified:'Not Verified',disabled:'Disabled'};
function settingsEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}
return view.extend({
 handleSave:null,handleSaveApply:null,handleReset:null,
 async load(){let result=await status();if(!result.success)throw new Error(result.error||'IPv6 status is unavailable.');this.data=result;this.settings=structuredClone(result.settings);this.original=structuredClone(this.settings);this.lastMode=result.last_mode||'auto';this.busy=false;},
 message(text){this.feedback.textContent=text;this.feedback.hidden=!text;},
 dirty(){return !settingsEqual(this.settings,this.original);},
 modeAvailable(mode){return !['pd','relay','nat66'].includes(mode)||!!this.data.capabilities?.[mode];},
 selectMode(mode){if(this.busy)return;if(mode!='disabled')this.lastMode=mode;this.settings.mode=mode;this.message('');this.sync();},
 switch(key,label){const input=E('input',{type:'checkbox',checked:this.settings[key]?'checked':null});input.addEventListener('change',()=>{this.settings[key]=input.checked;this.sync();});this.inputs[key]=input;return kit.toggle(label,input);},
 select(key,label,items){const input=E('select',{},items.map(([value,title])=>E('option',{value},title)));input.value=this.settings[key];input.addEventListener('change',()=>{this.settings[key]=input.value;this.sync();});this.inputs[key]=input;return E('div',{class:'i6-setting'},[E('label',{for:'i6-'+key},label),input]);},
 rows(entries){return E('dl',{class:'i6-rows'},entries.map(([label,node])=>E('div',{},[E('dt',{},label),E('dd',{},node)])));},
 async apply(){
  if(this.busy||!this.dirty())return;this.busy=true;this.message('Applying IPv6 Settings...');this.sync();
  try{const result=await save(JSON.stringify({settings:this.settings,revision:this.data.revision}));if(!result.success)throw new Error(result.error||'IPv6 could not be applied.');this.data=result;this.settings=structuredClone(result.settings);this.original=structuredClone(this.settings);this.lastMode=result.last_mode||this.lastMode;this.testResult=null;this.message('IPv6 Settings Applied.');}
  catch(e){this.message(e.message||String(e));}
  finally{this.busy=false;this.sync();}
 },
 async runTest(){if(this.busy||this.dirty())return;this.busy=true;this.message('Testing IPv6 Connection...');this.sync();try{const result=await test();if(!result.success)throw new Error(result.error||'The connection test failed.');this.testResult=result;this.data.last_test=result;this.message(result.ok?'IPv6 Connection Test Passed.':'Review the connection checks below.');}catch(e){this.message(e.message||String(e));}finally{this.busy=false;this.sync();}},
 renderChecks(){const result=this.testResult||this.data.last_test,checks=result?.checks||[];const order=[['wan','WAN IPv6 Connectivity'],['route','IPv6 Default Route'],['lan','LAN IPv6 Addressing'],['dns','IPv6 DNS Resolution'],['forward','IPv6 Forwarding'],['mtu','Path MTU Discovery']];dom.content(this.checks,order.map(([id,label])=>{let check=checks.find(c=>c.id===id),state=check?.state||'unverified';return E('div',{class:'i6-check'},[kit.icon(check?.state==='passed'?'check':'network'),E('div',{},[E('strong',{},label),E('span',{class:'i6-badge '+(state==='passed'?'is-passed':'')},check?stateNames[state]||'Not Verified':'Not Tested'),E('small',{},check?.detail||'Run Test Connection to check this item.')])]);}));},
 sync(){
  const s=this.settings,disabled=s.mode==='disabled',relay=false;
  this.enableButton.setAttribute('aria-pressed',String(!disabled));this.disableButton.setAttribute('aria-pressed',String(disabled));this.enableButton.disabled=this.disableButton.disabled=this.busy;
  this.accessBadge.textContent=this.dirty()?'Pending Apply':disabled?'Disabled':'Enabled';
  this.refreshModes();
  this.modeButtons.forEach((button,index)=>{button.setAttribute('aria-checked',String(this.visibleModes[index][0]===s.mode));button.disabled=this.busy;});
  this.modeNote.textContent=descriptions[s.mode];
  for(const [key,input] of Object.entries(this.inputs)){input.disabled=this.busy||(relay&&['slaac','dhcpv6','prefix','dns'].includes(key));if(input.type==='checkbox')input.checked=!!s[key];else input.value=s[key];}
  this.manualDNS.hidden=s.dns!='manual'||relay;this.dnsInput.disabled=this.busy;this.dnsInput.value=s.custom_dns.join(', ');
  this.securityNote.hidden=s.firewall;this.slaacNote.hidden=s.slaac||disabled||relay;
  this.wanAddress.textContent=this.data.upstream_address||'Not Available';this.prefix.textContent=this.data.delegated_prefix||'Not Delegated';
  this.active.textContent=modes.find(m=>m[0]===this.data.active_mode)?.[1]||'Waiting for IPv6';this.delegation.textContent=this.data.prefix_delegation||'Not Available';
  this.connectionBadge.textContent=this.data.upstream_up&&this.data.upstream_address?'Connected':'Disconnected';
  this.saveButton.disabled=this.busy||!this.dirty();this.saveButton.textContent=this.busy?'Working...':'Save & Apply';this.testButton.disabled=this.busy||this.dirty();
  this.pending.textContent=this.dirty()?'Save & Apply to Test Your Changes.':'';this.pending.hidden=!this.dirty();this.renderChecks();
 },
 refreshModes(){
  const visible=modes.filter(([mode])=>this.modeAvailable(mode)||mode===this.settings.mode),key=visible.map(m=>m[0]).join(',');
  if(this.modeKey===key)return;this.modeKey=key;this.visibleModes=visible;
  this.modeButtons=visible.map(([mode,label,recommended])=>kit.button('',()=>this.selectMode(mode),{class:'i6-mode',role:'radio','aria-checked':String(mode===this.settings.mode)}));
  this.modeButtons.forEach((button,index)=>dom.content(button,[E('span',{class:'i6-radio','aria-hidden':true}),E('strong',{},visible[index][1]),visible[index][2]?E('small',{class:'i6-badge'},visible[index][2]):'']));
  dom.content(this.modeContainer,this.modeButtons);
 },
 render(){
  this.inputs={};this.accessBadge=E('span',{class:'i6-badge'});this.connectionBadge=E('span',{class:'i6-badge'});
  this.enableButton=kit.button('Enable',()=>this.selectMode(this.settings.mode==='disabled'?(this.modeAvailable(this.lastMode)?this.lastMode:'auto'):this.settings.mode),{class:'st-button secondary'});
  this.disableButton=kit.button('Disable',()=>this.selectMode('disabled'),{class:'st-button secondary'});
  const access=E('section',{class:'st-card i6-access'},[E('div',{class:'i6-access-title'},[kit.icon('network'),E('strong',{},'IPv6 Management'),this.connectionBadge]),E('div',{class:'i6-access-controls'},[this.accessBadge,E('div',{class:'i6-segment'},[this.enableButton,this.disableButton])])]);
  this.modeContainer=E('div',{class:'i6-modes',role:'radiogroup','aria-label':'IPv6 Connection Mode'});
  this.wanAddress=E('span');this.prefix=E('span');this.active=E('span');this.delegation=E('span');this.modeNote=E('p',{class:'st-muted i6-note'});
  const modeCard=kit.card('Connection Mode',null,[this.modeContainer,this.modeNote,E('div',{class:'i6-inset'},[this.rows([['WAN IPv6 Address',this.wanAddress],['Delegated Prefix',this.prefix],['Active Mode',this.active],['Prefix Delegation',this.delegation]])])],'network');
  const slaac=this.switch('slaac','Enable SLAAC');
  const dhcp=this.select('dhcpv6','DHCPv6 Mode',[['disabled','Disabled'],['stateless','Stateless'],['stateful','Stateful']]);this.inputs.dhcpv6.id='i6-dhcpv6';
  const prefix=this.select('prefix','Requested Prefix',[['auto','Automatic'],['48','/48'],['56','/56'],['60','/60'],['64','/64']]);this.inputs.prefix.id='i6-prefix';
  const dns=this.select('dns','IPv6 DNS',[['auto','Automatic'],['cloudflare','Cloudflare'],['google','Google'],['quad9','Quad9'],['manual','Manual']]);this.inputs.dns.id='i6-dns';
  this.dnsInput=E('input',{type:'text',placeholder:'2606:4700:4700::1111',autocomplete:'off'});this.dnsInput.addEventListener('input',()=>{this.settings.custom_dns=this.dnsInput.value.split(/[\s,]+/).filter(Boolean);this.saveButton.disabled=this.busy||!this.dirty();this.testButton.disabled=true;this.pending.hidden=false;this.pending.textContent='Save & Apply to Test Your Changes.';});
  this.manualDNS=kit.field('IPv6 DNS Servers',this.dnsInput,'Separate Addresses with Commas.');this.slaacNote=E('p',{class:'st-muted i6-note'},'Some devices require SLAAC. Stateful DHCPv6 must be enabled when SLAAC is off.');
  const lanCard=kit.card('LAN Configuration',null,[slaac,dhcp,prefix,dns,this.manualDNS,this.slaacNote],'network');
  this.securityNote=E('p',{class:'st-muted i6-note'},'Unsolicited IPv6 traffic from WAN to LAN will be allowed. Router administration remains protected.');
  const security=kit.card('Security & Reliability',null,[this.switch('firewall','IPv6 Stateful Firewall'),this.switch('recovery','Automatic IPv6 Recovery'),this.securityNote],'shield');
  this.checks=E('div',{class:'i6-checks'});const diagnostics=kit.card('Connectivity Diagnostics',null,[this.checks,E('p',{class:'st-muted i6-scope'},'Checks this router and its LAN-source path. Use a connected device to verify its own IPv6 connection.')],'network');
  this.feedback=E('div',{class:'i6-feedback',role:'status','aria-live':'polite',hidden:true});this.pending=E('p',{class:'st-muted i6-pending',hidden:true});
  this.testButton=kit.button('Test Connection',()=>this.runTest(),{class:'st-button secondary'});this.saveButton=kit.button('Save & Apply',()=>this.apply());
  const root=kit.sheet([E('link',{rel:'stylesheet',href:L.resource('chester-ui/ipv6.css')+'?v=20261125-1'}),kit.head('IPv6','Connection, Addressing & Diagnostics','network'),access,E('div',{class:'i6-columns'},[modeCard,E('div',{class:'i6-stack'},[lanCard,security])]),diagnostics,this.feedback,this.pending,E('div',{class:'i6-actions'},[this.testButton,this.saveButton])],'st-ipv6');
  this.sync();poll.add(async()=>{if(this.busy||this.dirty()||document.hidden||!root.isConnected)return;try{const data=await status();if(data.success){this.data=data;this.settings=structuredClone(data.settings);this.original=structuredClone(this.settings);this.sync();}}catch(e){}},10);return root;
 }
});
