'use strict';
'require view';
'require uci';
'require ui';
'require dom';
'require fs';
'require chester-ui.settings as kit';
'require rpc';
'require poll';
'require validation';

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

const dumpInterfaces = rpc.declare({object:'network.interface',method:'dump',expect:{interface:[]}});
const generateKeys = rpc.declare({object:'luci.misectel.vpn',method:'generateKeyPair',expect:{keys:{}}});
const syncFirewall = rpc.declare({object:'luci.misectel.vpn',method:'syncFirewall',expect:{output:''}});
const list = v => Array.isArray(v) ? v.slice() : String(v || '').split(/[\s,]+/).filter(Boolean);
const keyOK = v => /^[A-Za-z0-9+/]{43}=$/.test(v || '');
const title = proto => proto === 'wireguard' ? 'WireGuard' : 'OpenVPN';
const copy = v => JSON.parse(JSON.stringify(v));
function validIP(value, nomask) {
	const parts = String(value).split('/');
	if (parts.length > 2 || nomask && parts.length !== 1) return false;
	const v4 = validation.parseIPv4(parts[0]), v6 = !v4 && validation.parseIPv6(parts[0]);
	return !!(v4 || v6) && (parts.length === 1 || /^\d+$/.test(parts[1]) && +parts[1] <= (v4 ? 32 : 128));
}
function validHost(value) { return validIP(value,true) || value.length <= 253 && value.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s)); }

// Imported profiles cannot execute hooks or reference arbitrary files on the router.
function validateOpenVPN(text) {
	if (!text || new Blob([text]).size > 262144 || text.includes('\0')) throw new Error(_('Choose an OpenVPN configuration under 256 KiB.'));
	const inline = new Set(['ca','cert','key','tls-auth','tls-crypt','tls-crypt-v2','auth-user-pass','peer-fingerprint']);
	const options = new Set(('client tls-client dev dev-type proto remote remote-random remote-random-hostname resolv-retry nobind persist-key persist-tun remote-cert-tls verify-x509-name auth cipher data-ciphers data-ciphers-fallback auth-nocache auth-user-pass ca cert key tls-auth tls-crypt tls-crypt-v2 key-direction tls-version-min tls-version-max tls-cipher tls-ciphersuites reneg-sec mute-replay-warnings verb mute ping ping-restart keepalive connect-retry connect-retry-max connect-timeout server-poll-timeout explicit-exit-notify tun-mtu link-mtu mssfix fragment sndbuf rcvbuf fast-io float route route-ipv6 route-metric route-delay route-nopull redirect-gateway redirect-private pull pull-filter dhcp-option setenv peer-fingerprint allow-compression compress comp-lzo').split(' '));
	let block = '', remote = false, client = false;
	for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = raw.trim(); if (!line || /^[#;]/.test(line)) continue;
		if (block) { if (line === '</'+block+'>') block = ''; continue; }
		const tag = line.match(/^<([a-z-]+)>$/);
		if (tag) { if (!inline.has(tag[1])) throw new Error(_('Unsupported inline configuration section.')); block = tag[1]; continue; }
		const [key,...args] = line.split(/\s+/), value = args.join(' ').split(/\s[#;]/)[0].trim();
		if (!options.has(key)) throw new Error(_('Unsupported OpenVPN option: ')+key);
		if (inline.has(key) && value && value !== '[inline]') throw new Error(_('Use inline certificates and keys, not file paths.'));
		if (key === 'dev' && !/^tun\d*$/.test(value)) throw new Error(_('Only routed TUN profiles are supported.'));
		if (key === 'setenv' && !/^opt\s+block-outside-dns$/.test(value)) throw new Error(_('Unsupported OpenVPN environment option.'));
		if (key === 'remote') remote = true;
		if (key === 'client' || key === 'tls-client') client = true;
	}
	if (block || !remote || !client) throw new Error(_('A complete OpenVPN client configuration with a remote server is required.'));
	return text.replace(/^\uFEFF/, '').trim()+'\n';
}

function fromWireGuard(text, name) {
	if (!text || new Blob([text]).size > 65536) throw new Error(_('Choose a WireGuard configuration under 64 KiB.'));
	const p = parseWireGuard(text), i = p.Interface;
	return {name,proto:'wireguard',disabled:'1',defaultroute:'0',metric:'0',vp:'13',private_key:i.PrivateKey,addresses:i.Address||[],dns:i.DNS||[],listen_port:i.ListenPort||'',mtu:i.MTU||'',peers:p.Peer.map(peer => ({public_key:peer.PublicKey,preshared_key:peer.PresharedKey||'',allowed_ips:peer.AllowedIPs||[],endpoint_host:peer.host||'',endpoint_port:peer.port||'',persistent_keepalive:peer.PersistentKeepalive||'',route_allowed_ips:'0'}))};
}

function validateProfile(p) {
	if (!p.name?.trim() || p.name.length > 64) throw new Error(_('Enter a profile name under 65 characters.'));
	if (!['wireguard','openvpn'].includes(p.proto)) throw new Error(_('Choose WireGuard or OpenVPN.'));
	const number = (v,min,max) => v === '' || v == null || /^\d+$/.test(v) && +v >= min && +v <= max;
	if (!number(p.metric,0,65535) || !number(p.vp,0,255)) throw new Error(_('Enter a valid metric and firewall policy.'));
	if (p.proto === 'wireguard') {
		if (!keyOK(p.private_key)) throw new Error(_('Enter a valid WireGuard private key.'));
		if (!list(p.addresses).length || !list(p.addresses).every(v => validIP(v))) throw new Error(_('Enter valid tunnel IP addresses with prefix lengths.'));
		if (!number(p.listen_port,1,65535) || !number(p.mtu,576,9000)) throw new Error(_('Enter a valid listen port and MTU.'));
		if (!list(p.dns).every(v => validIP(v,true))) throw new Error(_('Enter valid DNS IP addresses.'));
		if (!p.peers?.length) throw new Error(_('Add at least one WireGuard peer.'));
		for (const peer of p.peers) {
			if (!keyOK(peer.public_key) || peer.preshared_key && !keyOK(peer.preshared_key)) throw new Error(_('Enter valid peer keys.'));
			if (!list(peer.allowed_ips).length || !list(peer.allowed_ips).every(v => validIP(v))) throw new Error(_('Enter valid Allowed IPs for each peer.'));
			if (peer.endpoint_host && !validHost(peer.endpoint_host)) throw new Error(_('Enter a valid endpoint hostname or IP address.'));
			if (!number(peer.endpoint_port,1,65535) || peer.endpoint_host && !peer.endpoint_port || !number(peer.persistent_keepalive,0,65535)) throw new Error(_('Enter a valid endpoint port and keepalive.'));
		}
	} else if (p.configText != null) p.configText = validateOpenVPN(p.configText);
	else if (!/^\/etc\/misectel-vpn\/[^/]+\.ovpn$/i.test(p.config || '')) throw new Error(_('Import an OpenVPN configuration.'));
	return p;
}

return view.extend({
	handleSave:null, handleSaveApply:null, handleReset:null,
	async load() {
		const [,runtime] = await Promise.all([uci.load('network'),dumpInterfaces()]);
		this.runtime = runtime; this.protocol = 'wireguard'; this.dirty = false; this.removed = [];
		this.profiles = uci.sections('network','interface').filter(s => ['wireguard','openvpn'].includes(s.mvpn_proto || s.proto)).map(s => Object.assign(copy(s), {id:s['.name'],proto:s.mvpn_proto || s.proto,peers:uci.sections('network','wireguard_'+s['.name']).map(copy)}));
		this.original = copy(this.profiles);
	},
	button(text, fn, cls) { return kit.button(text,ui.createHandlerFn(this,async () => { try { await fn(); } catch(e) { this.message(e.message || String(e)); } }),{class:'st-button '+(cls || '')}); },
	message(text) { this.feedback.textContent = text; this.feedback.hidden = !text; },
	changed() { this.dirty = true; this.message(''); this.refresh(); },
	newProfile() { return {name:'',proto:this.protocol,disabled:'1',defaultroute:'0',metric:'0',vp:this.protocol === 'wireguard' ? '13' : '9',addresses:[],dns:[],peers:[]}; },
	modal(name,body,submit,label) {
		const error = E('div',{class:'v-client-error',role:'alert',hidden:true});
		const save = this.button(label || _('Save Profile'),async () => { try { await submit(); ui.hideModal(); } catch(e) { error.hidden = false; error.textContent = e.message || String(e); } });
		ui.showModal(name,[E('div',{class:'chester-settings st-vpn-client v-modal'},[body,error,E('div',{class:'v-modal-actions'},[kit.button(_('Cancel'),ui.hideModal,{class:'st-button secondary'}),save])])]);
	},
	importDialog() {
		const proto = this.protocol;
		const file = E('input',{type:'file',accept:proto === 'wireguard' ? '.conf' : '.ovpn',class:'v-file',id:'vpn-import-file'});
		const name = E('input',{type:'text',maxlength:64}), chosen = E('span',{},_('Choose Configuration File'));
		file.addEventListener('change',() => { const f = file.files[0]; chosen.textContent = f?.name || _('Choose Configuration File'); if (f && !name.value) name.value = f.name.replace(/\.(conf|ovpn)$/i,''); });
		this.modal(_('Import ')+title(proto),E('div',{},[kit.field(_('Profile Name'),name),E('label',{class:'v-upload',for:'vpn-import-file'},[this.icon('upload'),chosen,file]),E('p',{class:'st-muted'},_('The profile starts disabled. Enable it when you are ready, then Save & Apply.'))]),async () => {
			const f = file.files[0];
			if (!f || f.size > (proto === 'wireguard' ? 65536 : 262144) || !(proto === 'wireguard' ? /\.conf$/i : /\.ovpn$/i).test(f.name)) throw new Error(_('Choose a supported configuration file.'));
			const text = await f.text();
			const p = proto === 'wireguard' ? fromWireGuard(text,name.value.trim()) : Object.assign(this.newProfile(),{proto,name:name.value.trim(),vp:'9',configText:validateOpenVPN(text)});
			validateProfile(p); this.profiles.push(p); this.changed();
		},_('Import Profile'));
	},
	async editProfile(profile) {
		const p = copy(profile || this.newProfile()), fields = {};
		const field = (key,label,type,placeholder) => {
			const input = E(type === 'textarea' ? 'textarea' : 'input',type === 'textarea' ? {rows:9,spellcheck:'false'} : {type:type || 'text',autocomplete:'off',placeholder:placeholder || ''});
			input.value = Array.isArray(p[key]) ? p[key].join(', ') : p[key] || ''; fields[key] = input; return kit.field(label,input);
		};
		const content = [field('name',_('Profile Name'))], peers = p.peers || [];
		const advanced = [field('metric',_('Route Metric'),'number')];
		const defaultRoute = E('input',{type:'checkbox',checked:p.defaultroute === '1' ? 'checked' : null});
		advanced.push(kit.toggle(_('Use as Default Route'),defaultRoute,_('Send Internet traffic through this VPN when connected.')));
		const bits = [['LAN to VPN',1],['WAN to VPN',2],['VPN to LAN',4],['VPN to WAN',8],['LAN Egress NAT',16],['WAN Egress NAT',32],['VPN to LAN NAT',64],['VPN to WAN NAT',128]].map(([label,bit]) => ({bit,node:E('input',{type:'checkbox',checked:(+(p.vp || 0) & bit) ? 'checked' : null}),label}));
		advanced.push(E('div',{class:'v-policy'},bits.map(b => kit.toggle(_(b.label),b.node))));
		if (p.proto === 'wireguard') {
			content.push(E('div',{class:'st-fields'},[field('private_key',_('Private Key'),'password'),field('addresses',_('Tunnel IP Addresses'),'text','10.8.0.2/24, fd00::2/64')]));
			const publicKey = E('input',{type:'text',readonly:true,placeholder:_('Generate a key pair to view the public key')});
			content.push(this.button(_('Generate Key Pair'),async () => { const keys = await generateKeys(); if (!keyOK(keys.priv)) throw new Error(_('Key generation failed.')); fields.private_key.value = keys.priv; publicKey.value = keys.pub; },'secondary'),kit.field(_('Generated Public Key'),publicKey));
			advanced.unshift(E('div',{class:'st-fields'},[field('dns',_('DNS Servers')),field('listen_port',_('Listen Port'),'number'),field('mtu',_('MTU'),'number')]));
			const box = E('div',{class:'v-peer-list'});
			const renderPeers = () => dom.content(box,peers.map((peer,index) => {
				const grid = E('div',{class:'st-fields'});
				for (const [key,label,type] of [['description','Peer Name','text'],['public_key','Public Key','text'],['preshared_key','Preshared Key','password'],['allowed_ips','Allowed IPs','text'],['endpoint_host','Endpoint Host','text'],['endpoint_port','Endpoint Port','number'],['persistent_keepalive','Persistent Keepalive','number']]) {
					const input = E('input',{type,autocomplete:'off'}); input.value = Array.isArray(peer[key]) ? peer[key].join(', ') : peer[key] || '';
					input.addEventListener('input',() => { peer[key] = key === 'allowed_ips' ? list(input.value) : input.value.trim(); }); grid.appendChild(kit.field(_(label),input));
				}
				const route = E('input',{type:'checkbox',checked:peer.route_allowed_ips === '1' ? 'checked' : null}); route.addEventListener('change',() => { peer.route_allowed_ips = route.checked ? '1' : '0'; });
				return E('div',{class:'v-peer'},[E('div',{class:'v-peer-head'},[E('strong',{},_('Peer ')+(index+1)),this.button(_('Remove Peer'),() => { peers.splice(index,1); renderPeers(); },'secondary')]),grid,kit.toggle(_('Route Allowed IPs'),route)]);
			}));
			renderPeers(); content.push(E('h4',{},_('WireGuard Peers')),box,this.button(_('Add Peer'),() => { peers.push({allowed_ips:[],route_allowed_ips:'0'}); renderPeers(); },'secondary'));
		} else {
			if (p.configText == null && p.config) p.configText = await fs.read(p.config);
			content.push(field('configText',_('OpenVPN Configuration'),'textarea'),E('div',{class:'st-fields'},[field('username',_('Username')),field('password',_('Password'),'password')]));
		}
		content.push(E('details',{class:'st-advanced'},[E('summary',{},_('Routing & Firewall')),...advanced]));
		if (profile) content.push(this.button(_('Delete Profile'),() => { this.modal(_('Delete Profile?'),E('p',{},_('Remove ')+p.name+_(' from this router? This takes effect after Save & Apply.')),() => { this.profiles.splice(this.profiles.indexOf(profile),1); if (profile.id) this.removed.push(profile.id); this.changed(); },_('Delete Profile')); },'secondary v-delete'));
		this.modal(profile ? _('Edit ')+title(p.proto) : _('Add ')+title(p.proto),E('div',{},content),() => {
			for (const [key,input] of Object.entries(fields)) p[key] = ['addresses','dns'].includes(key) ? list(input.value) : key === 'password' ? input.value : input.value.trim();
			p.defaultroute = defaultRoute.checked ? '1' : '0'; p.vp = String(bits.reduce((n,b) => n | (b.node.checked ? b.bit : 0),0)); p.peers = peers; validateProfile(p);
			if (profile) this.profiles[this.profiles.indexOf(profile)] = p; else this.profiles.push(p); this.changed();
		});
	},
	icon(name) {
		if (!['upload','sliders','edit'].includes(name)) return kit.icon(name);
		const paths = {upload:'M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7',sliders:'M3 6h5m4 0h9M3 12h11m4 0h3M3 18h2m4 0h12M8 3v6m6 0v6M5 15v6',edit:'m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z'};
		const el = E('span',{class:'st-icon','aria-hidden':true}); el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[name]+'"/></svg>'; return el;
	},
	profileState(p) {
		if (!p.id || this.original.find(o => o.id === p.id)?.disabled !== p.disabled) return _('Pending Apply');
		if (p.disabled === '1') return _('Disabled');
		const runtime = this.runtime.find(i => i.interface === p.id);
		if (runtime?.up) return p.proto === 'wireguard' ? _('Interface Up') : _('Connected');
		return runtime?.pending ? _('Connecting') : _('Not Connected');
	},
	refresh() {
		const active = this.original.filter(p => p.disabled !== '1' && this.runtime.some(i => i.interface === p.id && i.up));
		this.status.textContent = active.length ? (active.some(p => p.proto === 'openvpn') ? _('Connected') : _('Interface Up')) : _('Not Connected');
		this.status.classList.toggle('is-connected',!!active.length);
		this.activeProtocol.textContent = [...new Set(active.map(p => title(p.proto)))].join(', ') || '—'; this.activeProfile.textContent = active.map(p => p.name || p.id).join(', ') || '—';
		const signature = JSON.stringify([this.profiles,this.profiles.map(p => this.profileState(p))]);
		if (signature !== this.profileSignature) { this.profileSignature = signature; dom.content(this.profileList,this.profiles.length ? this.profiles.map(p => {
			const toggle = E('input',{type:'checkbox',class:'st-switch',role:'switch',checked:p.disabled !== '1' ? 'checked' : null,'aria-label':_('Enable ')+(p.name || p.id)});
			toggle.addEventListener('change',() => { p.disabled = toggle.checked ? '0' : '1'; this.changed(); });
			const edit = this.button(_('Edit'),() => this.editProfile(p),'secondary v-edit'); edit.prepend(this.icon('edit'));
			return E('div',{class:'v-profile'},[E('span',{class:'v-avatar'},this.icon('shield')),E('div',{class:'v-profile-name'},[E('strong',{},p.name || p.id),E('span',{class:'st-muted'},title(p.proto)+' · '+this.profileState(p))]),E('div',{class:'v-profile-actions'},[edit,toggle])]);
		}) : [E('div',{class:'v-empty'},[this.icon('shield'),E('strong',{},_('No VPN Profiles')),E('span',{class:'st-muted'},_('Import a configuration or use Manual Setup to get started.'))])]); }
		this.saveButton.disabled = !this.dirty || this.saving; this.saveButton.textContent = this.saving ? _('Applying…') : _('Save & Apply');
	},
	async apply() {
		if (!this.dirty || this.saving) return;
		this.saving = true; this.refresh(); const written = []; let saveStarted = false;
		try {
			const changed = this.profiles.filter(p => JSON.stringify(p) !== JSON.stringify(this.original.find(o => o.id === p.id))); changed.forEach(validateProfile);
			for (const p of changed) {
				if (!p.id) { const prefix = p.proto === 'wireguard' ? 'vpw' : 'vpo'; let i = 1; while (uci.get('network',prefix+i.toString(16).padStart(4,'0'))) i++; p.id = prefix+i.toString(16).padStart(4,'0'); uci.add('network','interface',p.id); }
				if (p.proto === 'openvpn' && p.configText != null) {
					const original = this.original.find(o => o.id === p.id);
					if (!original || await fs.read(original.config).catch(() => '') !== p.configText) { const path = '/etc/misectel-vpn/'+p.id+'-'+Date.now()+'.ovpn'; await fs.write(path,p.configText,0o600); written.push(path); p.config = path; }
				}
				const keys = ['name','disabled','metric','defaultroute','vp'].concat(p.proto === 'wireguard' ? ['private_key','addresses','listen_port','dns','mtu'] : ['config','username','password']);
				for (const key of keys) { const value = p[key]; if (value == null || value === '' || Array.isArray(value) && !value.length) uci.unset('network',p.id,key); else uci.set('network',p.id,key,value); }
				uci.set('network',p.id,'proto',p.proto); uci.set('network',p.id,'mvpn_proto',p.proto); uci.set('network',p.id,'mvpn','1');
				if (p.proto === 'wireguard') { uci.sections('network','wireguard_'+p.id).forEach(peer => uci.remove('network',peer['.name'])); for (const peer of p.peers) { const id = uci.add('network','wireguard_'+p.id); for (const [key,value] of Object.entries(peer)) if (!key.startsWith('.') && value != null && value !== '') uci.set('network',id,key,value); } }
			}
			for (const id of this.removed) { uci.sections('network','wireguard_'+id).forEach(peer => uci.remove('network',peer['.name'])); uci.remove('network',id); }
			saveStarted = true; await uci.save(); await ui.changes.init();
			document.addEventListener('uci-applied',() => { syncFirewall().catch(e => this.message(_('Firewall sync failed: ')+e.message)); },{once:true}); ui.changes.apply(true);
		} catch(e) {
			if (!saveStarted) for (const path of written) await fs.remove(path).catch(() => {});
			uci.unload('network'); await uci.load('network'); for (const p of this.profiles) if (!this.original.some(o => o.id === p.id)) delete p.id;
			this.message(e.message || String(e));
		} finally { this.saving = false; this.refresh(); }
	},
	render() {
		this.status = E('span',{class:'v-status'}); this.activeProtocol = E('strong'); this.activeProfile = E('strong');
		const stat = (label,node) => E('div',{class:'v-summary-stat'},[E('span',{},label),node]);
		const summary = E('section',{class:'st-card v-summary'},[E('div',{class:'v-summary-title'},[this.icon('shield'),E('strong',{},_('VPN Connection')),this.status]),E('div',{class:'v-summary-stats'},[stat(_('Protocol'),this.activeProtocol),stat(_('Active Profile'),this.activeProfile)])]);
		const tabs = ['wireguard','openvpn'].map(proto => kit.button(title(proto),() => { this.protocol = proto; tabs.forEach((tab,i) => tab.setAttribute('aria-pressed',String(['wireguard','openvpn'][i] === proto))); },{class:'st-button secondary','aria-pressed':String(proto === this.protocol)}));
		const tile = (name,subtitle,icon,action) => { const button = this.button('',action,'secondary v-setup-tile'); dom.content(button,[this.icon(icon),E('span',{},[E('strong',{},name),E('small',{},subtitle)])]); return button; };
		const setup = kit.card(_('Client Setup'),null,[E('div',{class:'v-protocol',role:'group','aria-label':_('VPN Protocol')},tabs),E('div',{class:'v-setup-grid'},[tile(_('Import Configuration'),'.conf / .ovpn','upload',() => this.importDialog()),tile(_('Manual Setup'),_('Enter Connection Details'),'sliders',() => this.editProfile())])],'network');
		this.profileList = E('div',{class:'v-profiles'}); const profiles = kit.card(_('VPN Profiles'),null,[this.profileList],'network');
		const add = this.button(_('Add Profile'),() => this.editProfile(),'secondary v-add'); add.prepend(this.icon('plus')); profiles.firstChild.appendChild(add);
		this.feedback = E('div',{class:'v-client-error',role:'status','aria-live':'polite',hidden:true}); this.saveButton = this.button(_('Save & Apply'),() => this.apply());
		const root = kit.sheet([E('link',{rel:'stylesheet',href:L.resource('chester-ui/vpn-client.css')+'?v=20261125-5'}),kit.head(_('VPN'),_('Secure Your Connection'),'shield'),summary,setup,profiles,this.feedback,E('div',{class:'v-save-dock'},[this.saveButton])],'st-vpn-client');
		this.refresh(); poll.add(async () => { if (!document.hidden && !this.saving && root.isConnected) { try { this.runtime = await dumpInterfaces(); this.refresh(); } catch(e) { this.message(_('Live status is unavailable. Your saved profiles are unchanged.')); } } },5); return root;
	}
});
