'use strict';
'require view';
'require poll';
'require ui';
'require uci';
'require dom';
'require chester.ui as chester';
'require chester.clients as clients';

/* Client list.
 *
 * Replaces the stock page. Two things changed:
 *
 *  1. Devices can be NAMED without pinning an IP. The stock page could only set
 *     a name through "Add Static IP", which rejected the save unless an IPv4
 *     address was supplied -- so naming a phone meant also reserving an address
 *     for it. A dhcp 'host' section carrying mac + name and no ip is valid and
 *     idiomatic: dnsmasq emits --dhcp-host=<mac>,<name>, which names the device
 *     without reserving anything (see dhcp_host_add in /etc/init.d/dnsmasq).
 *
 *  2. The table lost a redundant column ("Status" and "Online Status" both
 *     reported online/offline), gained a filter box, and sorts online devices
 *     to the top.
 *
 * The name is stored where DHCP already looks, so it also shows up in the lease
 * list and in DNS -- not just on this page.
 */

const REFRESH_INTERVAL = 5;
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

function normalizeInputMac(value) {
	const normalized = String(value || '').trim().replace(/-/g, ':').toUpperCase();
	const compact = normalized.replace(/:/g, '');
	if (/^[0-9A-F]{12}$/.test(compact))
		return compact.replace(/../g, '$&:').replace(/:$/, '');
	return normalized;
}

/* The name is written into --dhcp-host=<mac>,<name>, a COMMA-SEPARATED option.
 * A name containing a comma would inject extra fields into that option and
 * corrupt the dnsmasq config, so the input is reduced to hostname-safe
 * characters rather than merely validated -- the user cannot type something
 * that breaks DHCP. */
function sanitizeName(value) {
	return String(value || '')
		.replace(/[^A-Za-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

function deviceLabel(device) {
	if (device.customName) return device.customName;
	if (device.hostname && device.hostname !== '--') return device.hostname;
	return device.mac;
}

/* Every cell is the same two-line shape -- a value and a detail line that
 * always occupies space even when empty -- so rows cannot end up different
 * heights depending on which fields a device happens to have. Combined with
 * table-layout:fixed and the colgroup below, the grid stays square. */
const COLUMNS = [
	{ label: 'Device',     width: '26%' },
	{ label: 'IP Address', width: '15%' },
	{ label: 'Connection', width: '17%' },
	{ label: 'Status',     width: '14%' },
	{ label: 'Static IP',  width: '12%' },
	{ label: 'Actions',    width: '16%' }
];

const NBSP = ' ';

function cell(main, sub, opts) {
	return E('td', opts || {}, [
		E('div', { 'class': 'cl-main' }, [ main ]),
		E('div', { 'class': 'cl-sub' }, [ sub || NBSP ])
	]);
}

const STYLE = `
.chester-clients .chester-device-table { table-layout: fixed; width: 100%; }
.chester-clients .chester-device-table th,
.chester-clients .chester-device-table td {
	vertical-align: middle;
	padding: .5em .6em;
}
.chester-clients .cl-main,
.chester-clients .cl-sub {
	display: block;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.chester-clients .cl-main { line-height: 1.4; }
.chester-clients .cl-sub  { line-height: 1.3; min-height: 1.3em; font-size: 90%; opacity: .65; }
.chester-clients .cl-name { cursor: pointer; font-weight: 600; }
.chester-clients .cl-name:hover { text-decoration: underline; }
.chester-clients .cl-actions {
	display: flex;
	gap: .4em;
	justify-content: flex-end;
	flex-wrap: nowrap;
}
.chester-clients .cl-actions > * { white-space: nowrap; }
.chester-clients .chester-table-input { width: 100%; box-sizing: border-box; }
.chester-clients .cl-filter { margin-bottom: .75em; }
/* The entry row puts real inputs in both lines, and the clipping that keeps
 * data rows square would cut the MAC field in half. */
.chester-clients .chester-device-table__add-row .cl-main,
.chester-clients .chester-device-table__add-row .cl-sub {
	overflow: visible;
	min-height: 0;
	opacity: 1;
	font-size: 100%;
}
.chester-clients .chester-device-table__add-row .cl-sub { margin-top: .35em; }
@media (max-width: 900px) {
	.chester-clients .cl-actions { justify-content: flex-start; flex-wrap: wrap; }
}
`;

function ensureStyle() {
	if (document.getElementById('chester-clients-style')) return;
	document.head.appendChild(E('style', { 'id': 'chester-clients-style' }, [ STYLE ]));
}

return view.extend({
	filterTerm: '',

	async load() {
		chester.ensureBaseStyle();
		await uci.load([ 'dhcp', 'chester' ]);
	},

	async fetchData() {
		return clients.fetchRuntimeData();
	},

	getNewStaticLease() {
		if (!this.newStaticLease)
			this.newStaticLease = { name: '', mac: '', ip: '' };
		return this.newStaticLease;
	},

	buildStaticLeaseMap() {
		return clients.buildStaticLeaseMap();
	},

	buildDevices(data) {
		const leases = this.buildStaticLeaseMap();
		const devices = clients.buildDevices(data, { staticLeases: leases });

		devices.forEach((device) => {
			const lease = leases[chester.normalizeMac(device.mac)];
			/* A name we set ourselves lives on the dhcp host section. The
			 * hostname the device reports is a separate thing and is kept, so
			 * the row can show both when they disagree. */
			device.customName = (lease && lease.name) ? lease.name : '';
			device.hasStaticIp = !!(lease && lease.ip);
		});

		const term = this.filterTerm.trim().toLowerCase();
		const matches = term
			? devices.filter((d) => [ deviceLabel(d), d.mac, d.ipaddr, d.hostname ]
				.some((f) => String(f || '').toLowerCase().includes(term)))
			: devices;

		/* Online first, then named devices, then by label. */
		return matches.sort((a, b) => {
			if ((a.tone === 'online') !== (b.tone === 'online'))
				return a.tone === 'online' ? -1 : 1;
			if (!!a.customName !== !!b.customName)
				return a.customName ? -1 : 1;
			return deviceLabel(a).localeCompare(deviceLabel(b));
		});
	},

	/* ---------------------------------------------------------- naming */

	async saveClientName(mac, rawName) {
		mac = normalizeInputMac(mac);
		if (!MAC_RE.test(mac))
			throw new Error(_('Enter a valid MAC address'));

		const name = sanitizeName(rawName);
		const leases = this.buildStaticLeaseMap();
		const existing = leases[chester.normalizeMac(mac)];
		let sid = existing ? existing.section : null;

		if (!name) {
			if (!sid) return;
			if (existing.ip) {
				/* Keep the address reservation, drop only the name. */
				uci.unset('dhcp', sid, 'name');
			} else {
				/* The section existed only to hold the name -- remove it
				 * rather than leaving an empty host block behind. */
				uci.remove('dhcp', sid);
			}
		} else {
			if (!sid) {
				sid = uci.add('dhcp', 'host');
				uci.set('dhcp', sid, 'mac', [ mac.toLowerCase() ]);
			}
			uci.set('dhcp', sid, 'name', name);
		}

		await chester.saveAndApplyUnchecked(uci);
	},

	openRenameModal(device) {
		const current = device.customName || '';
		const input = E('input', {
			'class': 'chester-input',
			'type': 'text',
			'value': current,
			'placeholder': _('e.g. Living-Room-TV')
		});
		const preview = E('div', { 'class': 'chester-device-row__sub' }, [ ' ' ]);

		const refresh = () => {
			const clean = sanitizeName(input.value);
			preview.textContent = (clean && clean !== input.value)
				? _('Will be saved as: %s').format(clean)
				: ' ';
		};
		input.addEventListener('input', refresh);
		refresh();

		const save = chester.createButton(_('Save & Apply'), 'chester-button',
			ui.createHandlerFn(this, async function (ev) {
				chester.setButtonBusy(ev.currentTarget, true);
				try {
					await this.saveClientName(device.mac, input.value);
					ui.hideModal();
					window.setTimeout(() => window.location.reload(), 300);
				} catch (err) {
					chester.notify(_('Could not save the name: %s').format(err.message || err), 'error');
				} finally {
					chester.setButtonBusy(ev.currentTarget, false);
				}
			}));

		const buttons = [ chester.createButton(_('Cancel'), 'chester-button-secondary', () => ui.hideModal()) ];
		if (current)
			buttons.push(chester.createButton(_('Clear Name'), 'chester-button-danger',
				ui.createHandlerFn(this, async function (ev) {
					chester.setButtonBusy(ev.currentTarget, true);
					try {
						await this.saveClientName(device.mac, '');
						ui.hideModal();
						window.setTimeout(() => window.location.reload(), 300);
					} catch (err) {
						chester.notify(_('Could not clear the name: %s').format(err.message || err), 'error');
					} finally {
						chester.setButtonBusy(ev.currentTarget, false);
					}
				})));
		buttons.push(save);

		ui.showModal(_('Name This Device'), [
			E('div', { 'class': 'chester-card' }, [
				E('div', { 'class': 'chester-form-grid' }, [
					chester.createField(_('Name'), input),
					chester.createField(_('MAC Address'),
						E('input', { 'class': 'chester-input', 'type': 'text', 'value': device.mac, 'readonly': 'readonly' }))
				]),
				preview,
				E('p', { 'class': 'chester-card__desc' }, [
					_('Letters, numbers and hyphens. The name is stored with the DHCP reservation, so it also appears in the lease list. This does not reserve an IP address.')
				]),
				E('div', { 'class': 'chester-card__footer' }, buttons)
			])
		], 'cbi-modal');
	},

	/* ----------------------------------------------------- static leases */

	async saveStaticLease(name, mac, ipaddr) {
		mac = normalizeInputMac(mac);
		if (!mac) throw new Error(_('MAC address is required'));
		if (!MAC_RE.test(mac)) throw new Error(_('Enter a valid MAC address'));
		if (!ipaddr) throw new Error(_('IPv4 address is required'));

		const staticLeases = this.buildStaticLeaseMap();
		const sid = staticLeases[chester.normalizeMac(mac)]?.section || uci.add('dhcp', 'host');
		const clean = sanitizeName(name);
		if (clean) uci.set('dhcp', sid, 'name', clean);
		else uci.unset('dhcp', sid, 'name');
		uci.set('dhcp', sid, 'ip', ipaddr);
		uci.set('dhcp', sid, 'mac', [ mac.toLowerCase() ]);
		uci.set('dhcp', sid, 'interface', 'lan');
		await chester.saveAndApplyUnchecked(uci);
	},

	openStaticLeaseModal(device) {
		const nameInput = E('input', { 'class': 'chester-input', 'type': 'text',
			'value': device.customName || (device.hostname !== '--' ? device.hostname : '') });
		const ipInput = E('input', { 'class': 'chester-input', 'type': 'text',
			'value': device.ipaddr !== '--' ? device.ipaddr : '' });
		const macInput = E('input', { 'class': 'chester-input', 'type': 'text', 'value': device.mac, 'readonly': 'readonly' });
		const interfaceInput = E('input', { 'class': 'chester-input', 'type': 'text', 'value': 'lan', 'readonly': 'readonly' });

		const saveButton = chester.createButton(_('Save & Apply'), 'chester-button',
			ui.createHandlerFn(this, async function (ev) {
				chester.setButtonBusy(ev.currentTarget, true);
				try {
					await this.saveStaticLease(nameInput.value.trim(), device.mac, ipInput.value.trim());
					ui.hideModal();
					window.setTimeout(() => window.location.reload(), 300);
				} catch (err) {
					chester.notify(_('Failed to save static IP binding: %s').format(err.message || err), 'error');
				} finally {
					chester.setButtonBusy(ev.currentTarget, false);
				}
			}));

		ui.showModal(_('Add Static IP'), [
			E('div', { 'class': 'chester-card' }, [
				E('div', { 'class': 'chester-form-grid' }, [
					chester.createField(_('Name'), nameInput),
					chester.createField(_('IPv4 Address'), ipInput),
					chester.createField(_('MAC Address'), macInput),
					chester.createField(_('Interface'), interfaceInput)
				]),
				E('div', { 'class': 'chester-card__footer' }, [
					chester.createButton(_('Cancel'), 'chester-button-secondary', () => ui.hideModal()),
					saveButton
				])
			])
		], 'cbi-modal');
	},

	async removeStaticLease(device) {
		if (!device?.staticLease?.section) return;
		const removeButton = chester.createButton(_('Remove & Apply'), 'chester-button-danger',
			ui.createHandlerFn(this, async function (ev) {
				chester.setButtonBusy(ev.currentTarget, true);
				try {
					/* Removing the reservation should not silently discard a
					 * name the user set: keep the section when it is named,
					 * and drop only the address. */
					if (device.customName) {
						uci.unset('dhcp', device.staticLease.section, 'ip');
						uci.unset('dhcp', device.staticLease.section, 'interface');
					} else {
						uci.remove('dhcp', device.staticLease.section);
					}
					await chester.saveAndApplyUnchecked(uci);
					ui.hideModal();
					window.setTimeout(() => window.location.reload(), 300);
				} catch (err) {
					chester.notify(_('Failed to remove static IP binding: %s').format(err.message || err), 'error');
				} finally {
					chester.setButtonBusy(ev.currentTarget, false);
				}
			}));

		ui.showModal(_('Remove Static IP'), [
			E('div', { 'class': 'chester-card' }, [
				E('p', { 'class': 'chester-card__desc' }, [
					device.customName
						? _('Release the reserved address for %s? The name is kept.').format(device.customName)
						: _('Remove the static IP binding for %s?').format(deviceLabel(device))
				]),
				E('div', { 'class': 'chester-card__footer' }, [
					chester.createButton(_('Cancel'), 'chester-button-secondary', () => ui.hideModal()),
					removeButton
				])
			])
		], 'cbi-modal');
	},

	/* -------------------------------------------------------- rendering */

	/* One column instead of the stock page's two, which both said the same
	 * thing. Badge for the state, detail underneath. */
	statusDetail(device) {
		const online = device.tone === 'online';
		if (online && device.connection === 'wireless')
			return `${device.signal}${chester.hasValue(device.ssid) ? ` / ${device.ssid}` : ''}`;
		if (device.dhcpLease?.time)
			return `${_('Lease')}: ${device.dhcpLease.time}`;
		return '';
	},

	renderDeviceRow(device) {
		const label = deviceLabel(device);
		const reported = (device.hostname && device.hostname !== '--') ? device.hostname : '';
		/* Show what the device calls itself only when we have overridden it. */
		const sub = (device.customName && reported && reported !== device.customName)
			? `${device.mac} · ${reported}`
			: device.mac;

		const nameNode = E('span', {
			'class': 'cl-name',
			'title': _('Click to name this device'),
			'click': ui.createHandlerFn(this, function () { this.openRenameModal(device); })
		}, [ label ]);

		const actions = [
			chester.createButton(device.customName ? _('Rename') : _('Name'),
				'chester-button-secondary', () => this.openRenameModal(device))
		];
		if (device.staticLease && device.hasStaticIp)
			actions.push(chester.createButton(_('Remove Static IP'), 'chester-button-secondary',
				() => this.removeStaticLease(device)));
		else
			actions.push(chester.createButton(_('Add Static IP'), 'chester-button-secondary',
				() => this.openStaticLeaseModal(device)));

		const online = device.tone === 'online';
		const wireless = device.connection === 'wireless';

		return E('tr', {}, [
			cell(nameNode, sub),
			cell(device.ipaddr, device.dhcpLease?.ipaddr && device.dhcpLease.ipaddr !== device.ipaddr
				? device.dhcpLease.ipaddr : ''),
			cell(wireless ? device.band : (device.connection === 'wired' ? _('Wired') : _('Static Binding')),
				wireless ? device.ssid : device.interface),
			cell(chester.createBadge(online ? _('Online') : _('Offline'), device.tone),
				this.statusDetail(device)),
			cell(device.hasStaticIp ? device.staticLease.ip : '--',
				device.hasStaticIp ? _('Reserved') : ''),
			E('td', {}, [ E('div', { 'class': 'cl-actions' }, actions) ])
		]);
	},

	renderAddStaticLeaseRow() {
		const draft = this.getNewStaticLease();
		const nameInput = E('input', { 'class': 'chester-input chester-table-input', 'type': 'text', 'placeholder': _('Name'), 'value': draft.name });
		const macInput = E('input', { 'class': 'chester-input chester-table-input', 'type': 'text', 'placeholder': _('MAC Address'), 'value': draft.mac });
		const ipInput = E('input', { 'class': 'chester-input chester-table-input', 'type': 'text', 'placeholder': _('IPv4 Address'), 'value': draft.ip, 'inputmode': 'numeric' });

		const updateDraft = () => {
			draft.name = nameInput.value;
			draft.mac = normalizeInputMac(macInput.value);
			draft.ip = ipInput.value;
		};
		[ nameInput, macInput, ipInput ].forEach((i) => i.addEventListener('input', updateDraft));

		const saveButton = chester.createButton(_('Add Static IP'), 'chester-button',
			ui.createHandlerFn(this, async function (ev) {
				updateDraft();
				chester.setButtonBusy(ev.currentTarget, true);
				try {
					await this.saveStaticLease(draft.name.trim(), draft.mac, draft.ip.trim());
					this.newStaticLease = { name: '', mac: '', ip: '' };
					window.setTimeout(() => window.location.reload(), 300);
				} catch (err) {
					chester.notify(_('Failed to save static IP binding: %s').format(err.message || err), 'error');
				} finally {
					chester.setButtonBusy(ev.currentTarget, false);
				}
			}));

		/* Same two-line cell shape as every other row, so the add-row does not
		 * sit taller or shorter than the list above it. */
		return E('tr', { 'class': 'chester-device-table__add-row' }, [
			cell(nameInput, macInput),
			cell(ipInput, ''),
			cell(_('Static Binding'), ''),
			cell('--', ''),
			cell(_('Static IP'), ''),
			E('td', {}, [ E('div', { 'class': 'cl-actions' }, [ saveButton ]) ])
		]);
	},

	renderDeviceList(devices) {
		if (!devices.length)
			return chester.createEmptyState(
				this.filterTerm ? _('No devices match "%s"').format(this.filterTerm) : _('No devices found'),
				this.filterTerm ? _('Clear the filter to see all devices.') : _('Connected devices will appear here.'));

		return E('div', { 'class': 'chester-device-table-wrap' }, [
			E('table', { 'class': 'chester-table chester-device-table' }, [
				E('colgroup', {}, COLUMNS.map((c) => E('col', { 'style': `width:${c.width}` }))),
				E('thead', {}, [ E('tr', {},
					COLUMNS.map((c) => E('th', {}, [ _(c.label) ]))) ]),
				E('tbody', {}, devices.map((d) => this.renderDeviceRow(d)).concat([ this.renderAddStaticLeaseRow() ]))
			])
		]);
	},

	renderHeroMeta(data, devices) {
		const online = devices.filter((d) => d.tone === 'online').length;
		const named = devices.filter((d) => !!d.customName).length;
		const staticCount = devices.filter((d) => d.hasStaticIp).length;
		const pill = (label, value) => E('span', { 'class': 'chester-pill' }, [
			E('span', {}, [ label ]), E('strong', {}, [ String(value) ])
		]);
		return [
			pill(_('Online Devices'), online),
			pill(_('Named'), named),
			pill(_('Static IP Devices'), staticCount)
		];
	},

	createShell() {
		this.heroMetaNode = E('div', { 'class': 'chester-hero__meta' });
		this.listNode = E('div');
		this.loadingNode = E('div', { 'class': 'chester-loading' }, [ _('Refreshing online devices...') ]);

		/* Lives OUTSIDE listNode: the list is replaced every few seconds by the
		 * poll, and an input inside it would lose its value and focus. */
		this.filterInput = E('input', {
			'class': 'chester-input',
			'type': 'search',
			'placeholder': _('Filter by name, MAC or IP'),
			'style': 'max-width:22em'
		});
		this.filterInput.addEventListener('input', () => {
			this.filterTerm = this.filterInput.value;
			if (this.latestData) this.updateShell(this.latestData, true);
		});

		ensureStyle();
		return E('div', { 'class': 'chester-page chester-clients' }, [
			E('div', { 'class': 'chester-shell' }, [
				E('section', { 'class': 'chester-hero' }, [
					E('div', { 'class': 'chester-hero__content' }, [
						E('h2', { 'class': 'chester-hero__title' }, [ _('Device Management') ]),
						E('div', { 'class': 'chester-hero__subtitle' }, [
							_('Click a device name to label it. Names are kept even when the device is offline.')
						]),
						this.heroMetaNode
					])
				]),
				chester.createCard(_('Client List'),
					_('Online devices refresh automatically. Named devices and devices with a static IP stay listed when offline.'),
					[ E('div', { 'class': 'cl-filter' }, [ this.filterInput ]), this.listNode, this.loadingNode ])
			])
		]);
	},

	/* True while the user is typing into the add-row, so the poll does not
	 * yank the field out from under them mid-entry. */
	isEditing() {
		const a = document.activeElement;
		return !!(a && this.listNode && this.listNode.contains(a)
			&& /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
	},

	updateShell(data, force) {
		this.latestData = data;
		const devices = this.buildDevices(data);
		dom.content(this.heroMetaNode, this.renderHeroMeta(data, devices));
		if (force || !this.isEditing())
			dom.content(this.listNode, [ this.renderDeviceList(devices) ]);
		this.loadingNode.style.display = 'none';
	},

	render() {
		const shell = this.createShell();
		return this.fetchData().then((data) => {
			this.updateShell(data);
			poll.add(() => this.fetchData()
				.then((next) => { this.updateShell(next); })
				.catch(() => {}), REFRESH_INTERVAL);
			return shell;
		}).catch(() => {
			this.loadingNode.style.display = 'none';
			dom.content(this.listNode, [
				chester.createEmptyState(_('Failed to load online devices'), _('Please try again later.'))
			]);
			return shell;
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
