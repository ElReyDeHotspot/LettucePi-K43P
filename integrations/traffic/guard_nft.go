package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func bridgeNames() []string {
	ifs, _ := net.Interfaces()
	var names []string
	for _, i := range ifs {
		if strings.HasPrefix(i.Name, "br-") {
			names = append(names, i.Name)
		}
	}
	sort.Strings(names)
	return names
}
func nftPolicy(p *compiledPolicy, bridges []string) string {
	head := "add table inet chester_guard\ndelete table inet chester_guard\n"
	if !p.Config.Enabled {
		return head
	}
	var b strings.Builder
	b.WriteString(head + "table inet chester_guard {\n")
	sets := map[string][]string{}
	for _, n := range []string{"allow4", "allow6", "block4", "block6", "device_allow4", "device_allow6", "device_block4", "device_block6", "bypass", "internet", "custom4", "custom6"} {
		sets[n] = nil
	}
	add := func(mac string, allow bool, ip netip.Prefix) {
		key := "block"
		if allow {
			key = "allow"
		}
		if mac != "" {
			key = "device_" + key
		}
		if ip.Addr().Is4() {
			key += "4"
		} else {
			key += "6"
		}
		v := ip.String()
		if mac != "" {
			v = mac + " . " + v
		}
		sets[key] = append(sets[key], v)
	}
	now := time.Now().Unix()
	for _, r := range p.Config.Rules {
		if r.Kind == "ip" && (r.Expires == 0 || r.Expires > now) {
			ip, _ := prefix(r.Value)
			add(r.MAC, r.Allow, ip)
			if r.MAC == "" && !r.Allow {
				key := "custom4"
				if ip.Addr().Is6() {
					key = "custom6"
				}
				sets[key] = append(sets[key], ip.String())
			}
		}
	}
	for _, d := range p.Config.Devices {
		if d.Mode == "off" {
			sets["bypass"] = append(sets["bypass"], d.MAC)
		} else if d.BlockInternet {
			sets["internet"] = append(sets["internet"], d.MAC)
		}
	}
	for _, id := range p.Config.Categories {
		for _, sub := range p.IPLists[id] {
			add("", false, sub)
		}
	}
	// Custom device category choices override global IP-category sets using an early return.
	for _, d := range p.Config.Devices {
		if d.Mode == "custom" {
			for _, id := range d.Categories {
				for _, sub := range p.IPLists[id] {
					add(d.MAC, false, sub)
				}
			}
		}
	}
	keys := []string{"allow4", "allow6", "block4", "block6", "device_allow4", "device_allow6", "device_block4", "device_block6", "bypass", "internet", "custom4", "custom6"}
	for _, key := range keys {
		typ := "ether_addr"
		if strings.HasSuffix(key, "4") {
			typ = "ipv4_addr"
		} else if strings.HasSuffix(key, "6") {
			typ = "ipv6_addr"
		}
		if strings.HasPrefix(key, "device_") {
			typ = "ether_addr . " + typ
		}
		fmt.Fprintf(&b, "set %s { type %s; ", key, typ)
		if key != "bypass" && key != "internet" {
			b.WriteString("flags interval; auto-merge; ")
		}
		if len(sets[key]) > 0 {
			sort.Strings(sets[key])
			unique := []string{}
			for _, v := range sets[key] {
				if len(unique) == 0 || unique[len(unique)-1] != v {
					unique = append(unique, v)
				}
			}
			b.WriteString("elements = { " + strings.Join(unique, ", ") + " }; ")
		}
		b.WriteString("}\n")
	}
	quoted := make([]string, len(bridges))
	for i, name := range bridges {
		quoted[i] = strconv.Quote(name)
	}
	if len(quoted) == 0 {
		return ""
	}
	lan := "{ " + strings.Join(quoted, ", ") + " }"
	b.WriteString("chain forward { type filter hook forward priority -10; policy accept;\niifname != " + lan + " return\noifname " + lan + " return\nether saddr @bypass return\nether saddr @internet counter drop comment \"Device internet block\"\n")
	for _, family := range []string{"4", "6"} {
		ip := "ip"
		if family == "6" {
			ip = "ip6"
		}
		fmt.Fprintf(&b, "ether saddr . %s daddr @device_allow%s return\n%s daddr @allow%s return\n", ip, family, ip, family)
	}
	for _, family := range []string{"4", "6"} {
		ip := "ip"
		if family == "6" {
			ip = "ip6"
		}
		fmt.Fprintf(&b, "ether saddr . %s daddr @device_block%s counter drop comment \"Per-device IP blocks\"\n", ip, family)
	}
	// Global category IPs are skipped for devices with their own category selection;
	// custom global IP rules still apply through a separate set below.
	customMAC := []string{}
	for _, d := range p.Config.Devices {
		if d.Mode == "custom" {
			customMAC = append(customMAC, d.MAC)
		}
	}
	if len(customMAC) > 0 {
		b.WriteString("ip daddr @custom4 counter drop comment \"Custom IPv4 blocks\"\nip6 daddr @custom6 counter drop comment \"Custom IPv6 blocks\"\n")
		b.WriteString("ether saddr { " + strings.Join(customMAC, ", ") + " } return\n")
	}
	b.WriteString("ip daddr @block4 counter drop comment \"Global IPv4 blocks\"\nip6 daddr @block6 counter drop comment \"Global IPv6 blocks\"\n}\n")
	b.WriteString("chain dns_redirect { type nat hook prerouting priority -110; policy accept;\niifname " + lan + " udp dport 53 redirect to :5354\niifname " + lan + " tcp dport 53 redirect to :5354\n}\n")
	b.WriteString("chain protect_dns { type filter hook input priority -10; policy accept;\niifname \"lo\" return\niifname " + lan + " return\nudp dport 5354 drop\ntcp dport 5354 drop\n}\n}\n")
	return b.String()
}
func applyNFT(p *compiledPolicy) error {
	script := nftPolicy(p, bridgeNames())
	if script == "" {
		return errors.New("No LAN bridge is available. Retry after the network finishes starting.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, args := range [][]string{{"-c", "-f", "-"}, {"-f", "-"}} {
		cmd := exec.CommandContext(ctx, "/usr/sbin/nft", args...)
		cmd.Stdin = strings.NewReader(script)
		out, e := cmd.CombinedOutput()
		if e != nil {
			return fmt.Errorf("Could not apply protection rules: %s", strings.TrimSpace(string(out)))
		}
	}
	return nil
}

func attr(kind uint16, data []byte) []byte {
	n := len(data) + 4
	b := make([]byte, (n+3)&^3)
	binary.NativeEndian.PutUint16(b, uint16(n))
	binary.NativeEndian.PutUint16(b[2:], kind)
	copy(b[4:], data)
	return b
}
func nested(kind uint16, data ...[]byte) []byte { return attr(kind|0x8000, appendAll(data...)) }
func appendAll(parts ...[]byte) []byte {
	var b []byte
	for _, p := range parts {
		b = append(b, p...)
	}
	return b
}
func port(s string) []byte {
	n, _ := strconv.Atoi(s)
	b := make([]byte, 2)
	binary.BigEndian.PutUint16(b, uint16(n))
	return b
}
func conntrackDelete(fd int, f Flow) error {
	parts := strings.Split(f.ID, "|")
	if len(parts) < 7 {
		return nil
	}
	src, dst := net.ParseIP(parts[2]), net.ParseIP(parts[3])
	if src == nil || dst == nil {
		return nil
	}
	family := byte(syscall.AF_INET)
	ipSrc, ipDst := uint16(1), uint16(2)
	src, dst = src.To4(), dst.To4()
	if src == nil {
		family = syscall.AF_INET6
		src, dst = net.ParseIP(parts[2]).To16(), net.ParseIP(parts[3]).To16()
		ipSrc, ipDst = 3, 4
	}
	proto := byte(0)
	switch parts[1] {
	case "tcp":
		proto = 6
	case "udp":
		proto = 17
	default:
		return nil
	}
	tuple := nested(1, nested(1, attr(ipSrc, src), attr(ipDst, dst)), nested(2, attr(1, []byte{proto}), attr(2, port(parts[4])), attr(3, port(parts[5]))))
	seq := uint32(time.Now().UnixNano())
	payload := append([]byte{family, 0, 0, 0}, tuple...)
	if parts[6] != "0" {
		payload = append(payload, attr(18, port(parts[6]))...)
	}
	msg := make([]byte, 16)
	binary.NativeEndian.PutUint32(msg, uint32(16+len(payload)))
	binary.NativeEndian.PutUint16(msg[4:], 0x102)
	binary.NativeEndian.PutUint16(msg[6:], 5)
	binary.NativeEndian.PutUint32(msg[8:], seq)
	msg = append(msg, payload...)
	if e := syscall.Sendto(fd, msg, 0, &syscall.SockaddrNetlink{Family: syscall.AF_NETLINK}); e != nil {
		return e
	}
	buf := make([]byte, 4096)
	n, _, e := syscall.Recvfrom(fd, buf, 0)
	if e != nil {
		return e
	}
	if n < 20 {
		return errors.New("Short conntrack acknowledgement")
	}
	if binary.NativeEndian.Uint32(buf[8:]) != seq {
		return errors.New("Unexpected conntrack acknowledgement")
	}
	code := int32(binary.NativeEndian.Uint32(buf[16:]))
	if code == 0 || code == -int32(syscall.ENOENT) {
		return nil
	}
	return syscall.Errno(-code)
}

// Deleting matching conntrack tuples asks the kernel to tear down their offload
// entries as well. No blanket conntrack flush and no network restart is used.
func clearBlockedFlows(p *compiledPolicy) (int, error) {
	if !p.Config.Enabled {
		return 0, nil
	}
	fd, e := syscall.Socket(syscall.AF_NETLINK, syscall.SOCK_RAW, 12)
	if e != nil {
		return 0, e
	}
	defer syscall.Close(fd)
	syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &syscall.Timeval{Sec: 1})
	if e = syscall.Bind(fd, &syscall.SockaddrNetlink{Family: syscall.AF_NETLINK}); e != nil {
		return 0, e
	}
	file, e := os.Open("/proc/net/nf_conntrack")
	if e != nil {
		return 0, e
	}
	defer file.Close()
	known, n := hosts(), networks()
	scanner := bufio.NewScanner(file)
	count := 0
	started := time.Now()
	for scanner.Scan() {
		f, a, b, ok := parse(scanner.Text())
		if !ok || !n.lan(a.Src) {
			continue
		}
		classify(&f, a, b, n)
		mac := known[net.ParseIP(a.Src).String()].MAC
		dest, err := netip.ParseAddr(a.Dst)
		if err != nil {
			continue
		}
		dns := a.Dport == "53" && (f.Protocol == "tcp" || f.Protocol == "udp")
		if (f.Direction == "Outbound" && p.blockedIP(mac, dest)) || dns {
			if e = conntrackDelete(fd, f); e != nil {
				return count, e
			}
			count++
		}
		if time.Since(started) > 2*time.Second {
			return count, errors.New("Connection cleanup exceeded its safety budget. Retry while the router is less busy.")
		}
	}
	return count, scanner.Err()
}
