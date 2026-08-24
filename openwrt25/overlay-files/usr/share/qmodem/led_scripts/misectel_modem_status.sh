#!/bin/sh

. /usr/share/qmodem/modem_util.sh
. /usr/share/qmodem/led_scripts/misectel_led.sh
. /lib/functions.sh

MODEM_CFG="$1"
ON_OFF="$2"
last_siminserted=
last_netstat=
last_is_nr=0

update_cfg()
{
	config_load qmodem
	config_get AT_PORT "$MODEM_CFG" at_port
	config_get ALIAS "$MODEM_CFG" alias
	config_get USE_UBUS "$MODEM_CFG" use_ubus
	use_ubus_flag=
	[ "$USE_UBUS" != 1 ] || use_ubus_flag=-u
}

update_netdev()
{
	config_load network
	if [ -n "$ALIAS" ]; then
		config_get NET_DEV "$ALIAS" ifname
	else
		config_get NET_DEV "$MODEM_CFG" ifname
	fi
}

sim_inserted()
{
	# Read the SIM state from QModem's cached view instead of issuing our
	# own AT+CPIN? every cycle. There is one AT port and the dashboard,
	# the cellular pages and QModem itself already queue on it; the extra
	# round trip was timing out and reporting the SIM as absent when it
	# was merely busy, which blanked the panel and showed SIM errors.
	local info status

	info="$(/usr/share/qmodem/modem_ctrl.sh sim_info "$MODEM_CFG" 2>/dev/null)"
	status="$(printf '%s\n' "$info" | jq -r '.modem_info[]? | select(.key == "SIM Status") | .value' 2>/dev/null | head -n 1)"

	case "$status" in
		[Rr]eady) echo 1 ;;
		# Unreadable is not the same as absent: keep the last answer so a
		# busy port cannot make a present SIM look missing.
		''|null) echo "${last_siminserted:-1}" ;;
		*) echo 0 ;;
	esac
}

get_mode()
{
	local cell_info="$1"
	local network_mode rat_code

	network_mode="$(printf '%s\n' "$cell_info" | jq -r '.modem_info[]? | select(.key == "network_mode") | .value' | head -n 1)"
	case "$network_mode" in
		*EN-DC*|*NR5G*|*NR*|*5G*) echo 1; return ;;
		*LTE*|*4G*) echo 0; return ;;
	esac

	rat_code="$(at "$AT_PORT" 'AT+COPS?' | grep '+COPS:' | awk -F, '{print $4}' | tr -d '"')"
	case "$rat_code" in
		''|*[!0-9]*) echo "$last_is_nr" ;;
		*) [ "$rat_code" -le 7 ] && echo 0 || echo 1 ;;
	esac
}

get_rsrp()
{
	local cell_info="$1"
	local rsrp

	rsrp="$(printf '%s\n' "$cell_info" | jq -r '.modem_info[]? | select(.key == "RSRP") | .value' | head -n 1)"
	case "$rsrp" in
		-*) ;;
		*) rsrp=0 ;;
	esac
	[ "$rsrp" -ge -140 ] 2>/dev/null && [ "$rsrp" -le 0 ] 2>/dev/null || rsrp=0
	echo "$rsrp"
}

update_modem_leds()
{
	local siminserted cell_info mode is_nr rsrp signal netstat
	local lte_led nr_led

	siminserted="$(sim_inserted)"
	# A failed AT read reports 0 here, which is indistinguishable from a
	# SIM that is genuinely absent. Only act on it once a SIM has actually
	# been seen and has gone away; otherwise hold what is already showing,
	# so a busy AT port cannot blank the panel.
	if [ "$siminserted" = 0 ]; then
		if [ "$last_siminserted" = 1 ]; then
			modem_leds_off
			led_turn "$LED_4G_POOR" 1
			led_turn "$LED_5G_POOR" 1
			last_netstat=
			last_siminserted=0
		fi
		return
	fi
	last_siminserted=1

	cell_info="$(/usr/share/qmodem/modem_ctrl.sh cell_info "$MODEM_CFG")"
	rsrp="$(get_rsrp "$cell_info")"
	# get_rsrp returns 0 when it could not read one. That is the AT port
	# being busy, not a weak signal, so hold rather than drop to poor.
	[ "$rsrp" = 0 ] && return

	mode="$(printf '%s\n' "$cell_info" | jq -r '.modem_info[]? | select(.key == "network_mode") | .value' | head -n 1)"
	is_nr="$(get_mode "$cell_info")"
	last_is_nr="$is_nr"

	if [ "$rsrp" -ge -110 ]; then
		signal=2
	else
		signal=1
	fi

	netstat="${mode}_${is_nr}_${signal}"
	# Only touch the LEDs when the picture actually changes.
	[ "$netstat" != "$last_netstat" ] || return
	last_netstat="$netstat"

	case "$signal" in
		2) lte_led="$LED_4G_GOOD"; nr_led="$LED_5G_GOOD" ;;
		*) lte_led="$LED_4G_POOR"; nr_led="$LED_5G_POOR" ;;
	esac

	modem_leds_off
	case "$mode" in
		*EN-DC*|*ENDC*|*NSA*)
			# EN-DC keeps an LTE anchor up alongside 5G, so both are on air
			# and both indicators belong lit.
			led_turn "$lte_led" 1
			led_turn "$nr_led" 1
			;;
		*SA*|*NR5G*|*NR*)
			led_turn "$nr_led" 1
			;;
		*)
			# No 5G in the picture, or the mode string was unreadable: fall
			# back to what get_mode decided.
			if [ "$is_nr" = 1 ]; then
				led_turn "$nr_led" 1
			else
				led_turn "$lte_led" 1
			fi
			;;
	esac
}

misectel_led_init || exit 1
update_cfg
if [ "$ON_OFF" = off ]; then
	modem_leds_off
	exit 0
fi

while true; do
	update_cfg
	update_netdev
	update_modem_leds
	# One AT port serves every consumer on the box, so this loop stays
	# deliberately slow. The LEDs only change when the signal band or
	# radio changes, so a longer interval costs nothing visible.
	sleep 20
done
