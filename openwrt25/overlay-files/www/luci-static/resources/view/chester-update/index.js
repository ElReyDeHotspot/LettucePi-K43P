'use strict';
'require view';
'require fs';
'require ui';

/* Chester system update.
 *
 * Reads a manifest from GitHub, compares its sha256 against the one stamped
 * into /etc/chester-version at build time, and offers a one-click update that
 * keeps settings. All the work happens in /usr/sbin/chester-update; this view
 * only calls it, because the rpcd ACL permits exactly those two argument
 * forms and nothing else.
 */

function row(label, value, mono) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '33%' }, [ label ]),
		E('td', { 'class': 'td left', 'style': mono ? 'font-family:monospace;font-size:90%;word-break:break-all' : '' },
			[ value || '-' ])
	]);
}

return view.extend({
	load: function () {
		return fs.exec('/usr/sbin/chester-update', [ 'status' ]).then(function (res) {
			try { return JSON.parse((res.stdout || '').trim()); }
			catch (e) { return { ok: false, error: 'unreadable' }; }
		}).catch(function () { return { ok: false, error: 'denied' }; });
	},

	handleInstall: function (info, ev) {
		var self = this;
		ui.showModal(_('Update firmware'), [
			E('p', {}, _('The router will download the update, check it, install it and restart.')),
			E('ul', {}, [
				E('li', {}, _('Your settings are kept.')),
				E('li', {}, _('Packages you installed yourself are not kept.')),
				E('li', {}, _('Do not unplug the router while it works.'))
			]),
			E('p', { 'class': 'alert-message warning' },
				_('This takes a few minutes. The page will stop responding while the router restarts.')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
				' ',
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(self, function () {
						ui.showModal(_('Updating'), [
							E('p', { 'class': 'spinning' }, _('Downloading and installing. Do not unplug the router.'))
						]);
						return fs.exec('/usr/sbin/chester-update', [ 'install' ]).then(function (res) {
							var out = (res.stdout || '').trim();
							if (out.indexOf('OK:') !== 0) {
								ui.showModal(_('Update failed'), [
									E('p', {}, out || _('The update could not be started.')),
									E('p', {}, _('The router has not been changed.')),
									E('div', { 'class': 'right' }, [
										E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))
									])
								]);
								return;
							}
							/* The flash is detached, so this response arrives before the
							 * reboot. Hand over to LuCI's own reconnect countdown. */
							ui.showModal(_('Installing'), [
								E('p', { 'class': 'spinning' },
									_('The router is installing the update and will restart. Do not unplug it.'))
							]);
							ui.awaitReconnect(window.location.host);
						});
					})
				}, _('Update now'))
			])
		]);
	},

	render: function (info) {
		var body = [ E('h2', {}, _('System Update')) ];

		if (!info || info.ok !== true) {
			body.push(E('div', { 'class': 'alert-message warning' }, [
				info && info.error === 'offline'
					? _('Could not reach the update server. Check the router\'s internet connection.')
					: _('The update service is not available on this firmware.')
			]));
			if (info && info.installed_version)
				body.push(E('table', { 'class': 'table' }, [
					row(_('Installed version'), info.installed_version),
					row(_('Built'), info.installed_built)
				]));
			return E('div', {}, body);
		}

		var newer = (info.update_available === true || info.update_available === 'true');

		body.push(E('div', { 'class': newer ? 'alert-message notice' : 'alert-message success' }, [
			newer ? _('An update is available.') : _('This router is up to date.')
		]));

		body.push(E('table', { 'class': 'table' }, [
			row(_('Installed version'), info.installed_version),
			row(_('Installed build'), info.installed_built),
			row(_('Latest version'), info.latest_version),
			row(_('Latest build'), info.latest_built),
			row(_('Latest checksum'), info.latest_sha, true)
		]));

		if (info.notes)
			body.push(E('p', {}, [ E('em', {}, info.notes) ]));

		if (newer) {
			body.push(E('p', {}, [
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleInstall', info)
				}, _('Install update'))
			]));
			body.push(E('p', {}, [ E('small', {},
				_('Your settings are kept. Packages you installed yourself are not.')) ]));
		}

		return E('div', {}, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
