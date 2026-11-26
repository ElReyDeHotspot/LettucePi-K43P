"""Generate isolated ucode fixtures for both home app-update implementations."""
from pathlib import Path
import re
source=(Path(__file__).resolve().parents[1]/'payload/usr/share/rpcd/ucode/chester.update').read_text(encoding='utf-8').split('\n',1)[1]
source=re.sub(r'^import .*?;\n','',source,flags=re.M).replace("return {'chester.update':{status:{call:()=>status()}}};",'')
print('''let cached={},refreshes=0,version='build=202611260020\\nbin=20\\n';
function time(){return 2000000000;}
function readfile(path){if(path=='/etc/chester-version')return version;return sprintf('%J',cached);}
function system(command){refreshes++;return 0;}
function check(ok,message){if(!ok)die(message+'\\n');}
'''+source+'''
let s=status();check(s.checking&&!s.release_verified,'Empty cache refreshes');
cached={schema:2,ok:true,release_verified:true,app_update:true,update_available:true,installed_build:'202611260020',installed_bin:'20',installed_app:0,latest_build:'20261126180000',latest_bin:'20',latest_app:1,checked_at:time()};
s=status();check(s.update_available&&s.latest_app==1&&s.latest_rev=='20','K45P same firmware, newer app detected');
cached.release_verified=false;s=status();check(!s.update_available,'Unverified app rejected');cached.release_verified=true;
cached.requires_firmware=true;s=status();check(!s.update_available,'Incompatible app rejected');cached.requires_firmware=false;
cached.latest_bin='19';s=status();check(!s.release_verified,'Wrong firmware base rejected');cached.latest_bin='20';
cached.update_available=false;s=status();check(!s.update_available,'Backend conflict cannot advertise installable update');cached.update_available=true;
version='build=20261126180000\\nbin=20\\napp_revision=1\\n';s=status();check(s.checking&&!s.update_available,'Old cache cannot announce already installed app');
cached.installed_build='20261126180000';cached.installed_app=1;s=status();check(s.release_verified&&!s.update_available,'Installed app current');
cached.latest_app=2;cached.latest_build='20261126190000';s=status();check(s.update_available,'Next app on 14-digit installed app build detected');
version='build=20261126152923\\nbin=64\\n';cached.installed_build='20261126152923';cached.installed_app=0;cached.latest_app=1;cached.latest_bin='64';s=status();check(s.update_available,'K43P same BIN newer app detected');
cached.latest_app=0;cached.update_available=false;cached.latest_build='20261126152923';s=status();check(s.release_verified&&!s.update_available,'K43P signed baseline current');
cached.app_update=false;cached.latest_build='20261127152923';s=status();check(s.update_available,'Legacy full firmware still detected');
cached.latest_build='20251126152923';s=status();check(!s.release_verified,'Older full firmware not current');
cached.schema=1;s=status();check(s.checking&&!s.release_verified,'Legacy cache migrated');
cached={schema:2,installed_build:'20261126152923',ok:false,checked_at:time()};s=status();check(!s.checking&&!s.release_verified,'Failed check respects backoff');
cached.checked_at=time()-61;s=status();check(s.checking,'Failure retries after one minute');
print('PASS native home app status: both board counters, same-BIN app updates, installed/cache identity, trust, conflicts, baselines and legacy firmware.\\n');
''')
