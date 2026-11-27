"""Emit a native ucode fixture for first-use SIM initialization."""
from pathlib import Path
import re
source=(Path(__file__).resolve().parents[1]/'payload/usr/share/rpcd/ucode/chester.sim').read_text().split('\n',1)[1]
source=re.sub(r'^import .*?;\n','',source,flags=re.M).replace("return {'chester.sim':","let api={'chester.sim':")
print("""let files={},directory=false,started=false,writes=0;
function mkdir(path,mode){directory=true;return true;}
function unlink(path){delete files[path];}
function rename(a,b){files[b]=files[a];delete files[a];return true;}
function open(path,mode){
 if(mode=='r')return files[path]==null?null:{read:()=>files[path],close:()=>true};
 if(!directory)return null;
 return {write:s=>{files[path]=s;writes++;},close:()=>true};
}
function popen(command,mode){started=true;return {read:()=>'',close:()=>true};}
"""+source+"""
function check(v,m){if(!v)die(m+'\\n');}
let result=api['chester.sim'].refresh.call();
check(result.success&&directory&&started,'First-use refresh did not create state and start service');
check(json(files['/tmp/chester-sim/request.json']).action=='refresh','Refresh was not queued');
check(api['chester.sim'].refresh.call().busy&&writes==1,'Queued request was overwritten');
print('PASS native SIM first-use initialization and pending-request exclusion.\\n');
""")
