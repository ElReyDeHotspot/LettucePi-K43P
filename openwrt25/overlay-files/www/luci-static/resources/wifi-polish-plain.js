(function () {
	'use strict';
	if (document.body.dataset.page !== 'admin-network-wifi') return;

	function findCard(label) {
		var cards = document.querySelectorAll('.chester-page--wifi .chester-grid > .chester-card, .chester-page--wifi .chester-grid > section');
		for (var i = 0; i < cards.length; i++)
			if ((cards[i].textContent || '').indexOf(label) >= 0) return cards[i];
		return null;
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function add(uci, card, radio, maximum) {
		if (!card || card.querySelector('[data-wifi-txpower]')) return;
		var field = el('div', 'chester-field wifi-txpower-field');
		var head = el('div', 'chester-field__head');
		var control = el('div', 'chester-field__control');
		var wrap = el('div', 'chester-select-wrap');
		var select = el('select', 'chester-select');
		var configured = uci.get('wireless', radio, 'txpower') || '';
		field.dataset.wifiTxpower = radio;
		head.appendChild(el('label', 'chester-field__label', 'Transmit Power'));
		select.appendChild(new Option('Auto (driver default)', '', configured === '', configured === ''));
		for (var dbm = maximum; dbm >= 0; dbm--) {
			var mw = Math.round(Math.pow(10, dbm / 10));
			select.appendChild(new Option(dbm + ' dBm (' + mw + ' mW)', String(dbm), String(dbm) === String(configured), String(dbm) === String(configured)));
		}
		select.addEventListener('change', function () {
			if (select.value) uci.set('wireless', radio, 'txpower', select.value);
			else uci.unset('wireless', radio, 'txpower');
		});
		wrap.appendChild(select); control.appendChild(wrap); field.appendChild(head); field.appendChild(control);
		(card.querySelector('.chester-card__body') || card).appendChild(field);
	}

	L.require('uci').then(function (uci) {
		return uci.load('wireless').then(function () {
			var attempts = 0;
			var timer = window.setInterval(function () {
				var card24 = findCard('2.4 GHz');
				var card58 = findCard('5.8 GHz');
				add(uci, card24, 'radio0', 25);
				add(uci, card58, 'radio1', 28);
				if ((card24 && card58) || ++attempts >= 40) window.clearInterval(timer);
			}, 250);
		});
	});
})();

(function () {
	'use strict';
	if (document.body.dataset.page !== 'admin-network-wifi') return;

	function enableFields() {
		return Array.prototype.filter.call(document.querySelectorAll('.chester-page--wifi .chester-field'), function (field) {
			if (field.classList.contains('wifi-top-control')) return false;
			var head = field.querySelector('.chester-field__label');
			return head && head.textContent.trim().toLowerCase() === 'enable wi-fi' && field.querySelector('input[type=checkbox]');
		});
	}

	function makeSwitch(title, offText, onText) {
		var card = document.createElement('div');
		card.className = 'wifi-top-control';
		var heading = document.createElement('div');
		heading.className = 'wifi-top-control__title';
		heading.textContent = title;
		var choices = document.createElement('div');
		choices.className = 'wifi-top-control__choices';
		var off = document.createElement('span');
		off.className = 'wifi-top-control__state wifi-top-control__state--off';
		off.textContent = offText;
		var label = document.createElement('label');
		label.className = 'wifi-switch';
		var input = document.createElement('input');
		input.type = 'checkbox';
		var track = document.createElement('span');
		track.className = 'wifi-switch__track';
		var on = document.createElement('span');
		on.className = 'wifi-top-control__state wifi-top-control__state--on';
		on.textContent = onText;
		label.appendChild(input); label.appendChild(track);
		choices.appendChild(off); choices.appendChild(label); choices.appendChild(on);
		card.appendChild(heading); card.appendChild(choices);
		return { node: card, input: input, off: off, on: on };
	}

	function paint(control) {
		control.off.classList.toggle('is-active', !control.input.checked);
		control.on.classList.toggle('is-active', control.input.checked);
	}

	function install() {
		var outer = document.querySelector('.chester-page--wifi .chester-shell > .chester-card');
		if (!outer || outer.querySelector('.wifi-top-controls')) return false;
		var modeField = Array.prototype.find.call(outer.children, function (child) {
			return child.classList && child.classList.contains('chester-field') && child.querySelector('input[type=checkbox]');
		});
		if (!modeField) return false;
		var modeSource = modeField.querySelector('input[type=checkbox]');
		var outerHead = outer.querySelector(':scope > .chester-card__head');
		if (outerHead) {
			var outerTitle = outerHead.querySelector('.chester-card__title');
			var outerDescription = outerHead.querySelector('.chester-card__description');
			if (outerTitle) outerTitle.textContent = 'Wi-Fi Settings';
			if (outerDescription) outerDescription.remove();
		}
		var wifi = makeSwitch('Wi-Fi', 'Disable', 'Enable');
		var names = makeSwitch('Wi-Fi Networks', 'Separate Networks', 'Same Name');
		var row = document.createElement('div');
		row.className = 'wifi-top-controls';
		row.appendChild(wifi.node); row.appendChild(names.node);
		outer.insertBefore(row, modeField);
		modeField.classList.add('wifi-control-source');

		function refreshSources() {
			var sources = enableFields();
			sources.forEach(function (field) { field.classList.add('wifi-control-source'); });
			wifi.input.checked = sources.length ? sources.every(function (field) { return field.querySelector('input[type=checkbox]').checked; }) : true;
			names.input.checked = modeSource.checked;
			paint(wifi); paint(names);
		}

		wifi.input.addEventListener('change', function () {
			enableFields().forEach(function (field) {
				var source = field.querySelector('input[type=checkbox]');
				source.checked = wifi.input.checked;
				source.dispatchEvent(new Event('change', { bubbles: true }));
			});
			paint(wifi);
		});

		names.input.addEventListener('change', function () {
			modeSource.checked = names.input.checked;
			modeSource.dispatchEvent(new Event('change', { bubbles: true }));
			paint(names);
			window.setTimeout(refreshSources, 50);
		});

		new MutationObserver(function () { window.setTimeout(refreshSources, 0); }).observe(outer, { childList: true, subtree: true });
		refreshSources();
		return true;
	}

	var attempts = 0;
	var timer = window.setInterval(function () {
		if (install() || ++attempts >= 40) window.clearInterval(timer);
	}, 250);
})();
