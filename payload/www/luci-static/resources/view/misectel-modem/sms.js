'use strict';
'require view';
'require rpc';
'require dom';
'require misectel.modem as modemHelper';
'require qmodem.sms as smsService';
'require chester-ui.settings as kit';
const getStorage=rpc.declare({object:'qmodem_sms',method:'get_sms_storage',params:['config_section'],expect:{}});
const setStorage=rpc.declare({object:'qmodem_sms',method:'set_sms_storage',params:['config_section','mem1','mem2','mem3'],expect:{}});
function select(value){return E('select',{},[['ME','Modem Memory'],['SM','SIM Card']].map(([v,label])=>E('option',{value:v,selected:value===v?'selected':null},[label])));}
function content(m){return m.content||m.text||'';}
function sent(m){return ['sent','tx'].includes(String(m.type||m.direction||'').toLowerCase());}
return view.extend({
 load(){return modemHelper.loadModems();},
 message(text,error){this.feedback.textContent=text;this.feedback.className='sms-feedback'+(error?' is-error':'');this.feedback.hidden=false;},
 rememberDraft(){if(this.phone)this.draft={phone:this.phone.value,text:this.text.value};},
 async action(button,fn){button.disabled=true;try{await fn();}catch(e){this.message(e.message||String(e),true);}finally{button.disabled=false;}},
 async conversation(){
  const contact=this.contact,modem=this.modem,revision=++this.conversationRevision;
  if(!contact){dom.content(this.conversationNode,[kit.card('Conversation','Your messages appear here.',[E('div',{'class':'sms-empty'},[kit.icon('network'),E('strong',{},['Start a Conversation']),E('span',{},['Choose a conversation or write a new message.'])])],'network')]);return;}
  dom.content(this.conversationNode,[kit.card('Conversation',contact,[E('p',{'class':'st-muted'},['Loading messages…'])],'network')]);
  try{
   const result=await smsService.getConversation(modem,contact);if(revision!==this.conversationRevision||modem!==this.modem)return;
   const messages=result?.messages||result?.conversation||[];
   const bubbles=messages.map(m=>{const outgoing=sent(m),failed=outgoing&&m.is_success===false,id=m.id??m.index;
    const ids=Array.isArray(m.part_ids)&&m.part_ids.length?m.part_ids.filter(part=>part!=null):id!=null?[id]:[];
    return E('article',{'class':'sms-bubble'+(outgoing?' is-sent':'')+(failed?' is-failed':'')},[
     E('div',{'class':'sms-bubble-label'},[failed?'Not Sent':outgoing?'Sent':'Received']),E('p',{},[content(m)||'Empty message']),
     E('div',{'class':'sms-bubble-meta'},[E('time',{},[m.timestamp!=null?smsService.formatTimestamp(m.timestamp):'']),ids.length?kit.button('Delete',ev=>this.action(ev.currentTarget,async()=>{await smsService.deleteSms(modem,outgoing?'sent':'received',ids);await this.refresh();}),{'class':'sms-delete'}):''])
    ]);
   });
   const carrierBlock=messages.some(m=>!sent(m)&&/message blocking is active/i.test(content(m)));
   dom.content(this.conversationNode,[kit.card(contact,'Conversation',[
    carrierBlock?E('div',{'class':'sms-carrier-note'},['Carrier notice: message blocking is active on this SIM/account. Check SMS service with your carrier.']):'',
    E('div',{'class':'sms-messages'},bubbles.length?bubbles:[E('p',{'class':'st-muted'},['No messages in this conversation.'])])
   ],'network')]);
  }catch(e){if(revision===this.conversationRevision)dom.content(this.conversationNode,[kit.card('Conversation Unavailable',e.message||String(e),[],'network')]);}
 },
 compose(){
  this.phone=E('input',{type:'tel',value:this.draft?.phone||'',placeholder:'+1 555 123 4567',autocomplete:'tel'});
  this.text=E('textarea',{rows:5,placeholder:'Write your message…'},[this.draft?.text||'']);
  const counter=E('span',{'class':'st-muted'},[String(this.text.value.length)+' characters']);this.text.addEventListener('input',()=>{counter.textContent=this.text.value.length+' characters';this.rememberDraft();});this.phone.addEventListener('input',()=>this.rememberDraft());
  const send=kit.button('Send Message',ev=>this.action(ev.currentTarget,async()=>{
   const number=this.phone.value.trim(),text=this.text.value.trim(),modem=this.modem;
   if(!/^\+?[0-9][0-9 ()-]{2,24}$/.test(number))throw new Error('Enter a valid phone number.');if(!text)throw new Error('Write a message before sending.');if(text.length>2000)throw new Error('Keep your message under 2,000 characters.');
   const result=await smsService.sendSms(modem,number.replace(/[ ()-]/g,''),text,'16bit');if(!result?.success)throw new Error(result?.error||'The modem did not confirm sending the message.');
   this.draft={phone:number,text:''};this.contact=number.replace(/[ ()-]/g,'');this.text.value='';counter.textContent='0 characters';this.message('Message submitted to the modem'+(result.parts>1?' · '+result.parts+' parts':'')+'. Carrier delivery may vary.');await this.refresh();
  }));
  return kit.card('New Message','Send a text using the active SIM.',[kit.field('Phone Number',this.phone),kit.field('Message',this.text),E('div',{'class':'sms-compose-footer'},[counter,send])],'network');
 },
 storage(result){
  if(result?.error||!result?.success)return kit.card('Storage','Memory settings are unavailable.',[E('p',{'class':'st-muted'},[result?.error||'Refresh to try again.'])],'router');
  const s=result.storage||{},reading=select(s.mem1||'ME'),writing=select(s.mem2||'ME'),receiving=select(s.mem3||'ME');
  const apply=kit.button('Apply Storage Settings',ev=>this.action(ev.currentTarget,async()=>{const r=await setStorage(this.modem,reading.value,writing.value,receiving.value);if(r?.error||!r?.success)throw new Error(r?.error||'The modem did not apply the storage settings.');this.message('Storage settings applied.');await this.refresh();}),{'class':'st-button secondary'});
  return E('details',{'class':'st-card sms-storage'},[E('summary',{},['Storage Settings']),E('p',{'class':'st-muted'},['Choose where the modem reads, writes, and receives SMS.']),E('div',{'class':'st-fields'},[kit.field('Read Messages From',reading),kit.field('Save Sent Messages To',writing),kit.field('Receive Messages In',receiving)]),apply]);
 },
 async refresh(){
  this.rememberDraft();const modem=this.modem,revision=++this.revision;this.refreshButton.disabled=true;
  try{
   const [list,storage]=await Promise.all([smsService.listSms(modem),getStorage(modem).catch(e=>({error:e.message}))]);if(revision!==this.revision||modem!==this.modem)return;
   const conversations=list?.conversations||[],memory=storage.storage||{},used=memory[memory.mem1]?.used??0,total=memory[memory.mem1]?.total;
   if(!conversations.some(c=>c.contact===this.contact))this.contact=conversations[0]?.contact||null;
   dom.content(this.metrics,[kit.stat('Conversations',String(conversations.length),'network'),kit.stat('SMS Memory',storage.success?used+' / '+(total??'—'):'Unavailable','router'),kit.stat('Send With','Active SIM','shield')]);
   const contacts=conversations.map(item=>E('button',{type:'button','class':'sms-contact','aria-pressed':String(item.contact===this.contact),click:()=>{this.contact=item.contact;this.contacts.querySelectorAll('.sms-contact').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.contact===item.contact)));this.conversation();},'data-contact':item.contact},[
    E('span',{'class':'sms-avatar','aria-hidden':'true'},[kit.icon('network')]),E('span',{'class':'sms-contact-text'},[E('strong',{},[smsService.formatPhoneNumber(item.contact||'Unknown sender')]),E('small',{},[typeof item.last_message==='string'?item.last_message:content(item.last_message||{})||'View conversation'])]),E('span',{'class':'sms-chevron','aria-hidden':'true'},['›'])
   ]));
   this.contacts=E('div',{'class':'sms-contacts'},contacts.length?contacts:[E('div',{'class':'sms-empty'},[E('strong',{},['No Conversations Yet']),E('span',{},['Incoming texts will appear here.'])])]);
   dom.content(this.listNode,[kit.card('Messages','Choose a conversation to read its messages.',[this.contacts],'network'),this.compose()]);dom.content(this.storageNode,[this.storage(storage)]);await this.conversation();
  }catch(e){this.message(e.message||String(e),true);if(!this.listNode.children.length)dom.content(this.listNode,[this.compose()]);}finally{if(revision===this.revision)this.refreshButton.disabled=false;}
 },
 render(modems){
  this.revision=0;this.conversationRevision=0;this.modems=modems||[];this.modem=modemHelper.ensureSelected(null,this.modems);this.metrics=E('div',{'class':'st-summary'});this.feedback=E('div',{'class':'sms-feedback',role:'status','aria-live':'polite',hidden:true});this.listNode=E('div');this.conversationNode=E('div');this.storageNode=E('div');
  this.refreshButton=kit.button('Refresh Messages',()=>this.refresh(),{'class':'st-button secondary'});
  const selector=E('select',{},this.modems.map(m=>E('option',{value:m.id,selected:m.id===this.modem?'selected':null},[modemHelper.modemLabel(m)])));selector.addEventListener('change',()=>{this.rememberDraft();this.modem=selector.value;this.contact=null;this.refresh();});
  const page=kit.sheet([
   E('link',{rel:'stylesheet',href:L.resource('chester-ui/sms.css')+'?v=2'}),kit.head('SMS','Messages, made simple.','network'),this.metrics,this.feedback,
   E('div',{'class':'sms-toolbar'},[this.modems.length>1?kit.field('Modem',selector):E('span',{'class':'st-muted'},['Messages use the currently selected SIM.']),this.refreshButton]),
   this.modems.length?E('div',{'class':'st-columns sms-columns'},[this.listNode,E('div',{},[this.conversationNode,this.storageNode])]):kit.card('No Modem Detected','Connect a modem to read and send text messages.',[],'router')
  ],'st-sms');if(this.modems.length)this.refresh();return page;
 },handleSave:null,handleSaveApply:null,handleReset:null
});
