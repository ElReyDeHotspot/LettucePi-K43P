
function check(value,message){if(!value)die(message);}
mkdir(RUN,0700);
let c={device:'rmnet_mhi0.1',network_key:'network-a',automatic:1500,v4:{up:true},v6:{up:true},u:{get:(config,sid,key)=>key=='smart_network'?'network-a':key=='smart_limit'?'1360':null}};
let job={token:'1-1',device:c.device,network_key:c.network_key,ceiling:1500};
let result={success:true,timestamp:time(),checks:[{family:4,confirmed:true,verified_bytes:1428},{family:6,confirmed:true,verified_bytes:1400}]};
write(RUN+'/job.json',sprintf('%J',job));write(RUN+'/result-1-1.json',sprintf('%J',result));check(smartValue(c,true).mtu==1400,'Smart did not choose the verified dual-stack minimum');
result.checks[1].confirmed=false;write(RUN+'/result-1-1.json',sprintf('%J',result));check(smartValue(c,true).mtu==1360,'Inconclusive tests discarded the known working limit');
c.network_key='network-b';check(smartValue(c,true).mtu==1500,'Old carrier measurements were used on a different connection');
c.network_key='network-a';c.v6.up=false;check(smartValue(c,true).mtu==1428,'An intentionally inactive family blocked the active family');
result.timestamp=time()-400;write(RUN+'/result-1-1.json',sprintf('%J',result));check(smartValue(c,true).mtu==1360,'Stale probes changed the MTU');
print('PASS Smart dual-stack selection, inconclusive fallback, network binding, inactive-family handling and stale-result rejection.\n');
