'use strict';'require view';'require poll';'require rpc';'require uci';'require dom';'require misectel.ui as misectel';'require misectel.modem as modemHelper';'require misectel.clients as clients';const REFRESH_INTERVAL=15;const MODEM_RPC_TIMEOUT=3000;const DASHBOARD_CSS_ID='misectel-dashboard-css';const DASHBOARD_CSS_URL=L.resource('misectel-dashboard/dashboard.css');const METRIC_HISTORY_LIMIT=24;const SETUP_URL=L.url('setup');const PASSWORD_SETTINGS_URL=L.url('admin','system','settings','admin');const MODEM_STATUS_URL=L.url('admin','modem','cellular-info');const NETWORK_SETTINGS_URL=L.url('admin','network','settings');const WIFI_SETTINGS_URL=L.url('admin','network','wifi');const CLIENTS_URL=L.url('admin','dashboard','clients');const callSystemBoard=rpc.declare({object:'system',method:'board',expect:{}});const callSystemInfo=rpc.declare({object:'system',method:'info',expect:{}});const callCPUInfo=rpc.declare({object:'luci',method:'getCPUInfo',expect:{}});const callCPUUsage=rpc.declare({object:'luci',method:'getCPUUsage',expect:{}});const callTempInfo=rpc.declare({object:'luci',method:'getTempInfo',expect:{}});const callBuiltinEthernetPorts=rpc.declare({object:'luci',method:'getBuiltinEthernetPorts',expect:{result:[]}});const callTcpConnections=rpc.declare({object:'misectel',method:'tcp_connections',expect:{}});const callInternetStatus=rpc.declare({object:'misectel',method:'internet_status',expect:{}});const callConfiguredTempStatus=rpc.declare({object:'misectel',method:'temp_status',params:['node'],expect:{}});const callSystemTime=rpc.declare({object:'misectel',method:'system_time',expect:{}});const callOemModelName=rpc.declare({object:'misectel',method:'oem_model_name',expect:{}});const callLedPower=rpc.declare({object:'misectel',method:'led_power',expect:{}});const callSetLedPower=rpc.declare({object:'misectel',method:'set_led_power',params:['enabled'],expect:{}});const callModemTemp=rpc.declare({object:'misectel',method:'modem_temp',expect:{}});const callTtlStatus=rpc.declare({object:'misectel',method:'ttl_status',expect:{}});const callSetTtl=rpc.declare({object:'misectel',method:'set_ttl',params:['enabled'],expect:{}});const callVideoEngine=rpc.declare({object:'misectel',method:'video_engine',expect:{}});const callSetVideoEngine=rpc.declare({object:'misectel',method:'set_video_engine',params:['enabled'],expect:{}});const callWanToLan=rpc.declare({object:'misectel',method:'wan_to_lan',expect:{}});const callSetWanToLan=rpc.declare({object:'misectel',method:'set_wan_to_lan',params:['enabled'],expect:{}});const callNetworkDeviceStatus=rpc.declare({object:'network.device',method:'status',params:['name'],expect:{'':{}}});const callNetworkDevicesStatusMap=rpc.declare({object:'network.device',method:'status',expect:{'':{}}});const callInterfaceDump=rpc.declare({object:'network.interface',method:'dump',expect:{interface:[]}});const callQmodemBaseInfo=rpc.declare({object:'qmodem',method:'base_info',params:['config_section'],expect:{}});const callQmodemNetworkInfo=rpc.declare({object:'qmodem',method:'network_info',params:['config_section'],expect:{}});const callQmodemCellInfo=rpc.declare({object:'qmodem',method:'cell_info',params:['config_section'],expect:{}});const callQmodemSimInfo=rpc.declare({object:'qmodem',method:'sim_info',params:['config_section'],expect:{}});const callQmodemConnectStatus=rpc.declare({object:'qmodem',method:'get_connect_status',params:['config_section'],expect:{}});const FIELD_PATTERNS={model:['model','modulemodel','productmodel','devicemodel','modemmodel'],imei:['imei'],iccid:['iccid'],operator:['operator','carrier','provider','networkoperator','serviceprovider','spn'],networkType:['connectedtype','connectiontype','networktype','servicetype','rat','mode'],ipv4:['ipv4address','ipv4addr','ipaddressv4','localipv4','ipv4'],ipv6:['ipv6address','ipv6addr','ipaddressv6','localipv6','ipv6'],band:['caband','lteband','nrband','band'],netMode:['networkmode'],bandwidth:['dlbandwidth','bandwidth'],cellId:['cellid'],pci:['physicalcellid','pcid','pci'],arfcn:['nrarfcn','earfcn','arfcn'],rsrp:['rsrp'],rsrq:['rsrq'],sinr:['sinr'],rssi:['rssi']};const MODEM_CHIP_FIELDS=[{key:'networkType',label:'Network',translate:true},{key:'operator',label:'Carrier',translate:true}];const MODEM_DETAIL_FIELDS=[{key:'imei',label:'IMEI'},{key:'iccid',label:'ICCID'},{key:'ipv4',label:'IPv4'},{key:'ipv6',label:'IPv6'},{key:'rsrp',label:'RSRP'},{key:'rsrq',label:'RSRQ'},{key:'sinr',label:'SINR'},{key:'cellId',label:'Cell ID'}];const MODEM_DYNAMIC_FIELD_SOURCES={networkType:'network',operator:'network',band:'cell',rsrp:'cell',rsrq:'cell',sinr:'cell',rssi:'cell',netMode:'cell',bandwidth:'cell',cellId:'cell',pci:'cell',arfcn:'cell'};const MODEM_SIGNAL_FIELDS=[{key:'rsrp',label:'RSRP'},{key:'rsrq',label:'RSRQ'},{key:'sinr',label:'SINR'}];const MODEM_DESCRIPTION_FIELDS=[{key:'brandModel',label:'Modem Model',translate:true},{key:'ipv4',label:'IPv4'},{key:'ipv4Gateway',label:'IPv4 Gateway',translate:true},{key:'ipv4Dns',label:'IPv4 DNS',translate:true},{key:'ipv6',label:'IPv6'},{key:'ipv6Gateway',label:'IPv6 Gateway',translate:true},{key:'ipv6Dns',label:'IPv6 DNS',translate:true},{key:'uptime',label:'Online Time',translate:true},{key:'imei',label:'IMEI'},{key:'iccid',label:'ICCID'},{key:'cellId',label:'Cell ID'}];function ensureStylesheet(id,href){if(document.getElementById(id))
return;document.head.appendChild(E('link',{id:id,rel:'stylesheet',type:'text/css',href:href}));}
misectel.ensureBaseStyle();ensureStylesheet(DASHBOARD_CSS_ID,DASHBOARD_CSS_URL);function isEmptyValue(value){return value==null||value===''||value==='N/A'||value==='null'||value==='undefined';}
function asDisplayValue(value,fallback){if(isEmptyValue(value))
return fallback||'--';return String(value);}
function hasMeaningfulValue(value){return!isEmptyValue(value)&&value!=='--';}
function isTruthyFlag(value){return value===true||value===1||value==='1'||value==='true'||value==='yes'||value==='on'||value==='up';}
function isRadioUp(radio){if(!radio)
return false;if(isTruthyFlag(radio.up)||isTruthyFlag(radio.is_up)||isTruthyFlag(radio?.iwinfo?.up))
return true;return ensureArray(radio.interfaces).some((iface)=>isTruthyFlag(iface?.up)||isTruthyFlag(iface?.is_up)||isTruthyFlag(iface?.iwinfo?.up));}
function ensureArray(value){return Array.isArray(value)?value:[];}
function arrayValue(value){if(Array.isArray(value))
return value;if(value==null||value==='')
return[];return[value];}
function normalizeToken(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function pickFirstValue(values){for(let i=0;i<values.length;i++){if(!isEmptyValue(values[i]))
return String(values[i]);}
return null;}
function findEntryInGroups(groups,patterns){for(let i=0;i<groups.length;i++){const value=findEntry(groups[i],patterns);if(!isEmptyValue(value))
return value;}
return null;}
function joinDisplayValues(values,separator){const parts=[];ensureArray(values).forEach((value)=>{if(isEmptyValue(value))
return;const text=String(value).trim();if(!text||parts.indexOf(text)!==-1)
return;parts.push(text);});return parts.join(separator||' ');}
function parsePercent(value){if(value==null)
return null;const match=String(value).match(/-?\d+(?:\.\d+)?/);if(!match)
return null;const percent=Math.max(0,Math.min(100,parseFloat(match[0])));return isNaN(percent)?null:percent;}
function formatBytes(value){if(value==null||isNaN(value))
return'--';const units=['B','KB','MB','GB','TB'];let amount=Number(value);let unit=0;while(amount>=1024&&unit<units.length-1){amount/=1024;unit++;}
return`${amount.toFixed(amount >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;}
function formatPercent(value){if(value==null||isNaN(value))
return'--';return`${value.toFixed(value >= 100 ? 0 : 1)}%`;}
function formatDateTime(epochSeconds){if(!epochSeconds)
return'--';try{return new Date(epochSeconds*1000).toLocaleString();}
catch(err){return'--';}}
function formatDuration(totalSeconds){if(totalSeconds==null)
return'--';let remaining=Math.max(0,Math.floor(totalSeconds));const days=Math.floor(remaining/86400);remaining%=86400;const hours=Math.floor(remaining/3600);remaining%=3600;const minutes=Math.floor(remaining/60);const seconds=remaining%60;const parts=[];if(days)
parts.push(`${days}d`);if(hours||parts.length)
parts.push(`${hours}h`);if(minutes||parts.length)
parts.push(`${minutes}m`);parts.push(`${seconds}s`);return parts.join(' ');}
function formatIpList(list){const values=Array.isArray(list)?list:[];return values.length?values.map((entry)=>`${entry.address}/${entry.mask}`).join(', '):'--';}
function formatLoad(load){if(!Array.isArray(load)||load.length<3)
return'--';return'%.2f / %.2f / %.2f'.format(load[0]/65535.0,load[1]/65535.0,load[2]/65535.0);}
function formatTemperatureNumber(value,unit){if(value==null||isNaN(value))
return null;let normalized=Number(value);let normalizedUnit=unit?String(unit).toUpperCase():'C';const absolute=Math.abs(normalized);if(!unit){if(absolute>=1000)
normalized/=1000;else if(absolute>=200)
normalized/=10;}
const decimals=Math.abs(normalized%1)>=0.05?1:0;return`${normalized.toFixed(decimals)}°${normalizedUnit}`;}
function normalizeTemperatureText(value){if(isEmptyValue(value))
return null;const text=String(value).trim();const match=text.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*(?:°)?\s*([cCfF]))?$/);if(!match)
return text;const numeric=parseFloat(match[1]);if(isNaN(numeric))
return text;return formatTemperatureNumber(numeric,match[2]||null)||text;}
function formatLinkSpeed(speed){if(isEmptyValue(speed))
return _('Unknown');const match=String(speed).match(/\d+/);if(!match)
return String(speed);const value=parseInt(match[0],10);if(isNaN(value)||value<=0)
return String(speed);if(value>=1000)
return`${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} Gbps`;return`${value} Mbps`;}
function parseNumericValue(value){if(value==null)
return null;const match=String(value).match(/-?\d+(?:\.\d+)?/);if(!match)
return null;const numeric=parseFloat(match[0]);return isNaN(numeric)?null:numeric;}
function linkSpeedTier(speed){const value=parseNumericValue(speed);if(value==null||value<=0)
return'offline';if(value>=1000)
return'gigabit';if(value>=100)
return'fast';return'slow';}
function loadTone(percent){if(percent==null||isNaN(percent))
return'neutral';if(percent>=80)
return'high';if(percent>=50)
return'medium';return'low';}
function temperatureTone(value){const temperature=parseNumericValue(normalizeTemperatureText(value));if(temperature==null)
return'neutral';if(temperature>=75)
return'high';if(temperature>=55)
return'medium';return'low';}
function signalTone(level){if(level>=4)
return'strong';if(level>=3)
return'good';if(level>=2)
return'fair';return'weak';}
function modemSignalLevel(snapshot){const rsrp=parseNumericValue(snapshot?.rsrp);const rssi=parseNumericValue(snapshot?.rssi);const sinr=parseNumericValue(snapshot?.sinr);if(rsrp!=null){if(rsrp>=-90)
return 4;if(rsrp>=-100)
return 3;if(rsrp>=-110)
return 2;return 1;}
if(rssi!=null){if(rssi>=-70)
return 4;if(rssi>=-85)
return 3;if(rssi>=-95)
return 2;return 1;}
if(sinr!=null){if(sinr>=20)
return 4;if(sinr>=13)
return 3;if(sinr>=5)
return 2;return 1;}
return 0;}
function formatPortRole(role,name){if(!role||role==='unknown'){if(/^wan/i.test(name))
return'WAN';if(/^lan/i.test(name))
return'LAN';return _('Ethernet');}
return String(role).toUpperCase();}
function isPhysicalPortName(name,status){if(!name||!L.isObject(status))
return false;if(status.devtype!=='ethernet'&&status.devtype!=='dsa')
return false;if(/^(lo|br-|docker|ifb|gre|gretap|erspan|tun|tap|wg|wwan|ppp|sit|bond|veth)/.test(name))
return false;if(name.indexOf('@')!==-1)
return false;return true;}
function flattenQmodemEntries(result){if(Array.isArray(result))
return result.filter((entry)=>L.isObject(entry));if(Array.isArray(result?.modem_info))
return result.modem_info.filter((entry)=>L.isObject(entry));if(Array.isArray(result?.info))
return result.info.filter((entry)=>L.isObject(entry));return[];}
function findEntry(entries,patterns){for(let i=0;i<entries.length;i++){const entry=entries[i];const haystacks=[normalizeToken(entry.key),normalizeToken(entry.full_name),normalizeToken(entry.extra_info)];if(patterns.some((pattern)=>haystacks.some((haystack)=>haystack.indexOf(pattern)!==-1))&&!isEmptyValue(entry.value))
return String(entry.value);}
return null;}
function findConnectionState(connectResult){if(!L.isObject(connectResult))
return{tone:'offline',text:_('Disconnected')};const values=[];const walk=(value)=>{if(Array.isArray(value)){value.forEach(walk);return;}
if(L.isObject(value)){Object.keys(value).forEach((key)=>walk(value[key]));return;}
if(value!=null)
values.push(String(value).toLowerCase());};walk(connectResult);if(values.some((value)=>/^(?:0|no|false|offline|disconnect(?:ed)?|hang|hangup)$/.test(value)))
return{tone:'offline',text:_('Disconnected')};if(values.some((value)=>/^(?:1|yes|true|online|connect(?:ed)?|attached)$/.test(value)))
return{tone:'online',text:_('Connected')};if(Object.keys(connectResult).length)
return{tone:'warn',text:_('Idle')};return{tone:'offline',text:_('Disconnected')};}
function extractTempText(tempInfo){if(typeof tempInfo==='string')
return normalizeTemperatureText(tempInfo);if(!L.isObject(tempInfo))
return null;return normalizeTemperatureText(pickFirstValue([tempInfo.tempinfo,tempInfo.temperature,tempInfo.temp,tempInfo.value]));}
function withTimeoutState(promise,timeoutMs){return Promise.race([Promise.resolve(promise).then((value)=>({value:value,timedOut:false,failed:false})).catch(()=>({value:null,timedOut:false,failed:true})),new Promise((resolve)=>window.setTimeout(()=>resolve({value:null,timedOut:true,failed:false}),timeoutMs))]);}
function buildRpcSourceState(result,normalize){const data=normalize(result?.value);const hasData=Array.isArray(data)?data.length>0:(L.isObject(data)?Object.keys(data).length>0:data!=null);return{data:data,timedOut:result?.timedOut===true,failed:result?.failed===true,hasData:hasData,healthy:result?.timedOut!==true&&result?.failed!==true&&hasData};}
function fieldLabel(field){return field.translate?_(field.label):field.label;}
/* The modules actually deployed, labelled with their chipset. Anything else
   still gets upper-cased rather than shown as the modem reports it. */
const CHESTER_MODEM_NAMES={'RM520N-GL':'SDX62 RM520N-GL','RM502Q-AE':'SDX55 RM502Q-AE','RM520F-GL':'SDX65 RM520F-GL','RM551E-GL':'SDX75 RM551E-GL'};
function chesterModemLabel(value){var s=String(value==null?'':value).trim().toUpperCase();return CHESTER_MODEM_NAMES[s]||s;}

/* Cell ID is a composite identity, and which base station it names depends on
   the radio the value came from:
     LTE  ECI is 28 bits = 20-bit eNB + 8-bit cell  -> eNB = ECI >> 8
     NR   NCI is 36 bits = gNB + cell, gNB is 22-32 -> gNB = NCI >> cellBits
   In NSA (EN-DC) the modem reports the LTE anchor's ECI and no NR cell
   identity at all, so NSA is an eNB case, not a gNB one. Verified on this
   hardware: network_mode "EN-DC Mode", Cell ID C3CB03 tagged [LTE], and the
   NR block carries only PCI/ARFCN/Band.
     0xC3CB03 = 12831491, >> 8 = 50123.
   NR_CELL_BITS is the one operator-dependent number here; 12 (a 24-bit gNB
   ID) is the common case and only applies on true SA. */
const NR_CELL_BITS=12;
function chesterCellIdField(snapshot){
	var raw=String((snapshot&&snapshot.cellId!=null)?snapshot.cellId:'').trim();
	if(!raw)return null;
	var hex=raw.replace(/^0x/i,'');
	var n=/^[0-9a-f]+$/i.test(hex)?parseInt(hex,16):(/^\d+$/.test(raw)?parseInt(raw,10):NaN);
	if(!isFinite(n))return null;
	var mode=String((snapshot&&snapshot.netMode)||'')+' '+String((snapshot&&snapshot.networkType)||'');
	var nsa=/EN-?DC|NSA/i.test(mode);
	var sa=!nsa&&/NR5G|(^|[^A-Z])NR([^A-Z]|$)/i.test(mode)&&!/LTE/i.test(mode);
	return sa?{label:'gNB',value:String(Math.floor(n/Math.pow(2,NR_CELL_BITS)))}
	         :{label:'eNB',value:String(Math.floor(n/256))};
}


/* Carrier aggregation, one line per component, as: N41 507870 482 50MHz
 *
 * Built from the RAW cell entries rather than the flattened snapshot, because
 * the flattened value loses which radio it came from. qmodem reports the
 * carriers in two different shapes depending on the mode:
 *
 *   SA + CA   one row per field, slash separated per component, and the
 *             extra (CA) rows repeat the secondary:
 *               Band "41 / 41"  ARFCN "507870 / 530190"  DL Bandwidth "50 / 50"
 *   NSA       separate blocks tagged [LTE] and [NR], one value each
 *
 * Grouping by that tag is what keeps NSA honest: its anchor is an LTE band and
 * must read B66, not N66, which is exactly what guessing the prefix from the
 * network mode would have produced. */
function chesterSplitCa(value){
	return String(value==null?'':value).split('/').map(function(x){return x.trim();}).filter(function(x){return x!=='';});
}
function chesterCarriersFromEntries(entries,mode){
	if(!Array.isArray(entries))return [];
	var groups={},order=[];
	for(var i=0;i<entries.length;i++){
		var e=entries[i]||{};
		var key=String(e.key||'').toLowerCase().replace(/[^a-z0-9]/g,'');
		var tag=String(e.extra_info||e.extraInfo||'').toUpperCase();
		var val=String(e.value==null?'':e.value).trim();
		if(!val||val==='-')continue;
		var slot=null;
		if(key==='band'||key==='bandca')slot='band';
		else if(key==='arfcn'||key==='earfcn'||key==='nrarfcn'||key==='arfcnca')slot='arfcn';
		else if(key==='physicalcellid'||key==='pci'||key==='pcid'||key==='physicalcellidca')slot='pci';
		else if(key==='dlbandwidth'||key==='dlbandwidthca')slot='bw';
		if(!slot)continue;
		/* the (CA) rows restate the secondary carrier that the slash-separated
		   rows already carry, so they are only used when nothing else did */
		var isCa=/ca$/.test(key)||/^CA-/.test(tag);
		var name=isCa?(tag||'CA'):(tag||'PRIMARY');
		if(!groups[name]){groups[name]={};order.push(name);}
		if(groups[name][slot]==null)groups[name][slot]=val;
	}
	var out=[],seen={};
	for(var g=0;g<order.length;g++){
		var name=order[g],grp=groups[name];
		var bands=chesterSplitCa(grp.band),arfcns=chesterSplitCa(grp.arfcn),
		    pcis=chesterSplitCa(grp.pci),bws=chesterSplitCa(grp.bw);
		var count=Math.max(bands.length,arfcns.length,pcis.length,bws.length);
		if(!count)continue;
		var nr=/NR/.test(name)||(name==='PRIMARY'&&/NR5G|(^|[^A-Z])NR([^A-Z]|$)/i.test(String(mode||''))&&!/LTE/i.test(String(mode||'')));
		for(var c=0;c<count;c++){
			var band=bands[c]||bands[0]||'';
			var parts=[];
			if(band)parts.push((nr?'N':'B')+band.replace(/^[NB]/i,''));
			var arfcn=arfcns[c]||arfcns[0];if(arfcn)parts.push(arfcn);
			var pci=pcis[c]||pcis[0];if(pci)parts.push(pci);
			var bw=bws[c]||bws[0];if(bw)parts.push(bw.replace(/\s*MHZ$/i,'')+'MHz');
			if(!parts.length)continue;
			var line=parts.join(' ');
			if(seen[line])continue;
			seen[line]=1;
			out.push({label:out.length?_('CA'):_('Band'),value:line,band:band?((nr?'N':'B')+band.replace(/^[NB]/i,'')):'',arfcn:arfcn||'',pci:pci||'',bw:bw?(bw.replace(/\s*MHZ$/i,'')+'MHz'):''});
		}
	}
	return out;
}


/* The Network chip read "TDD NR5G", which is the duplex mode plus the radio
   and says nothing about whether the connection is standalone. network_mode
   from the modem does: "NR5G-SA Mode with 2 CA" or "EN-DC Mode". */
function chesterNetworkLabel(snapshot){
	var mode=String((snapshot&&snapshot.netMode)||'');
	var type=String((snapshot&&snapshot.networkType)||'');
	if(/EN-?DC|NSA/i.test(mode)||/EN-?DC|NSA/i.test(type))return 'NR5G NSA';
	if(/SA/i.test(mode)&&/NR5G|(^|[^A-Z])NR([^A-Z]|$)/i.test(mode))return 'NR5G SA';
	if(/NR5G/i.test(type)&&!/LTE/i.test(type))return 'NR5G SA';
	if(/LTE/i.test(type)&&!/NR5G/i.test(type))return 'LTE';
	return '';
}


/* The Carrier field often arrives as a bare PLMN (MCC+MNC) rather than a name
   -- 310260 is T-Mobile. Mapped for the US networks these ship on; anything
   unrecognised is passed through untouched rather than guessed at, so a new
   or foreign PLMN still shows its digits instead of the wrong operator. */
const CHESTER_PLMN={
'310260':'T-Mobile','310160':'T-Mobile','310200':'T-Mobile','310210':'T-Mobile',
'310220':'T-Mobile','310230':'T-Mobile','310240':'T-Mobile','310250':'T-Mobile',
'310270':'T-Mobile','310300':'T-Mobile','310310':'T-Mobile','310490':'T-Mobile',
'310530':'T-Mobile','310580':'T-Mobile','310660':'T-Mobile','310800':'T-Mobile',
'311490':'T-Mobile','312530':'T-Mobile','316010':'T-Mobile',
'310410':'AT&T','310150':'AT&T','310170':'AT&T','310380':'AT&T','310560':'AT&T',
'310680':'AT&T','310070':'AT&T','311180':'AT&T',
'313100':'FirstNet','313110':'FirstNet','313120':'FirstNet','313130':'FirstNet',
'311480':'Verizon','310004':'Verizon','310010':'Verizon','310012':'Verizon',
'310013':'Verizon','311280':'Verizon','311110':'Verizon',
'313340':'DISH','311870':'Boost','312250':'Cricket'};
function chesterCarrierName(value){
	var raw=String(value==null?'':value).trim();
	if(!raw)return raw;
	var digits=raw.replace(/[^0-9]/g,'');
	if(digits.length>=5&&digits.length<=6&&digits===raw.replace(/\s/g,''))
		return CHESTER_PLMN[digits]||raw;
	return raw;
}


/* The carriers as individually labelled fields, so they read like the rest of
   the detail grid instead of one dense line. Secondary carriers are prefixed
   CA rather than numbered, which is how they are referred to on the radio. */

/* Band fields as a wrapping grid rather than one tall column.
   These modems aggregate up to 6 carriers, which is 24 labelled fields; as a
   single dt/dd column that runs far past the details beside it, so the cells
   flow into as many columns as the width allows. */
function chesterBandGrid(groups){
	/* One block per carrier so a component's four fields never split across
	   columns -- with up to 6 aggregated carriers an ungrouped flow would put
	   an SCC label in one column and its ARFCN in the next. */
	return E('div',{'class':'misectel-dashboard-band-grid'},groups.map(function(items){
		return E('div',{'class':'misectel-dashboard-band-group'},items.map(function(f){
			return E('div',{'class':'misectel-dashboard-band-item'},[
				E('span',{'class':'misectel-dashboard-band-item__label'},[f.label]),
				E('strong',{'class':'misectel-dashboard-band-item__value'},[f.value])
			]);
		}));
	}));
}

function chesterBandFields(carriers){
	if(!Array.isArray(carriers))return [];
	var out=[];
	carriers.forEach(function(c,i){
		var items=[];
		/* PCC is the primary component, SCC every aggregated one after it --
		   the same names the radio reports them under. */
		if(c.band)items.push({label:i?('SCC'+i):'PCC',value:c.band});
		if(c.arfcn)items.push({label:_('ARFCN'),value:c.arfcn});
		if(c.pci)items.push({label:_('PCID'),value:c.pci});
		if(c.bw)items.push({label:_('BW'),value:c.bw});
		if(items.length)out.push(items);
	});
	return out;
}


/* Network mode selection.
 *
 * qmodem has no API for this: get_mode is the data-path driver (qmi/gobinet/
 * mbim) and network_prefer is only a 3G/4G/5G enable mask, neither of which
 * can express NSA versus SA. So these go through qmodem's own send_at rather
 * than around it.
 *
 * NSA and SA are each two settings, not one: mode_pref chooses the radios and
 * nr5g_disable_mode decides which 5G connection type is allowed.
 *   nr5g_disable_mode  0 = both, 1 = SA disabled (so NSA), 2 = NSA disabled (so SA)
 */
var callSendAt=rpc.declare({object:'qmodem',method:'send_at',params:['config_section','params'],expect:{}});
const CHESTER_MODES=[
	{id:'auto',label:'AUTO',cmds:['AT+QNWPREFCFG="mode_pref",auto','AT+QNWPREFCFG="nr5g_disable_mode",0']},
	{id:'lte', label:'LTE', cmds:['AT+QNWPREFCFG="mode_pref",LTE']},
	{id:'nsa', label:'NSA', cmds:['AT+QNWPREFCFG="mode_pref",NR5G:LTE','AT+QNWPREFCFG="nr5g_disable_mode",1']},
	{id:'sa',  label:'SA',  cmds:['AT+QNWPREFCFG="mode_pref",NR5G','AT+QNWPREFCFG="nr5g_disable_mode",2']}
];


/* Re-enable the band list when switching into NSA or SA.
 *
 * Switching mode leaves the other family's band selection empty -- go to NSA
 * and the SA bands come back blank -- so returning to SA without restoring
 * them gives a mode with no bands enabled, which is no service at all. The
 * lists come from the modem's own capability values in uci (sa_band /
 * nsa_band), slash separated there and colon separated for the AT command.
 *
 * If uci has not been read or the value is missing, this returns null and the
 * mode is set without touching the bands, rather than sending an empty list
 * and disabling everything. */
function chesterBandRestoreCmd(modem,modeId){
	var key=modeId==='sa'?'sa_band':(modeId==='nsa'?'nsa_band':null);
	if(!key||!modem||!modem.id)return null;
	var raw=null;
	try{raw=uci.get('qmodem',modem.id,key);}catch(err){raw=null;}
	if(!raw)return null;
	var bands=String(raw).split('/').map(function(x){return x.trim();}).filter(Boolean).join(':');
	if(!bands)return null;
	return 'AT+QNWPREFCFG="'+(modeId==='sa'?'nr5g_band':'nsa_nr5g_band')+'",'+bands;
}

function chesterModeButtons(modem){
	var status=E('span',{'class':'chester-mode__status'},['']);
	var port=null;
	try{port=uci.get('qmodem',modem.id,'at_port');}catch(err){port=null;}

	/* params is an OBJECT with .at and .port, not a command string, and the
	   handler answers status "1" for success and "0" for failure. Passing a
	   string left both null: every call returned status "0" -- which reads
	   like success until you notice the modem never changed. */
	function at(cmd){
		return callSendAt(modem.id,{at:cmd,port:port}).then(function(res){
			var cfg=res&&res.at_cfg?res.at_cfg:{};
			if(String(cfg.status)!=='1')throw new Error(_('the modem rejected the command'));
			return String(cfg.res||'');
		});
	}

	var buttons=CHESTER_MODES.map(function(mode){
		var btn=E('button',{'type':'button','class':'chester-mode__btn'},[_(mode.label)]);
		btn.addEventListener('click',function(){
			buttons.forEach(function(b){b.disabled=true;});
			status.className='chester-mode__status';
			status.textContent=_('Applying…');
			var cmds=mode.cmds.slice();
			var restore=chesterBandRestoreCmd(modem,mode.id);
			if(restore)cmds.push(restore);
			var chain=Promise.resolve();
			cmds.forEach(function(cmd){chain=chain.then(function(){return at(cmd);});});
			chain.then(function(){
				buttons.forEach(function(b){b.classList.remove('is-active');});
				btn.classList.add('is-active');
				status.textContent=_('Applied. The modem will re-register.');
			}).catch(function(err){
				status.className='chester-mode__status is-bad';
				status.textContent=_('Could not apply: %s').format(err&&err.message?err.message:err);
			}).then(function(){
				buttons.forEach(function(b){b.disabled=false;});
			});
		});
		return btn;
	});

	/* Read the modem's actual preference rather than guessing from the
	   connection: mode_pref can be AUTO while the radio happens to be on SA,
	   and those are different answers to "what is this set to". */
	if(port){
		Promise.all([at('AT+QNWPREFCFG="mode_pref"'),at('AT+QNWPREFCFG="nr5g_disable_mode"')])
			.then(function(out){
				var pref=(String(out[0]).match(/"mode_pref",([^\r\n]*)/)||[])[1]||'';
				var dis=(String(out[1]).match(/"nr5g_disable_mode",\s*(\d)/)||[])[1]||'';
				var id=dis==='1'?'nsa':dis==='2'?'sa':/^\s*AUTO/i.test(pref)?'auto':/LTE/i.test(pref)&&!/NR5G/i.test(pref)?'lte':'';
				CHESTER_MODES.forEach(function(m,i){if(m.id===id)buttons[i].classList.add('is-active');});
			}).catch(function(){});
	}

	return E('div',{'class':'chester-mode'},[
		E('div',{'class':'chester-mode__head'},[status]),
		E('div',{'class':'chester-mode__row'},buttons)
	]);
}

function chesterField(field,snapshot){
	if(field&&field.key==='operator'){
		var carrier=chesterCarrierName(snapshot[field.key]);
		if(carrier)return {label:fieldLabel(field),value:carrier};
	}
	if(field&&field.key==='networkType'){
		var net=chesterNetworkLabel(snapshot);
		if(net)return {label:fieldLabel(field),value:net};
	}
	if(field&&field.key==='cellId'){
		var c=chesterCellIdField(snapshot);
		if(c)return {label:c.label,value:c.value};
	}
	return {label:fieldLabel(field),value:asDisplayValue(snapshot[field.key],'--')};
}

function buildModemHighlights(snapshot){return MODEM_CHIP_FIELDS.map((field)=>chesterField(field,snapshot)).filter((chip)=>chip.value!=='--');}
function buildSignalSets(entries){if(!Array.isArray(entries))return [];var rat='',out=[],seen={};var want={rsrp:'RSRP',rsrq:'RSRQ',sinr:'SINR'};for(var i=0;i<entries.length;i++){var e=entries[i]||{};var k=String(e.key||'').trim(),v=String(e.value||'').trim();if(!k)continue;if(k===v&&/^(LTE|NR5G|WCDMA|GSM|TDS)/i.test(v)){rat=/NR5G|^NR/i.test(v)?'5G':'LTE';continue;}var kn=k.toLowerCase();if(want[kn]&&v&&rat){var label=rat+' '+want[kn];if(!seen[label]){seen[label]=1;out.push({label:label,value:v});}}}return out;}
function buildModemSignals(snapshot){return MODEM_SIGNAL_FIELDS.map((field)=>chesterField(field,snapshot)).filter((detail)=>detail.value!=='--');}
function buildModemDescription(snapshot){return MODEM_DESCRIPTION_FIELDS.map((field)=>chesterField(field,snapshot)).filter((detail)=>detail.value!=='--');}
function parseInterfaceDump(dump){if(Array.isArray(dump))
return dump;if(Array.isArray(dump?.interface))
return dump.interface;return[];}
function findInterfaceInfo(dump,name){return parseInterfaceDump(dump).find((item)=>item.interface===name||item.device===name||item.l3_device===name)||null;}
function getConfiguredInterfaceNames(){try{return uci.sections('network','interface').map((section)=>section['.name']).filter((name)=>!!name&&name!=='loopback');}
catch(err){return[];}}
function findConfiguredTempNode(){try{const sections=uci.sections('misectel');for(let i=0;i<sections.length;i++){const node=String(sections[i]?.temp_node||'').trim();if(node)
return node;}}
catch(err){}
return null;}
function getManagedPhysicalPortNames(statusMap,builtinPorts){const names=[];const pushName=(name)=>{if(!name||names.indexOf(name)!==-1)
return;const status=statusMap?.[name];if(status&&!isPhysicalPortName(name,status))
return;names.push(name);};try{uci.sections('network','device').forEach((section)=>{pushName(section.name);arrayValue(section.ports).forEach(pushName);});uci.sections('network','interface').forEach((section)=>{arrayValue(section.device).forEach(pushName);arrayValue(section.ifname).forEach(pushName);});}
catch(err){}
ensureArray(builtinPorts).forEach((port)=>{if(!port?.device)
return;pushName(port.device);});Object.keys(statusMap||{}).forEach((name)=>{arrayValue(statusMap[name]?.['bridge-members']).forEach(pushName);});return names;}
function extractPrimaryMac(board,logicalInterfaces,ports){const candidates=[board?.network?.lan?.macaddr,board?.network?.wan?.macaddr,board?.network?.wan6?.macaddr];ensureArray(logicalInterfaces).forEach((iface)=>{candidates.push(iface?.mac);});ensureArray(ports).forEach((port)=>{candidates.push(port?.mac);});for(let i=0;i<candidates.length;i++){if(!hasMeaningfulValue(candidates[i]))
continue;return misectel.normalizeMac(candidates[i]);}
return'--';}
function buildModemInterfaceInfo(interfaceDump,section){return modemHelper.resolveModemInterfaceInfo(section,interfaceDump);}
function interfaceTone(info){if(!L.isObject(info))
return'offline';if(info.pending===true)
return'warn';return info.up===true?'online':'offline';}
function interfaceText(info){if(!L.isObject(info))
return _('Disconnected');if(info.pending===true)
return _('Idle');return info.up===true?_('Connected'):_('Disconnected');}
function readTraffic(deviceStatus){const stats=deviceStatus?.statistics||deviceStatus?.stats||{};return{rx:stats.rx_bytes!=null?formatBytes(stats.rx_bytes):'--',tx:stats.tx_bytes!=null?formatBytes(stats.tx_bytes):'--'};}
function hasNonZeroTraffic(traffic){return[traffic?.rx,traffic?.tx].some((value)=>{const amount=parseNumericValue(value);return amount!=null&&amount>0;});}
function interfaceHasAddress(info){return formatIpList(info?.['ipv4-address'])!=='--'||formatIpList(info?.['ipv6-address'])!=='--';}
function interfaceHasOperationalData(info,gateway,traffic){return info?.up===true||info?.pending===true||interfaceHasAddress(info)||hasMeaningfulValue(gateway)||hasNonZeroTraffic(traffic);}
function findEntryState(entries){const raw=findEntry(entries,['connectstatus','connectionstatus','status']);if(!raw)
return null;const value=String(raw).toLowerCase();if(/^(?:1|yes|true|online|connect(?:ed)?)$/.test(value))
return{tone:'online',text:_('Connected')};if(/^(?:0|no|false|offline|disconnect(?:ed)?)$/.test(value))
return{tone:'offline',text:_('Disconnected')};return null;}
function portExists(port){const st=port&&port.status;if(!L.isObject(st))return false;return st.present===true;}function hiddenPortNames(){try{var v=uci.get('misectel','clients','hidden_ports');if(!v)return [];if(!Array.isArray(v))v=String(v).split(/[\s,]+/);return v.filter(Boolean).map(function(x){return String(x).toLowerCase();});}catch(e){return [];}}
function portLabelMap(){try{var v=uci.get('misectel','clients','port_labels');if(!v)return {};if(Array.isArray(v))v=v.join(' ');var m={};String(v).split(/[\s,]+/).forEach(function(pair){var kv=pair.split('=');if(kv.length===2&&kv[0]&&kv[1])m[kv[0].toLowerCase()]=kv[1];});return m;}catch(e){return {};}}
function portLabel(n){var k=String(n||'').toLowerCase();var m=portLabelMap();return m[k]||String(n||'').toUpperCase();}
function portDisplayOrder(name){var n=String(name||'').toUpperCase();if(n.indexOf('WAN')===0)return 999;var m=n.match(/(\d+)/);return m?parseInt(m[1],10):500;}
return view.extend({load(){return Promise.resolve();},async fetchData(){await L.resolveDefault(uci.load(['qmodem','misectel','firewall','network']),null);const configuredTempNode=findConfiguredTempNode();const[board,systemInfo,cpuInfo,cpuUsage,systemTempInfo,configuredTempInfo,systemTime,oemModelInfo,builtinPorts,tcpConnections,internetStatus,deviceStatusMap,interfaceDump,clientData,modemTempInfo,ledPowerInfo,ttlInfo,videoInfo,wanToLanInfo]=await Promise.all([L.resolveDefault(callSystemBoard(),{}),L.resolveDefault(callSystemInfo(),{}),L.resolveDefault(callCPUInfo(),{}),L.resolveDefault(callCPUUsage(),{}),L.resolveDefault(callTempInfo(),{}),configuredTempNode?L.resolveDefault(callConfiguredTempStatus(configuredTempNode),{}):Promise.resolve(null),L.resolveDefault(callSystemTime(),{}),L.resolveDefault(callOemModelName(),{}),L.resolveDefault(callBuiltinEthernetPorts(),[]),L.resolveDefault(callTcpConnections(),{}),L.resolveDefault(callInternetStatus(),{}),L.resolveDefault(callNetworkDevicesStatusMap(),{}),L.resolveDefault(callInterfaceDump(),{}),L.resolveDefault(clients.fetchRuntimeData(),{hostHints:{},wirelessData:{},wiredInterfaces:[],radioByIfname:{},assoclists:[],neighbors:[]}),L.resolveDefault(callModemTemp(),{}),L.resolveDefault(callLedPower(),{}),L.resolveDefault(callTtlStatus(),{}),L.resolveDefault(callVideoEngine(),{}),L.resolveDefault(callWanToLan(),{})]);const builtinPortList=Array.isArray(builtinPorts)?builtinPorts:ensureArray(builtinPorts?.result);const modemSections=this.getModemSections();this.pruneModemSnapshotCache(modemSections);const modems=await Promise.all(modemSections.map((section)=>this.fetchModem(section,interfaceDump)));const ports=await this.fetchPorts(builtinPortList,deviceStatusMap);const memory=L.isObject(systemInfo.memory)?systemInfo.memory:{};const memoryUsed=(memory.total!=null&&memory.available!=null)?(memory.total-memory.available):null;const memoryPercent=(memory.total>0&&memoryUsed!=null)?(memoryUsed/memory.total)*100:null;const cpuPercent=parsePercent(cpuUsage.cpuusage);const tempInfo=hasMeaningfulValue(extractTempText(configuredTempInfo))?configuredTempInfo:systemTempInfo;const onlineModemCount=modems.filter((modem)=>modem.status.tone==='online').length;const onlineDeviceCount=clients.countOnlineDevices(clientData,{staticLeases:{}});const tcpConnectionCount=parseNumericValue(tcpConnections?.count);const wanInterfaces=this.buildWanInterfaces(interfaceDump,deviceStatusMap);const logicalInterfaces=this.buildLogicalInterfaces(interfaceDump,deviceStatusMap);const primaryModem=modems.find((modem)=>modem.status.tone==='online')||modems[0]||null;const wifiEnabled=Object.keys(clientData?.wirelessData||{}).some((name)=>isRadioUp(clientData.wirelessData[name]));const oemModelName=String(oemModelInfo?.model_name||'').trim();return{board,deviceModel:oemModelName||board.model,systemInfo,cpuInfo,cpuUsage,cpuPercent,tempInfo,systemTime,tempNode:configuredTempNode||configuredTempInfo?.node||systemTempInfo?.node||null,modemTemp:(modemTempInfo&&modemTempInfo.value)?String(modemTempInfo.value):null,ledPowerOn:(ledPowerInfo&&typeof ledPowerInfo.enabled==='boolean')?ledPowerInfo.enabled:null,ttlOn:(ttlInfo&&typeof ttlInfo.enabled==='boolean')?ttlInfo.enabled:null,videoOn:(videoInfo&&typeof videoInfo.enabled==='boolean')?videoInfo.enabled:null,wanToLanOn:(wanToLanInfo&&typeof wanToLanInfo.enabled==='boolean')?wanToLanInfo.enabled:null,modems,primaryModem,onlineModemCount,onlineDeviceCount,tcpConnectionCount,internetStatus,wifiEnabled,setupCompleted:this.isSetupCompleted(),passwordUnset:this.hasUnsetPasswordWarning(),ports,logicalInterfaces,wanInterfaces,memory,memoryUsed,memoryPercent};},hasUnsetPasswordWarning(){const warnings=document.querySelectorAll('#maincontent .alert-message.warning');let matched=false;warnings.forEach((node)=>{const heading=node.querySelector('h4');const title=heading?heading.textContent.trim():'';if(title!==_('No password set!'))
return;node.style.display='none';matched=true;});return matched;},isSetupCompleted(){return String(uci.get('misectel','setup','completed')||'0')==='1';},buildWanInterfaces(interfaceDump,deviceStatusMap){const wanRole=(uci.get('misectel','network_defaults','wan_role')||'').trim();if(!wanRole)
return[];const primary=findInterfaceInfo(interfaceDump,wanRole);if(!primary)
return[];const items=[wanRole].map((name)=>{const info=findInterfaceInfo(interfaceDump,name)||{};const l3Device=info.l3_device||info.device||'--';const deviceInfo=deviceStatusMap?.[l3Device]||deviceStatusMap?.[info.device]||{};const traffic=readTraffic(deviceInfo);const gateway=asDisplayValue(Array.isArray(info.route)&&info.route[0]?info.route[0].nexthop:null,'--');return{name:name,tone:interfaceTone(info),statusText:interfaceText(info),proto:asDisplayValue(info.proto,'--'),l3Device:asDisplayValue(l3Device,'--'),ipv4:formatIpList(info['ipv4-address']),ipv6:formatIpList(info['ipv6-address']),uptime:formatDuration(info.uptime),gateway:gateway,rx:traffic.rx,tx:traffic.tx,visible:interfaceHasOperationalData(info,gateway,traffic)};});const visibleItems=items.filter((item)=>item.visible);return visibleItems.length?visibleItems:items.slice(0,1);},buildLogicalInterfaces(interfaceDump,deviceStatusMap){const statusMap=L.isObject(deviceStatusMap)?deviceStatusMap:{};const configuredNames=getConfiguredInterfaceNames();const restrictToConfigured=configuredNames.length>0;const wanRole=(uci.get('misectel','network_defaults','wan_role')||'').trim();const lanZone=uci.sections('firewall','zone').find((section)=>section.name==='lan');const wanZone=uci.sections('firewall','zone').find((section)=>section.name==='wan');const lanNames=arrayValue(lanZone?.network);const wanNames=arrayValue(wanZone?.network);const seen={};return parseInterfaceDump(interfaceDump).filter((info)=>{const name=info?.interface;if(!name||name==='loopback'||seen[name])
return false;if(restrictToConfigured&&configuredNames.indexOf(name)===-1)
return false;seen[name]=true;return lanNames.indexOf(name)!==-1||wanNames.indexOf(name)!==-1||name===wanRole||info.up===true||hasMeaningfulValue(info.device)||hasMeaningfulValue(info.l3_device);}).map((info)=>{const deviceName=info.l3_device||info.device||'--';const deviceInfo=statusMap?.[deviceName]||statusMap?.[info.device]||{};const traffic=readTraffic(deviceInfo);const gateway=asDisplayValue(Array.isArray(info.route)&&info.route[0]?info.route[0].nexthop:null,'--');const isLan=lanNames.indexOf(info.interface)!==-1||/^lan/i.test(info.interface)||/^br-lan/.test(deviceName);const rawType=wanNames.indexOf(info.interface)!==-1||info.interface===wanRole?_('WAN'):(isLan?_('LAN'):asDisplayValue(info.proto,_('Interface')));const speedText=deviceInfo?.carrier===true?formatLinkSpeed(deviceInfo.speed):asDisplayValue(deviceName,'--');return{name:info.interface,type:rawType,tone:interfaceTone(info),statusText:interfaceText(info),device:asDisplayValue(deviceName,'--'),mac:asDisplayValue(deviceInfo.macaddr,'--'),ipv4:formatIpList(info['ipv4-address']),ipv6:formatIpList(info['ipv6-address']),speed:speedText,rx:traffic.rx,tx:traffic.tx,visible:isLan||interfaceHasOperationalData(info,gateway,traffic)};}).filter((item)=>item.visible);},getModemSections(){try{return uci.sections('qmodem','modem-device').filter((section)=>section.state!=='disabled'&&section.disabled!=='1').map((section)=>({id:section['.name'],alias:section.alias,name:section.name,manufacturer:section.manufacturer,network:section.network}));}
catch(err){return[];}},pruneModemSnapshotCache(sections){if(!L.isObject(this.modemSnapshotCache))
this.modemSnapshotCache={};const nextCache={};ensureArray(sections).forEach((section)=>{if(section?.id&&this.modemSnapshotCache[section.id])
nextCache[section.id]=this.modemSnapshotCache[section.id];});this.modemSnapshotCache=nextCache;},mergeModemSnapshot(snapshot){if(!L.isObject(this.modemSnapshotCache))
this.modemSnapshotCache={};const previous=this.modemSnapshotCache[snapshot.id]||{};const merged=Object.assign({},snapshot);if((!Array.isArray(merged.signalSets)||!merged.signalSets.length)&&Array.isArray(previous.signalSets)&&previous.signalSets.length)merged.signalSets=previous.signalSets;if((!Array.isArray(merged.carriers)||!merged.carriers.length)&&Array.isArray(previous.carriers)&&previous.carriers.length)merged.carriers=previous.carriers;const identityKeys=['title','subtitle','brandModel','imei','iccid'];identityKeys.forEach((key)=>{if(!hasMeaningfulValue(merged[key])&&hasMeaningfulValue(previous[key]))
merged[key]=previous[key];});Object.keys(MODEM_DYNAMIC_FIELD_SOURCES).forEach((key)=>{if(hasMeaningfulValue(merged[key]))
return;if(merged.fieldStale?.[key]===true&&hasMeaningfulValue(previous[key]))
merged[key]=previous[key];});if((!L.isObject(snapshot.status)||snapshot.status.stale===true)&&L.isObject(previous.status))
merged.status=previous.status;this.modemSnapshotCache[snapshot.id]=merged;return merged;},async fetchModem(section,interfaceDump){const[baseInfo,networkInfo,cellInfo,simInfo,connectStatus]=await Promise.all([withTimeoutState(L.resolveDefault(callQmodemBaseInfo(section.id),{}),MODEM_RPC_TIMEOUT),withTimeoutState(L.resolveDefault(callQmodemNetworkInfo(section.id),{}),MODEM_RPC_TIMEOUT),withTimeoutState(L.resolveDefault(callQmodemCellInfo(section.id),{}),MODEM_RPC_TIMEOUT),withTimeoutState(L.resolveDefault(callQmodemSimInfo(section.id),{}),MODEM_RPC_TIMEOUT),withTimeoutState(L.resolveDefault(callQmodemConnectStatus(section.id),{}),MODEM_RPC_TIMEOUT)]);const sourceStates={base:buildRpcSourceState(baseInfo,flattenQmodemEntries),network:buildRpcSourceState(networkInfo,flattenQmodemEntries),cell:buildRpcSourceState(cellInfo,flattenQmodemEntries),sim:buildRpcSourceState(simInfo,flattenQmodemEntries),connect:buildRpcSourceState(connectStatus,(value)=>L.isObject(value)?value:{})};const allEntries=[].concat(sourceStates.base.data).concat(sourceStates.network.data).concat(sourceStates.cell.data).concat(sourceStates.sim.data);const entryState=findEntryState(allEntries);const status=(()=>{if(sourceStates.connect.healthy){const rpcState=findConnectionState(sourceStates.connect.data);if(entryState&&rpcState.tone!=='online')
return Object.assign({},entryState,{stale:false});return Object.assign({},rpcState,{stale:false});}
if(entryState)
return Object.assign({},entryState,{stale:false});return{tone:'offline',text:_('Disconnected'),stale:true};})();const model=findEntryInGroups([sourceStates.base.data,sourceStates.network.data,sourceStates.cell.data,sourceStates.sim.data],FIELD_PATTERNS.model);const operator=findEntryInGroups([sourceStates.network.data,sourceStates.sim.data,allEntries],FIELD_PATTERNS.operator);const networkType=findEntryInGroups([sourceStates.network.data,allEntries],FIELD_PATTERNS.networkType);const band=findEntryInGroups([sourceStates.cell.data,sourceStates.network.data,allEntries],FIELD_PATTERNS.band);const brandModel=chesterModemLabel(pickFirstValue([model,section.name]));const interfaceInfo=buildModemInterfaceInfo(interfaceDump,section);const title=pickFirstValue([brandModel,section.alias,section.id])||section.id;const subtitle='';const snapshot=this.mergeModemSnapshot({id:section.id,title:title,subtitle:subtitle,status:status,brandModel:brandModel,imei:findEntryInGroups([sourceStates.base.data,sourceStates.sim.data,allEntries],FIELD_PATTERNS.imei),iccid:findEntryInGroups([sourceStates.sim.data,sourceStates.base.data,allEntries],FIELD_PATTERNS.iccid),networkType:networkType,operator:operator,band:band,signalSets:buildSignalSets(sourceStates.cell.data),carriers:chesterCarriersFromEntries(sourceStates.cell.data,networkType),baseInterface:interfaceInfo.baseInterface,ipv6Interface:interfaceInfo.ipv6Interface,ipv4:interfaceInfo.ipv4,ipv4Gateway:interfaceInfo.ipv4Gateway,ipv4Dns:interfaceInfo.ipv4Dns,ipv6:interfaceInfo.ipv6,ipv6Gateway:interfaceInfo.ipv6Gateway,ipv6Dns:interfaceInfo.ipv6Dns,uptime:interfaceInfo.uptime,rsrp:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.rsrp),rsrq:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.rsrq),sinr:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.sinr),rssi:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.rssi),cellId:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.cellId),pci:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.pci),arfcn:findEntryInGroups([sourceStates.cell.data,allEntries],FIELD_PATTERNS.arfcn),fieldStale:Object.keys(MODEM_DYNAMIC_FIELD_SOURCES).reduce((acc,key)=>{acc[key]=sourceStates[MODEM_DYNAMIC_FIELD_SOURCES[key]]?.healthy!==true;return acc;},{})});return{id:snapshot.id,title:snapshot.title,subtitle:snapshot.subtitle,network:pickFirstValue([hasMeaningfulValue(snapshot.baseInterface)?snapshot.baseInterface:null,hasMeaningfulValue(snapshot.ipv6Interface)?snapshot.ipv6Interface:null,section.network])||'--',status:snapshot.status,highlights:buildModemHighlights(snapshot),signals:(Array.isArray(snapshot.signalSets)&&snapshot.signalSets.length)?snapshot.signalSets:buildModemSignals(snapshot),description:buildModemDescription(snapshot),carriers:Array.isArray(snapshot.carriers)?snapshot.carriers:[],id:snapshot.id,modeLabel:chesterNetworkLabel(snapshot),signalLevel:modemSignalLevel(snapshot)};},async fetchPorts(builtinPorts,deviceStatusMap){const statusMap=L.isObject(deviceStatusMap)?deviceStatusMap:{};const roleMap={};const portNames=[];const managedPortNames=getManagedPhysicalPortNames(statusMap,builtinPorts);ensureArray(builtinPorts).forEach((port)=>{if(!port||!port.device||managedPortNames.indexOf(port.device)===-1)
return;if(portNames.indexOf(port.device)===-1)
portNames.push(port.device);roleMap[port.device]=port.role;});Object.keys(statusMap).forEach((name)=>{if(managedPortNames.indexOf(name)===-1||!isPhysicalPortName(name,statusMap[name])||portNames.indexOf(name)!==-1)
return;portNames.push(name);});const ports=await Promise.all(portNames.map(async(name)=>{const knownStatus=L.isObject(statusMap[name])&&Object.keys(statusMap[name]).length?statusMap[name]:null;const status=knownStatus||await L.resolveDefault(callNetworkDeviceStatus(name),{});return{name:name,role:roleMap[name],status:L.isObject(status)?status:{}};}));return ports.filter((port)=>hiddenPortNames().indexOf(String(port.name||'').toLowerCase())===-1).filter((port)=>portExists(port)).sort((a,b)=>portDisplayOrder(portLabel(a.name))-portDisplayOrder(portLabel(b.name))).map((port)=>{const status=port.status;const carrier=status.carrier===true?true:status.carrier===false?false:null;const speedText=carrier==null?_('Unknown'):(carrier?formatLinkSpeed(status.speed):_('Not connected'));return{name:portLabel(port.name),logical:String(port.name||''),role:formatPortRole(port.role,port.name),mac:asDisplayValue(status.macaddr,'--'),link:carrier==null?_('Unknown'):(carrier?_('Connected'):_('Disconnected')),speed:speedText,speedTier:carrier?linkSpeedTier(status.speed):'offline',tone:carrier==null?'warn':(carrier?'online':'offline')};});},createShell(){this.modemSnapshotCache={};this.metricHistory={};this.heroMeta=E('div',{'class':'misectel-dashboard-hero__meta','style':'display:none'});this.securityNode=E('div',{'class':'misectel-dashboard-setup','style':'display:none'});this.summaryNode=E('div',{'class':'misectel-dashboard-quick-grid'});this.ledToggle=E('button',{'class':'misectel-dashboard-led-toggle','type':'button','aria-pressed':'true','title':_('Front panel lights'),'click':(ev)=>{this.toggleLedPower(ev.currentTarget);}},[E('span',{'class':'misectel-dashboard-led-toggle__icon'},['\u23FB']),E('span',{'class':'misectel-dashboard-led-toggle__text'},[_('LED Lights')])]);this.ttlToggle=E('button',{'class':'misectel-dashboard-led-toggle','type':'button','aria-pressed':'false','title':_('TTL / hop limit rewriting'),'click':(ev)=>{this.toggleTtl(ev.currentTarget);}},[E('span',{'class':'misectel-dashboard-led-toggle__icon'},['\u23FB']),E('span',{'class':'misectel-dashboard-led-toggle__text'},[_('TTL/HL')])]);this.videoToggle=E('button',{'class':'misectel-dashboard-led-toggle','type':'button','aria-pressed':'false','title':_('4K/HD streaming engine'),'click':(ev)=>{this.toggleVideoEngine(ev.currentTarget);}},[E('span',{'class':'misectel-dashboard-led-toggle__icon'},['\u23FB']),E('span',{'class':'misectel-dashboard-led-toggle__text'},[_('4K/HD')])]);this.ledToggleWrap=E('div',{'class':'misectel-dashboard-led-toggle-wrap'},[this.videoToggle,this.ttlToggle,this.ledToggle]);this.metricsNode=E('div',{'class':'misectel-dashboard-stats-grid'});this.modemNode=E('div',{'class':'misectel-dashboard-modem-grid'});this.portPanelNode=E('div',{'class':'misectel-dashboard-port-panel'});this.systemNode=E('div',{'class':'misectel-dashboard-info-list'});this.wanNode=E('div',{'class':'misectel-dashboard-wan-list misectel-dashboard-wan-list--compact'});this.interfaceNode=E('div');this.modemSelectWrap=E('div',{'class':'misectel-dashboard-select-wrap misectel-ui-select-wrap misectel-dashboard-card__select','style':'display:none'});this.modemSelect=E('select',{'class':'misectel-dashboard-select misectel-ui-select','aria-label':_('Switch Modem'),'change':(ev)=>{this.selectedModemId=ev.currentTarget.value||null;if(this.latestData)
dom.content(this.modemNode,this.renderModems(this.latestData.modems));}});this.modemSelectWrap.appendChild(this.modemSelect);this.modemCard=misectel.createCard('',null,[this.modemNode],this.modemSelectWrap);this.modemCard.classList.add('misectel-dashboard-card--modem-main');this.portCard=misectel.createCard('',null,[E('div',{'class':'misectel-dashboard-interface-stack'},[E('section',{'class':'misectel-dashboard-interface-block'},[this.portPanelNode]),E('div',{'class':'misectel-dashboard-bottom-grid'},[E('section',{'class':'misectel-dashboard-interface-block misectel-dashboard-interface-block--compact'},[E('div',{'class':'misectel-dashboard-section-title'},[_('System Info')]),this.systemNode]),(this.wanSection=E('section',{'class':'misectel-dashboard-interface-block misectel-dashboard-interface-block--compact'},[E('div',{'class':'misectel-dashboard-section-title'},[_('WAN Status')]),this.wanNode]))])])]);this.portCard.classList.add('misectel-dashboard-card--ports-main');this.loadingNode=E('div',{'class':'misectel-dashboard-loading'},[E('em',{},[_('Collecting device information...')])]);return E('div',{'class':'misectel-dashboard-page'},[E('div',{'class':'misectel-dashboard-shell'},[E('section',{'class':'misectel-dashboard-hero'},[this.ledToggleWrap,this.summaryNode]),this.securityNode,E('div',{'class':'misectel-dashboard-layout'},[E('div',{'class':'misectel-dashboard-main'},[this.modemCard]),E('div',{'class':'misectel-dashboard-side'},[this.metricsNode,this.portCard])]),this.loadingNode])]);},syncWanToLanToggle(on){if(this.portPanelNode&&this.latestData&&this.latestData.ports)dom.content(this.portPanelNode,this.renderPorts(this.latestData.ports));if(this.wanSection){const lan=(on===true);this.wanSection.classList.toggle('is-inactive',lan);this.wanSection.title=lan?_('The 2.5G socket is a LAN port, so there is no WAN interface running.'):'';}},async toggleWanToLan(btn){const next=(this.wanToLanOn===true)?'0':'1';if(btn)btn.disabled=true;try{const r=await L.resolveDefault(callSetWanToLan(next),{});this.wanToLanOn=(r&&typeof r.enabled==='boolean')?r.enabled:(next==='1');}finally{if(btn)btn.disabled=false;this.syncWanToLanToggle(this.wanToLanOn);}},syncVideoToggle(on){if(!this.videoToggle)return;const lit=on===true;this.videoToggle.classList.toggle('is-off',!lit);this.videoToggle.setAttribute('aria-pressed',lit?'true':'false');this.videoToggle.title=lit?_('4K/HD streaming engine is on'):_('4K/HD streaming engine is off');},async toggleVideoEngine(btn){const next=(this.videoOn===true)?'0':'1';if(btn)btn.disabled=true;try{const r=await L.resolveDefault(callSetVideoEngine(next),{});this.videoOn=(r&&typeof r.enabled==='boolean')?r.enabled:(next==='1');}finally{if(btn)btn.disabled=false;this.syncVideoToggle(this.videoOn);}},syncTtlToggle(on){if(!this.ttlToggle)return;const lit=on===true;this.ttlToggle.classList.toggle('is-off',!lit);this.ttlToggle.setAttribute('aria-pressed',lit?'true':'false');this.ttlToggle.title=lit?_('TTL rewriting is on'):_('TTL rewriting is off');},async toggleTtl(btn){const next=(this.ttlOn===true)?'0':'1';if(btn)btn.disabled=true;try{const r=await L.resolveDefault(callSetTtl(next),{});this.ttlOn=(r&&typeof r.enabled==='boolean')?r.enabled:(next==='1');}finally{if(btn)btn.disabled=false;this.syncTtlToggle(this.ttlOn);}},syncLedToggle(on){if(!this.ledToggle)return;const lit=on!==false;this.ledToggle.classList.toggle('is-off',!lit);this.ledToggle.setAttribute('aria-pressed',lit?'true':'false');this.ledToggle.title=lit?_('Front panel lights are on'):_('Front panel lights are off');},async toggleLedPower(btn){const next=(this.ledPowerOn===false)?'1':'0';if(btn)btn.disabled=true;try{const r=await L.resolveDefault(callSetLedPower(next),{});this.ledPowerOn=(r&&typeof r.enabled==='boolean')?r.enabled:(next==='1');}finally{if(btn)btn.disabled=false;this.syncLedToggle(this.ledPowerOn);}},pushMetricHistory(name,value){if(value==null||isNaN(value))
return;if(!Array.isArray(this.metricHistory[name]))
this.metricHistory[name]=[];this.metricHistory[name].push(Math.max(0,Math.min(100,Number(value))));if(this.metricHistory[name].length>METRIC_HISTORY_LIMIT)
this.metricHistory[name]=this.metricHistory[name].slice(-METRIC_HISTORY_LIMIT);},renderSparkline(metric,tone){const history=Array.isArray(this.metricHistory[metric])?this.metricHistory[metric]:[];if(!history.length)
return null;const points=history.map((value,index)=>{const x=history.length===1?0:(index/(history.length-1))*100;const y=100-Math.max(0,Math.min(100,value));return`${x.toFixed(2)},${y.toFixed(2)}`;}).join(' ');return E('svg',{'class':`misectel-dashboard-sparkline misectel-dashboard-sparkline--${tone || 'neutral'}`,'viewBox':'0 0 100 100','preserveAspectRatio':'none','aria-hidden':'true'},[E('polyline',{'points':points})]);},renderSetupGuide(setupCompleted,passwordUnset){if(setupCompleted&&!passwordUnset)
return[];if(!setupCompleted){return[E('div',{'class':'misectel-dashboard-setup__main'},[E('div',{'class':'misectel-dashboard-setup__eyebrow'},[_('Setup Wizard')]),E('strong',{'class':'misectel-dashboard-setup__title'},[_('Device initialization settings are not yet complete.')]),E('div',{'class':'misectel-dashboard-setup__text'},[_('Please go to "System Settings" immediately to set an administrator password to protect the web management interface.')]),E('div',{'class':'misectel-dashboard-setup__steps'},[E('span',{'class':'misectel-dashboard-setup__step'},[_('Set Administrator Password')]),E('span',{'class':'misectel-dashboard-setup__step'},[_('Configure Internet access')]),E('span',{'class':'misectel-dashboard-setup__step'},[_('Wi-Fi settings')])])]),E('div',{'class':'misectel-dashboard-setup__actions'},[E('a',{'class':'misectel-dashboard-setup__action misectel-dashboard-setup__action--primary','href':SETUP_URL},[_('Start Configuration')]),E('a',{'class':'misectel-dashboard-setup__action','href':NETWORK_SETTINGS_URL},[_('Configure Internet')]),E('a',{'class':'misectel-dashboard-setup__action','href':WIFI_SETTINGS_URL},[_('Configure Wi-Fi')])])];}
return[E('div',{'class':'misectel-dashboard-setup__main'},[E('div',{'class':'misectel-dashboard-setup__eyebrow'},[_('Security Warning: No Password Set')]),E('strong',{'class':'misectel-dashboard-setup__title'},[_('Set Administrator Password')]),E('div',{'class':'misectel-dashboard-setup__text'},[_('Please go to "System Settings" immediately to set an administrator password to protect the web management interface.')])]),E('div',{'class':'misectel-dashboard-setup__actions'},[E('a',{'class':'misectel-dashboard-setup__action misectel-dashboard-setup__action--primary','href':PASSWORD_SETTINGS_URL},[_('Go to Administration')])])];},renderHeroMeta(data){const board=L.isObject(data.board)?data.board:{};const release=L.isObject(board.release)?board.release:{};const tempText=extractTempText(data.tempInfo);const pills=[{label:_('Device Model'),value:asDisplayValue(data.deviceModel,'--')},{label:_('Firmware Version'),value:asDisplayValue(release.description||release.version,'--')},{label:_('Temperature'),value:hasMeaningfulValue(tempText)?tempText:null}].filter((item)=>hasMeaningfulValue(item.value));return pills.map((item)=>E('span',{'class':'misectel-dashboard-pill'},[E('span',{},[item.label]),E('strong',{},[item.value])]));},renderQuickStatus(data){const internetOnline=data.internetStatus?.online===true;const internetHint=internetOnline?[data.internetStatus?.target,data.internetStatus?.ip,data.internetStatus?.latency].filter((part)=>hasMeaningfulValue(part)).join(' / '):_('Internet Connectivity is Detected every 15 seconds.');const modem=data.primaryModem;const modemHint=modem?[modem.title,modem.status?.text].filter((part)=>hasMeaningfulValue(part)).join(' / '):_('No Modem detected');return[this.renderQuickCard({label:_('Internet Connection'),value:internetOnline?_('Connected'):_('Disconnected'),hint:internetHint,badge:internetOnline?_('Online'):_('Offline'),tone:internetOnline?'internet':'warn',href:NETWORK_SETTINGS_URL}),this.renderQuickCard({label:_('Modem Connection'),value:modem?.network||'--',hint:modemHint,badge:modem?.status?.text||'--',tone:modem?.status?.tone==='online'?'modem':'neutral',href:MODEM_STATUS_URL}),this.renderQuickCard({label:_('Connected Devices'),value:`${data.onlineDeviceCount}`,hint:_('Primary LAN clients online now'),badge:`${data.onlineModemCount} ${data.onlineModemCount==1?_('Online Modem'):_('Online Modems')}`,tone:'device',href:CLIENTS_URL}),this.renderQuickCard({label:_('Wi-Fi Status'),value:data.wifiEnabled?_('Enabled'):_('Disabled'),hint:data.wifiEnabled?_('At least one WiFi is enabled'):_('WiFi not Enabled'),badge:data.wifiEnabled?_('ON'):_('Off'),tone:data.wifiEnabled?'wifi':'neutral',href:WIFI_SETTINGS_URL})];},renderQuickCard(options){const tone=options.tone||'neutral';const className=['misectel-dashboard-quick-card',`misectel-dashboard-quick-card--${tone}`,options.href?'misectel-dashboard-quick-card--clickable':''].join(' ');const children=misectel.compactNodes([E('div',{'class':'misectel-dashboard-quick-card__head'},[E('span',{'class':'misectel-dashboard-quick-card__label'},[options.label]),hasMeaningfulValue(options.badge)?E('span',{'class':'misectel-dashboard-quick-card__badge'},[options.badge]):null]),E('div',{'class':'misectel-dashboard-quick-card__value'},[options.value])]);return options.href?E('a',{'class':className,'href':options.href},children):E('div',{'class':className},children);},renderRuntimeMetrics(data){const systemInfo=L.isObject(data.systemInfo)?data.systemInfo:{};const cpuTone=loadTone(data.cpuPercent);const memoryTone=loadTone(data.memoryPercent);const tempText=extractTempText(data.tempInfo)||'--';const modemTempText=hasMeaningfulValue(data.modemTemp)?(normalizeTemperatureText(data.modemTemp)||String(data.modemTemp)):'--';const loadText=formatLoad(systemInfo.load);const systemTime=L.isObject(data.systemTime)?data.systemTime:{};const localTimeText=hasMeaningfulValue(systemTime.local_time)?systemTime.local_time:(systemInfo.localtime!=null?formatDateTime(systemInfo.localtime):'--');const memoryHint=(data.memoryUsed!=null&&data.memory.total!=null)?`${formatBytes(data.memoryUsed)} / ${formatBytes(data.memory.total)}`:'--';return[this.renderStatCard({label:_('CPU'),value:formatPercent(data.cpuPercent),hint:hasMeaningfulValue(loadText)?loadText:'--',progress:data.cpuPercent,tone:cpuTone,sparkline:this.renderSparkline('cpu',cpuTone)}),this.renderStatCard({label:_('Memory'),value:formatPercent(data.memoryPercent),hint:memoryHint,progress:data.memoryPercent,tone:memoryTone,sparkline:this.renderSparkline('memory',memoryTone)}),this.renderStatCard({label:_('Uptime'),value:formatDuration(systemInfo.uptime),hint:localTimeText,tone:'neutral'}),this.renderStatCard({label:_('Modem Temp'),value:modemTempText,hint:hasMeaningfulValue(data.modemTemp)?(data.primaryModem?.title||_('Modem')):_('No modem detected'),tone:temperatureTone(modemTempText)})];},renderStatCard(options){const tone=options.tone||'neutral';const className=['misectel-dashboard-stat',`misectel-dashboard-stat--${tone}`,options.href?'misectel-dashboard-stat--clickable':''].filter(Boolean).join(' ');const children=misectel.compactNodes([E('div',{'class':'misectel-dashboard-stat__head'},misectel.compactNodes([E('span',{'class':'misectel-dashboard-stat__label'},[options.label]),options.sparkline||(hasMeaningfulValue(options.badge)?E('span',{'class':'misectel-dashboard-stat__badge'},[options.badge]):null)])),E('div',{'class':'misectel-dashboard-stat__value'},[options.value])]);if(hasMeaningfulValue(options.hint))
children.push(E('div',{'class':'misectel-dashboard-stat__hint'},[options.hint]));if(options.progress!=null){children.push(E('div',{'class':'misectel-dashboard-progress'},[E('span',{'style':`width:${Math.max(0, Math.min(100, options.progress))}%`})]));}
if(Array.isArray(options.footer)&&options.footer.length){children.push(E('div',{'class':'misectel-dashboard-stat__footer'},options.footer.map((item)=>E('div',{'class':'misectel-dashboard-stat__meta'},[E('span',{'class':'misectel-dashboard-stat__meta-label'},[item.label]),E('strong',{'class':'misectel-dashboard-stat__meta-value'},[item.value])]))));}
return options.href?E('a',{'class':className,'href':options.href},children):E('div',{'class':className},children);},renderSystem(data){const board=L.isObject(data.board)?data.board:{};const release=L.isObject(board.release)?board.release:{};const systemInfo=L.isObject(data.systemInfo)?data.systemInfo:{};const systemTime=L.isObject(data.systemTime)?data.systemTime:{};const fields=[{label:_('Device Model'),value:asDisplayValue(data.deviceModel,'--')},{label:_('Firmware Version'),value:asDisplayValue(release.description||release.version,'--')},{label:_('Kernel Version'),value:asDisplayValue(board.kernel,'--')},{label:_('CPU Model'),value:asDisplayValue(data.cpuInfo.cpuinfo||board.system,'--')},{label:_('Local Time'),value:hasMeaningfulValue(systemTime.local_time)?systemTime.local_time:formatDateTime(systemInfo.localtime)},{label:_('Uptime'),value:formatDuration(systemInfo.uptime)},{label:_('System Load'),value:formatLoad(systemInfo.load)},{label:_('Available Memory'),value:(data.memory.available!=null&&data.memory.total!=null)?`${formatBytes(data.memory.available)} / ${formatBytes(data.memory.total)}`:'--'}].filter((field)=>hasMeaningfulValue(field.value));return fields.length?fields.map((field)=>misectel.createInfoItem(field.label,field.value)):[misectel.createEmptyState(_('No System Info'))];},renderModems(modems){if(!modems.length)
return[misectel.createEmptyState(_('No Modem detected'))];if(!this.selectedModemId||!modems.some((modem)=>modem.id===this.selectedModemId))
this.selectedModemId=modems[0].id;const modem=modems.find((item)=>item.id===this.selectedModemId)||modems[0];const modemHead=[E('h4',{'class':'misectel-dashboard-modem__name'},[modem.title])];if(hasMeaningfulValue(modem.subtitle))
modemHead.push(E('div',{'class':'misectel-dashboard-modem__meta'},[modem.subtitle]));const children=[E('div',{'class':'misectel-dashboard-modem__overview'},[E('div',{'class':'misectel-dashboard-signal'},[E('div',{'class':'misectel-dashboard-signal__bars'},[0,1,2,3].map((index)=>E('span',{'class':['misectel-dashboard-signal__bar',index<modem.signalLevel?'is-active':'',`is-${signalTone(modem.signalLevel)}`].filter(Boolean).join(' ')}))),E('div',{'class':'misectel-dashboard-signal__label'},[_('Signal Quality')])]),E('div',{'class':'chester-modeside'},[E('div',{'class':'misectel-dashboard-chip-row'},modem.highlights.length?modem.highlights.map((chip)=>misectel.createChip(chip.label,chip.value)):[misectel.createChip(_('Status'),modem.status.text)]),modem.id?chesterModeButtons(modem):E('div',{})])])];if(modem.signals.length){children.push(E('div',{'class':'misectel-dashboard-signal-grid'},modem.signals.map((detail)=>E('div',{'class':'misectel-dashboard-signal-card'},[E('span',{'class':'misectel-dashboard-signal-card__label'},[detail.label]),E('strong',{'class':'misectel-dashboard-signal-card__value'},[detail.value])]))));}

var chesterBands=chesterBandFields(modem.carriers);var chesterList=function(items){return E('dl',{'class':'misectel-dashboard-description-list'},items.reduce((nodes,detail)=>{nodes.push(E('dt',{},[detail.label]));nodes.push(E('dd',{},[detail.value]));return nodes;},[]));};if(modem.description.length||chesterBands.length){children.push(E('div',{'class':'misectel-dashboard-detail-split'},[modem.description.length?chesterList(modem.description):E('div',{}),chesterBands.length?chesterBandGrid(chesterBands):E('div',{})]));}
else{children.push(E('div',{'class':'misectel-dashboard-signal-grid'},[E('div',{'class':'misectel-dashboard-signal-card'},[E('span',{'class':'misectel-dashboard-signal-card__label'},[_('Status')]),E('strong',{'class':'misectel-dashboard-signal-card__value'},[modem.status.text])])]));}
return[E('article',{'class':'misectel-dashboard-modem'},children)];},renderPorts(ports){if(!ports.length)
return[misectel.createEmptyState(_('No Ethernet Ports Found'))];return ports.map((port)=>{const isWan=String(port.logical||'').toLowerCase()==='wan';const asLan=(this.wanToLanOn===true);const label=isWan?(asLan?_('LAN'):_('WAN')):port.name;const cls=['misectel-dashboard-port-panel__port',`is-${port.speedTier || 'offline'}`,`is-${port.tone || 'offline'}`];if(isWan)cls.push('is-switchable');const attrs={'class':cls.join(' ')};if(isWan){attrs.title=asLan?_('This socket is a LAN port. Click to make it a WAN uplink.'):_('This socket is a WAN uplink. Click to make it a LAN port.');attrs.role='button';attrs.tabindex='0';attrs.click=(ev)=>{this.toggleWanToLan(ev.currentTarget);};}const online=(port.tone==='online');const kids=[E('strong',{'class':'misectel-dashboard-port-panel__name'},[label])];if(online)kids.push(E('div',{'class':'misectel-dashboard-port-panel__speed'},[port.speed]));return E('div',attrs,kids);});},renderSystemCompact(data){const board=L.isObject(data.board)?data.board:{};const release=L.isObject(board.release)?board.release:{};const systemInfo=L.isObject(data.systemInfo)?data.systemInfo:{};const systemTime=L.isObject(data.systemTime)?data.systemTime:{};const primaryMac=extractPrimaryMac(board,data.logicalInterfaces,data.ports);const fields=[{label:_('Device Model'),value:asDisplayValue(data.deviceModel,'--')},{label:_('Firmware Version'),value:asDisplayValue(release.description||release.version,'--')},{label:_('Local Time'),value:hasMeaningfulValue(systemTime.local_time)?systemTime.local_time:formatDateTime(systemInfo.localtime)},].filter((field)=>hasMeaningfulValue(field.value));return fields.length?fields.map((field)=>misectel.createInfoItem(field.label,field.value)):[misectel.createEmptyState(_('No System Info'))];},renderWanCompact(interfaces){if(!interfaces.length)
return[misectel.createEmptyState(_('WAN management is unavailable'))];return interfaces.map((iface)=>E('article',{'class':'misectel-dashboard-wan misectel-dashboard-wan--compact'},[E('div',{'class':'misectel-dashboard-wan__head'},[E('div',{'class':'misectel-dashboard-wan__title'},[E('h4',{'class':'misectel-dashboard-wan__name'},[iface.name]),E('div',{'class':'misectel-dashboard-wan__meta'},[`${iface.l3Device} / ${iface.proto}`])]),misectel.createBadge(iface.statusText,iface.tone)]),E('div',{'class':'misectel-dashboard-wan__grid misectel-dashboard-wan__grid--compact'},[this.renderDashboardDetail('IPv4',iface.ipv4),this.renderDashboardDetail(_('Gateway'),iface.gateway),this.renderDashboardDetail(_('RX Traffic'),iface.rx),this.renderDashboardDetail(_('TX Traffic'),iface.tx)])]));},renderDashboardDetail(label,value){return E('div',{'class':'misectel-dashboard-detail'},[E('span',{'class':'misectel-dashboard-detail__label'},[label]),E('span',{'class':'misectel-dashboard-detail__value'},[value])]);},renderWanInterfaces(interfaces){if(!interfaces.length)
return[misectel.createEmptyState(_('WAN management is unavailable'))];return interfaces.map((iface)=>E('article',{'class':'misectel-dashboard-wan'},[E('div',{'class':'misectel-dashboard-wan__head'},[E('div',{'class':'misectel-dashboard-wan__title'},[E('h4',{'class':'misectel-dashboard-wan__name'},[iface.name]),E('div',{'class':'misectel-dashboard-wan__meta'},[`${iface.l3Device} / ${iface.proto}`])]),misectel.createBadge(iface.statusText,iface.tone)]),E('div',{'class':'misectel-dashboard-wan__grid'},[this.renderDashboardDetail('IPv4',iface.ipv4),this.renderDashboardDetail('IPv6',iface.ipv6),this.renderDashboardDetail(_('Gateway'),iface.gateway),this.renderDashboardDetail(_('Online Time'),iface.uptime),this.renderDashboardDetail(_('RX Traffic'),iface.rx),this.renderDashboardDetail(_('TX Traffic'),iface.tx)])]));},renderLogicalInterfaces(interfaces){if(!interfaces.length)
return[misectel.createEmptyState(_('No interface data available.'))];const headers=[_('Name'),_('Type'),_('Status'),_('Device'),_('MAC Address'),'IPv4','IPv6',_('Link Speed'),_('RX Traffic'),_('TX Traffic')];return[E('div',{'class':'misectel-dashboard-interface-table-wrap'},[E('table',{'class':'misectel-dashboard-interface-table'},[E('thead',{},[E('tr',{},headers.map((label)=>E('th',{},[label])))]),E('tbody',{},interfaces.map((iface)=>E('tr',{'class':`is-${iface.tone || 'offline'}`},[E('td',{'data-label':_('Name')},[iface.name]),E('td',{'data-label':_('Type')},[iface.type]),E('td',{'data-label':_('Status')},[misectel.createBadge(iface.statusText,iface.tone)]),E('td',{'data-label':_('Device')},[iface.device]),E('td',{'data-label':_('MAC Address')},[iface.mac]),E('td',{'data-label':'IPv4'},[iface.ipv4]),E('td',{'data-label':'IPv6'},[iface.ipv6]),E('td',{'data-label':_('Link Speed')},[iface.speed]),E('td',{'data-label':_('RX Traffic')},[iface.rx]),E('td',{'data-label':_('TX Traffic')},[iface.tx])])))])])];},updateShell(data){if(data&&data.ledPowerOn!==null&&data.ledPowerOn!==undefined){this.ledPowerOn=data.ledPowerOn;this.syncLedToggle(this.ledPowerOn);}if(data&&data.ttlOn!==null&&data.ttlOn!==undefined){this.ttlOn=data.ttlOn;this.syncTtlToggle(this.ttlOn);}if(data&&data.videoOn!==null&&data.videoOn!==undefined){this.videoOn=data.videoOn;this.syncVideoToggle(this.videoOn);}if(data&&data.wanToLanOn!==null&&data.wanToLanOn!==undefined){this.wanToLanOn=data.wanToLanOn;this.syncWanToLanToggle(this.wanToLanOn);}this.latestData=data;this.pushMetricHistory('cpu',data.cpuPercent);this.pushMetricHistory('memory',data.memoryPercent);this.updateModemSelect(data.modems);dom.content(this.heroMeta,this.renderHeroMeta(data));this.securityNode.style.display=(!data.setupCompleted||data.passwordUnset)?'':'none';dom.content(this.securityNode,this.renderSetupGuide(data.setupCompleted,data.passwordUnset));dom.content(this.summaryNode,this.renderQuickStatus(data));dom.content(this.metricsNode,this.renderRuntimeMetrics(data));dom.content(this.modemNode,this.renderModems(data.modems));dom.content(this.portPanelNode,this.renderPorts(data.ports));dom.content(this.systemNode,this.renderSystemCompact(data));dom.content(this.wanNode,this.renderWanCompact(data.wanInterfaces));this.loadingNode.style.display='none';},updateModemSelect(modems){if(modems.length<=1){this.selectedModemId=modems.length?modems[0].id:null;this.modemSelectWrap.style.display='none';dom.content(this.modemSelect,[]);return;}
if(!this.selectedModemId||!modems.some((modem)=>modem.id===this.selectedModemId))
this.selectedModemId=modems[0].id;dom.content(this.modemSelect,modems.map((modem)=>E('option',{'value':modem.id,'selected':modem.id===this.selectedModemId?'selected':null},[modem.title])));this.modemSelectWrap.style.display='';},render(){const shell=this.createShell();return this.fetchData().then((data)=>{this.updateShell(data);poll.add(()=>this.fetchData().then((nextData)=>{this.updateShell(nextData);}).catch(()=>{}),REFRESH_INTERVAL);return shell;}).catch(()=>{this.loadingNode.style.display='none';dom.content(this.modemNode,[misectel.createEmptyState(_('Failed to load Overview'))]);return shell;});},handleSaveApply:null,handleSave:null,handleReset:null});