'use strict';
'require baseclass';
'require rpc';
'require poll';

const STORE='chester-update-progress-v1';
const STEPS=['Prepare Router','Download Firmware','Verify Firmware','Install & Restart','Reconnect','Confirm Update'];
const PHASE={queued:0,checking:0,preparing:0,downloading:1,verifying:2,verified:2,installing:3};
const HELP='A brief disconnect is expected. If this window doesn’t refresh, reconnect to the router’s Wi-Fi or LAN, then refresh the page.';
const MAX_AGE=45*60*1000;
let activeWindow=null;

function valid(options){
 return options&&['K43P','K45P'].includes(options.product)&&/^[0-9]{12}(?:[0-9]{2})?$/.test(options.build||'')&&/^[0-9]{1,5}$/.test(String(options.revision||''))&&/^[0-9a-f]{32}$/.test(options.id||'');
}
function makeID(){const bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
class Model{
 constructor(options){Object.assign(this,{stage:0,issued:false,accepted:false,complete:false,failed:false,recovering:false,offline:false,authorized:true,confirmations:0,wrongConfirmations:0,detail:'Preparing the update…',started:Date.now()},options);}
 job(job){
  if(!job||job.id!==this.id||this.complete)return;
  this.offline=false;this.accepted=true;
  if(job.phase==='failed'){this.failed=true;this.recovering=job.recovering===true;this.detail=job.message||'The update stopped.';return;}
  if(this.failed)return;
  if(PHASE[job.phase]!=null)this.stage=Math.max(this.stage,PHASE[job.phase]);
  if(typeof job.message==='string')this.detail=job.message;
 }
 disconnected(){if(!this.failed&&!this.complete)this.offline=true;}
 beacon(value){
  if(this.failed||this.complete||!this.issued||!this.boot||!value?.boot||value.boot===this.boot)return;
  if(value.product!==this.product){this.detail='Check that you are connected to the intended router.';return;}
  this.offline=false;this.stage=Math.max(this.stage,4);
  if(value.build!==this.build||String(value.revision)!==String(this.revision)){
   this.confirmations=0;if(++this.wrongConfirmations>=3){this.failed=true;this.detail='The router is back online, but the installed firmware does not match this update. Sign in before retrying.';}return;
  }
  this.wrongConfirmations=0;
  if(++this.confirmations>=3){this.stage=5;this.complete=true;this.detail='The installed firmware version has been confirmed.';}
  else if(this.confirmations>=2){this.stage=5;this.detail='Confirming the installed firmware version…';}
  else this.detail='The router is back online. Checking the installed firmware…';
 }
}
async function jsonRequest(url,options){
 const abort=new AbortController(),timer=window.setTimeout(()=>abort.abort(),4000);
 try{const response=await window.fetch(url,Object.assign({cache:'no-store',credentials:'same-origin',mode:'same-origin',redirect:'error',signal:abort.signal},options));if(!response.ok)throw new Error('The router is not responding.');return await response.json();}
 finally{window.clearTimeout(timer);}
}
function transport(){
 let serial=0;
 return {
  async exec(params){
   const result=await jsonRequest(rpc.getBaseURL(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++serial,method:'call',params:[rpc.getSessionID(),'file','exec',{command:'/usr/sbin/chester-update',params}]})});
   if(result.error||!Array.isArray(result.result)||result.result[0]!==0){const error=new Error('Update status requires a new sign-in.');error.authentication=true;throw error;}
   return result.result[1]||{};
  },
  async job(){const result=await this.exec(['job-status']);if(result.code!==0)throw new Error('Update status is unavailable.');return JSON.parse(result.stdout||'{}');},
  probe(){return jsonRequest('/cgi-bin/chester-update-status?check='+Date.now(),{credentials:'omit'});}
 };
}
function checkIcon(){const el=E('span',{class:'cup-check','aria-hidden':'true'});el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 4 4 8-8"/></svg>';return el;}
function powerIcon(){const el=E('span',{class:'cup-power-icon','aria-hidden':'true'});el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2v6m8-6v6M6 8h12v4a6 6 0 0 1-12 0zm6 10v4"/></svg>';return el;}
class Window{
 constructor(options){
  this.model=new Model(options);this.io=options.io||transport();this.onClose=options.onClose;this.closed=false;
  this.wasPolling=poll.active();poll.stop();
  this.previousFocus=document.activeElement;
  this.header=E('h2',{id:'chester-update-dialog-title'},'System Update');
  this.device=E('p',{class:'cup-device'},'Chester '+options.product+' · '+(options.product==='K45P'?'Rev. ':'BIN')+options.revision);
  this.title=E('h3');this.help=E('p',{class:'cup-help'},HELP);
  this.leaf=E('div',{class:'cup-emblem','aria-hidden':'true'},[E('img',{src:'/luci-static/misectel/green-leaf.svg',alt:'',width:70,height:70})]);
  this.segments=STEPS.map(()=>E('span',{class:'cup-segment'}));this.caption=E('p',{class:'cup-caption'});
  this.rows=STEPS.map(label=>({marker:E('span',{class:'cup-marker'},[checkIcon()]),label:E('span',{class:'cup-step-label'},label),status:E('span',{class:'cup-step-status'})}));
  for(const row of this.rows)row.root=E('li',{class:'cup-step'},[row.marker,row.label,row.status]);
  this.detail=E('p',{class:'cup-detail',role:'status','aria-live':'polite'});
  this.powerBar=E('div',{class:'cup-power'},[powerIcon(),E('strong',{},'Keep Your Router Powered On')]);
  this.footerText=E('span');this.footer=E('div',{class:'cup-footer'},[E('span',{class:'cup-spinner','aria-hidden':'true'}),this.footerText]);
  this.action=E('button',{type:'button',class:'cup-button',hidden:true,click:()=>this.actionClick()});
  this.dialog=E('section',{class:'cup-dialog',role:'dialog','aria-modal':'true','aria-labelledby':'chester-update-dialog-title',tabindex:'-1'},[
   E('div',{class:'cup-header'},[this.header,this.device]),this.leaf,this.title,this.help,
   E('div',{class:'cup-track'},this.segments),this.caption,E('ol',{class:'cup-steps'},this.rows.map(row=>row.root)),
   this.powerBar,this.detail,this.footer,this.action
  ]);
  this.overlay=E('div',{class:'cup-overlay'},[E('link',{rel:'stylesheet',href:L.resource('chester-ui/update-progress.css')+'?v=20261126-5'}),this.dialog]);
  this.layout=()=>this.overlay.style.setProperty('--cup-left',Math.max(0,document.querySelector('#maincontent')?.getBoundingClientRect().left||0)+'px');this.layout();window.addEventListener('resize',this.layout);
  document.body.appendChild(this.overlay);document.body.classList.add('chester-update-active');
  this.keyHandler=event=>{if(event.key==='Tab'){event.preventDefault();(this.action.hidden?this.dialog:this.action).focus();}if(event.key==='Escape')event.preventDefault();};
  this.overlay.addEventListener('keydown',this.keyHandler);this.dialog.focus();this.paint();
  this.baseline=options.boot?Promise.resolve():this.io.probe().then(value=>{if(value.product!==this.model.product||!value.boot)throw new Error('The router identity could not be read.');this.model.boot=value.boot;this.persist();});
  this.baseline.catch(()=>{});this.schedule(0);
 }
 persist(){if(this.model.preview)return;try{const m=this.model;window.sessionStorage.setItem(STORE,JSON.stringify({id:m.id,product:m.product,build:m.build,revision:m.revision,boot:m.boot,keep:m.keep,started:m.started,stage:m.stage,issued:m.issued,accepted:m.accepted}));}catch(e){}}
 schedule(delay){window.clearTimeout(this.timer);if(!this.closed)this.timer=window.setTimeout(()=>this.tick(),delay);}
 async install(){
  if(this.model.issued)return;
  try{await this.baseline;}catch(e){this.fail('The router status could not be read. The update has not started.');return;}
  this.model.issued=true;this.persist();
  try{const response=await this.io.exec(['install',this.model.id]);const text=(response.stdout||'').trim();if(response.code!==0||!text.startsWith('OK:'))this.fail(text||'The update could not be started.');else{this.model.accepted=true;this.persist();}}
  catch(e){if(e.authentication)this.fail('Sign in again before starting the update. The update has not started.');else{this.model.disconnected();this.model.detail='Checking whether the update started. Do not start another update.';}}
  this.paint();
 }
 fail(message){this.model.failed=true;this.model.recovering=false;this.model.detail=message;this.paint();}
 async tick(){
  if(this.closed||this.model.complete||this.model.failed&&!this.model.recovering)return;
  if(Date.now()-this.model.started>MAX_AGE){this.paused=true;this.model.detail='The update could not be confirmed. Reconnect to the router, refresh the page and sign in before retrying.';this.paint();return;}
  if(this.model.issued&&this.model.authorized){
   try{this.model.job(await this.io.job());}catch(e){if(e.authentication)this.model.authorized=false;this.model.disconnected();}
  }
  if(this.model.issued&&(this.model.stage>=3||this.model.offline)){
   try{this.model.beacon(await this.io.probe());}catch(e){this.model.disconnected();}
  }
  this.paint();this.persist();
  if(!this.model.complete&&(!this.model.failed||this.model.recovering))this.schedule(2500);
 }
 paint(){
  const m=this.model;
  this.overlay.dataset.state=m.complete?'complete':m.failed?(m.recovering?'recovering':'failed'):m.offline?'offline':'working';
  this.title.textContent=m.complete?'Update Confirmed':m.failed?(m.recovering?'Restoring Router Services':m.wrongConfirmations>=3?'Update Not Confirmed':'Update Stopped'):this.paused?'Check Your Connection':m.stage===3?'Installing & Restarting':m.stage===4?'Reconnecting':m.stage===5?'Confirming Update':['Preparing Your Router','Downloading Firmware','Verifying Firmware'][m.stage];
  this.help.textContent=m.complete?'The router is back online and the installed firmware matches this update.':m.failed?(m.recovering?'The update stopped. Restoring the optional services paused for the update.':'Review the status below before trying again. No update will be retried automatically.'):HELP;this.powerBar.hidden=m.complete;
  this.caption.textContent=m.complete?'All Steps Complete':'Step '+(m.stage+1)+' of 6';
  this.segments.forEach((segment,i)=>{segment.className='cup-segment'+(m.complete||i<m.stage?' is-done':i===m.stage?' is-current':'');});
  this.rows.forEach((row,i)=>{const done=m.complete||i<m.stage,current=!m.complete&&i===m.stage;row.root.className='cup-step'+(done?' is-done':current?' is-current':'');row.marker.className='cup-marker'+(done?' is-done':current?' is-current':'');row.status.textContent=done?'Complete':current?(m.failed?'Stopped':'In Progress'):'Waiting';});
  const custom=m.failed||this.paused||m.stage>=4||m.offline&&m.stage<3;
  this.detail.hidden=!custom;this.detail.textContent=custom?m.detail:'';
  this.footerText.textContent=m.complete?'Installed Version Verified':m.failed?(m.recovering?'Restoring Optional Services…':'No Automatic Retry Will Be Started'):this.paused?'Waiting for Your Connection':m.stage>=4?'Checking Installed Firmware…':m.stage===3?'Waiting for Your Router…':m.stage===2?'Checking Firmware Integrity…':m.stage===1?'Downloading Firmware…':'Preparing the Update…';
  this.action.hidden=!(m.complete||m.failed&&!m.recovering||this.paused);
  this.action.textContent=m.complete?'Continue to Router':this.paused?'Check Again':'Close';
 }
 actionClick(){if(this.paused){this.paused=false;this.model.started=Date.now();this.schedule(0);this.paint();return;}const complete=this.model.complete;this.close();if(complete)window.location.reload();}
 close(){this.closed=true;window.clearTimeout(this.timer);this.overlay.remove();window.removeEventListener('resize',this.layout);document.body.classList.remove('chester-update-active');try{window.sessionStorage.removeItem(STORE);}catch(e){}if(this.wasPolling)poll.start();if(this.previousFocus?.isConnected)this.previousFocus.focus();if(activeWindow===this)activeWindow=null;if(this.onClose)this.onClose();}
}
function open(options){if(activeWindow&&!activeWindow.closed)return activeWindow;const input=Object.assign({id:makeID(),keep:true},options);if(!valid(input))throw new Error('The verified release details are incomplete. Check for updates again.');activeWindow=new Window(input);return activeWindow;}
function resume(options){try{const saved=JSON.parse(window.sessionStorage.getItem(STORE)||'null');if(valid(saved)&&saved.issued&&Date.now()-saved.started<MAX_AGE&&saved.product===options.product)return open(Object.assign({},options,saved));window.sessionStorage.removeItem(STORE);}catch(e){}return null;}
return baseclass.extend({open,resume,makeID,createModel:options=>new Model(options),valid});
