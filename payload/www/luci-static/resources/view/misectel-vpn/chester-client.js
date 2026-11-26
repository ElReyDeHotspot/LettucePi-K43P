'use strict';
'require view';
'require uci';
'require ui';
'require dom';
'require fs';
'require chester-ui.settings as kit';
'require misectel.vpn as vpn';

function parseWireGuard(text) {
	const profile = { Interface: null, Peer: [] };
	const allowed = {
		Interface: ['PrivateKey', 'Address', 'ListenPort', 'DNS', 'MTU'],
		Peer: ['PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint', 'PersistentKeepalive']
	};
	let kind, section;
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = raw.split('#')[0].trim();
		if (!line) continue;
		const header = line.match(/^\[(Interface|Peer)\]$/);
		if (header) {
			kind = header[1];
			section = Object.create(null);
			if (kind === 'Peer') profile.Peer.push(section);
			else if (profile.Interface) throw new Error(_('Duplicate Interface section.'));
			else profile.Interface = section;
			continue;
		}
		const entry = line.match(/^(\w+)\s*=\s*(.+)$/);
		if (!section || !entry || !allowed[kind].includes(entry[1]))
			throw new Error(_('Unsupported WireGuard directive or invalid configuration line.'));
		const [, key, value] = entry;
		if (['Address', 'AllowedIPs', 'DNS'].includes(key))
			section[key] = (section[key] || []).concat(value.split(',').map(x => x.trim()).filter(Boolean));
		else if (section[key] != null) throw new Error(_('Duplicate WireGuard directive.'));
		else section[key] = value.trim();
	}
	const validKey = key => /^[A-Za-z0-9+/]{43}=$/.test(key || '');
	if (!validKey(profile.Interface?.PrivateKey) || !profile.Peer.length)
		throw new Error(_('A valid private key and at least one peer are required.'));
	for (const peer of profile.Peer) {
		if (!validKey(peer.PublicKey) || (peer.PresharedKey && !validKey(peer.PresharedKey)))
			throw new Error(_('Invalid peer key.'));
		if (peer.Endpoint) {
			const endpoint = peer.Endpoint.match(/^(?:\[([^\]]+)\]|([^:\s]+)):(\d+)$/);
			if (!endpoint || +endpoint[3] < 1 || +endpoint[3] > 65535)
				throw new Error(_('Invalid WireGuard endpoint.'));
			peer.host = endpoint[1] || endpoint[2];
			peer.port = endpoint[3];
		}
	}
	return profile;
}

return view.extend({
	load() {
		return uci.load('network');
	},

	async importWireGuard(text, label) {
		if (!text || new Blob([text]).size > 65536)
			throw new Error(_('Enter or choose a WireGuard configuration under 64 KiB.'));
		const profile = parseWireGuard(text);
		const used = new Set(uci.sections('network').map(s => s['.name']));
		let index = 1;
		while (used.has('vpw' + index.toString(16).padStart(4, '0'))) index++;
		const name = 'vpw' + index.toString(16).padStart(4, '0');
		const created = [];
		const add = (type, id, values) => {
			const section = uci.add('network', type, id);
			created.push(section);
			for (const [key, value] of Object.entries(values))
				if (value != null) uci.set('network', section, key, value);
		};
		try {
			const iface = profile.Interface;
			add('interface', name, {
				name: label, proto: 'wireguard',
				mvpn_proto: 'wireguard', mvpn: '1', disabled: '1', defaultroute: '0',
				vp: '13', private_key: iface.PrivateKey, addresses: iface.Address,
				listen_port: iface.ListenPort, dns: iface.DNS, mtu: iface.MTU
			});
			for (const peer of profile.Peer) {
				add('wireguard_' + name, null, {
					public_key: peer.PublicKey, preshared_key: peer.PresharedKey,
					allowed_ips: peer.AllowedIPs, endpoint_host: peer.host,
					endpoint_port: peer.port, persistent_keepalive: peer.PersistentKeepalive,
					route_allowed_ips: '0'
				});
			}
			await uci.save();
		} catch (err) {
			created.forEach(section => uci.remove('network', section));
			throw err;
		}
	},

	async addOpenVPN(label, host, port, transport, ca) {
		if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host) ||
			!/^\d+$/.test(port) || +port < 1 || +port > 65535 ||
			!['udp', 'tcp-client'].includes(transport) ||
			!/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/.test(ca))
			throw new Error(_('Enter a valid server, port and PEM CA certificate.'));
		const used = new Set(uci.sections('network').map(s => s['.name']));
		let index = 1;
		while (used.has('vpo' + index.toString(16).padStart(4, '0'))) index++;
		const name = 'vpo' + index.toString(16).padStart(4, '0');
		const path = '/etc/misectel-vpn/' + name + '-' + Date.now() + '.ovpn';
		await fs.write(path, [
			'client', 'dev tun', 'remote ' + host + ' ' + port, 'proto ' + transport,
			'remote-cert-tls server', '<ca>', ca, '</ca>', ''
		].join('\n'), 0o600);
		uci.add('network', 'interface', name);
		try {
			for (const [key, value] of Object.entries({
				name: label, proto: 'openvpn', mvpn_proto: 'openvpn', mvpn: '1',
				disabled: '1', defaultroute: '0', vp: '9', config: path
			}))
				uci.set('network', name, key, value);
			await uci.save();
		} catch (err) {
			uci.remove('network', name);
			await fs.remove(path);
			throw err;
		}
	},

	async render() {
		const selected = new URLSearchParams(location.search).get('protocol');
		const protocol = selected === 'openvpn' ? 'openvpn' : 'wireguard';
		const chooser = ['wireguard', 'openvpn'].map(id =>
			kit.button(id === 'wireguard' ? 'WireGuard' : 'OpenVPN',
				() => { location.search = '?protocol=' + id; },
				{ class: id === protocol ? 'st-button' : 'st-button secondary',
					'aria-pressed': String(id === protocol) }));
		const controls = [E('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, chooser)];
		const field = (label, input) => kit.field(label, input);
		const action = (label, fn) => kit.button(label,
			ui.createHandlerFn(this, async () => {
				try {
					await fn();
					location.href = '?protocol=' + protocol + '&imported=1';
				} catch (err) {
					ui.addNotification(null, E('p', {}, err.message), 'error');
				}
			}));
		if (protocol === 'wireguard') {
			const input = E('input', { type: 'file', accept: '.conf', 'aria-label': _('WireGuard configuration file') });
			const button = kit.button(_('Import WireGuard'),
				ui.createHandlerFn(this, async () => {
					try {
						const file = input.files[0];
						if (!file || !/\.conf$/i.test(file.name) || file.size > 65536)
							throw new Error(_('Choose a WireGuard .conf file under 64 KiB.'));
						await this.importWireGuard(await file.text(), file.name.replace(/\.conf$/i, ''));
						location.href = '?protocol=wireguard&imported=1';
					} catch (err) {
						ui.addNotification(null, E('p', {}, err.message), 'error');
					}
				}));
			controls.push(field(_('Configuration File'), input));
			controls.push(kit.footer(button));
			controls.push(E('p', {}, _('Use Add VPN and Add Peer below to enter WireGuard settings manually.')));
		} else {
			controls.push(E('p', {}, _('Select Add VPN, open the profile, then upload its .ovpn configuration.')));
			const name = E('input', { type: 'text' });
			const host = E('input', { type: 'text' });
			const port = E('input', { type: 'number', value: '1194', min: '1', max: '65535' });
			const transport = E('select', {}, [E('option', { value: 'udp' }, 'UDP'), E('option', { value: 'tcp-client' }, 'TCP')]);
			const ca = E('textarea', { rows: '5' });
			controls.push(E('details', {}, [
				E('summary', {}, _('Enter OpenVPN Settings Manually')),
				E('div', { class: 'st-fields' }, [
					field(_('Profile Name'), name), field(_('Server Hostname or IPv4'), host),
					field(_('Port'), port), field(_('Transport'), transport), field(_('CA Certificate (PEM)'), ca)
				]),
				action(_('Create OpenVPN Profile'), () =>
					this.addOpenVPN(name.value.trim() || _('OpenVPN client'), host.value.trim(), port.value, transport.value, ca.value.trim()))
			]));
		}
		if (new URLSearchParams(location.search).has('imported'))
			controls.push(E('p', {}, _('Profile staged and disabled. Review its settings, then enable it and use Save & Apply.')));
		const profiles = await vpn.render(protocol);
		profiles.querySelectorAll('.cbi-map > h2, .cbi-map > .cbi-map-descr').forEach(el => el.remove());
		profiles.querySelectorAll('.cbi-section-create button').forEach(el => {
			el.classList.remove('cbi-button', 'cbi-button-add');
			el.classList.add('st-button', 'secondary');
		});
		return kit.sheet([
			E('link', {rel: 'stylesheet', href: L.resource('chester-ui/vpn-client.css') + '?v=20261125-1'}),
			kit.head(_('VPN'), _('Set up a WireGuard or OpenVPN client.'), 'shield'),
			kit.card(_('Client Setup'), null, controls, 'shield'),
			kit.card(_('VPN Profiles'), null, [profiles], 'network')
		], 'st-vpn-client');
	}
});
