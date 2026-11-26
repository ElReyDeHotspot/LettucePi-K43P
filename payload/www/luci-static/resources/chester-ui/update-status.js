'use strict';
'require baseclass';
function describe(info){
 info=info||{};
 const verified=info.release_verified===true||info.manifest_checked===true;
 const available=verified&&info.update_available===true;
 const rev=/^[0-9]{1,4}$/.test(String(info.latest_rev||''))?String(info.latest_rev):'';
 const app=info.app_update===true&&Number.isSafeInteger(info.latest_app)&&info.latest_app>0;
 const detail=app?'App Revision '+info.latest_app:rev?'Rev. '+rev:'New Release';
 if(available)return {available:true,label:'Update Available',detail,title:'Update Available — '+detail};
 if(info.checking===true)return {available:false,label:'Checking…',detail:'',title:'Checking for signed updates'};
 if(verified)return {available:false,label:'Up to Date',detail:'',title:'Your installed software is up to date'};
 return {available:false,label:'Check Unavailable',detail:'',title:'Could not check for updates. Open System Update to try again.'};
}
return baseclass.extend({describe});
