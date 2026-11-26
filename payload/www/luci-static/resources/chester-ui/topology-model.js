'use strict';
'require baseclass';
const MAC=/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const safeID=id=>typeof id==='string'&&/^(?:router|internet|lan|port:(?:lan[1-4]|wan)|wifi:[\w.-]{1,40}|device:(?:[0-9A-F]{2}:){5}[0-9A-F]{2}|custom:[\w-]{1,48})$/.test(id);
const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\x00-\x1f]/.test(v);
function empty(){return {schema:1,nodes:[],links:[],positions:{},parents:{},rooms:{},remembered:[]};}
function validate(raw){
 if(!raw||raw.schema!==1)throw new Error('Choose a Chester Network Map export.');
 const m=empty(),ids=new Set();
 if(!Array.isArray(raw.nodes)||raw.nodes.length>128||!Array.isArray(raw.links)||raw.links.length>512||!Array.isArray(raw.remembered)||raw.remembered.length>512)throw new Error('The map exceeds its device or link limit.');
 m.nodes=raw.nodes.map(n=>{if(!n||!safeID(n.id)||!n.id.startsWith('custom:')||ids.has(n.id)||!text(n.name,64)||!n.name.trim()||!['switch','accesspoint','router','server','device'].includes(n.icon))throw new Error('Check the infrastructure names and icons.');ids.add(n.id);return {id:n.id,name:n.name.trim(),icon:n.icon};});
 m.links=raw.links.map(l=>{if(!l||!safeID(l.from)||!safeID(l.to)||l.from===l.to||!text(l.label||'',64))throw new Error('Choose two different devices for each link.');return {from:l.from,to:l.to,label:l.label||''};});
 for(const key of ['positions','parents','rooms']){const entries=Object.entries(raw[key]||{});if(entries.length>768)throw new Error('The map contains too many saved details.');for(const [id,v]of entries){if(!safeID(id))throw new Error('Invalid map device.');if(key==='positions'){if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>20000||Math.abs(v.y)>20000)throw new Error('Move devices within the map area.');m.positions[id]={x:v.x,y:v.y};}else if(key==='parents'){if(!safeID(v)||v===id||['internet','router'].includes(id))throw new Error('Invalid uplink.');m.parents[id]=v;}else{if(!text(v,64))throw new Error('Use a room name of up to 64 characters.');m.rooms[id]=v;}}}
 for(const id of Object.keys(m.parents)){const seen=new Set([id]);let p=m.parents[id];while(p){if(seen.has(p))throw new Error('Uplinks cannot form a loop. Use an additional link for a redundant connection.');seen.add(p);p=m.parents[p];}}
 m.remembered=raw.remembered.map(d=>{if(!d||!MAC.test(d.mac)||!text(d.hostname||'',64)||!text(d.ipaddr||'',64)||!text(d.interface||'',40)||!text(d.ssid||'',64)||!text(d.band||'',24)||!['wired','wireless','static'].includes(d.connection)||!Number.isFinite(d.lastSeen)||d.lastSeen<0)throw new Error('Invalid remembered client.');return {mac:d.mac,hostname:d.hostname||'',ipaddr:d.ipaddr||'',interface:d.interface||'',ssid:d.ssid||'',band:d.band||'',connection:d.connection,lastSeen:d.lastSeen};});
 if(JSON.stringify(m).length>196608)throw new Error('The map is too large.');return m;
}
function build(runtime,devices,profiles,map){
 const nodes=[{id:'internet',name:'Internet',icon:'router',kind:'upstream',detail:'Upstream Network',evidence:'Logical upstream; no physical path inferred.'},{id:'router',name:runtime.hostname||'Chester K43P',icon:'router',kind:'router',ipaddr:runtime.address||'',detail:runtime.address||'Router',evidence:'This Router'},{id:'lan',name:'Local Network',icon:'switch',kind:'segment',detail:'Shared LAN Segment',evidence:'Unknown physical paths are grouped here.'}],edges=[{from:'internet',to:'router',kind:'logical',label:'Upstream'},{from:'router',to:'lan',kind:'logical',label:'LAN'}],ports=new Set(),fdb={},portLabels={};
 for(const port of runtime.ports||[]){ports.add(port.device);portLabels[port.device]=port.label||port.device.toUpperCase();nodes.push({id:'port:'+port.device,name:port.label||port.device.toUpperCase(),icon:'ethernet',kind:'port',online:port.carrier,detail:port.carrier?(port.speed>=1000?(port.speed/1000)+'Gbps':port.speed+'Mbps'):'Disconnected',evidence:'Physical Ethernet Link'});edges.push({from:'router',to:'port:'+port.device,kind:'physical',label:port.role==='lan'?'LAN':'WAN'});}
 for(const f of runtime.fdb||[])if(ports.has(f.device)){const mac=String(f.mac).toUpperCase();if(!fdb[mac])fdb[mac]=new Set();fdb[mac].add(f.device);}
 const all=new Map((map.remembered||[]).map(d=>[d.mac,{...d,tone:'offline',remembered:true}]));for(const d of devices.slice(0,512))all.set(d.mac.toUpperCase(),{...d,mac:d.mac.toUpperCase()});
 for(const d of [...all.values()].sort((a,b)=>(b.tone==='online')-(a.tone==='online')).slice(0,512)){
  const p=profiles[d.mac]||{},id='device:'+d.mac,online=d.tone==='online',wireless=d.connection==='wireless';let parent='lan',evidence=online?'Physical uplink not detected.':'Last Known Client · Not Currently Seen';
  if(online&&wireless&&/^[\w.-]{1,40}$/.test(d.interface||'')){parent='wifi:'+d.interface;if(!nodes.some(n=>n.id===parent)){nodes.push({id:parent,name:d.ssid||'Wi-Fi',icon:'accesspoint',kind:'wifi',detail:d.band||'Wireless',evidence:'Router Wireless Interface'});edges.push({from:'router',to:parent,kind:'physical',label:d.band||'Wi-Fi'});}evidence='Associated with '+(d.ssid||d.interface);}
  else if(online&&fdb[d.mac]?.size===1){parent='port:'+Array.from(fdb[d.mac])[0];evidence='Learned behind '+portLabels[parent.slice(5)]+'. Intermediate switches may be hidden.';}
  nodes.push({...d,id,name:p.name||(d.hostname&&d.hostname!=='--'?d.hostname:'Unnamed Device'),icon:p.icon||'auto',kind:'client',online,detail:d.ipaddr||'No IP Address',evidence});edges.push({from:parent,to:id,kind:online&&wireless?'physical':'learned',label:wireless?'Wi-Fi':'Learned Path'});
 }
 for(const n of map.nodes)nodes.push({...n,kind:'custom',detail:map.rooms[n.id]||'Manually Mapped',evidence:'Manually Added · Status Not Monitored'});
 const index=new Map(nodes.map(n=>[n.id,n]));
 for(const [to,from]of Object.entries(map.parents))if(index.has(to)&&index.has(from)){const e=edges.find(e=>e.to===to);if(e)Object.assign(e,{from,kind:'manual',label:'Mapped Uplink'});else edges.push({from,to,kind:'manual',label:'Mapped Uplink'});}
 for(const l of map.links)if(index.has(l.from)&&index.has(l.to))edges.push({...l,kind:'manual',label:l.label||'Mapped Link'});
 for(const n of nodes){n.room=map.rooms[n.id]||'';}
 return {nodes,edges};
}
function layout(graph,saved){
 const positions={},depth={},active=new Set();const level=id=>{if(depth[id]!=null)return depth[id];if(active.has(id))return 0;active.add(id);const edge=graph.edges.find(e=>e.to===id&&e.label!=='Mapped Link');const n=edge?Math.min(8,level(edge.from)+1):2;active.delete(id);return depth[id]=n;},rows={};
 for(const n of graph.nodes){const d=level(n.id),row=rows[d]||0;rows[d]=row+1;positions[n.id]=saved[n.id]||{x:50+d*270,y:50+row*145};}return positions;
}
return baseclass.extend({empty,validate,build,layout,safeID});
