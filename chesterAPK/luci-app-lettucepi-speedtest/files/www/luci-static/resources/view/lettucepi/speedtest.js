'use strict';
'require view';
'require rpc';
'require dom';
'require ui';
'require poll';

var callStatus = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'status' });
var callStart = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'start' });
var callCancel = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'cancel' });

return view.extend({
	load: function() { return callStatus(); },

	render: function(data) {
		var self = this;
		var root = E('div', { class: 'cbi-map lp-speedtest' }, [
			E('style', {}, '.lp-speedtest{max-width:920px;margin:auto}.lp-st-card{background:#071b2d;border:1px solid #21405b;border-radius:18px;padding:26px;color:#eaf6ff}.lp-st-brand{font-size:13px;letter-spacing:.14em;color:#7ca6c7}.lp-st-title{font-size:30px;font-weight:700;margin:5px 0 24px}.lp-st-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.lp-st-metric{background:#0b243a;border-radius:14px;padding:18px;text-align:center}.lp-st-value{font-size:34px;font-weight:750;color:#20c9f3}.lp-st-label{font-size:12px;color:#91abc1;margin-top:5px}.lp-st-details{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.lp-st-details div{padding:10px 0;border-bottom:1px solid #1c3b54}.lp-st-actions{display:flex;gap:10px;justify-content:center}.lp-st-actions button{min-width:150px}.lp-st-msg{text-align:center;min-height:24px;margin:16px 0;color:#a8c4d8}@media(max-width:650px){.lp-st-grid{grid-template-columns:1fr}.lp-st-details{grid-template-columns:1fr}}'),
			E('div', { class: 'lp-st-card' }, [
				E('div', { class: 'lp-st-brand' }, 'LETTUCEPI · POWERED BY OOKLA'),
				E('div', { class: 'lp-st-title' }, 'Internet Speedtest'),
				E('div', { class: 'lp-st-grid' }, [
					self.metric('download', '—', 'DOWNLOAD · Mbps'),
					self.metric('ping', '—', 'PING · ms'),
					self.metric('upload', '—', 'UPLOAD · Mbps')
				]),
				E('div', { class: 'lp-st-details' }, [
					E('div', {}, [ E('strong', {}, 'Provider: '), E('span', { id: 'lp-st-isp' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Server: '), E('span', { id: 'lp-st-server' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Location: '), E('span', { id: 'lp-st-location' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Packet loss: '), E('span', { id: 'lp-st-loss' }, '—') ])
				]),
				E('div', { id: 'lp-st-msg', class: 'lp-st-msg' }),
				E('div', { class: 'lp-st-actions' }, [
					E('button', { class: 'btn cbi-button-positive', id: 'lp-st-start', click: ui.createHandlerFn(self, self.start) }, 'Start Test'),
					E('button', { class: 'btn', id: 'lp-st-cancel', click: ui.createHandlerFn(self, self.cancel) }, 'Cancel')
				]),
				E('p', { style: 'text-align:center;color:#7894aa;margin:22px 0 0;font-size:12px' }, 'Uses the official Ookla Speedtest CLI installed on this router. A test can consume significant cellular data.')
			])
		]);
		poll.add(function() { return self.refresh(); }, 1);
		window.setTimeout(function() { self.update(data || {}); }, 0);
		return root;
	},

	metric: function(id, value, label) {
		return E('div', { class: 'lp-st-metric' }, [ E('div', { class: 'lp-st-value', id: 'lp-st-' + id }, value), E('div', { class: 'lp-st-label' }, label) ]);
	},

	refresh: function() {
		var self = this;
		return callStatus().then(function(r) { self.update(r || {}); });
	},

	update: function(r) {
		function set(id, value) { var n = document.getElementById(id); if (n) n.textContent = value; }
		set('lp-st-download', Number(r.download_mbps || 0) > 0 ? Number(r.download_mbps).toFixed(2) : '—');
		set('lp-st-upload', Number(r.upload_mbps || 0) > 0 ? Number(r.upload_mbps).toFixed(2) : '—');
		set('lp-st-ping', r.latency_ms ? Number(r.latency_ms).toFixed(1) : '—');
		set('lp-st-isp', r.isp || '—'); set('lp-st-server', r.server || '—');
		set('lp-st-location', r.location || '—'); set('lp-st-loss', r.packet_loss != null ? r.packet_loss + '%' : '—');
		var msg = !r.installed ? 'Official Ookla CLI is not installed.' : r.running ? 'Testing your connection…' : r.phase === 'completed' ? 'Test complete.' : r.phase === 'failed' ? ('Test failed. ' + (r.error || '')) : 'Ready.';
		set('lp-st-msg', msg);
		var start = document.getElementById('lp-st-start'), cancel = document.getElementById('lp-st-cancel');
		if (start) start.disabled = !r.installed || !!r.running;
		if (cancel) cancel.disabled = !r.running;
	},

	start: function() { var self = this; return callStart().then(function(r) { if (r && r.error) ui.addNotification(null, E('p', {}, r.error)); return self.refresh(); }); },
	cancel: function() { var self = this; return callCancel().then(function() { return self.refresh(); }); },

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
