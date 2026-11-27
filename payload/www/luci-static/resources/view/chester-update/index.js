'use strict';
'require view';
'require fs';
'require ui';
'require rpc';
'require dom';
'require chester-ui.settings as settings';
'require chester-ui.update-progress as progress';

const callUpdateSettings=rpc.declare({object:'misectel',method:'update_settings',expect:{}});
const callSetUpdateSettings=rpc.declare({object:'misectel',method:'set_update_settings',params:['auto','time','keep_settings'],expect:{}});
function decode(result){try{return JSON.parse(result.stdout||'{}');}catch(e){return {ok:false,error:'The router returned an unreadable update response.'};}}
function chooseRelease(app,firmware){
 if(firmware.ok===true&&firmware.manifest_checked===true&&firmware.update_available===true)return Object.assign({},app,firmware,{app_update:false,requires_firmware:false,error:''});
 if(firmware.ok!==true&&app.update_available!==true)return Object.assign({},app,{ok:false,manifest_checked:false,error:'The full firmware release could not be checked. Try again.'});
 return app;
}
function releaseNotes(value){
 const notes=Array.isArray(value)?value:typeof value==='string'?value.split(/\n+|\.\s+(?=[A-Z])/):[];
 return notes.filter(v=>typeof v==='string').map(v=>v.replace(/^\s*[-*#]+\s*/,'').replace(/\bBin\s+(\d+)/g,'Bin $1').trim()).filter(Boolean);
}
function versionLabel(info,prefix){if(info.app_update)return 'App Update '+(info[prefix+'_app']||0)+' · Firmware '+(info[prefix+'_bin']||'');const v=info[prefix+'_version'],bin=info[prefix+'_bin'];return v?('Version '+v+(bin?' · Bin '+bin:'')):'Not reported';}
function releaseDate(value){if(!value)return 'Not reported';const d=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00'):new Date(value);return isNaN(d.getTime())?String(value):d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}
function fileSize(value){const n=Number(value);return n>0?(n/1048576).toFixed(2)+' MiB':'Not reported';}
function line(label,value,extra){return E('div',{'class':'up-line'},[E('span',{'class':'st-muted'},[label]),E('strong',{'class':extra||''},[value||'Not Reported'])]);}
function infoCard(title,description,body,icon){return settings.card(title,description,body,icon);}

return view.extend({
 load(){return Promise.all([
  fs.exec('/usr/sbin/chester-update',['status-local']).then(decode).catch(()=>({ok:false,local_only:true,error:'Installed firmware details could not be read.'})),
  callUpdateSettings().catch(()=>({unavailable:true}))
 ]);},
 savePreferences(){
  if(this.preferencesUnavailable)return Promise.reject(new Error('Update options are unavailable. Reload the page before making changes.'));
  this.preferenceNote.textContent='Saving…';
  return callSetUpdateSettings(this.autoInput.checked?'1':'0',this.timeInput.value||'03:00',this.keepInput.checked?'1':'0').then(result=>{
   if(!result||result.success!==true)throw new Error(result?.message||'Could not save update options.');
   this.autoInput.checked=result.auto===true;this.keepInput.checked=result.keep_settings!==false;
   if(result.time)this.timeInput.value=result.time;
   this.timeInput.disabled=!this.autoInput.checked;
   this.preferenceNote.textContent=this.autoInput.checked?'Saved. Updates install at '+this.timeInput.value+' '+this.zone+'.':'Options saved.';
   return result;
  }).catch(error=>{this.preferenceNote.textContent=error.message||'Could not save options.';throw error;});
 },
 async checkForUpdates(){
  if(this.checking)return;
  this.checking=true;this.checkButton.disabled=true;this.checkButton.textContent='Checking…';this.installButton.disabled=true;
  this.paintStatus(this.info,true);
  try{
   const [app,firmware]=await Promise.all([
    fs.exec('/usr/sbin/chester-update',['status']).then(decode),
    fs.exec('/usr/sbin/chester-update',['firmware-status']).then(decode).catch(()=>({ok:false}))
   ]);
   const result=chooseRelease(app,firmware);
   this.info=Object.assign({},this.info,result);this.checkedAt=new Date();
  }catch(error){this.info=Object.assign({},this.info,{ok:false,local_only:false,manifest_checked:false,error:'The update service did not respond. Your installed firmware is unchanged.'});this.checkedAt=new Date();}
  finally{this.checking=false;this.checkButton.disabled=false;this.checkButton.textContent='Check for Updates';this.paintStatus(this.info,false);}
 },
 paintStatus(info,checking){
  const verified=!checking&&info.ok===true&&info.manifest_checked===true;
  const newer=verified&&info.update_available===true;
  this.pill.className='up-pill '+(checking?'is-checking':newer?'is-new':verified?'is-current':'is-unavailable');
  this.pill.textContent=checking?'Checking':newer?'Update available':verified?'Up to date':'Check unavailable';
  this.statusTitle.textContent=checking?'Checking for Updates…':newer?'A fresh update is ready.':verified?'Your software is up to date.':'We couldn’t check for updates.';
  this.statusCopy.textContent=info.requires_firmware?info.error:checking?'Looking for the latest published release for your K43P.':newer?versionLabel(info,'latest')+' is available for your router.':verified?'No newer K43P release is available.':(info.error==='offline'?'The router could not reach the update server.':info.error)||'Check your internet connection and try again.';
  this.installButton.hidden=!newer;this.installButton.disabled=!newer||this.preferencesUnavailable;
  this.footnoteNode.textContent=info.app_update?'App updates verify an independent signature, exact firmware compatibility and file checksums. An interrupted installation is rolled back at boot.':'Full firmware updates verify the image size, checksum and firmware format before installation. The router restarts to finish.';
  this.checkedNode.textContent=this.checkedAt?(verified?'Last checked ':'Last attempt ')+this.checkedAt.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'Updates are checked securely against the published release.';
  dom.content(this.installedBody,[E('div',{'class':'up-version'},[info.installed_version||'Reading details…']),line('Firmware',info.installed_bin?'BIN'+info.installed_bin:'Not Reported'),...(info.app_update?[line('App Revision',String(info.installed_app||0))]:[]),line('Built',releaseDate(info.installed_built)),line('OpenWrt',info.os_version),line('Kernel',info.kernel),line('Device',info.model||'Chester K43P')]);
  const latest=checking?[E('p',{'class':'st-muted up-checking'},['Checking the published release…'])]:verified?[
   E('div',{'class':'up-version'},[info.latest_version||'Not reported']),
   line('Firmware',info.latest_bin?'BIN'+info.latest_bin:'Not Reported'),...(info.app_update?[line('App Revision',String(info.latest_app||0)),line('Update Type','Signed App Update')]:[]),line('Released',releaseDate(info.latest_built)),line('Download Size',info.app_update&&Number(info.latest_app)===0?'Included in Firmware':fileSize(info.size)),
   line('Compatibility',info.release_board&&info.board&&info.release_board===info.board?'Matches this K43P':'Checked before installation')
  ]:[E('p',{'class':'st-muted'},['Release details will appear after a successful update check.']),settings.button('Try Again',()=>this.checkForUpdates(),{'class':'st-button secondary'})];
  dom.content(this.latestBody,latest);
  const notes=verified?releaseNotes(info.notes):[];
  this.changesSub.textContent=verified?versionLabel(info,'latest'):'Latest published release';
  dom.content(this.changesBody,checking?[E('p',{'class':'st-muted'},['Release notes are being checked.'])]:notes.length?[E('ul',{},notes.map(note=>E('li',{},[note])))]:[E('p',{'class':'st-muted'},[verified?'No release notes were supplied for this image.':'Check for updates to see what’s changed.'])]);
  dom.content(this.detailsBody,[line('Device',info.model||'Chester K43P'),line('Board',String(info.board||'').replace(/^misectel,/i,'').toUpperCase()),line('Installed Build',info.installed_build),line('Release Build',verified?info.latest_build:'Not checked'),line('Release Verification',verified?info.app_update?'Ed25519 Signature Verified':'K43P manifest checked':'Not checked'),line(info.app_update?'Package SHA-256':'Image SHA-256',verified?(info.app_update&&Number(info.latest_app)===0?'No Package Required':info.latest_sha):'Available after a successful check','up-hash')]);
 },
 render(data){
  this.info=data?.[0]||{};const prefs=data?.[1]||{};this.preferencesUnavailable=prefs.unavailable===true;this.zone=prefs.timezone||'UTC';
  this.keepInput=E('input',{type:'checkbox',checked:this.info.app_update||prefs.keep_settings!==false?'checked':null,disabled:this.preferencesUnavailable?'disabled':null});
  this.autoInput=E('input',{type:'checkbox',checked:prefs.auto===true?'checked':null,disabled:this.preferencesUnavailable?'disabled':null});
  this.timeInput=E('input',{type:'time',value:prefs.time||'03:00',disabled:this.preferencesUnavailable||prefs.auto!==true?'disabled':null,'aria-label':'Automatic Update Time'});
  this.autoInput.addEventListener('change',()=>{this.timeInput.disabled=!this.autoInput.checked;});
  this.preferenceNote=E('span',{'class':'st-muted','aria-live':'polite'},[this.preferencesUnavailable?'Update options could not be read. Reload to try again.':'Changes apply when you save.']);
  this.pill=E('span',{'class':'up-pill'});
  this.statusTitle=E('h3',{},['Checking for Updates…']);this.statusCopy=E('p',{'class':'st-muted'},[]);
  this.checkButton=settings.button('Check for Updates',()=>this.checkForUpdates(),{'class':'st-button secondary'});
  this.installButton=settings.button('Update Now',()=>this.handleInstall(this.keepInput.checked),{hidden:true});
  this.checkedNode=E('p',{'class':'st-muted up-checked'},[]);
  this.latestBody=E('div',{'class':'up-info-body'});this.changesBody=E('div',{'class':'up-notes'});this.changesSub=E('p',{'class':'st-muted'});this.detailsBody=E('div',{});
  this.installedBody=E('div',{});const installed=infoCard('Installed Firmware','Currently running on this router.',[this.installedBody],'router');
  this.footnoteNode=E('p',{'class':'st-muted up-footnote'});
  const latest=infoCard('Latest Release','Firmware for Chester K43P.',[this.latestBody],'shield');
  const changes=E('section',{'class':'st-card up-changes'},[E('div',{'class':'up-changes-head'},[settings.icon('plus'),E('div',{},[E('h3',{},['What’s Changed']),this.changesSub])]),this.changesBody]);
  const preferenceCard=infoCard('Update Options','Choose how updates are installed.',[
   E('div',{'class':'up-option-grid'},[settings.toggle('Keep My Settings',this.keepInput,'Preserve Wi-Fi, APN, passwords and router settings. App updates always preserve settings.'),
   settings.toggle('Automatic Updates',this.autoInput,'Install available K43P releases daily at the selected time.')]),
   E('div',{'class':'up-schedule'},[settings.field('Install At',this.timeInput,'Router timezone: '+this.zone)]),
   settings.footer(settings.button('Save Options',async ev=>{const b=ev.currentTarget;b.disabled=true;try{await this.savePreferences();}catch(e){}finally{b.disabled=this.preferencesUnavailable;}},{disabled:this.preferencesUnavailable?'disabled':null}),this.preferenceNote)
  ],'clock');
  const page=settings.sheet([
   E('link',{rel:'stylesheet',href:L.resource('chester-ui/update.css')+'?v=20261123-3'}),
   settings.head('System Update','The latest software. The same Chester experience.','shield'),
   E('section',{'class':'st-card up-hero','aria-live':'polite'},[E('div',{'class':'up-hero-copy'},[E('div',{'class':'up-hero-icon'},[E('img',{src:'/luci-static/misectel/green-leaf.svg',alt:'',width:38,height:38})]),E('div',{},[this.pill,this.statusTitle,this.statusCopy])]),E('div',{'class':'up-actions'},[this.checkButton,this.installButton])]),
   this.checkedNode,E('div',{'class':'up-columns'},[installed,latest]),changes,preferenceCard,
   E('details',{'class':'st-advanced up-details'},[E('summary',{},['Firmware Details']),this.detailsBody]),
   this.footnoteNode
  ],'up-page');
  this.paintStatus(this.info,true);const resumed=progress.resume({product:'K43P'});if(!resumed)Promise.resolve().then(()=>this.checkForUpdates());return page;
 },
 handleInstall(keep){
  ui.showModal('Update Firmware',[
   E('p',{},this.info.app_update?'The router will download a small signed app package, verify every changed file and restart. The kernel and calibration remain unchanged.':'The router will download, verify and install the firmware, then restart.'),
   E('p',{},keep?'Your saved router settings will be kept.':'Your saved settings, Wi-Fi name and password, APN and admin password will be erased.'),
   E('p',{},'Keep the router powered on. The status window will stay open while the router restarts.'),
   E('div',{class:'up-actions'},[
    settings.button('Cancel',()=>ui.hideModal(),{class:'st-button secondary'}),
    settings.button('Update Now',async()=>{
     ui.hideModal();let status;
     try{status=progress.open({product:'K43P',build:String(this.info.latest_build||''),revision:String(this.info.latest_bin||''),keep:this.info.app_update?true:keep,firmware:this.info.app_update===false});}
     catch(error){ui.showModal('Update Could Not Start',[E('p',{},error.message),settings.button('Close',()=>ui.hideModal())]);return;}
     try{await this.savePreferences();await status.install();}
     catch(error){status.fail(error.message||'Update options could not be saved. The update has not started.');}
    })
   ])
  ]);
 },

 handleSave:null,handleSaveApply:null,handleReset:null
});
