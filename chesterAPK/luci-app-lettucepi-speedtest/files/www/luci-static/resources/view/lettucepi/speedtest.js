'use strict';
'require view';
'require rpc';
'require dom';
'require ui';
'require poll';

var callStatus = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'status' });
var callHistory = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'history' });
var callInstall = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'install' });
var callStart = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'start' });
var callCancel = rpc.declare({ object: 'luci.lettucepi.speedtest', method: 'cancel' });

return view.extend({
	load: function() { return Promise.all([ callStatus(), callHistory() ]); },

	render: function(data) {
		var self = this;
		var root = E('div', { class: 'cbi-map lp-speedtest' }, [
			E('style', {}, '.lp-speedtest{max-width:980px;margin:auto;color:#fff}.lp-st-card{background:radial-gradient(circle at 50% 28%,#182f4a 0,#0b1c31 42%,#061426 100%);border:1px solid #243c56;border-radius:20px;padding:28px 34px 32px;box-shadow:0 22px 55px rgba(0,0,0,.25);color:#fff}.lp-st-brand{text-align:center;font-size:15px;font-weight:800;letter-spacing:.16em}.lp-st-brand span{color:#8798aa;font-size:11px;font-weight:500;letter-spacing:.06em}.lp-st-title{text-align:center;font-size:14px;font-weight:500;color:#8fa1b5;margin:8px 0 22px}.lp-st-grid{display:grid;grid-template-columns:repeat(3,1fr);max-width:660px;margin:0 auto;gap:20px}.lp-st-metric{text-align:center;padding:8px}.lp-st-value{font-size:35px;line-height:1.1;font-weight:400;font-variant-numeric:tabular-nums}.lp-st-metric-download .lp-st-value{color:#21c5ef}.lp-st-metric-upload .lp-st-value{color:#be77ff}.lp-st-metric-ping .lp-st-value{color:#fff}.lp-st-label{font-size:11px;color:#9cabbc;margin-top:7px;letter-spacing:.08em}.lp-st-dial{width:220px;height:220px;margin:18px auto 6px;position:relative;border-radius:50%;display:flex;align-items:center;justify-content:center;background:conic-gradient(#21c5ef 0deg,#be77ff 115deg,#223b57 116deg 360deg);box-shadow:0 0 36px rgba(33,197,239,.13)}.lp-st-dial:before{content:"";position:absolute;inset:5px;border-radius:50%;background:#0b1c31}.lp-st-go{position:relative;z-index:1;width:176px;height:176px!important;min-width:0!important;border-radius:50%!important;border:2px solid #21c5ef!important;background:rgba(7,25,43,.96)!important;color:#fff!important;font-size:38px!important;font-weight:300!important;letter-spacing:.04em;box-shadow:inset 0 0 28px rgba(33,197,239,.12),0 0 22px rgba(33,197,239,.18);cursor:pointer}.lp-st-go:hover{background:#102b44!important;transform:scale(1.02)}.lp-st-go:disabled{cursor:default;opacity:.8}.lp-st-dial.running{animation:lp-st-spin 1.35s linear infinite}.lp-st-dial.running .lp-st-go{animation:lp-st-counterspin 1.35s linear infinite;font-size:16px!important;color:#b8cadb!important}.lp-st-dial.upload{background:conic-gradient(#be77ff 0 150deg,#223b57 151deg 360deg)}@keyframes lp-st-spin{to{transform:rotate(360deg)}}@keyframes lp-st-counterspin{to{transform:rotate(-360deg)}}.lp-st-msg{text-align:center;min-height:24px;margin:8px 0 20px;color:#a8bbcf}.lp-st-details{display:grid;grid-template-columns:1fr 1fr;gap:0 28px;max-width:760px;margin:10px auto 20px}.lp-st-details div{padding:11px 0;border-bottom:1px solid #20384f;color:#9eb0c2}.lp-st-details strong{color:#fff;font-weight:500}.lp-st-result{grid-column:1/-1;text-align:center}.lp-st-result a,.lp-st-history a{color:#21c5ef;text-decoration:none}.lp-st-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.lp-st-actions button:not(.lp-st-go){min-width:140px}.lp-st-foot{text-align:center;color:#70869b;margin:20px 0 0;font-size:11px}.lp-st-history{margin-top:22px;background:#07192b;border:1px solid #243c56;border-radius:18px;padding:20px;color:#eef7ff}.lp-st-history h3{margin:0 0 14px;font-weight:500}.lp-st-history table{width:100%;border-collapse:collapse}.lp-st-history th,.lp-st-history td{padding:11px 8px;border-bottom:1px solid #1c354d;text-align:right;font-variant-numeric:tabular-nums}.lp-st-history th{color:#8195a9;font-size:11px;font-weight:500;text-transform:uppercase}.lp-st-history th:first-child,.lp-st-history td:first-child{text-align:left}.lp-st-empty{text-align:center;color:#7894aa;padding:16px}@media(max-width:650px){.lp-st-card{padding:22px 14px}.lp-st-grid{gap:2px}.lp-st-value{font-size:27px}.lp-st-dial{width:190px;height:190px}.lp-st-go{width:150px;height:150px!important}.lp-st-details{grid-template-columns:1fr}.lp-st-result{grid-column:auto}.lp-st-history{overflow-x:auto}.lp-st-history table{min-width:650px}}'),
			E('style', {}, '.lp-st-dial{width:220px!important;height:220px!important;min-width:220px!important;min-height:220px!important;aspect-ratio:1/1!important;box-sizing:border-box!important;flex:0 0 220px!important;border-radius:9999px!important}.lp-st-go.btn{display:block!important;position:relative!important;box-sizing:border-box!important;width:176px!important;height:176px!important;min-width:176px!important;min-height:176px!important;max-width:176px!important;max-height:176px!important;aspect-ratio:1/1!important;padding:0!important;margin:0!important;line-height:1!important;flex:0 0 176px!important;border-radius:9999px!important;text-align:center!important}.lp-st-go-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0;margin:0;line-height:1;text-align:center;transform:translateY(-1px);pointer-events:none}@media(max-width:650px){.lp-st-dial{width:190px!important;height:190px!important;min-width:190px!important;min-height:190px!important;flex-basis:190px!important}.lp-st-go.btn{width:150px!important;height:150px!important;min-width:150px!important;min-height:150px!important;max-width:150px!important;max-height:150px!important;flex-basis:150px!important}}'),
			E('div', { class: 'lp-st-card' }, [
				E('div', { class: 'lp-st-brand' }, [ 'SPEEDTEST ', E('span', {}, 'BY OOKLA') ]),
				E('div', { class: 'lp-st-title' }, 'LettucePi connection test'),
				E('div', { class: 'lp-st-grid' }, [
					self.metric('download', '—', 'DOWNLOAD · Mbps'),
					self.metric('ping', '—', 'PING · ms'),
					self.metric('upload', '—', 'UPLOAD · Mbps')
				]),
				E('div', { id: 'lp-st-dial', class: 'lp-st-dial' }, [
					E('button', { class: 'btn lp-st-go', id: 'lp-st-start', click: ui.createHandlerFn(self, self.start) }, E('span', { id: 'lp-st-go-label', class: 'lp-st-go-label' }, 'GO'))
				]),
				E('div', { id: 'lp-st-msg', class: 'lp-st-msg' }),
				E('div', { class: 'lp-st-details' }, [
					E('div', {}, [ E('strong', {}, 'Provider: '), E('span', { id: 'lp-st-isp' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Server: '), E('span', { id: 'lp-st-server' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Location: '), E('span', { id: 'lp-st-location' }, '—') ]),
					E('div', {}, [ E('strong', {}, 'Packet loss: '), E('span', { id: 'lp-st-loss' }, '—') ]),
					E('div', { class: 'lp-st-result' }, [ E('strong', {}, 'Result: '), E('span', { id: 'lp-st-result' }, 'Available when the test finishes') ])
				]),
				E('div', { class: 'lp-st-actions' }, [
					E('button', { class: 'btn', id: 'lp-st-install', click: ui.createHandlerFn(self, self.install) }, 'Install Ookla Engine'),
					E('button', { class: 'btn', id: 'lp-st-cancel', click: ui.createHandlerFn(self, self.cancel) }, 'Cancel')
				]),
				E('p', { class: 'lp-st-foot' }, 'Uses the official Ookla Speedtest CLI. A test can consume significant cellular data.')
			]),
			E('div', { class: 'lp-st-history' }, [ E('h3', {}, 'Recent Tests'), E('div', { id: 'lp-st-history' }) ])
		]);
		poll.add(function() { return self.refresh(); }, 1);
		window.setTimeout(function() { self.update((data && data[0]) || {}); self.updateHistory((data && data[1]) || {}); }, 0);
		return root;
	},

	metric: function(id, value, label) {
		return E('div', { class: 'lp-st-metric lp-st-metric-' + id }, [ E('div', { class: 'lp-st-value', id: 'lp-st-' + id }, value), E('div', { class: 'lp-st-label' }, label) ]);
	},

	refresh: function() {
		var self = this;
		return Promise.all([ callStatus(), callHistory() ]).then(function(r) { self.update(r[0] || {}); self.updateHistory(r[1] || {}); });
	},

	update: function(r) {
		function set(id, value) { var n = document.getElementById(id); if (n) n.textContent = value; }
		set('lp-st-download', Number(r.download_mbps || 0) > 0 ? Number(r.download_mbps).toFixed(2) : '—');
		set('lp-st-upload', Number(r.upload_mbps || 0) > 0 ? Number(r.upload_mbps).toFixed(2) : '—');
		set('lp-st-ping', r.latency_ms ? Number(r.latency_ms).toFixed(1) : '—');
		set('lp-st-isp', r.isp || '—'); set('lp-st-server', r.server || '—');
		set('lp-st-location', r.location || '—'); set('lp-st-loss', r.packet_loss != null ? r.packet_loss + '%' : '—');
		var result = document.getElementById('lp-st-result');
		if (result) result.replaceChildren(r.result_url ? E('a', { href: r.result_url, target: '_blank', rel: 'noopener noreferrer' }, 'View on Speedtest.net') : document.createTextNode('Available when the test finishes'));
		var stage = r.test_phase === 'ping' ? 'Measuring ping…' : r.test_phase === 'download' ? 'Measuring download…' : r.test_phase === 'upload' ? 'Measuring upload…' : 'Testing your connection…';
		var msg = !r.installed ? 'Official Ookla CLI is not installed.' : r.running ? stage : r.phase === 'completed' ? 'Test complete.' : r.phase === 'failed' ? ('Test failed. ' + (r.error || '')) : 'Ready.';
		set('lp-st-msg', msg);
		var install = document.getElementById('lp-st-install'), start = document.getElementById('lp-st-start'), cancel = document.getElementById('lp-st-cancel'), dial = document.getElementById('lp-st-dial');
		if (install) { install.disabled = !!r.running; install.style.display = r.installed ? 'none' : ''; }
		if (start) start.disabled = !r.installed || !!r.running;
		set('lp-st-go-label', r.running ? (r.test_phase === 'upload' ? 'UPLOAD' : r.test_phase === 'download' ? 'DOWNLOAD' : 'PING') : 'GO');
		if (cancel) cancel.disabled = !r.running;
		if (dial) dial.className = 'lp-st-dial' + (r.running ? ' running' : '') + (r.test_phase === 'upload' ? ' upload' : '');
	},

	updateHistory: function(payload) {
		var target = document.getElementById('lp-st-history');
		if (!target) return;
		var rows = (payload && payload.results) || [];
		if (!rows.length) { target.replaceChildren(E('div', { class: 'lp-st-empty' }, 'No completed tests yet.')); return; }
		rows = rows.slice().reverse();
		var body = rows.map(function(r) {
			var when = r.timestamp ? new Date(Number(r.timestamp) * 1000).toLocaleString() : '—';
			return E('tr', {}, [
				E('td', {}, when), E('td', {}, Number(r.download_mbps || 0).toFixed(2)),
				E('td', {}, Number(r.upload_mbps || 0).toFixed(2)), E('td', {}, Number(r.latency_ms || 0).toFixed(1)),
				E('td', {}, (r.server || '—') + (r.location ? ' · ' + r.location : '')),
				E('td', {}, r.result_url ? E('a', { href: r.result_url, target: '_blank', rel: 'noopener noreferrer' }, 'View') : '—')
			]);
		});
		target.replaceChildren(E('table', {}, [ E('thead', {}, E('tr', {}, [ E('th', {}, 'Date'), E('th', {}, 'Down'), E('th', {}, 'Up'), E('th', {}, 'Ping'), E('th', {}, 'Server'), E('th', {}, 'Result') ])), E('tbody', {}, body) ]));
	},

	install: function() {
		var self = this, button = document.getElementById('lp-st-install'), message = document.getElementById('lp-st-msg');
		if (button) button.disabled = true;
		if (message) message.textContent = 'Downloading and verifying the official Ookla engine…';
		return callInstall().then(function(r) {
			if (!r || !r.ok) ui.addNotification(null, E('p', {}, 'Engine installation failed: ' + ((r && r.error) || 'unknown error')));
			return self.refresh();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, 'Engine installation failed: ' + err));
			return self.refresh();
		});
	},
	start: function() { var self = this; return callStart().then(function(r) { if (r && r.error) ui.addNotification(null, E('p', {}, r.error)); return self.refresh(); }); },
	cancel: function() { var self = this; return callCancel().then(function() { return self.refresh(); }); },

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
