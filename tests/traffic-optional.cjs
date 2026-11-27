const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../payload/www/luci-static/resources/view/lettucepi/traffic.js','utf8'),calls=[];
const rpc={declare:spec=>async()=>{calls.push(spec.method);if(spec.method==='feature_status')return {installed:false};throw Error('Uninstalled feature must not collect or load client data');}};
const E=(tag,attrs,children)=>({tag,attrs,children}),kit=new Proxy({},{get:(_,key)=>(...args)=>({key,args})});
const page=Function('view','rpc','poll','dom','ui','navigation','kit','icons','trafficChart','E',source)({extend:x=>x},rpc,{add(){throw Error('Uninstalled traffic must not poll');}},{},{},{render(){}},kit,{},{},E);
(async()=>{await page.load();const result=page.render();assert.equal(result.key,'sheet');assert.deepEqual(calls,['feature_status']);assert(JSON.stringify(result).includes('Not Installed'));assert(JSON.stringify(result).includes('Install Live Traffic'));console.log('PASS optional traffic page: installation prompt with no counters, client reads or polling.');})().catch(e=>{console.error(e);process.exitCode=1;});
