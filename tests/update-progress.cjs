const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../payload/www/luci-static/resources/chester-ui/update-progress.js'),'utf8');
const api=Function('baseclass','rpc','poll',source)({extend:x=>x},{},{});
const options={id:'a'.repeat(32),product:'K43P',build:'20261126150000',revision:'63',boot:'old-boot',issued:true};
function model(){return api.createModel({...options});}
function beacon(m,extra={}){m.beacon({product:'K43P',build:options.build,revision:'63',boot:'new-boot',...extra});}
assert(api.valid(options));assert(!api.valid({...options,id:';reboot'}));assert(!api.valid({...options,build:'unknown'}));
let m=model();m.job({id:'b'.repeat(32),phase:'failed'});assert(!m.failed);
m.job({id:options.id,phase:'downloading'});assert.equal(m.stage,1);
m.job({id:options.id,phase:'verifying'});m.job({id:options.id,phase:'checking'});assert.equal(m.stage,2);
m.job({id:options.id,phase:'installing'});m.disconnected();assert.equal(m.stage,3);assert(!m.complete);
beacon(m,{boot:'old-boot'});assert.equal(m.confirmations,0);
beacon(m,{product:'K45P'});assert.equal(m.confirmations,0);
beacon(m);assert.equal(m.stage,4);assert(!m.complete);
beacon(m);assert.equal(m.stage,5);assert(!m.complete);
beacon(m);assert(m.complete);assert.equal(m.stage,5);
m=model();for(let i=0;i<3;i++)beacon(m,{build:'20261126061312',revision:'61'});assert(m.failed);assert(!m.complete);
m=model();m.job({id:options.id,phase:'failed',recovering:true,message:'Download stopped'});assert(m.failed&&m.recovering);
m.job({id:options.id,phase:'failed',recovering:false,message:'Download stopped'});assert(!m.recovering);beacon(m);assert(!m.complete);
m=model();m.disconnected();for(let i=0;i<3;i++)beacon(m);assert(m.complete,'A lost launch response must not prevent positive postboot verification');
assert(!source.includes('awaitReconnect'));assert(!source.includes('location.href='));assert(!source.includes('window.location='));
assert(source.includes('then refresh the page.'));assert(!source.includes('reopen the router page'));
assert(source.includes('this.header,this.device'),'Header must contain text without the small leaf');
console.log('PASS request identity, monotonic stages, disconnect persistence, reboot/version proof, wrong firmware, service recovery, lost launch response and refresh wording');
