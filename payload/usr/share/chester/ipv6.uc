'use strict';
export const defaults = {mode:'auto',slaac:true,dhcpv6:'disabled',prefix:'auto',dns:'auto',custom_dns:[],firewall:true,recovery:true};
export const modes = ['auto','pd','relay','nat66','disabled'];
export function ipv6(s) {
 if(type(s)!='string'||!match(s,/^[0-9a-fA-F:]+$/))return false;
 let halves=split(s,'::');if(length(halves)>2)return false;
 let count=0;for(let half in halves){if(half=='')continue;for(let word in split(half,':')){if(!match(word,/^[0-9a-fA-F]{1,4}$/))return false;count++;}}
 return length(halves)==2?count<8:count==8;
};
export function validate(raw) {
 if(type(raw)!='object'||index(modes,raw.mode)<0)die('Choose a valid connection mode.');
 let s={mode:raw.mode,enabled:raw.mode!='disabled',slaac:raw.slaac,dhcpv6:raw.dhcpv6,prefix:raw.prefix,dns:raw.dns,custom_dns:raw.custom_dns||[],firewall:raw.firewall,recovery:raw.recovery};
 for(let k in ['slaac','firewall','recovery'])if(type(s[k])!='bool')die('Choose valid switches.');
 if(index(['disabled','stateless','stateful'],s.dhcpv6)<0||index(['auto','48','56','60','64'],s.prefix)<0||index(['auto','cloudflare','google','quad9','manual'],s.dns)<0)die('Choose valid LAN settings.');
 if(type(s.custom_dns)!='array'||length(s.custom_dns)>4)die('Enter up to four IPv6 DNS servers.');
 for(let address in s.custom_dns)if(!ipv6(address)||address=='::'||address=='::1'||match(lc(address),/^ff/))die('Enter valid unicast IPv6 DNS addresses.');
 if(s.dns=='manual'&&!length(s.custom_dns))die('Enter at least one IPv6 DNS server.');
 if(s.enabled&&!s.slaac&&s.dhcpv6!='stateful')die('Enable SLAAC or Stateful DHCPv6 to assign client addresses.');
 return s;
};
export function activeMode(s,r) {
 if(s.mode!='auto')return s.mode;
 if(r.has_pd)return 'pd';
 if(r.shared64)return 'relay';
 if(r.address)return 'nat66';
 return 'waiting';
};
export function plan(s,c,r) {
 let iface=c.interface,active=activeMode(s,r),out=[];
 let put=(config,sid,key,value)=>push(out,{config:config,sid:sid,key:key,value:value});
 let net=(key,value)=>put('network',iface,key,value),lan=(key,value)=>put('network','lan',key,value),dh=(key,value)=>put('dhcp','lan',key,value);
 if(!iface||!c.lan_zone||!c.wan_zone)die('A cellular IPv6 interface and LAN/WAN firewall zones are required.');
 net('disabled',s.enabled?'0':'1');
 net('reqprefix',s.prefix);net('delegate','1');net('sourcefilter',active=='nat66'?'0':'1');
 net('extendprefix',active=='relay'||s.mode=='auto'&&active=='waiting'?'1':'0');
 lan('ip6assign',!s.enabled?'0':'64');lan('ip6class',active=='nat66'?['local']:null);
 dh('ra',!s.enabled?'disabled':'server');
 dh('ndp',active=='relay'&&!r.noarp?'relay':'disabled');
 dh('dhcpv6',!s.enabled||s.dhcpv6=='disabled'?'disabled':'server');
 dh('ra_slaac',s.slaac?'1':'0');dh('dhcpv6_na',s.dhcpv6=='stateful'?'1':'0');
 dh('ra_flags',s.dhcpv6=='stateful'?['managed-config','other-config']:s.dhcpv6=='stateless'?['other-config']:['none']);
 dh('ra_default',active=='nat66'?'1':'0');
 let servers={cloudflare:['2606:4700:4700::1111','2606:4700:4700::1001'],google:['2001:4860:4860::8888','2001:4860:4860::8844'],quad9:['2620:fe::fe','2620:fe::9']};
 let dns=s.dns=='manual'?s.custom_dns:servers[s.dns]||[];
 net('peerdns',length(dns)?'0':'1');net('dns',length(dns)?dns:null);
 let v4=[];for(let value in c.lan_dns||[])if(index(value,':')<0)push(v4,value);
 dh('dns',length(v4)+length(dns)?[...v4,...dns]:null);
 return {active:active,changes:out,dns:dns,relay_master:active=='relay'&&!r.noarp,nat66:active=='nat66',inbound:s.enabled&&!s.firewall,disabled:!s.enabled};
};
