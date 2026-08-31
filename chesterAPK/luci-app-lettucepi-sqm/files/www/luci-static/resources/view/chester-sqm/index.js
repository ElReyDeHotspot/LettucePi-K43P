'use strict';
'require view';
'require ui';
'require rpc';

/* Chester Smart Queue.
 *
 * Shaping here is built from what the vendor kernel provides rather than from
 * sqm-scripts, which cannot be installed: kmod-ifb and kmod-sched-cake live in
 * the target feed, left out because it is built against a different kernel.
 *
 * The two directions work by different mechanisms and the page says so plainly,
 * because the difference is visible to the user. Upload is queued: tbf makes
 * the bottleneck ours and fq_codel manages it, so packets wait rather than die.
 * Download cannot be queued from here -- the bottleneck belongs to the carrier,
 * upstream of this box -- so it is policed: an nftables token bucket drops what
 * exceeds the rate until the sender backs off. TCP paces smoothly under that;
 * UDP and QUIC just see loss.
 *
 * Presentation matches the System Update page so the two read as one product.
 */

var callStatus = rpc.declare({ object: 'misectel', method: 'sqm_status', expect: {} });
var callSet = rpc.declare({
	object: 'misectel', method: 'set_sqm',
	params: [ 'enabled', 'upload_enabled', 'upload_kbit',
	          'download_enabled', 'download_kbit' ],
	expect: {}
});

var CSS_ID = 'chester-sqm-css';
var CSS = [
'.cq-page {',
'	--cq-text: #172033;',
'	--cq-muted: #6d7788;',
'	--cq-line: rgba(92, 108, 132, .17);',
'	--cq-fill: rgba(238, 242, 247, .76);',
'	width: 100%;',
'	box-sizing: border-box;',
'	padding: 12px 0 28px;',
'	color: var(--cq-text);',
'}',
'.cq-page, .cq-page * { box-sizing: border-box; }',
'.cq-window {',
'	width: min(100%, 1000px);',
'	margin: 0 auto;',
'	overflow: hidden;',
'	border: 1px solid var(--cq-line);',
'	border-radius: 24px;',
'	background: rgba(255, 255, 255, .94);',
'	box-shadow: 0 20px 55px rgba(28, 43, 67, .10), 0 2px 8px rgba(28, 43, 67, .04);',
'}',
'.cq-header {',
'	display: flex;',
'	align-items: center;',
'	justify-content: center;',
'	gap: 14px;',
'	text-align: center;',
'	min-height: 88px;',
'	padding: 22px 26px 18px;',
'	border-bottom: 1px solid var(--cq-line);',
'	background: linear-gradient(180deg, rgba(248,250,253,.96), rgba(255,255,255,.96));',
'}',
'.cq-header h2 { margin: 0; font-size: 23px; font-weight: 730; letter-spacing: -.035em; }',
'.cq-pill {',
'	display: inline-flex;',
'	align-items: center;',
'	min-height: 28px;',
'	padding: 4px 11px;',
'	border-radius: 999px;',
'	background: rgba(109,119,136,.10);',
'	color: var(--cq-muted);',
'	font-size: 11.5px;',
'	font-weight: 720;',
'	white-space: nowrap;',
'}',
'.cq-pill::before {',
'	content: "";',
'	width: 7px; height: 7px;',
'	margin-right: 7px;',
'	border-radius: 50%;',
'	background: currentColor;',
'}',
'.cq-pill.is-on { background: rgba(39,174,96,.10); color: #168847; }',
'.cq-pill.is-off { background: rgba(109,119,136,.10); color: var(--cq-muted); }',
'.cq-master {',
'	display: flex;',
'	align-items: center;',
'	justify-content: space-between;',
'	gap: 20px;',
'	margin: 20px 22px 0;',
'	padding: 17px 18px;',
'	border: 1px solid rgba(22,119,255,.14);',
'	border-radius: 17px;',
'	background: linear-gradient(145deg, rgba(22,119,255,.075), rgba(22,119,255,.025));',
'}',
'.cq-master strong { display: block; font-size: 15px; font-weight: 710; }',
'.cq-master span { display: block; margin-top: 4px; color: var(--cq-muted); font-size: 12.5px; }',
'.cq-groups {',
'	display: grid;',
'	grid-template-columns: repeat(2, minmax(0, 1fr));',
'	gap: 16px;',
'	padding: 16px 22px 20px;',
'}',
'@media (max-width: 760px) { .cq-groups { grid-template-columns: minmax(0, 1fr); } }',
'.cq-group {',
'	min-width: 0;',
'	border: 1px solid var(--cq-line);',
'	border-radius: 17px;',
'	background: rgba(255,255,255,.88);',
'}',
'.cq-group--wide { grid-column: 1 / -1; }',
'.cq-group h3 {',
'	display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap;',
'	margin: 0; padding: 16px 18px 10px; font-size: 15px; font-weight: 710;',
'}',
'.cq-group h3 em {',
'	font-style: normal; font-size: 11px; font-weight: 640;',
'	letter-spacing: .04em; text-transform: uppercase; color: var(--cq-muted);',
'}',
'.cq-list { padding: 0 18px 8px; }',
'.cq-row {',
'	display: flex;',
'	align-items: center;',
'	justify-content: space-between;',
'	gap: 16px;',
'	min-height: 44px;',
'	padding: 10px 0;',
'	border-top: 1px solid var(--cq-line);',
'}',
'.cq-row__k { color: var(--cq-muted); font-size: 12.5px; font-weight: 520; }',
'.cq-row__v { color: var(--cq-text); font-size: 12.5px; font-weight: 680; text-align: right; overflow-wrap: anywhere; }',
'.cq-row__v.is-good { color: #168847; }',
'.cq-row__v.is-off { color: var(--cq-muted); font-weight: 590; }',
'.cq-row__v.is-warn { color: #b46b00; }',
'.cq-switch { position: relative; display: inline-flex; width: 52px; height: 30px; flex: 0 0 52px; cursor: pointer; }',
'.cq-switch input { position: absolute; opacity: 0; pointer-events: none; }',
'.cq-track {',
'	position: absolute; inset: 0;',
'	border-radius: 999px;',
'	background: #c7ced8;',
'	box-shadow: inset 0 0 0 1px rgba(60,72,90,.06);',
'	transition: background .2s ease;',
'}',
'.cq-track::after {',
'	content: ""; position: absolute; top: 3px; left: 3px;',
'	width: 24px; height: 24px; border-radius: 50%;',
'	background: #fff; box-shadow: 0 2px 7px rgba(24,36,54,.25);',
'	transition: transform .2s ease;',
'}',
'.cq-switch input:checked + .cq-track { background: #27ae60; }',
'.cq-switch input:checked + .cq-track::after { transform: translateX(22px); }',
'.cq-switch--sm { width: 44px; height: 26px; flex-basis: 44px; }',
'.cq-switch--sm .cq-track::after { width: 20px; height: 20px; }',
'.cq-switch--sm input:checked + .cq-track::after { transform: translateX(18px); }',
'.cq-rate {',
'	width: 118px;',
'	padding: 7px 10px;',
'	border: 1px solid var(--cq-line);',
'	border-radius: 10px;',
'	background: var(--cq-fill);',
'	color: var(--cq-text);',
'	font-family: inherit;',
'	font-size: 12.5px;',
'	font-weight: 640;',
'	text-align: right;',
'}',
'.cq-rate:disabled { opacity: .5; cursor: not-allowed; }',
'.cq-note {',
'	margin: 0 22px 18px;',
'	padding: 12px 14px;',
'	border: 1px solid var(--cq-line);',
'	border-radius: 13px;',
'	background: rgba(238,242,247,.6);',
'	color: var(--cq-muted);',
'	font-size: 12.5px;',
'	line-height: 1.55;',
'}',
'.cq-note strong { color: var(--cq-text); }',
'.cq-note--warn {',
'	border-color: rgba(255,159,10,.28);',
'	background: rgba(255,159,10,.07);',
'	color: #7a4b00;',
'}',
'.cq-note--warn strong { color: #7a4b00; }',
'.cq-foot {',
'	display: flex;',
'	align-items: center;',
'	justify-content: flex-end;',
'	gap: 12px;',
'	padding: 15px 22px 18px;',
'	border-top: 1px solid var(--cq-line);',
'	background: rgba(247,249,252,.72);',
'}',
'.cq-status { margin: 0; color: var(--cq-muted); font-size: 12px; }',
'.cq-status.is-bad { color: #d93442; font-weight: 640; }',
'.cq-btn {',
'	display: inline-flex; align-items: center; justify-content: center;',
'	min-height: 36px; padding: 8px 20px;',
'	border: 0; border-radius: 11px;',
'	background: linear-gradient(145deg, #2688ff, #0768e6);',
'	box-shadow: 0 6px 15px rgba(22,119,255,.24);',
'	color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 700;',
'	cursor: pointer; transition: transform .16s ease, box-shadow .16s ease;',
'}',
'.cq-btn:hover { transform: translateY(-1px); box-shadow: 0 9px 20px rgba(22,119,255,.30); }',
'.cq-btn:disabled { opacity: .55; cursor: progress; transform: none; }'
].join('\n');

function ensureCss() {
	if (document.getElementById(CSS_ID))
		return;
	document.head.appendChild(E('style', { id: CSS_ID }, [ CSS ]));
}

function row(label, value, cls) {
	return E('div', { 'class': 'cq-row' }, [
		E('span', { 'class': 'cq-row__k' }, [ label ]),
		E('span', { 'class': 'cq-row__v' + (cls ? ' ' + cls : '') }, [ value || '-' ])
	]);
}

function controlRow(label, control) {
	return E('div', { 'class': 'cq-row' }, [
		E('span', { 'class': 'cq-row__k' }, [ label ]),
		E('span', {}, [ control ])
	]);
}

function group(title, kind, rows, wide) {
	return E('section', { 'class': 'cq-group' + (wide ? ' cq-group--wide' : '') }, [
		E('h3', {}, kind ? [ title, E('em', {}, [ kind ]) ] : [ title ]),
		E('div', { 'class': 'cq-list' }, rows)
	]);
}

function bytes(n) {
	var v = parseInt(n, 10);
	if (!isFinite(v) || v <= 0) return '-';
	var u = [ 'B', 'KB', 'MB', 'GB', 'TB' ], i = 0;
	while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
	return (i ? v.toFixed(1) : String(v)) + ' ' + u[i];
}

function mbit(kbit) {
	var v = parseInt(kbit, 10);
	if (!isFinite(v) || v <= 0) return '';
	return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' Mbit/s';
}

function toggle(on, small) {
	var input = E('input', { 'type': 'checkbox', 'checked': on ? 'checked' : null });
	var label = E('label', { 'class': 'cq-switch' + (small ? ' cq-switch--sm' : '') },
		[ input, E('span', { 'class': 'cq-track' }) ]);
	label.input = input;
	return label;
}

return view.extend({
	load: function () {
		ensureCss();
		return callStatus().catch(function () { return {}; });
	},

	render: function (s) {
		var self = this;
		s = s || {};

		var on = (s.enabled === true);
		var shaping = (s.shaping === true);
		var dlAvail = (s.download_available === true);
		var dlActive = (s.download_active === true);
		var offloadOn = (s.offload === '1' || s.offload === 1);

		var upOn = (s.upload_enabled === true);
		var dlOn = (s.download_enabled === true);

		var master = toggle(on);
		var upSwitch = toggle(upOn, true);
		var upRate = E('input', {
			'type': 'number', 'class': 'cq-rate', 'min': '64', 'step': '1000',
			'value': s.upload_kbit || '20000',
			'disabled': upOn ? null : 'disabled'
		});
		var dlSwitch = toggle(dlOn, true);
		var dlRate = E('input', {
			'type': 'number', 'class': 'cq-rate', 'min': '64', 'step': '1000',
			'value': s.download_kbit || '90000',
			'disabled': (dlAvail && dlOn) ? null : 'disabled'
		});

		/* A rate box that still looks editable while its direction is off
		 * invites someone to type a number, press Apply and believe it took
		 * effect. Greying it out follows the switch immediately rather than
		 * waiting for the reload. */
		upSwitch.input.addEventListener('change', function () {
			upRate.disabled = !upSwitch.input.checked;
		});
		dlSwitch.input.addEventListener('change', function () {
			dlRate.disabled = !dlAvail || !dlSwitch.input.checked;
		});

		var status = E('p', { 'class': 'cq-status' }, [ '' ]);

		var save = E('button', {
			'class': 'cq-btn',
			'click': ui.createHandlerFn(self, function () {
				status.className = 'cq-status';
				status.textContent = _('Applying…');
				return callSet(
					master.input.checked ? '1' : '0',
					upSwitch.input.checked ? '1' : '0',
					String(upRate.value || ''),
					dlSwitch.input.checked ? '1' : '0',
					String(dlRate.value || '')
				).then(function (res) {
					if (!res || res.success === false) {
						status.className = 'cq-status is-bad';
						status.textContent = (res && res.message) || _('Could not apply.');
						return;
					}
					/* Re-read rather than assume: the service declines to
					 * attach anything while the modem is mid-redial, and the
					 * page should show that instead of a hopeful summary. */
					status.textContent = _('Applied.');
					window.setTimeout(function () { location.reload(); }, 900);
				}).catch(function (e) {
					status.className = 'cq-status is-bad';
					status.textContent = _('Could not apply: %s').format(e);
				});
			})
		}, _('Apply'));

		var pillCls = (shaping || dlActive) ? 'is-on' : 'is-off';
		var pillText = (shaping || dlActive) ? _('Active') : (on ? _('Idle') : _('Off'));

		var dlRows = [
			controlRow(_('Limit downloads'), dlSwitch),
			controlRow(_('Limit (kbit)'), dlRate)
		];
		if (dlAvail) {
			dlRows.push(row(_('Rate'), dlActive
				? (s.download_kbytes ? s.download_kbytes + ' KB/s' : mbit(s.download_kbit))
				: _('not installed'), dlActive ? 'is-good' : 'is-off'));
			dlRows.push(row(_('Seen'), bytes(s.dl_seen_bytes)));
			dlRows.push(row(_('Dropped'), (s.dl_dropped && s.dl_dropped !== '0')
				? s.dl_dropped + ' pkt / ' + bytes(s.dl_dropped_bytes)
				: '0'));
		} else {
			dlRows.push(row(_('Rate'), _('unavailable'), 'is-off'));
		}

		var body = [
			E('header', { 'class': 'cq-header' }, [
				E('h2', {}, [ _('Smart Queue') ]),
				E('span', { 'class': 'cq-pill ' + pillCls }, [ pillText ])
			]),

			E('section', { 'class': 'cq-master' }, [
				E('div', {}, [
					E('strong', {}, [ _('Smart Queue') ]),
					E('span', {}, [ on
						? _('Keeping latency down under load')
						: _('Not active') ])
				]),
				master
			]),

			E('div', { 'class': 'cq-groups' }, [
				group(_('Upload'), upOn ? _('queued') : _('off'), [
					controlRow(_('Limit uploads'), upSwitch),
					controlRow(_('Limit (kbit)'), upRate),
					row(_('Shaper'), shaping ? ('tbf ' + (s.tbf_rate || '')) : _('not attached'),
						shaping ? 'is-good' : 'is-off'),
					row(_('Queue'), shaping ? 'fq_codel' : '-', shaping ? 'is-good' : 'is-off'),
					row(_('Sent'), bytes(s.sent_bytes)),
					row(_('Dropped'), s.dropped || '0')
				]),
				group(_('Download'),
					!dlAvail ? _('unavailable') : (dlOn ? _('policed') : _('off')),
					dlRows),
				group(_('Status'), null, [
					row(_('WAN device'), s.wan || _('waiting for modem')),
					row(_('LAN queue'), s.lan_fq_codel ? _('fq_codel, no rate limit') : _('off'),
						s.lan_fq_codel ? 'is-good' : 'is-off'),
					row(_('Flow offload'), offloadOn
						? _('ON — bypasses shaping entirely')
						: _('off, required for shaping'),
						offloadOn ? 'is-warn' : 'is-good')
				], true)
			])
		];

		if (offloadOn)
			body.push(E('div', { 'class': 'cq-note cq-note--warn' }, [
				E('strong', {}, [ _('Flow offloading is on.') ]), ' ',
				_('Offloaded connections skip both the queue and the limiter, so shaping will look intermittent rather than simply off. Smart Queue turns offloading off while it is enabled and restores it afterwards; if it is on now, something else re-enabled it.')
			]));

		body.push(E('div', { 'class': 'cq-note' }, dlAvail ? [
			E('strong', {}, [ _('Upload is queued, download is policed.') ]), ' ',
			_('Uploads leave through this router, so the queue is ours to manage and packets wait their turn. Downloads arrive having already passed the carrier bottleneck, so the only lever left is to drop what exceeds the limit until the sender slows down. Set the download limit a little below your real line speed — a limit above it does nothing at all.')
		] : [
			E('strong', {}, [ _('Download limiting is not available on this firmware.') ]), ' ',
			_('It needs either the nftables rate limiter or the tc police action, and neither is present. Upload shaping is unaffected, and on a cellular uplink it is the direction that matters most.')
		]));

		body.push(E('footer', { 'class': 'cq-foot' }, [ status, save ]));

		return E('div', { 'class': 'cq-page' }, [ E('main', { 'class': 'cq-window' }, body) ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
