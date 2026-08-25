'use strict';
'require view';
'require fs';
'require ui';

/* Chester system update.
 *
 * Reads a manifest from GitHub, compares its build id against the one stamped
 * into /etc/chester-version at build time, and offers a one-click update that
 * keeps settings. All the work happens in /usr/sbin/chester-update; this view
 * only calls it, because the rpcd ACL permits exactly those two argument forms
 * and nothing else.
 *
 * Presentation uses the Chester UI kit (chester-ui/kit.css), the same one the
 * Tailscale page uses, so both pages stay identical as the kit evolves.
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

return view.extend({
	load: function () {
		ensureKit();
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
		var body = [ E('h2', { 'class': 'ck-title' }, _('System Update')) ];

		if (!info || info.ok !== true) {
			body.push(banner('warn',
				info && info.error === 'offline'
					? _('Could not reach the update server.')
					: _('The update service is not available on this firmware.'),
				info && info.error === 'offline'
					? _('Check the router\'s internet connection and try again.')
					: null));
			if (info && info.installed_version)
				body.push(E('div', { 'class': 'ck-card' }, [
					E('div', { 'class': 'ck-rows' }, [
						row(_('Installed Image'), info.installed_bin ? ('bin ' + info.installed_bin) : _('unknown'))
					])
				]));
			return E('div', { 'class': 'ck-page ck-page--center' }, body);
		}

		var newer = (info.update_available === true || info.update_available === 'true');

		body.push(newer
			? banner('info', _('An update is available.'),
				info.latest_version
					? _('Version %s is ready to install.').format(info.latest_version)
					: null)
			: banner('ok', _('This router is up to date.'),
				info.installed_version
					? _('Version %s').format(info.installed_version)
					: null));

		body.push(E('div', { 'class': 'ck-card' }, [
			E('div', { 'class': 'ck-rows' }, [
				row(_('Installed Image'), info.installed_bin ? ('bin ' + info.installed_bin) : _('unknown')),
				row(_('Latest Image'), info.latest_bin ? ('bin ' + info.latest_bin) : _('unknown'))
			])
		]));

		if (newer) {
			body.push(E('div', { 'class': 'ck-actions' }, [
				E('button', {
					'class': 'ck-btn ck-btn--primary',
					'click': ui.createHandlerFn(this, 'handleInstall', info)
				}, _('Install update'))
			]));
			body.push(E('p', { 'class': 'ck-note' },
				_('Your settings are kept. Packages you installed yourself are not.')));
		}

		return E('div', { 'class': 'ck-page ck-page--center' }, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
