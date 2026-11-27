#!/usr/bin/env python3
"""Share one Go runtime between native tools; preserve each command interface.

Run on Linux with Go in PATH. --ndt-source must be the pinned official NDT7
checkout used by build-ndt7.sh. Only a native binary is built, never firmware.
"""
import argparse,hashlib,json,re,shutil,subprocess
from pathlib import Path

def run(*args,cwd):subprocess.run(args,cwd=cwd,check=True)
def main():
    p=argparse.ArgumentParser()
    for arg in ['k45-source','ndt-source','work']:
        p.add_argument('--'+arg,required=True)
    a=p.parse_args();repo=Path(__file__).resolve().parents[1];k45=Path(a.k45_source).resolve();ndt=Path(a.ndt_source).resolve();work=Path(a.work).resolve()
    assert not work.exists(),'A fresh build directory is required'
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ndt,text=True).strip()
    assert commit=='1f6adcf81a3f29cae933a2e317e86e24826e2900','Use the pinned M-Lab source'
    shutil.copytree(ndt,work,ignore=shutil.ignore_patterns('.git','cmd'))
    packages={'traffic':repo/'integrations/traffic','sim':k45/'integrations/sim','scan':repo/'integrations/scan','apps':repo/'integrations/app-update','ndt':k45/'integrations/ndt7'}
    applets={'traffic':'chester-traffic','sim':'chester-simd','scan':'chester-scan','apps':'chester-app-update','ndt':'chester-ndt7'}
    sources={}
    for name,source in packages.items():
        target=work/'chester_native'/name;target.mkdir(parents=True)
        for path in source.glob('*.go'):
            raw=path.read_text(encoding='utf-8');sources[name+'/'+path.name]=hashlib.sha256(raw.replace('\r\n','\n').encode()).hexdigest()
            text=re.sub(r'(?m)^package main\s*$', 'package '+name,raw)
            text=re.sub(r'\bfunc main\(\)', 'func Main()',text)
            # Preserve the applet identity when scan guards/workers and the
            # detached updater re-exec the shared physical executable.
            text=re.sub(r'(?m)^(\s*)(\w+) := exec.Command\((self|exe),([^\n]*)$',
                        lambda m:m[0]+'\n'+m[1]+m[2]+'.Args[0] = "'+applets[name]+'"',text)
            (target/path.name).write_text(text,encoding='utf-8',newline='\n')
    main_dir=work/'cmd/chester-engine';main_dir.mkdir(parents=True)
    imports='\n'.join(f'{name} "github.com/m-lab/ndt7-client-go/chester_native/{name}"' for name in packages)
    cases='\n'.join(f'case "{applets[name]}": {name}.Main()' for name in packages)
    (main_dir/'main.go').write_text('package main\nimport ("os";"fmt";"path/filepath";\n'+imports+'\n)\nfunc main(){name:=filepath.Base(os.Args[0]);if name=="chester-engine"&&len(os.Args)>1{name=os.Args[1];os.Args=append([]string{name},os.Args[2:]...)};switch name{'+cases+'\ndefault:fmt.Fprintln(os.Stderr,"Unknown Chester command");os.Exit(2)}}\n',encoding='utf-8')
    for dependency in ['github.com/miekg/dns@v1.1.73','golang.org/x/net@v0.57.0','golang.org/x/sys@v0.47.0']:
        run('go','mod','edit','-require='+dependency,cwd=work)
    run('go','mod','tidy',cwd=work)
    run('go','test','./chester_native/...',cwd=work)
    import os
    env=os.environ.copy();env.update(CGO_ENABLED='0',GOOS='linux',GOARCH='arm64')
    output=repo/'payload/usr/libexec/chester-engine'
    subprocess.run(['go','build','-trimpath','-buildvcs=false','-ldflags=-s -w -buildid=','-o',str(output),'./cmd/chester-engine'],cwd=work,env=env,check=True)
    report={'ndt_source_commit':commit,'source_sha256':sources,'binary_bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
    (repo/'integrations/app-update/native-suite-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'binary_bytes':report['binary_bytes'],'sha256':report['sha256']}))
if __name__=='__main__':main()
