'use strict';
'require view';
'require rpc';
'require poll';
'require dom';

const callStatus = rpc.declare({ object: 'modem_transport', method: 'status', expect: {} });
const callSetProfile = rpc.declare({ object: 'modem_transport', method: 'set_profile', params: [ 'profile' ], expect: {} });

function row(label, value) {
	return E('tr', {}, [ E('th', { style: 'text-align:left;width:35%;padding:.65rem' }, [ label ]), E('td', { style: 'padding:.65rem' }, [ value || '--' ]) ]);
}

return view.extend({
	load: function() { return callStatus(); },
	renderStatus: function(data) {
		return E('div', { class: 'cbi-section' }, [
			E('h3', {}, [ _('Detected Modem Transport') ]),
			E('table', { class: 'table' }, [
				row(_('Active transport'), data.transport),
				row(_('Negotiated speed'), data.speed),
				row(_('Bus address'), data.bus),
				row(_('Modem ID'), data.modem_id),
				row(_('Kernel driver'), data.driver),
				row(_('Network interface'), data.interface),
				row(_('PCIe status'), data.pcie_status),
				row(_('Active boot profile'), data.active_profile),
				row(_('Saved selection'), data.selected_profile)
			])
		]);
	},
	render: function(data) {
		let select = E('select', { class: 'cbi-input-select' }, [
			E('option', { value: 'auto', selected: data.selected_profile == 'auto' ? '' : null }, [ _('Auto — QMODEM detection') ]),
			E('option', { value: 'pcie', selected: data.selected_profile == 'pcie' ? '' : null }, [ _('K32P — PCIe (AT data_interface 1,1)') ]),
			E('option', { value: 'usb3', selected: data.selected_profile == 'usb3' ? '' : null }, [ _('K43 — USB3 (AT data_interface 0,0)') ])
		]);
		let result = E('span', { style: 'margin-left:1rem' }, []);
		let apply = E('button', { class: 'btn cbi-button cbi-button-apply', click: () => {
			apply.disabled = true;
			result.textContent = _('Staging selected kernel profile…');
			callSetProfile(select.value).then((reply) => {
				result.textContent = reply.success ? _('Profile staged. Router is rebooting…') : (reply.message || _('Failed'));
				if (!reply.success) apply.disabled = false;
			}).catch((err) => { result.textContent = String(err); apply.disabled = false; });
		} }, [ _('Apply Profile & Reboot') ]);
		let selector = E('div', { class: 'cbi-section' }, [ E('h3', {}, [ _('Boot Transport Profile') ]), E('p', {}, [ _('PCIe and USB3 share one physical lane on MT7981. Changing profile safely stages the matching kernel and reboots.') ]), select, ' ', apply, result ]);
		let node = E('div', {}, [ E('h2', {}, [ _('Modem Transport') ]), E('p', {}, [ _('Live detection of PCIe/MHI, USB 3 SuperSpeed, or USB 2 fallback.') ]), selector, this.renderStatus(data) ]);
		poll.add(() => callStatus().then((next) => dom.content(node.lastElementChild, this.renderStatus(next).childNodes)), 5);
		return node;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
