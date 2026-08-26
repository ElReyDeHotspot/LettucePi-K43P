'use strict';
'require view';
'require fs';
'require ui';
'require rpc';

/* Chester system update.
 *
 * Reads a manifest from GitHub, compares its build id against the one stamped
 * into /etc/chester-version at build time, and offers a one-click update.
 * All the work happens in /usr/sbin/chester-update; this view only calls it,
 * because the rpcd ACL permits exactly those argument forms and nothing else.
 *
 * Presentation follows the misectel Cellular > IPv6 page rather than the
 * generic ck- kit: same window, same gradient icon tile, same status pill,
 * same grouped cards and switches. The kit is fine for a page that is mostly
 * two lines of text, but this is a settings screen and looked out of place
 * beside the rest of the UI.
 *
 * The CSS is injected from here rather than living in cascade.css, because
 * cascade.css ships with the theme payload while this view ships with the
 * dashboard package -- keeping them in one file means the markup and its
 * styling can never arrive in different versions.
 */

var callUpdateSettings = rpc.declare({
	object: 'misectel', method: 'update_settings', expect: {}
});
var callSetUpdateSettings = rpc.declare({
	object: 'misectel', method: 'set_update_settings',
	params: [ 'auto', 'time', 'keep_settings' ], expect: {}
});

var CSS_ID = 'chester-update-css';
var CSS = [
'.su-page {',
'	--su-accent: #1677ff;',
'	--su-green: #27ae60;',
'	--su-red: #d93442;',
'	--su-text: #172033;',
'	--su-muted: #6d7788;',
'	--su-line: rgba(92, 108, 132, .17);',
'	--su-fill: rgba(238, 242, 247, .76);',
'	width: 100%;',
'	box-sizing: border-box;',
'	padding: 12px 0 28px;',
'	color: var(--su-text);',
'}',
'.su-page, .su-page * { box-sizing: border-box; }',

'.su-window {',
'	width: min(100%, 1000px);',
'	margin: 0 auto;',
'	overflow: hidden;',
'	border: 1px solid var(--su-line);',
'	border-radius: 24px;',
'	background: rgba(255, 255, 255, .94);',
'	box-shadow: 0 20px 55px rgba(28, 43, 67, .10), 0 2px 8px rgba(28, 43, 67, .04);',
'}',

'.su-header {',
'	display: flex;',
'	align-items: center;',
'	justify-content: center;',
'	gap: 14px;',
'	text-align: center;',
'	min-height: 97px;',
'	padding: 24px 26px 20px;',
'	border-bottom: 1px solid var(--su-line);',
'	background: linear-gradient(180deg, rgba(248,250,253,.96), rgba(255,255,255,.96));',
'}',
'.su-header__copy { min-width: 0; }',
'.su-header__copy h2 {',
'	margin: 0;',
'	color: var(--su-text);',
'	font-size: 23px;',
'	font-weight: 730;',
'	letter-spacing: -.035em;',
'}',
'.su-header__copy p {',
'	margin: 4px 0 0;',
'	color: var(--su-muted);',
'	font-size: 13px;',
'	line-height: 1.45;',
'}',

'.su-pill {',
'	display: inline-flex;',
'	align-items: center;',
'	justify-content: center;',
'	min-height: 28px;',
'	padding: 4px 11px;',
'	border-radius: 999px;',
'	background: rgba(109,119,136,.10);',
'	color: var(--su-muted);',
'	font-size: 11.5px;',
'	font-weight: 720;',
'	white-space: nowrap;',
'}',
'.su-pill::before {',
'	content: "";',
'	width: 7px;',
'	height: 7px;',
'	margin-right: 7px;',
'	border-radius: 50%;',
'	background: currentColor;',
'}',
'.su-pill.is-ok { background: rgba(39,174,96,.10); color: #168847; }',
'.su-pill.is-new { background: rgba(22,119,255,.10); color: #0a63d6; }',
'.su-pill.is-bad { background: rgba(217,52,66,.09); color: var(--su-red); }',

'.su-master {',
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
'.su-master__copy { min-width: 0; }',
'.su-master__copy strong { display: block; font-size: 15px; font-weight: 710; }',
'.su-master__copy span {',
'	display: block;',
'	margin-top: 4px;',
'	color: var(--su-muted);',
'	font-size: 12.5px;',
'}',

'.su-groups {',
'	display: grid;',
'	grid-template-columns: repeat(2, minmax(0, 1fr));',
'	gap: 16px;',
'	padding: 16px 22px 20px;',
'}',
'@media (max-width: 720px) { .su-groups { grid-template-columns: minmax(0, 1fr); } }',
'.su-group {',
'	min-width: 0;',
'	overflow: hidden;',
'	border: 1px solid var(--su-line);',
'	border-radius: 17px;',
'	background: rgba(255,255,255,.88);',
'}',
'.su-group__heading { padding: 17px 18px 12px; }',
'.su-group__heading h3 { margin: 0; font-size: 15px; font-weight: 710; letter-spacing: -.01em; }',
'.su-group__heading p {',
'	margin: 4px 0 0;',
'	color: var(--su-muted);',
'	font-size: 12px;',
'	line-height: 1.4;',
'}',
'.su-group__list { padding: 0 18px 7px; }',

'.su-row {',
'	display: flex;',
'	align-items: center;',
'	justify-content: space-between;',
'	gap: 18px;',
'	min-height: 46px;',
'	padding: 11px 0;',
'	border-top: 1px solid var(--su-line);',
'}',
'.su-row__label { color: var(--su-muted); font-size: 12.5px; font-weight: 520; }',
'.su-row__value {',
'	min-width: 0;',
'	color: var(--su-text);',
'	font-size: 12.5px;',
'	font-weight: 680;',
'	text-align: right;',
'	overflow-wrap: anywhere;',
'}',
'.su-row__value.is-good { color: #168847; }',
'.su-row__value.is-muted { color: var(--su-muted); font-weight: 590; }',
'.su-row__control { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }',

'.su-switch { position: relative; display: inline-flex; width: 52px; height: 30px; flex: 0 0 52px; cursor: pointer; }',
'.su-switch input { position: absolute; opacity: 0; pointer-events: none; }',
'.su-switch__track {',
'	position: absolute;',
'	inset: 0;',
'	border-radius: 999px;',
'	background: #c7ced8;',
'	box-shadow: inset 0 0 0 1px rgba(60,72,90,.06);',
'	transition: background .2s ease;',
'}',
'.su-switch__track::after {',
'	content: "";',
'	position: absolute;',
'	top: 3px;',
'	left: 3px;',
'	width: 24px;',
'	height: 24px;',
'	border-radius: 50%;',
'	background: #fff;',
'	box-shadow: 0 2px 7px rgba(24,36,54,.25);',
'	transition: transform .2s ease;',
'}',
'.su-switch input:checked + .su-switch__track { background: var(--su-green); }',
'.su-switch input:checked + .su-switch__track::after { transform: translateX(22px); }',
'.su-switch input:disabled + .su-switch__track { opacity: .55; }',

'.su-time {',
'	padding: 7px 10px;',
'	border: 1px solid var(--su-line);',
'	border-radius: 10px;',
'	background: var(--su-fill);',
'	color: var(--su-text);',
'	font-family: inherit;',
'	font-size: 12.5px;',
'	font-weight: 640;',
'}',
'.su-time:disabled { opacity: .5; }',
'.su-zone {',
'	padding: 4px 9px;',
'	border-radius: 999px;',
'	background: rgba(109,119,136,.10);',
'	color: var(--su-muted);',
'	font-size: 11.5px;',
'	font-weight: 700;',
'	white-space: nowrap;',
'}',

'.su-footer {',
'	display: flex;',
'	align-items: center;',
'	justify-content: flex-end;',
'	gap: 18px;',
'	padding: 17px 22px 20px;',
'	border-top: 1px solid var(--su-line);',
'	background: rgba(247,249,252,.72);',
'}',
'.su-footer__copy strong { display: block; font-size: 14px; font-weight: 700; }',
'.su-footer__copy span { display: block; margin-top: 3px; color: var(--su-muted); font-size: 12px; }',
'.su-footer__actions { display: flex; align-items: center; gap: 11px; flex: 0 0 auto; }',

'.su-button {',
'	display: inline-flex;',
'	align-items: center;',
'	justify-content: center;',
'	min-height: 36px;',
'	padding: 8px 18px;',
'	border: 0;',
'	border-radius: 11px;',
'	background: linear-gradient(145deg, #2688ff, #0768e6);',
'	box-shadow: 0 6px 15px rgba(22,119,255,.24);',
'	color: #fff;',
'	font-family: inherit;',
'	font-size: 12.5px;',
'	font-weight: 700;',
'	cursor: pointer;',
'	transition: transform .16s ease, box-shadow .16s ease;',
'}',
'.su-button:hover { transform: translateY(-1px); box-shadow: 0 9px 20px rgba(22,119,255,.30); }',
'.su-button:disabled { opacity: .55; cursor: progress; transform: none; }',
'.su-button--quiet {',
'	background: rgba(109,119,136,.10);',
'	box-shadow: none;',
'	color: #465061;',
'}',
'.su-button--quiet:hover { box-shadow: 0 4px 12px rgba(28,43,67,.10); }',

'.su-note { margin: 0; color: var(--su-muted); font-size: 12px; }',
'.su-note.is-bad { color: var(--su-red); font-weight: 640; }'
].join('\n');

function ensureCss() {
	if (document.getElementById(CSS_ID))
		return;
	document.head.appendChild(E('style', { id: CSS_ID }, [ CSS ]));
}

function row(label, value, cls) {
	return E('div', { 'class': 'su-row' }, [
		E('span', { 'class': 'su-row__label' }, [ label ]),
		E('span', { 'class': 'su-row__value' + (cls ? ' ' + cls : '') }, [ value || '-' ])
	]);
}

function controlRow(label, control) {
	return E('div', { 'class': 'su-row' }, [
		E('span', { 'class': 'su-row__label' }, [ label ]),
		E('span', { 'class': 'su-row__control' }, control)
	]);
}

function group(title, rows) {
	return E('section', { 'class': 'su-group' }, [
		E('div', { 'class': 'su-group__heading' }, [ E('h3', {}, [ title ]) ]),
		E('div', { 'class': 'su-group__list' }, rows)
	]);
}

function toggle(id, on) {
	var input = E('input', { 'type': 'checkbox', 'id': id, 'checked': on ? 'checked' : null });
	return {
		input: input,
		node: E('label', { 'class': 'su-switch' }, [ input, E('span', { 'class': 'su-switch__track' }) ])
	};
}

return view.extend({
	load: function () {
		ensureCss();
		return Promise.all([
			fs.exec('/usr/sbin/chester-update', [ 'status' ]).then(function (res) {
				try { return JSON.parse((res.stdout || '').trim()); }
				catch (e) { return { ok: false, error: 'unreadable' }; }
			}).catch(function () { return { ok: false, error: 'denied' }; }),
			/* Never let this reject the whole page: the firmware card is still
			 * worth showing on a build whose backend predates these options. */
			callUpdateSettings().catch(function () {
				return { auto: false, time: '03:00', keep_settings: true, timezone: 'UTC' };
			})
		]);
	},

	handleInstall: function (keep) {
		var self = this;
		ui.showModal(_('Update firmware'), [
			E('p', {}, _('The router will download the update, check it, install it and restart.')),
			E('ul', {}, [
				keep
					? E('li', {}, _('Your settings are kept.'))
					: E('li', {}, [ E('strong', {},
						_('Your settings will be erased, including the Wi-Fi name and password, the APN and the admin password.')) ]),
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
							E('p', { 'class': 'spinning' },
								_('Downloading and installing. Do not unplug the router.'))
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
							/* The flash is detached, so this response arrives before
							 * the reboot. Hand over to LuCI's reconnect countdown. */
							ui.showModal(_('Installing'), [
								E('p', { 'class': 'spinning' },
									_('The router is installing the update and will restart. Do not unplug it.'))
							]);
							ui.awaitReconnect(window.location.host);
						});
					})
				}, _('Update Now'))
			])
		]);
	},

	render: function (data) {
		var self = this;
		var info = data ? data[0] : null;
		var settings = (data && data[1]) ? data[1] : {};
		var online = !!(info && info.ok === true);
		var newer = online && (info.update_available === true || info.update_available === 'true');
		var zone = settings.timezone || 'UTC';

		/* Keeping settings defaults ON and automatic updates default OFF.
		 * Those are the two safe directions: nothing reflashes on a schedule
		 * nobody asked for, and nothing silently discards a customer's Wi-Fi
		 * name, APN and admin password. */
		var keep = toggle('su-keep', settings.keep_settings !== false);
		var auto = toggle('su-auto', settings.auto === true);
		var timeBox = E('input', {
			'type': 'time', 'class': 'su-time', 'id': 'su-time',
			'value': settings.time || '03:00',
			'disabled': (settings.auto === true) ? null : 'disabled'
		});
		var zoneTag = E('span', { 'class': 'su-zone' }, [ zone ]);
		var note = E('p', { 'class': 'su-note' }, [ '' ]);

		auto.input.addEventListener('change', function () {
			timeBox.disabled = !auto.input.checked;
		});

		var save = E('button', {
			'class': 'su-button su-button--quiet',
			'click': ui.createHandlerFn(self, function () {
				note.className = 'su-note';
				note.textContent = _('Saving…');
				return callSetUpdateSettings(
					auto.input.checked ? '1' : '0',
					timeBox.value || '03:00',
					keep.input.checked ? '1' : '0'
				).then(function (res) {
					if (res && res.success === false) {
						note.className = 'su-note is-bad';
						note.textContent = res.message || _('Could not save.');
						return;
					}
					/* Echo back what the router stored, not what was typed: an
					 * unusable time is corrected server-side and the field
					 * should show the value that will actually run. */
					if (res && res.time)
						timeBox.value = res.time;
					note.className = 'su-note';
					note.textContent = (res && res.auto)
						? _('Saved. Updates install at %s %s.').format(res.time, zone)
						: _('Saved.');
				}).catch(function (e) {
					note.className = 'su-note is-bad';
					note.textContent = _('Could not save: %s').format(e);
				});
			})
		}, _('Save'));

		var pill, pillText;
		if (!online) {
			pill = 'is-bad';
			pillText = (info && info.error === 'offline') ? _('Offline') : _('Unavailable');
		}
		else if (newer) { pill = 'is-new'; pillText = _('Update available'); }
		else { pill = 'is-ok'; pillText = _('Up To Date'); }

		var masterAction = newer
			? E('button', {
				'class': 'su-button',
				'click': ui.createHandlerFn(self, function () {
					return self.handleInstall(keep.input.checked);
				})
			}, _('Install Update'))
			: E('span', { 'class': 'su-note' }, [
				online ? _('Nothing To Install') : _('Cannot Check Right Now')
			]);

		return E('div', { 'class': 'su-page' }, [ E('main', { 'class': 'su-window' }, [
			E('header', { 'class': 'su-header' }, [
				E('div', { 'class': 'su-header__copy' }, [
					E('h2', {}, [ _('System Update') ])
				]),
				E('span', { 'class': 'su-pill ' + pill }, [ pillText ])
			]),

			E('section', { 'class': 'su-master' }, [
				E('div', { 'class': 'su-master__copy' }, [
					E('strong', {}, [
						(info && info.installed_bin)
							? _('Bin %s').format(info.installed_bin)
							: _('Bin Unknown')
					]),
					E('span', {}, [
						(newer && info.latest_bin)
							? _('Bin %s is ready to install').format(info.latest_bin)
							: ((info && info.installed_version)
								? _('Version %s').format(info.installed_version)
								: _('This Router Is Current'))
					])
				]),
				E('div', {}, [ masterAction ])
			]),

			E('div', { 'class': 'su-groups' }, [
				group(_('Firmware'), [
					row(_('Installed'), (info && info.installed_bin) ? 'Bin ' + info.installed_bin : _('Unknown')),
					row(_('Latest'), (online && info.latest_bin) ? 'Bin ' + info.latest_bin : _('Unknown'),
						newer ? 'is-good' : null),
					row(_('Version'), (info && info.installed_version) || _('Unknown'), 'is-muted')
				]),
				group(_('Update Options'), [
					controlRow(_('Keep Settings'), [ keep.node ]),
					controlRow(_('Install Automatically'), [ auto.node ]),
					controlRow(_('Schedule Update'), [ timeBox, zoneTag ])
				])
			]),

			/* No footer caption: the zone tag beside the clock already says
			 * which clock the schedule runs on, and repeating it here was just
			 * restating the row above in a longer sentence. */
			E('footer', { 'class': 'su-footer' }, [
				E('div', { 'class': 'su-footer__actions' }, [ note, save ])
			])
		]) ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
