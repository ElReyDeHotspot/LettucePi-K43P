'use strict';
'require view';
'require fs';
'require ui';
'require rpc';
'require uci';

/* 4K/HD -- the customer-facing face of zapret.
 *
 * zapret's own pages expose several dozen DPI knobs. Almost none of them matter
 * here: the strategy is already tuned, so this page answers the three questions
 * a customer actually has -- is it on, is my video still throttled, and can I
 * prove the difference -- and keeps the full settings a click away under
 * Developer for when they are needed.
 *
 * The A/B test is the point of the page. "Video is faster" is not something a
 * user can feel reliably, so the engine is measured off and on back to back and
 * both numbers are shown.
 */

var KIT_CSS_ID = 'chester-ui-kit-css';
var KIT_CSS_URL = L.resource('chester-ui/kit.css');

var callVideoBoost = rpc.declare({ object: 'chester', method: 'video_boost', expect: {} });
var callSetVideoBoost = rpc.declare({
	object: 'chester', method: 'set_video_boost', params: [ 'enabled' ], expect: {} });

function ensureKit() {
	if (document.getElementById(KIT_CSS_ID))
		return;
	document.head.appendChild(E('link', {
		id: KIT_CSS_ID, rel: 'stylesheet', type: 'text/css', href: KIT_CSS_URL
	}));
}

function banner(kind, title, sub) {
	var text = [ E('span', { 'class': 'ck-banner__title' }, [ title ]) ];
	if (sub)
		text.push(E('span', { 'class': 'ck-banner__sub' }, [ sub ]));
	return E('div', { 'class': 'ck-banner ck-banner--' + kind }, [
		E('span', { 'class': 'ck-banner__icon' }),
		E('div', { 'class': 'ck-banner__text' }, text)
	]);
}

function row(label, value, mono) {
	return E('div', { 'class': 'ck-row' }, [
		E('div', { 'class': 'ck-row__k' }, [ label ]),
		E('div', { 'class': 'ck-row__v' + (mono ? ' ck-row__v--mono' : '') }, [ value || '-' ])
	]);
}

function mbps(v) {
	var n = parseFloat(v);
	return (isNaN(n) ? '-' : (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' Mbps');
}

function zap(args) {
	return fs.exec('/usr/sbin/chester-zapret', args).then(function (r) {
		return (r.stdout || '').trim();
	}).catch(function (e) { return 'FAIL: ' + e; });
}

/* Report what actually went wrong. An earlier version answered 'denied' for
 * every exception, which sent me looking at ACLs when the real fault was
 * elsewhere -- the message is worth more than the guess. */
function zapJson(args) {
	return fs.exec('/usr/sbin/chester-zapret', args).then(function (r) {
		var out = (r.stdout || '').trim();
		if (!out) return { ok: false, error: 'no output' };
		try { return JSON.parse(out); }
		catch (e) { return { ok: false, error: out.slice(0, 120) }; }
	}).catch(function (e) {
		return { ok: false, error: String((e && e.message) ? e.message : e).slice(0, 160) };
	});
}

function exec(args) {
	return fs.exec('/usr/sbin/chester-videotest', args).then(function (r) {
		var out = (r.stdout || '').trim();
		if (!out)
			return { ok: false, error: 'no output (exit ' + (r.code === undefined ? '?' : r.code) +
				(r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : '') + ')' };
		try { return JSON.parse(out); }
		catch (e) { return { ok: false, error: 'unreadable: ' + out.slice(0, 120) }; }
	}).catch(function (e) {
		return { ok: false, error: String((e && e.message) ? e.message : e).slice(0, 160) };
	});
}

return view.extend({
	load: function () {
		ensureKit();
		return L.resolveDefault(callVideoBoost(), {});
	},

	/* The install runs detached and this polls, because apk update plus the
	 * kernel modules plus the download plus the service start take far longer
	 * than a LuCI XHR will wait. Doing it synchronously reported "XHR request
	 * timed out" while the install was in fact completing normally. */
	install: function () {
		var self = this;
		var stage = E('p', { 'class': 'spinning' }, _('Starting...'));
		ui.showModal(_('Install 4K/HD'), [
			E('p', {}, _('Downloading and installing. This needs an internet connection and takes a minute.')),
			stage
		]);

		return zapJson([ 'install-start' ]).then(function (r) {
			if (r && r.ok === false) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, r.error || _('Could not start the install.')), 'danger');
				return;
			}
			var tries = 0, misses = 0;
			var poll = function () {
				if (++tries > 60) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, _('The install did not finish in time.')), 'warning');
					return self.reload();
				}
				zapJson([ 'install-status' ]).then(function (s) {
					if (s && s.done) {
						ui.hideModal();
						ui.addNotification(null, E('p', {}, s.message ||
							(s.success ? _('Installed.') : _('Install failed.'))),
							s.success ? 'info' : 'danger');
						return self.reload();
					}
					if (s && s.ok === false) {
						if (++misses >= 5) {
							ui.hideModal();
							ui.addNotification(null, E('p', {},
								_('Install failed: %s').format(s.error || '?')), 'danger');
							return self.reload();
						}
						window.setTimeout(poll, 3000);
						return;
					}
					misses = 0;
					if (s && s.stage) stage.textContent = s.stage + '...';
					window.setTimeout(poll, 3000);
				});
			};
			window.setTimeout(poll, 3000);
		});
	},

	setEngine: function (on) {
		var self = this;
		ui.showModal(_('4K/HD'), [
			E('p', { 'class': 'spinning' }, on ? _('Turning on...') : _('Turning off...'))
		]);
		return L.resolveDefault(callSetVideoBoost(on ? '1' : '0'), {}).then(function (r) {
			ui.hideModal();
			if (r && r.success === false)
				ui.addNotification(null, E('p', {}, r.message || _('Could not change that.')), 'warning');
			return self.reload();
		});
	},

	reload: function () {
		var self = this;
		return L.resolveDefault(callVideoBoost(), {}).then(function (info) {
			var body = self.render(info);
			var old = document.querySelector('#view');
			if (old) { old.innerHTML = ''; old.appendChild(body); }
		});
	},

	/* The A/B runs detached on the router because it takes about a minute;
	 * this just polls until the result file appears. */
	runTest: function () {
		var self = this;
		var stage = E('p', { 'class': 'spinning' }, _('Starting...'));
		ui.showModal(_('Streaming Test'), [
			E('p', {}, _('Measuring video speed with the engine off, then on. This takes about a minute.')),
			stage
		]);

		return exec([ 'ab-start' ]).then(function (r) {
			if (r && r.ok === false) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, r.error || _('Could not start the test.')), 'danger');
				return;
			}
			var tries = 0, misses = 0;
			var poll = function () {
				if (++tries > 60) {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, _('The test did not finish in time.')), 'warning');
					return;
				}
				exec([ 'ab-status' ]).then(function (s) {
					if (s && s.done) { ui.hideModal(); self.showResult(s); return; }
					/* The test stops the engine on purpose, which tears down the
					 * nftables rules and reloads the firewall. A poll or two
					 * across that is expected to fail; only give up if they keep
					 * failing. Treating the first miss as fatal reported the run
					 * as failed while it was in fact completing normally. */
					if (s && s.ok === false) {
						if (++misses >= 5) {
							ui.hideModal();
							ui.addNotification(null, E('p', {},
								_('Streaming test failed: %s').format(s.error || '?')), 'danger');
							return;
						}
						stage.textContent = _('Reconfiguring the network...');
						window.setTimeout(poll, 3000);
						return;
					}
					misses = 0;
					if (s && s.stage) stage.textContent = s.stage + '...';
					window.setTimeout(poll, 3000);
				});
			};
			window.setTimeout(poll, 3000);
		});
	},

	showResult: function (s) {
		var self = this;
		var off = s.off || {}, on = s.on || {};
		var helped = (s.helped === true || s.helped === 'true');

		ui.showModal(_('Streaming Test result'), [
			E('div', { 'class': 'ck-page' }, [
				helped
					? banner('ok', _('4K/HD is working.'),
						_('Video is %sx faster with the engine on.').format(s.gain))
					: banner('warn', _('No clear difference.'),
						_('Video measured about the same either way.')),
				E('div', { 'class': 'ck-card' }, [
					E('div', { 'class': 'ck-rows' }, [
						row(_('Video, engine OFF'), mbps(off.video_mbps)),
						row(_('Video, engine ON'), mbps(on.video_mbps)),
						row(_('Non-video speed'), mbps(on.control_mbps)),
						row(_('Improvement'), s.gain ? (s.gain + 'x') : '-')
					])
				]),
				E('p', { 'class': 'ck-note' },
					_('Non-video speed is the control. Carriers throttle only what they recognise as video, so a normal speed test looks fine while video is capped.'))
			]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': function () { ui.hideModal(); self.reload(); } }, _('Close'))
			])
		]);
	},

	render: function (info) {
		var self = this;
		info = info || {};
		var installed = (info.installed === true);
		var on = (info.enabled === true);
		var running = (info.running === true);

		var body = [ E('h2', { 'class': 'ck-title' }, _('4K/HD Video')) ];

		if (!installed) {
			body.push(banner('info', _('The 4K/HD engine is not installed.'),
				_('Install it to stop your carrier throttling video.')));
			body.push(E('div', { 'class': 'ck-actions' }, [
				E('button', {
					'class': 'ck-btn ck-btn--primary',
					'click': ui.createHandlerFn(self, 'install')
				}, _('Install'))
			]));
			body.push(E('p', { 'class': 'ck-note' },
				_('About 200 KB. The router downloads it and starts it for you.')));
			return E('div', { 'class': 'ck-page ck-page--center' }, body);
		}

		if (on && running)
			body.push(banner('ok', _('4K/HD is on.'),
				_('Video streams at full speed instead of being capped.')));
		else if (on && !running)
			body.push(banner('warn', _('4K/HD is on, but the engine is not running.'),
				_('Try turning it off and on again.')));
		else
			body.push(banner('warn', _('4K/HD is off.'),
				_('Your carrier is free to throttle video.')));

		body.push(E('div', { 'class': 'ck-card' }, [
			E('div', { 'class': 'ck-rows' }, [
				row(_('Status'), on ? _('On') : _('Off')),
				row(_('Engine'), running ? _('Running') : _('Stopped'))
			])
		]));

		body.push(E('div', { 'class': 'ck-actions' }, [
			E('button', {
				'class': 'ck-btn ' + (running ? 'ck-btn--danger' : 'ck-btn--primary'),
				'click': ui.createHandlerFn(self, 'setEngine', !running)
			}, running ? _('Turn off') : _('Turn on')),
			E('button', {
				'class': 'ck-btn',
				'click': ui.createHandlerFn(self, 'runTest')
			}, _('Streaming Test'))
		]));

		body.push(E('p', { 'class': 'ck-note' },
			_('The streaming test measures video with the engine off and on, so you can see the difference rather than take it on trust.')));

		return E('div', { 'class': 'ck-page ck-page--center' }, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
