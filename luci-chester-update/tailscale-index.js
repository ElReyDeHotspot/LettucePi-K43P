'use strict';
'require view';
'require fs';
'require ui';

/* Tailscale install / uninstall.
 *
 * The binary ships in the firmware, so this only enables or disables the
 * service. All the work is in /usr/sbin/chester-tailscale; the rpcd ACL
 * permits exactly those three argument forms.
 */

function row(label, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '33%' }, [ label ]),
		E('td', { 'class': 'td left' }, [ value || '-' ])
	]);
}

return view.extend({
	load: function () {
		return fs.exec('/usr/sbin/chester-tailscale', [ 'status' ]).then(function (r) {
			try { return JSON.parse((r.stdout || '').trim()); }
			catch (e) { return { ok: false, error: 'unreadable' }; }
		}).catch(function () { return { ok: false, error: 'denied' }; });
	},

	run: function (action, ev) {
		var self = this;
		var busy = action === 'install' ? _('Downloading and installing…') : _('Removing…');
		ui.showModal(_('Tailscale'), [ E('p', { 'class': 'spinning' }, busy) ]);
		return fs.exec('/usr/sbin/chester-tailscale', [ action ]).then(function (r) {
			var out = (r.stdout || '').trim();
			ui.hideModal();
			if (out.indexOf('OK:') !== 0) {
				ui.addNotification(null, E('p', {}, out || _('Action failed.')), 'danger');
				return;
			}
			ui.addNotification(null, E('p', {}, out.replace(/^OK:\s*/, '')), 'info');
			/* Re-read rather than guessing the new state. */
			return self.load().then(function (info) {
				var body = self.render(info);
				var old = document.querySelector('#view');
				if (old) { old.innerHTML = ''; old.appendChild(body); }
			});
		}).catch(function (err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, String(err)), 'danger');
		});
	},

	render: function (info) {
		var body = [ E('h2', {}, _('Tailscale')) ];

		if (!info || info.ok !== true) {
			body.push(E('div', { 'class': 'alert-message warning' }, [
				_('Tailscale controls are not available.')
			]));
			return E('div', {}, body);
		}

		var present = (info.present === true || info.present === 'true');
		var on = present && (info.installed === true || info.installed === 'true');
		var running = (info.running === true || info.running === 'true');

		body.push(E('div', { 'class': on ? 'alert-message success' : 'alert-message notice' }, [
			on ? (running ? _('Tailscale is installed and running.')
			              : _('Tailscale is installed but not running.'))
			   : _('Tailscale is not installed. It will be downloaded from the package feed, so the router needs an internet connection.')
		]));

		body.push(E('table', { 'class': 'table' }, [
			row(_('Status'), on ? (running ? _('Running') : _('Enabled, stopped')) : _('Not installed')),
			row(_('Version'), info.version),
			row(_('Connection'), info.backend || _('Not connected')),
			row(_('Stored identity'), info.state === 'present' ? _('Yes') : _('None'))
		]));

		if (!on) {
			body.push(E('p', {}, [
				E('button', {
					'class': 'btn cbi-button-action important',
					'click': ui.createHandlerFn(this, 'run', 'install')
				}, _('Install Tailscale'))
			]));
			body.push(E('p', {}, [ E('small', {},
				_('About 7 MB is downloaded and installed. This takes a minute.')) ]));
		} else {
			body.push(E('p', {}, [
				E('button', {
					'class': 'btn cbi-button-remove',
					'click': ui.createHandlerFn(this, 'run', 'uninstall')
				}, _('Uninstall Tailscale'))
			]));
			body.push(E('p', {}, [ E('small', {},
				_('This stops Tailscale and discards this router\'s identity, so it will not rejoin automatically.')) ]));
		}

		return E('div', {}, body);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
