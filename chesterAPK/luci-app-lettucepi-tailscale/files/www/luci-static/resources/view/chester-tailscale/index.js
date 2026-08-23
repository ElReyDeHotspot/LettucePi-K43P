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
 */

function row(label, value, mono) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '35%' }, [ label ]),
		E('td', { 'class': 'td left', 'style': mono ? 'font-family:monospace;word-break:break-all' : '' },
			[ value || '-' ])
	]);
}

function btn(label, cls, handler) {
	return E('button', { 'class': 'btn ' + cls, 'click': handler, 'style': 'margin:0 .4em .4em 0' }, label);
}

return view.extend({
	load: function () {
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
				'style': 'word-break:break-all' }, url) ]),
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
		var body = [ E('h2', {}, _('Tailscale')) ];

		if (!info || info.ok !== true) {
			body.push(E('div', { 'class': 'alert-message warning' },
				[ _('Tailscale controls are not available.') ]));
			return E('div', {}, body);
		}

		var present   = (info.present === true || info.present === 'true');
		var running   = (info.running === true || info.running === 'true');
		var connected = (info.backend === 'Running');
		var needslogin= (info.backend === 'NeedsLogin' || info.backend === 'Stopped' || info.backend === '');
		var ssh       = (info.ssh === true || info.ssh === 'true');
		var dns       = (info.dns === true || info.dns === 'true');

		var tone = !present ? 'notice' : (connected ? 'success' : 'warning');
		var head = !present
			? _('Tailscale is not installed. It will be downloaded from the package feed, so the router needs an internet connection.')
			: (connected ? _('Connected to your tailnet.')
			   : (running ? _('Installed and running, but not signed in yet.')
			              : _('Installed but the service is not running.')));
		body.push(E('div', { 'class': 'alert-message ' + tone }, [ head ]));

		if (present) {
			body.push(E('table', { 'class': 'table' }, [
				row(_('Status'), connected ? _('Connected') : (running ? _('Not signed in') : _('Stopped'))),
				row(_('Version'), info.version),
				row(_('Signed in as'), info.user),
				row(_('Tailscale IP'), info.ip, true),
				row(_('Tailscale SSH'), ssh ? _('Enabled') : _('Disabled')),
				row(_('Use tailnet DNS'), dns ? _('Yes') : _('No (default)'))
			]));
		}

		var actions = [];

		if (!present) {
			actions.push(btn(_('Install'), 'cbi-button-action important',
				ui.createHandlerFn(self, 'run', 'install', _('Downloading and installing...'))));
		} else {
			if (!connected) {
				actions.push(btn(_('Connect'), 'cbi-button-action important',
					ui.createHandlerFn(self, 'run', 'connect', _('Starting sign-in...'))));
				actions.push(btn(_('Connect + SSH'), 'cbi-button-action',
					ui.createHandlerFn(self, 'run', 'connect-ssh', _('Starting sign-in...'))));
			}
			actions.push(btn(_('Update'), 'cbi-button-action',
				ui.createHandlerFn(self, 'run', 'update', _('Checking for a newer version...'))));
			actions.push(btn(dns ? _('Turn tailnet DNS off') : _('Turn tailnet DNS on'), 'cbi-button-action',
				ui.createHandlerFn(self, 'run', dns ? 'dns-off' : 'dns-on', _('Applying...'))));
			if (connected || info.state === 'present')
				actions.push(btn(_('Log out'), 'cbi-button-remove', function () {
					self.confirmThen(_('Log out of Tailscale'),
						_('This router leaves the tailnet and forgets its identity. Tailscale stays installed.'),
						'logout', _('Logging out...'));
				}));
			actions.push(btn(_('Uninstall'), 'cbi-button-remove', function () {
				self.confirmThen(_('Uninstall Tailscale'),
					_('Tailscale is removed and this router forgets its identity. It can be installed again at any time.'),
					'uninstall', _('Removing...'));
			}));
		}

		body.push(E('div', { 'style': 'margin-top:1em' }, actions));

		if (info.authurl)
			body.push(E('p', {}, [
				E('em', {}, _('Sign-in pending: ')),
				E('a', { 'href': info.authurl, 'target': '_blank', 'rel': 'noreferrer' }, info.authurl)
			]));

		body.push(E('p', {}, [ E('small', {}, present
			? _('Connect + SSH also allows SSH to this router over the tailnet. Tailnet DNS is off by default so the router keeps serving its own DNS.')
			: _('About 7 MB is downloaded and installed. This takes a minute.')) ]));

		return E('div', {}, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
