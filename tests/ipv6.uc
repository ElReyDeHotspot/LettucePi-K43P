'use strict';
import {validate,plan,activeMode,ipv6,defaults} from '/usr/share/chester/ipv6.uc';
function check(ok,message){if(!ok)die(message);}
check(defaults.mode=='auto'&&defaults.slaac&&defaults.dhcpv6=='disabled'&&defaults.prefix=='auto'&&defaults.dns=='auto'&&defaults.firewall&&defaults.recovery&&!length(defaults.custom_dns),'Recommended factory defaults changed');
check(validate(defaults).enabled,'Factory IPv6 must be enabled');
const base={mode:'auto',slaac:true,dhcpv6:'stateless',prefix:'auto',dns:'auto',custom_dns:[],firewall:true,recovery:true};
const ctx={interface:'pcie0v6',lan_zone:'lan',wan_zone:'wan',lan_dns:['9.9.9.9','2001:db8::53'],ula:'fd00:1234::/48'};
for(let mode in ['auto','pd','relay','nat66','disabled']){
 let s=validate({...base,mode:mode}),p=plan(s,ctx,{shared64:true,address:'2001:db8::2'});
 check(length(p.changes)>10,'Missing mode changes');check(p.changes[0].sid=='pcie0v6','Hardcoded modem selected');
 check(p.nat66==(mode=='nat66'),'NAT66 escaped selected mode');check(p.disabled==(mode=='disabled'),'Disabled state mismatch');
 for(let row in p.changes)check(index(['start','limit','dhcpv4','ipaddr','proto','metric'],row.key)<0,'IPv4 setting modified');
}
check(activeMode(base,{has_pd:true,shared64:true,address:'2001:db8::2'})=='pd','PD preference failed');
check(activeMode(base,{shared64:true,address:'2001:db8::2'})=='relay','Shared /64 failed');
check(activeMode(base,{address:'2001:db8::2'})=='nat66','NAT fallback failed');
check(!plan(validate(base),ctx,{shared64:true,noarp:true,address:'2001:db8::2'}).relay_master,'NDP relay enabled on point-to-point modem');
check(activeMode(base,{})=='waiting','Disconnected claimed connected');
check(ipv6('2001:db8::1')&&ipv6('::1')&&ipv6('fe80::1'),'IPv6 literal parse failed');
for(let ip in ['::::','2001:db8::gg','2001:db8::1%eth0','2001:db8::1;reboot','1:2:3:4:5:6:7','1:2:3:4:5:6:7:8:9'])check(!ipv6(ip),'Invalid IPv6 accepted');
for(let bad in [{...base,slaac:false,dhcpv6:'stateless'},{...base,dns:'manual',custom_dns:[]},{...base,dns:'manual',custom_dns:['ff02::1']},{...base,mode:'passthrough'},{...base,mode:'shell'},{...base,firewall:'true'}]){
 let failed=false;try{validate(bad);}catch(e){failed=true;}check(failed,'Invalid settings accepted');
}
check(validate({...base,slaac:false,dhcpv6:'stateful'}).dhcpv6=='stateful','Stateful addressing rejected');
let p=plan(validate({...base,dns:'cloudflare'}),ctx,{shared64:true,address:'2001:db8::2'});
let dns=null;for(let row in p.changes)if(row.config=='dhcp'&&row.key=='dns')dns=row.value;
check(dns[0]=='9.9.9.9'&&length(dns)==3,'IPv4 DNS was not preserved');
check(plan(validate({...base,firewall:false}),ctx,{has_pd:true}).inbound,'Firewall switch ignored');
print('PASS available IPv6 plans, automatic selection, offline handling, IPv6/DNS validation, IPv4 preservation and firewall scope.\n');
