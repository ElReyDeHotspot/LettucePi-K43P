'use strict';
export const defaults={mtu_mode:'auto',mtu:1500,mss_enabled:true,mss_mode:'auto',mss4:1460,mss6:1440};
export function validate(raw,automatic) {
 if(type(raw)!='object'||index(['auto','smart','custom'],raw.mtu_mode)<0||index(['auto','custom'],raw.mss_mode)<0||type(raw.mss_enabled)!='bool')die('Choose valid MTU and MSS settings.');
 let s={...defaults,...raw};if(s.mtu_mode=='smart'){s.mss_enabled=true;s.mss_mode='auto';}
 for(let key in ['mtu','mss4','mss6'])if(type(s[key])!='int')die('Enter whole numbers for MTU and MSS.');
 if(s.mtu<1280||s.mtu>1500)die('MTU must be between 1280 and 1500 bytes for this dual-stack cellular connection.');
 let limit=s.mtu_mode=='custom'?s.mtu:automatic;
 if(s.mss4<536||s.mss4>1460||s.mss6<536||s.mss6>1440)die('Enter valid TCP MSS limits.');
 if(s.mss_enabled&&s.mss_mode=='custom'&&(s.mss4>limit-40||s.mss6>limit-60))die('The MSS limits must fit the selected MTU: IPv4 up to '+(limit-40)+', IPv6 up to '+(limit-60)+'.');
 return {mtu_mode:s.mtu_mode,mtu:s.mtu,mss_enabled:s.mss_enabled,mss_mode:s.mss_mode,mss4:s.mss4,mss6:s.mss6};
};
export function rules(s,device,zone,preserve) {
 if(!match(device,/^[A-Za-z0-9_.-]{1,15}$/)||!match(zone,/^[A-Za-z_][A-Za-z0-9_]*$/))die('Unsupported cellular interface or firewall zone name.');
 let forward=[],post=[],syn=' tcp flags syn / syn,fin,rst ',quoted=sprintf('%J',device);
 if(preserve){
  push(forward,'iifname $'+zone+'_devices iifname != '+quoted+syn+'counter tcp option maxseg size set rt mtu comment "Chester MSS Other Uplinks In"');
  push(post,'oifname $'+zone+'_devices oifname != '+quoted+syn+'counter tcp option maxseg size set rt mtu comment "Chester MSS Other Uplinks Out"');
 }
 if(s.mss_enabled)for(let family in [4,6]){
  let head='meta nfproto ipv'+family+' ',value=family==4?s.mss4:s.mss6;
  let set=s.mss_mode=='auto'?'counter tcp option maxseg size set rt mtu':'tcp option maxseg size > '+value+' counter tcp option maxseg size set '+value;
  push(forward,head+'iifname '+quoted+syn+set+' comment "Chester MSS Cellular IPv'+family+' In"');
  push(post,head+'oifname '+quoted+syn+set+' comment "Chester MSS Cellular IPv'+family+' Out"');
 }
 return {forward:join('\n',forward)+'\n',post:join('\n',post)+'\n'};
};
