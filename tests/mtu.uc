'use strict';
import {defaults,validate,rules} from '/usr/share/chester/mtu.uc';
function check(value,message){if(!value)die(message);}
check(validate({...defaults,mtu_mode:'smart',mss_enabled:false,mss_mode:'custom'},1500).mss_enabled&&validate({...defaults,mtu_mode:'smart'},1500).mss_mode=='auto','Smart must manage automatic MSS');
check(validate(defaults,1500).mss_enabled,'Default MSS should be enabled');
for(let size in [1280,1400,1500])check(validate({...defaults,mtu_mode:'custom',mtu:size},1500).mtu==size,'Valid MTU rejected');
for(let bad in [{...defaults,mtu:1279},{...defaults,mtu:1501},{...defaults,mtu:'1400'},{...defaults,mtu_mode:'shell'},{...defaults,mss_enabled:'yes'},{...defaults,mss_mode:'custom',mss4:1500},{...defaults,mtu_mode:'custom',mtu:1400,mss_mode:'custom',mss6:1440}]){
 let rejected=false;try{validate(bad,1500);}catch(e){rejected=true;}check(rejected,'Invalid settings accepted');
}
let auto=rules(defaults,'rmnet_mhi0.1','wan',true);
check(index(auto.forward,'Cellular IPv4 In')>=0&&index(auto.post,'Cellular IPv6 Out')>=0,'Both families/directions must clamp');
check(index(auto.forward,'iifname != "rmnet_mhi0.1"')>=0&&index(auto.post,'Other Uplinks Out')>=0,'Other WAN clamping was not preserved');
let off=rules({...defaults,mss_enabled:false},'rmnet_mhi0.1','wan',true);
check(index(off.forward,'Cellular')<0&&index(off.post,'Cellular')<0&&index(off.forward,'Other Uplinks')>=0,'Disable affected the wrong uplink');
let custom=rules({...defaults,mss_mode:'custom',mss4:1200,mss6:1180},'rmnet_mhi0.1','wan',false);
check(index(custom.forward,'size > 1200')>=0&&index(custom.post,'size set 1180')>=0,'Custom MSS must only reduce the existing option');
let rejected=false;try{rules(defaults,'wan;reboot','wan',true);}catch(e){rejected=true;}check(rejected,'Unsafe interface accepted');
print('PASS MTU limits, automatic defaults, MSS limits, bidirectional IPv4/IPv6 rules, disabled behavior and other-uplink preservation.\n');
