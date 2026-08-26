'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'chester_ipv6', method: 'status', expect: {} });
var callSet = rpc.declare({ object: 'chester_ipv6', method: 'set', params: [ 'enabled' ], expect: {} });
var callTest = rpc.declare({ object: 'chester_ipv6', method: 'test', expect: {} });

function text(value) { return value || 'Not available'; }
function row(label, value, options) {
	options = options || {};
	return E('div', { 'class': 'v6-row' + (options.address ? ' v6-row--address' : '') }, [
		E('span', { 'class': 'v6-row__label' }, [ label ]),
		E('span', { 'class': 'v6-row__value' + (options.good ? ' is-good' : '') + (options.bad ? ' is-bad' : '') }, [ value ])
	]);
}
function group(title, subtitle, rows) {
	return E('section', { 'class': 'v6-group' }, [
		E('div', { 'class': 'v6-group__heading' }, [ E('h3', {}, [ title ]), E('p', {}, [ subtitle ]) ]),
		E('div', { 'class': 'v6-group__list' }, rows)
	]);
}

return view.extend({
	load: function() { return callStatus(); },
	render: function(data) {
		var enabled = data.enabled === true;
		var toggle = E('input', { 'type': 'checkbox', 'checked': enabled ? 'checked' : null });
		var state = E('span', { 'class': 'v6-state ' + (enabled ? 'is-on' : 'is-off') }, [ enabled ? 'On' : 'Off' ]);
		var testButton = E('button', { 'class': 'v6-button' }, [ 'Run Connection Test' ]);
		var testResult = E('span', { 'class': 'v6-test-result' }, [ 'Ready' ]);

		toggle.addEventListener('change', ui.createHandlerFn(this, async function() {
			var desired = toggle.checked;
			toggle.disabled = true;
			state.className = 'v6-state is-working';
			state.textContent = desired ? 'Turning On…' : 'Turning Off…';
			try {
				await callSet(desired);
				state.className = 'v6-state ' + (desired ? 'is-on' : 'is-off');
				state.textContent = desired ? 'On' : 'Off';
				ui.addNotification(null, E('p', {}, [ desired ? 'IPv6 is on.' : 'IPv6 is off.' ]), 'info');
				window.setTimeout(function() { window.location.reload(); }, 450);
			} catch (error) {
				toggle.checked = !desired;
				toggle.disabled = false;
				state.className = 'v6-state is-bad';
				state.textContent = 'Unable to Apply';
				ui.addNotification(null, E('p', {}, [ 'Unable to change IPv6: ' + error ]), 'error');
			}
		}));

		testButton.addEventListener('click', ui.createHandlerFn(this, async function() {
			testButton.disabled = true;
			testResult.className = 'v6-test-result is-working';
			testResult.textContent = 'Testing…';
			try {
				var response = await callTest();
				testResult.className = 'v6-test-result ' + (response.ok ? 'is-good' : 'is-bad');
				testResult.textContent = response.ok ? 'Connected' + (response.latency_ms ? ' · ' + response.latency_ms + ' ms' : '') : 'No IPv6 Connection';
			} catch (error) {
				testResult.className = 'v6-test-result is-bad';
				testResult.textContent = 'Test Failed';
			} finally { testButton.disabled = false; }
		}));

		return E('div', { 'class': 'v6-page' }, [ E('main', { 'class': 'v6-window' }, [
			E('header', { 'class': 'v6-header' }, [
				E('div', { 'class': 'v6-icon', 'aria-hidden': 'true' }, [ '6' ]),
				E('div', { 'class': 'v6-header__copy' }, [ E('h2', {}, [ 'IPv6' ]), E('p', {}, [ 'Cellular IPv6 for devices connected to this router' ]) ]),
				E('span', { 'class': 'v6-header__status ' + (data.upstream_up ? 'is-connected' : 'is-disconnected') }, [ data.upstream_up ? 'Connected' : 'Disconnected' ])
			]),
			E('section', { 'class': 'v6-master' }, [
				E('div', { 'class': 'v6-master__copy' }, [ E('strong', {}, [ 'IPv6' ]), E('span', {}, [ enabled ? 'Available to connected devices' : 'Not available to connected devices' ]) ]),
				E('div', { 'class': 'v6-master__control' }, [ state, E('label', { 'class': 'v6-switch' }, [ toggle, E('span', { 'class': 'v6-switch__track' }) ]) ])
			]),
			E('div', { 'class': 'v6-groups' }, [
				group('Cellular', 'Address supplied by the mobile network', [
					row('Connection', data.upstream_up ? 'Connected' : 'Disconnected', { good: data.upstream_up, bad: !data.upstream_up }),
					row('IPv6 Address', text(data.upstream_address), { address: true }),
					row('Carrier Prefix', text(data.upstream_prefix), { address: true })
				]),
				group('Local Network', 'IPv6 distributed to connected devices', [
					row('Router Address', text(data.lan_address), { address: true }),
					row('Router Advertisements', data.ra === 'server' ? 'On' : 'Off', { good: data.ra === 'server', bad: data.ra !== 'server' }),
					/* DHCPv6 being off is the shipped default, not a fault -- addresses
					 * come from SLAAC via the router advertisement, and nothing ever
					 * listens on udp/547. Painting it red made a perfectly healthy
					 * router look broken, so the mechanism actually in use is named
					 * and the DHCPv6 row is left neutral. */
					row('Addresses From', text(data.address_method), { good: !!data.address_method && data.address_method !== 'None', bad: data.address_method === 'None' }),
					row('DHCPv6', data.dhcpv6 === 'server' ? 'On' : 'Off')
				])
			]),
			E('footer', { 'class': 'v6-footer' }, [
				E('div', {}, [ E('strong', {}, [ 'Connection Test' ]), E('span', {}, [ 'Checks the cellular IPv6 path' ]) ]),
				E('div', { 'class': 'v6-footer__actions' }, [ testResult, testButton ])
			])
		]) ]);
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
