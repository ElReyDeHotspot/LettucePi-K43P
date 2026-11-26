'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require chester-ui.settings as kit';
const getStatus=rpc.declare({object:'chester.mtu',method:'status',expect:{}});
const saveSettings=rpc.declare({object:'chester.mtu',method:'save',params:['settings'],expect:{}});
const startTest=rpc.declare({object:'chester.mtu',method:'test',expect:{}});
const recommended={mtu_mode:'smart',mtu:1500,mss_enabled:true,mss_mode:'auto',mss4:1460,mss6:1440};
function clone(value){return structuredClone(value);}
function equal(a,b){return Object.keys(recommended).every(k=>a[k]===b[k]);}
return view.extend({
 handleSave:null,handleSaveApply:null,handleReset:null,
 async load(){const data=await getStatus();if(!data.success)throw new Error(data.error||'MTU status is unavailable.');this.data=data;this.settings=clone(data.settings);this.original=clone(this.settings);this.busy=false;this.testing=data.test?.state==='running';},
 dirty(){return !equal(this.settings,this.original);},
 message(text){this.feedback.textContent=text;this.feedback.hidden=!text;},
 segment(items,choose){return E('div',{class:'mt-segment'},items.map(([value,label])=>kit.button(label,()=>{if(this.busy||this.testing)return;choose(value);this.message('');this.sync();},{class:'st-button secondary','data-value':String(value)})));},
 selectMode(mode){this.settings.mtu_mode=mode;if(mode==='smart'){this.settings.mss_enabled=true;this.settings.mss_mode='auto';}this.limitMSS();},
 limitMSS(){const limit=this.settings.mtu_mode==='custom'?this.settings.mtu:this.data.automatic_mtu;if(limit>=1280&&limit<=1500){this.settings.mss4=Math.min(this.settings.mss4,limit-40);this.settings.mss6=Math.min(this.settings.mss6,limit-60);}},
 async apply(){if(this.busy||this.testing||!this.dirty())return;this.busy=true;this.message('Applying MTU & MSS...');this.sync();try{const data=await saveSettings(JSON.stringify({settings:this.settings,revision:this.data.revision}));if(!data.success)throw new Error(data.error||'Settings could not be applied.');this.data=data;this.settings=clone(data.settings);this.original=clone(this.settings);this.testing=data.test?.state==='running';this.message(this.testing?'Smart Mode Is Checking IPv4 & IPv6...':'MTU & MSS Applied.');}catch(e){this.message(e.message||String(e));}finally{this.busy=false;this.sync();}},
 restore(){if(this.busy||this.testing)return;this.settings=clone(recommended);this.limitMSS();this.message('Smart Settings Selected. Save & Apply to Use Them.');this.sync();},
 async runTest(){if(this.busy||this.testing||this.dirty())return;this.busy=true;this.sync();try{const result=await startTest();if(!result.success)throw new Error(result.error||'The MTU test could not start.');this.testing=true;this.data.test={state:'running',token:result.token};this.message('Testing MTU on IPv4 & IPv6...');}catch(e){this.message(e.message||String(e));}finally{this.busy=false;this.sync();}},
 renderTest(){const test=this.data.test||{},checks=test.checks||[];dom.content(this.results,[4,6].map(family=>{const item=checks.find(x=>x.family===family);let label='Not Tested',detail='';if(test.state==='running')label='Testing...';else if(item?.verified_bytes){label=item.verified_bytes+' Bytes Verified';detail=item.detail;}else if(item){label=item.state==='unverified'?'Not Verified':'Inconclusive';detail=item.detail;}else if(test.state==='failed'){label='Not Verified';detail=test.error||'Retry when the cellular connection is stable.';}return E('div',{class:'mt-result'},[E('strong',{},'IPv'+family),E('span',{class:item?.verified_bytes?'is-verified':''},label),detail?E('small',{},detail):'']);}));},
 sync(){
  const s=this.settings,locked=this.busy||this.testing;
  for(const [segment,value] of [[this.mtuSegment,s.mtu_mode],[this.enableSegment,String(s.mss_enabled)]])for(const button of segment.querySelectorAll('button')){button.setAttribute('aria-pressed',String(button.dataset.value===value));button.disabled=locked;}
  this.mtuInput.disabled=locked||s.mtu_mode!=='custom';this.mtuInput.value=s.mtu_mode==='custom'?s.mtu:s.mtu_mode==='smart'&&this.data.settings.mtu_mode==='smart'?this.data.current_mtu:this.data.automatic_mtu;this.mtuInput.setAttribute('aria-label','Custom MTU');
  this.modeInput.value=s.mss_mode;this.modeInput.disabled=locked||!s.mss_enabled||s.mtu_mode==='smart';for(const button of this.enableSegment.querySelectorAll('button'))button.disabled=locked||s.mtu_mode==='smart';
  this.mss4Input.value=s.mss4;this.mss6Input.value=s.mss6;this.mss4Input.disabled=this.mss6Input.disabled=locked||!s.mss_enabled||s.mss_mode!=='custom';
  const limit=s.mtu_mode==='custom'?s.mtu:s.mtu_mode==='smart'&&this.data.settings.mtu_mode==='smart'?this.data.current_mtu:this.data.automatic_mtu;this.mss4Input.max=limit-40;this.mss6Input.max=limit-60;
  this.mss4Value.textContent=!s.mss_enabled?'Disabled':s.mss_mode==='auto'?'Automatic':s.mss4+' Bytes';this.mss6Value.textContent=!s.mss_enabled?'Disabled':s.mss_mode==='auto'?'Automatic':s.mss6+' Bytes';
  this.mtuHelp.textContent=s.mtu_mode==='smart'?'Recommended: Smart Uses Carrier Limits & Verified Packet Tests. Automatic MSS Is Included.':'Automatic Uses the Network Default.';this.smartReason.textContent=s.mtu_mode==='smart'?(this.testing?'Optimizing...':this.data.settings.mtu_mode==='smart'?this.data.smart_reason:'Checks Run After Save & Apply'):'';this.smartReason.hidden=s.mtu_mode!=='smart';
  this.mtuValue.textContent=this.data.current_mtu||'Unavailable';this.mssValue.textContent=this.data.conflict?'Review Settings':!this.data.settings.mss_enabled?'Disabled':this.data.settings.mss_mode==='auto'?'Automatic':'Custom';
  this.restoreButton.disabled=locked;this.saveButton.disabled=locked||!this.dirty();this.saveButton.textContent=this.busy?'Applying...':'Save & Apply';
  this.testButton.disabled=locked||this.dirty()||!this.data.online;this.testButton.textContent=this.testing?'Testing...':'Test MTU';
  this.pending.textContent=this.data.conflict?'Zone-wide MSS Clamping Was Changed Elsewhere. Save This Page to Reconcile It.':this.dirty()?'Save & Apply Before Testing Your Changes.':'';this.pending.hidden=!this.pending.textContent;this.renderTest();
 },
 render(){
  this.mtuValue=E('strong');this.mssValue=E('strong');
  const summary=E('section',{class:'st-card mt-summary'},[kit.icon('network'),E('div',{class:'mt-summary-item'},[E('span',{},'Current MTU'),this.mtuValue,E('small',{},'Bytes')]),E('div',{class:'mt-summary-item'},[E('span',{},'TCP MSS'),this.mssValue,E('small',{},'Cellular Connection')])]);
  this.mtuSegment=this.segment([['auto','Automatic'],['smart','Smart'],['custom','Custom']],value=>this.selectMode(value));
  this.mtuInput=E('input',{type:'number',min:1280,max:1500,step:1,inputmode:'numeric',id:'mt-custom'});this.mtuInput.addEventListener('input',()=>{this.settings.mtu=Number(this.mtuInput.value);this.saveButton.disabled=this.busy||!this.dirty();this.testButton.disabled=true;});this.mtuInput.addEventListener('change',()=>{this.limitMSS();this.sync();});
  this.mtuHelp=E('p',{class:'st-muted mt-help'});this.smartReason=E('p',{class:'mt-smart-reason'});
  const mtu=kit.card('MTU','Set the packet size for your cellular connection.',[this.mtuSegment,E('div',{class:'mt-field-row'},[E('label',{for:'mt-custom'},'Custom MTU'),this.mtuInput,E('span',{},'Bytes')]),this.mtuHelp,this.smartReason,E('div',{class:'mt-inset mt-shared'},[E('strong',{},'IPv4 & IPv6'),E('span',{class:'mt-pill'},'Shared Setting')])]);
  this.enableSegment=this.segment([['true','Enable'],['false','Disable']],value=>{this.settings.mss_enabled=value==='true';});
  this.modeInput=E('select',{id:'mt-mss-mode'},[E('option',{value:'auto'},'Automatic'),E('option',{value:'custom'},'Custom')]);this.modeInput.addEventListener('change',()=>{this.settings.mss_mode=this.modeInput.value;this.limitMSS();if(this.settings.mss_mode==='custom')this.advanced.open=true;this.sync();});
  this.mss4Value=E('span');this.mss6Value=E('span');
  this.mss4Input=E('input',{type:'number',min:536,step:1,inputmode:'numeric'});this.mss6Input=E('input',{type:'number',min:536,step:1,inputmode:'numeric'});
  for(const [input,key] of [[this.mss4Input,'mss4'],[this.mss6Input,'mss6']])input.addEventListener('input',()=>{this.settings[key]=Number(input.value);this.saveButton.disabled=this.busy||!this.dirty();this.testButton.disabled=true;});
  this.advanced=E('details',{class:'mt-advanced',open:this.settings.mss_mode==='custom'?'open':null},[E('summary',{},'Advanced'),E('div',{class:'mt-manual-grid'},[kit.field('IPv4 MSS',this.mss4Input),kit.field('IPv6 MSS',this.mss6Input)]),E('p',{class:'st-muted mt-help'},'Custom Limits Only Reduce TCP MSS. They Must Fit the Selected MTU.')]);
  const mss=kit.card('TCP MSS Clamping','Help TCP connections fit the network path.',[this.enableSegment,E('div',{class:'mt-mode-row'},[E('label',{for:'mt-mss-mode'},'Clamping Mode'),this.modeInput]),E('div',{class:'mt-result-chips'},[E('div',{class:'mt-inset'},[E('strong',{},'IPv4'),this.mss4Value]),E('div',{class:'mt-inset'},[E('strong',{},'IPv6'),this.mss6Value])]),this.advanced,E('p',{class:'st-muted mt-help'},'TCP Traffic Only; UDP & QUIC Are Unaffected.')]);
  this.results=E('div',{class:'mt-results'});this.testButton=kit.button('Test MTU',()=>this.runTest(),{class:'st-button secondary mt-test-button'});
  const diagnostics=E('section',{class:'st-card mt-test-card'},[E('div',{class:'mt-test-head'},[E('h3',{},'MTU Test'),this.testButton]),this.results,E('p',{class:'st-muted mt-help'},'Tests One Destination per IP Version; Other Paths May Differ.')]);
  this.feedback=E('div',{class:'mt-feedback',role:'status','aria-live':'polite',hidden:true});this.pending=E('p',{class:'st-muted mt-pending',hidden:true});
  this.restoreButton=kit.button('Restore Recommended',()=>this.restore(),{class:'st-button secondary'});this.saveButton=kit.button('Save & Apply',()=>this.apply());
  const root=kit.sheet([E('link',{rel:'stylesheet',href:L.resource('chester-ui/mtu.css')+'?v=20261126-2'}),kit.head('MTU & MSS','Packet Size & TCP Compatibility'),summary,E('div',{class:'mt-columns'},[mtu,mss]),diagnostics,this.feedback,this.pending,E('div',{class:'mt-actions'},[this.restoreButton,this.saveButton])],'st-mtu');
  this.sync();let ticks=0;poll.add(async()=>{if(this.busy||document.hidden||!root.isConnected||this.dirty())return;if(!this.testing&&++ticks%10!==0)return;try{const data=await getStatus();if(!data.success)return;const wasTesting=this.testing;this.data=data;this.settings=clone(data.settings);this.original=clone(this.settings);this.testing=data.test?.state==='running';if(wasTesting&&!this.testing)this.message(data.test?.state==='complete'?'MTU Test Finished. Review the IPv4 & IPv6 Results.':data.test?.error||'The MTU Test Could Not Finish.');this.sync();}catch(e){if(this.testing)this.message('Waiting for the Router to Return the Test Results...');}},1);return root;
 }
});
