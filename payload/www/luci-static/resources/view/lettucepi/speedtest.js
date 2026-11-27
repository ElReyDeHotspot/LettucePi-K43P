'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require chester-ui.settings as kit';
var ooklaStatus=rpc.declare({object:'luci.lettucepi.speedtest',method:'status',expect:{}});
var ooklaHistory=rpc.declare({object:'luci.lettucepi.speedtest',method:'history',expect:{}});
var ooklaInstall=rpc.declare({object:'luci.lettucepi.speedtest',method:'install',expect:{}});
var ooklaStart=rpc.declare({object:'luci.lettucepi.speedtest',method:'start',expect:{}});
var ooklaCancel=rpc.declare({object:'luci.lettucepi.speedtest',method:'cancel',expect:{}});
var linkStatus=rpc.declare({object:'failover',method:'status',expect:{}});
var linkStart=rpc.declare({object:'failover',method:'test_start',params:['role','notice'],expect:{}});
var linkCancel=rpc.declare({object:'failover',method:'test_cancel',expect:{}});
var names={ookla:'Ookla',mlab:'M-Lab NDT',netflix:'Fast.com'};
function format(value){return Number.isFinite(value)?value.toFixed(1):'—';}
return view.extend({
 load:function(){return Promise.all([ooklaStatus(),ooklaHistory(),L.resolveDefault(linkStatus(),{})]);},
 render:function(data){
  var self=this;this.provider='mlab';this.data=data;this.busy=false;this.fastFrame=null;
  this.tabs=['mlab','netflix','ookla'].map(function(key){return E('button',{type:'button',role:'tab','aria-selected':String(key===self.provider),'aria-controls':'chester-speeds-panel',id:'chester-speeds-'+key,click:function(){self.choose(key);}},[key==='mlab'?'M-Lab':key==='ookla'?'Ookla':'Fast.com']);});
  this.heading=E('h3');this.scope=E('div',{'class':'sp-muted'});
  this.linkCards={};this.links=E('div',{class:'sp-link-grid'},['cellular','ethernet'].map(function(kind){
   var title=kind==='cellular'?'Cellular':'Ethernet',role=E('span',{class:'sp-link-role'}),health=E('span',{class:'sp-link-health'}),ip=E('span',{class:'sp-link-ip'}),phase=E('p',{class:'sp-link-phase','aria-live':'polite'}),date=E('small',{class:'sp-link-date'}),metrics={};
   var metricGrid=E('div',{class:'sp-link-metrics'},[['download_mbps','Download','Mbps'],['upload_mbps','Upload','Mbps'],['latency_ms','Latency','ms']].map(function(m){var value=E('strong',{},'—');metrics[m[0]]=value;return E('div',{},[E('span',{},m[1]),value,E('small',{},m[2])]);}));
   var ref={role:'',health:health,ip:ip,phase:phase,date:date,metrics:metrics,roleBadge:role};
   ref.button=E('button',{type:'button',class:'sp-start',click:function(){self.testLink(ref.role);}},'Test Speed');
   ref.node=E('section',{class:'sp-link-card','aria-label':title+' Speed Test'},[E('div',{class:'sp-link-head'},[kind==='cellular'?E('span',{class:'sp-link-glyph','aria-hidden':true},'5G'):kit.icon('port'),E('h4',{},title),role]),E('div',{class:'sp-link-connection'},[health,ip]),metricGrid,phase,date,ref.button]);
   self.linkCards[kind]=ref;return ref.node;
  }));
  this.startButton=E('button',{type:'button','class':'sp-start',click:ui.createHandlerFn(this,this.start)},['Run Speed Test']);
  this.cancelButton=E('button',{type:'button','class':'sp-cancel',click:ui.createHandlerFn(this,this.cancel)},['Cancel Test']);
  this.message=E('div',{'class':'sp-message','aria-live':'polite'});
  this.metrics={};this.metricGrid=E('div',{'class':'sp-metrics'});
  [['download','Download','Mbps'],['upload','Upload','Mbps'],['latency','Latency','ms'],['jitter','Jitter','ms']].forEach(function(m){var value=E('strong',{},['—']),node=E('div',{'class':'sp-metric'},[E('span',{},[m[1]]),value,E('small',{},[m[2]])]);self.metrics[m[0]]={value:value,node:node};self.metricGrid.append(node);});
  this.progressBar=E('div');this.progress=E('div',{'class':'sp-progress',role:'progressbar','aria-label':'Speed Test Progress','aria-valuemin':'0','aria-valuemax':'100'},[this.progressBar]);
  this.detail=E('div',{'class':'sp-details'});this.notice=E('p',{'class':'sp-muted sp-notice'});this.fastHost=E('div',{'class':'sp-fast'});
  this.history=E('div',{'class':'sp-history'});this.historyCard=E('details',{'class':'sp-history-card'},[E('summary',{},['Recent Results']),this.history]);
  var root=E('div',{'class':'lp-speedtest chester-ios chester-speeds'},[
   E('link',{rel:'stylesheet',href:L.resource('chester-ui/ios.css')+'?v=f78b876c6b61'}),
   E('link',{rel:'stylesheet',href:L.resource('chester-ui/speeds-links.css')+'?v=20261126-1'}),
   E('div',{'class':'sp-head'},[E('div',{'class':'ios-title',role:'heading','aria-level':'2'},['Chester Speeds']),E('p',{'class':'sp-muted'},['One place for your connection tests.'])]),
   E('div',{'class':'sp-tabs',role:'tablist','aria-label':'Speed Test Provider'},this.tabs),
   E('section',{id:'chester-speeds-panel',role:'tabpanel','class':'sp-panel'},[
    E('div',{'class':'sp-panel-head'},[E('div',{},[this.heading,this.scope]),E('div',{'class':'sp-actions'},[this.startButton,this.cancelButton])]),
    this.links,this.message,this.progress,this.metricGrid,this.detail,this.fastHost,this.notice
   ]),this.historyCard
  ]);
  this.update();poll.add(function(){return self.refresh();},2);return root;
 },
 nativeRunning:function(){var d=this.data||[];return !!((d[0]||{}).installing||(d[0]||{}).running||(((d[2]||{}).link_tests||{}).running));},
 choose:function(key){if(this.busy)return;this.closeFast();this.provider=key;this.error='';this.update();},
 closeFast:function(){if(this.fastFrame){this.fastFrame.remove();this.fastFrame=null;}},
 refresh:async function(){try{this.data=await Promise.all([ooklaStatus(),ooklaHistory(),L.resolveDefault(linkStatus(),{})]);this.update();}catch(e){this.message.textContent='Status is temporarily unavailable.';}},
 update:function(){
  var self=this,d=this.data||[],o=d[0]||{},f=d[2]||{},tests=f.link_tests||{},isOokla=this.provider==='ookla',isMlab=this.provider==='mlab',isNetflix=this.provider==='netflix';
  this.tabs.forEach(function(t,i){t.setAttribute('aria-selected',String(['mlab','netflix','ookla'][i]===self.provider));t.disabled=self.busy;});
  this.heading.textContent=names[this.provider];
  this.scope.textContent=isOokla?'From your router · current routing':isMlab?'From your router · one connection at a time':'From this device · Netflix servers';
  this.links.hidden=!isMlab;this.startButton.style.display=isMlab?'none':'';
  var c=f.config||{};this.updateLinks(f);
  var otherEngine=!isOokla&&o.running?'Ookla':!isMlab&&tests.running?'M-Lab':null;
  var result=isOokla?o:{};
  var running=isOokla?!!o.running:isMlab?!!tests.running:false;
  var activeRole=true;
  this.startButton.disabled=this.busy||this.nativeRunning();
  this.startButton.textContent=o.installing&&isOokla?'Installing Ookla…':isNetflix?(this.fastFrame?'Restart Test':'Run Fast.com Test'):isOokla&&!o.installed?'Install Ookla':'Run Speed Test';
  this.cancelButton.style.display=!isMlab&&(running||this.fastFrame)?'':'none';this.cancelButton.disabled=this.busy||(!activeRole&&!this.fastFrame);this.cancelButton.textContent=isNetflix?'Close Test':'Cancel Test';
  this.metricGrid.style.display=isOokla?'grid':'none';this.detail.style.display=isOokla?'grid':'none';this.metrics.jitter.node.style.display=isOokla?'':'none';this.metricGrid.style.gridTemplateColumns=isOokla?'':'repeat(3,minmax(0,1fr))';
  this.metrics.download.value.textContent=format(result.download_mbps);this.metrics.upload.value.textContent=format(result.upload_mbps);this.metrics.latency.value.textContent=format(result.latency_ms);this.metrics.jitter.value.textContent=format(result.jitter_ms);
  var phase=isOokla?o.test_phase:result.phase;
  this.message.className='sp-message'+(this.error||result.phase==='failed'?' error':'');
  this.message.textContent=this.error||o.install_error||(o.installing&&isOokla?'Installing the official Ookla engine…':isNetflix?(this.fastFrame?'The official FAST.com test is shown below.':'Ready to test Netflix performance.'):running?(!activeRole?'A test is running on the other connection.':phase==='download'?'Measuring download…':phase==='upload'?'Measuring upload…':phase==='ping'?'Measuring latency…':'Preparing your connection test…'):result.phase==='completed'?'Last test complete':result.phase==='cancelled'?'Test cancelled':result.phase==='failed'?'The test could not complete. Check this connection and try again.':'Ready to test');
  if(isMlab&&!this.error&&!otherEngine)this.message.textContent='';
  if(!this.error&&otherEngine)this.message.textContent=otherEngine+' test is running. Select its tab to view or cancel it.';
  this.progress.style.display=isOokla&&running?'':'none';var pct=isOokla?(phase==='upload'?50+50*(o.progress||0):phase==='download'?Math.max(4,50*(o.progress||0)):3):phase==='upload'?75:phase==='download'?25:3;this.progressBar.style.width=Math.min(100,pct)+'%';this.progress.setAttribute('aria-valuenow',String(Math.round(pct)));
  this.detail.replaceChildren();[['Server',result.server||'—'],['Test location',isOokla?(result.location||'Automatic'):'Selected Connection']].forEach(function(row){self.detail.append(E('div',{},[E('span',{},[row[0]]),E('strong',{},[row[1]])]));});
  if(isOokla&&result.result_url)this.detail.append(E('a',{href:result.result_url,target:'_blank',rel:'noopener noreferrer'},['View result on Speedtest.net']));
  this.notice.replaceChildren();this.notice.append(document.createTextNode(isOokla?'Runs on the router using the optional Ookla engine. Tests use internet data.':isMlab?'Runs on the selected router connection. M-Lab tests use data and publish the result and public IP address. ':'Loads Netflix’s official FAST.com test only when you press Run. This measures this device’s connection, including Wi-Fi or Ethernet. '));
  if(isMlab)this.notice.append(E('a',{href:'https://www.measurementlab.net/privacy/',target:'_blank',rel:'noopener noreferrer'},['M-Lab privacy policy']));
  if(isNetflix)this.notice.append(E('a',{href:'https://fast.com/',target:'_blank',rel:'noopener noreferrer'},['Open FAST.com separately']));
  this.historyCard.style.display=isOokla?'':'none';this.history.replaceChildren();var history=isOokla?((d[1]||{}).results||[]).slice().reverse().slice(0,5):(tests.results||[]).filter(function(r){return r.phase==='completed';}).sort(function(a,b){return b.timestamp-a.timestamp;});
  if(!history.length)this.history.append(E('p',{'class':'sp-muted'},['No completed tests yet.']));
  history.forEach(function(r){self.history.append(E('div',{'class':'sp-history-row'},[E('span',{},[r.timestamp?new Date(r.timestamp*1000).toLocaleString():'Recent test']),E('strong',{},[format(r.download_mbps)+' ↓ / '+format(r.upload_mbps)+' ↑ Mbps']),E('span',{'class':'sp-muted'},[r.server||names[self.provider]])]));});
 },
 updateLinks:function(f){
  var self=this,c=f.config||{},tests=f.link_tests||{},known=[f.wan,f.cell].filter(Boolean),cell=[c.primary,c.backup].find(function(x){return x&&x!=='wan';})||'pcie0';
  ['cellular','ethernet'].forEach(function(kind){var ref=self.linkCards[kind],iface=kind==='ethernet'?'wan':cell,v=known.find(function(x){return x.iface===iface;})||{},role=c.primary===iface?'primary':c.backup===iface?'secondary':'';
   ref.role=role;ref.roleBadge.textContent=role==='primary'?'Primary':role==='secondary'?'Secondary':'Not Assigned';ref.node.hidden=kind==='ethernet'&&(f.wan_is_lan===true||f.wan_is_lan==='1');
   ref.health.textContent=!v.up?'Not Connected':v.health==='down'?'No Internet':'Connected';ref.health.classList.toggle('is-connected',!!v.up&&v.health!=='down');ref.ip.textContent=v.ip&&v.ip!=='-'?v.ip:'';
   var result=(tests.results||[]).filter(function(x){return x.iface===iface;}).sort(function(a,b){return b.timestamp-a.timestamp;})[0]||{},active=!!tests.running&&tests.role===role;
   var readiness=f.link_connections?.[iface],ready=readiness?readiness.ready===true:v.up===true;
   ref.health.textContent=readiness?(ready?'Connected':'Not Connected'):ref.health.textContent;ref.health.classList.toggle('is-connected',ready&&v.health!=='down');
   ref.button.textContent=active?'Cancel Test':'Test Speed';ref.button.disabled=self.busy||!role||(!active&&(self.nativeRunning()||!ready));
   Object.keys(ref.metrics).forEach(function(k){ref.metrics[k].textContent=format(result[k]);});
   ref.phase.textContent=active?(result.phase==='upload'?'Testing Upload...':result.phase==='download'?'Testing Download...':'Preparing M-Lab Test...'):result.phase==='failed'?result.error||'The Test Could Not Complete.':result.phase==='cancelled'?'Test Cancelled':result.phase==='completed'?'Last Test Completed':'Ready to Test';
   ref.date.textContent=result.timestamp?'Last Test · '+new Date(result.timestamp*1000).toLocaleString():'';
  });
  this.links.classList.toggle('is-single',this.linkCards.ethernet.node.hidden);
 },
 testLink:async function(role){if(this.busy||!role)return;var tests=((this.data||[])[2]||{}).link_tests||{};if(this.nativeRunning()&&!(tests.running&&tests.role===role))return;this.busy=true;this.error='';this.update();try{var result=tests.running?await linkCancel():await linkStart(role,'1');if(result.error||result.success===false||result.ok===false)throw new Error(result.error||'Could Not Start the Test.');await this.refresh();}catch(e){this.error=e.message;}finally{this.busy=false;this.update();}},
 start:async function(){
  if(this.busy||this.nativeRunning())return;this.error='';
  if(this.provider==='ookla'&&!(this.data[0]||{}).installed){
   ui.showModal('Install Ookla',[
    E('p',{},['Download the official Ookla engine after reviewing the ',E('a',{href:'https://www.speedtest.net/apps/cli',target:'_blank',rel:'noopener noreferrer'},['Ookla CLI terms']),'.']),
    E('button',{class:'btn',click:ui.hideModal},['Cancel']),
    E('button',{class:'btn',click:async()=>{
     ui.hideModal();this.busy=true;this.update();
     try{var result=await ooklaInstall();if(result.ok===false||result.error)throw new Error(result.error||'Could not install the Ookla engine.');
     for(var attempt=0;attempt<110;attempt++){await this.refresh();var state=this.data[0]||{};if(state.installed)break;if(state.install_error)throw new Error(state.install_error);await new Promise(resolve=>window.setTimeout(resolve,1000));}
     if(!(this.data[0]||{}).installed)throw new Error('Installation is still pending. Check the Ookla tab again shortly.');}
     catch(e){this.error=e.message;}
     finally{this.busy=false;this.update();}
    }},['Accept & Install'])
   ]);
   return;
  }
  if(this.provider==='netflix'){this.closeFast();this.fastFrame=E('iframe',{src:'https://fast.com/',title:'Netflix FAST.com Speed Test',referrerpolicy:'no-referrer'});this.fastHost.replaceChildren(this.fastFrame);this.update();return;}
  this.busy=true;this.update();try{var r=this.provider==='ookla'?await ooklaStart():await linkStart('primary','1');if(r.error||(this.provider==='mlab'?!r.success:r.ok===false))throw new Error(r.error||'Could not start the test.');await this.refresh();}catch(e){this.error=e.message;}finally{this.busy=false;this.update();}
 },
 cancel:async function(){if(this.busy)return;if(this.provider==='netflix'){this.closeFast();this.update();return;}this.busy=true;this.update();try{if(this.provider==='ookla')await ooklaCancel();else await linkCancel();await this.refresh();}catch(e){this.error=e.message;}finally{this.busy=false;this.update();}},
 handleSaveApply:null,handleSave:null,handleReset:null
});
