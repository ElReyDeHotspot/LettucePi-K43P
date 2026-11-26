'use strict';
'require view';
return view.extend({load:function(){window.location.replace(L.url('admin','chester','speeds'));},render:function(){return E('p',{},'Opening Chester Speeds...');},handleSave:null,handleSaveApply:null,handleReset:null});
