'use strict';
'require view';
'require fs';
'require ui';
'require poll';

/* Tailscale control panel.
 *
 * Tailscale is not in the firmware; "Install" fetches it from the package feed.
 * All work happens in /usr/sbin/chester-tailscale -- the rpcd ACL permits
 * exactly the argument forms used here and nothing else.
 *
 * `tailscale up` blocks until the browser login completes, so the backend
 * backgrounds it and hands back the login URL; this view shows it as a link and
 * then polls until the node reports Running.
 *
 * Presentation uses the Chester UI kit (chester-ui/kit.css) rather than LuCI's
 * .alert-message. The theme paints that class with an absolutely positioned
 * "!" badge and only keeps text clear of it when the banner contains an <h4>,
 * so a bare string -- which is what this page has -- gets the badge printed on
 * top of its first word.
 */

var KIT_CSS_ID = 'chester-ui-kit-css';
var KIT_CSS_URL = L.resource('chester-ui/kit.css');

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

function btn(label, variant, handler) {
	return E('button', { 'class': 'ck-btn' + (variant ? ' ck-btn--' + variant : ''),
		'click': handler }, label);
}

return view.extend({
	load: function () {
		ensureKit();
		return fs.exec('/usr/sbin/chester-tailscale', [ 'status' ]).then(function (r) {
			try { return JSON.parse((r.stdout || '').trim()); }
			catch (e) { return { ok: false, error: 'unreadable' }; }
		}).catch(function () { return { ok: false, error: 'denied' }; });
	},

	refresh: function () {
		var self = this;
		return self.load().then(function (info) {
			var body = self.render(info);
			var old = document.querySelector('#view');
			if (old) { old.innerHTML = ''; old.appendChild(body); }
		});
	},

	/* Login URL handling: show it, keep it clickable, and stop polling once the
	 * node actually comes up. */
	showAuth: function (url) {
		var self = this;
		ui.showModal(_('Sign in to Tailscale'), [
			E('p', {}, _('Open this link, sign in, and this router joins your tailnet.')),
			E('p', {}, [ E('a', { 'href': url, 'target': '_blank', 'rel': 'noreferrer',
				'class': 'ck-link' }, url) ]),
			E('p', { 'class': 'spinning' }, _('Waiting for sign-in to complete...')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': function () { ui.hideModal(); self.refresh(); } }, _('Close'))
			])
		]);
		var tries = 0;
		var tick = function () {
			if (++tries > 60) return;
			fs.exec('/usr/sbin/chester-tailscale', [ 'authurl' ]).then(function (r) {
				var d = {};
				try { d = JSON.parse((r.stdout || '').trim()); } catch (e) { return; }
				if (d.backend === 'Running') { ui.hideModal(); self.refresh(); return; }
				window.setTimeout(tick, 3000);
			}).catch(function () {});
		};
		window.setTimeout(tick, 3000);
	},

	run: function (action, busyText, ev) {
		var self = this;
		ui.showModal(_('Tailscale'), [ E('p', { 'class': 'spinning' }, busyText) ]);
		return fs.exec('/usr/sbin/chester-tailscale', [ action ]).then(function (r) {
			var out = (r.stdout || '').trim();
			ui.hideModal();
			if (out.indexOf('OK:') !== 0) {
				ui.addNotification(null, E('p', {}, out || _('Action failed.')), 'danger');
				return self.refresh();
			}
			var msg = out.replace(/^OK:\s*/, '');
			/* connect / connect-ssh answer with the login URL when the node is
			 * not authenticated yet. */
			if (/^https:\/\//.test(msg)) return self.showAuth(msg);
			ui.addNotification(null, E('p', {}, msg), 'info');
			return self.refresh();
		}).catch(function (err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, String(err)), 'danger');
		});
	},

	confirmThen: function (title, warning, action, busyText) {
		var self = this;
		ui.showModal(title, [
			E('p', {}, warning),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button-remove',
					'click': ui.createHandlerFn(self, function () {
						ui.hideModal();
						return self.run(action, busyText);
					})
				}, _('Continue'))
			])
		]);
	},

	render: function (info) {
		var self = this;
		var body = [ E('h2', { 'class': 'ck-title' }, _('Tailscale')) ];

		if (!info || info.ok !== true) {
			body.push(banner('danger', _('Tailscale controls are not available.'),
				_('The helper on this router did not answer.')));
			return E('div', { 'class': 'ck-page ck-page--center' }, body);
		}

		var present   = (info.present === true || info.present === 'true');
		var running   = (info.running === true || info.running === 'true');
		var connected = (info.backend === 'Running');
		var ssh       = (info.ssh === true || info.ssh === 'true');
		var dns       = (info.dns === true || info.dns === 'true');

		if (!present)
			body.push(banner('info', _('Tailscale is not installed.'),
				_('It is downloaded from the package feed, so the router needs an internet connection.')));
		else if (connected)
			body.push(banner('ok', _('Connected to your tailnet.'),
				info.ip ? _('This router is reachable at %s.').format(info.ip) : null));
		else if (running)
			body.push(banner('warn', _('Installed and running, but not signed in yet.'),
				_('Use Connect to sign in and join your tailnet.')));
		else
			body.push(banner('warn', _('Installed, but the service is not running.'), null));

		if (present) {
			body.push(E('div', { 'class': 'ck-card' }, [
				E('div', { 'class': 'ck-rows' }, [
					row(_('Status'), connected ? _('Connected') : (running ? _('Not signed in') : _('Stopped'))),
					row(_('Version'), info.version),
					row(_('Signed in as'), info.user),
					row(_('Tailscale IP'), info.ip, true),
					row(_('Tailscale SSH'), ssh ? _('Enabled') : _('Disabled')),
					row(_('Use tailnet DNS'), dns ? _('Yes') : _('No (default)'))
				])
			]));
		}

		var actions = [];

		if (!present) {
			actions.push(btn(_('Install'), 'primary',
				ui.createHandlerFn(self, 'run', 'install', _('Downloading and installing...'))));
		} else {
			if (!connected) {
				actions.push(btn(_('Connect'), 'primary',
					ui.createHandlerFn(self, 'run', 'connect', _('Starting sign-in...'))));
				actions.push(btn(_('Connect + SSH'), null,
					ui.createHandlerFn(self, 'run', 'connect-ssh', _('Starting sign-in...'))));
			}
			actions.push(btn(_('Update'), null,
				ui.createHandlerFn(self, 'run', 'update', _('Checking for a newer version...'))));
			actions.push(btn(dns ? _('Turn tailnet DNS off') : _('Turn tailnet DNS on'), null,
				ui.createHandlerFn(self, 'run', dns ? 'dns-off' : 'dns-on', _('Applying...'))));
			if (connected || info.state === 'present')
				actions.push(btn(_('Log out'), 'danger', function () {
					self.confirmThen(_('Log out of Tailscale'),
						_('This router leaves the tailnet and forgets its identity. Tailscale stays installed.'),
						'logout', _('Logging out...'));
				}));
			actions.push(btn(_('Uninstall'), 'danger', function () {
				self.confirmThen(_('Uninstall Tailscale'),
					_('Tailscale is removed and this router forgets its identity. It can be installed again at any time.'),
					'uninstall', _('Removing...'));
			}));
		}

		body.push(E('div', { 'class': 'ck-actions' }, actions));

		if (info.authurl)
			body.push(E('p', { 'class': 'ck-note' }, [
				_('Sign-in pending: '),
				E('a', { 'href': info.authurl, 'target': '_blank', 'rel': 'noreferrer',
					'class': 'ck-link' }, info.authurl)
			]));

		body.push(E('p', { 'class': 'ck-note' },
			_('Connect + SSH also allows SSH to this router over the tailnet. Tailnet DNS is off by default so the router keeps serving its own DNS.')));

		return E('div', { 'class': 'ck-page ck-page--center' }, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
