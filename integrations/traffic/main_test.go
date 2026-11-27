package main

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

const line = "ipv4 2 tcp 6 100 ESTABLISHED src=192.168.100.2 dst=1.1.1.1 sport=5000 dport=443 packets=4 bytes=400 src=1.1.1.1 dst=10.0.0.2 sport=443 dport=5000 packets=8 bytes=800 [ASSURED] mark=0 zone=0 use=2"

func TestOffloadedProcRecord(t *testing.T) {
	raw := "ipv4 2 tcp 6 src=192.168.100.115 dst=1.0.0.1 sport=52990 dport=443 packets=2 bytes=92 src=1.0.0.1 dst=100.100.177.186 sport=443 dport=52990 packets=1 bytes=52 [HW_OFFLOAD] mark=67108864 zone=0 use=3"
	f, a, b, ok := parse(raw)
	if !ok || a.Src != "192.168.100.115" || b.Src != "1.0.0.1" || f.Bytes != 144 || f.Acceleration != "hardware" || f.SourcePort != "52990" || f.State != "" {
		t.Fatalf("Short offloaded record misread: %+v %+v %+v", f, a, b)
	}
}

func TestParse(t *testing.T) {
	f, a, b, ok := parse(line)
	if !ok || f.Bytes != 1200 || f.Packets != 12 || f.Protocol != "tcp" || !f.Accounted || b.Dst != "10.0.0.2" || a.Dport != "443" {
		t.Fatalf("%+v %+v %+v", f, a, b)
	}
	f, _, _, _ = parse("ipv6 10 udp 17 20 src=fd00::2 dst=2606:4700::1111 sport=5 dport=53 src=2606:4700::1111 dst=fd00::2 sport=53 dport=5")
	if f.Accounted {
		t.Fatal("missing counters must be unavailable")
	}
}
func TestDirection(t *testing.T) {
	_, sub, _ := net.ParseCIDR("192.168.100.0/24")
	n := Networks{Local: map[string]bool{"192.168.100.1": true}, LAN: []*net.IPNet{sub}}
	f, a, b, _ := parse(line)
	classify(&f, a, b, n)
	if f.Direction != "Outbound" {
		t.Fatal(f)
	}
	f, a, b, _ = parse("ipv4 2 tcp 6 100 ESTABLISHED src=8.8.8.8 dst=10.0.0.2 sport=5 dport=443 packets=1 bytes=100 src=192.168.100.2 dst=8.8.8.8 sport=443 dport=5 packets=2 bytes=200")
	classify(&f, a, b, n)
	if f.Direction != "Inbound" || f.Destination != "192.168.100.2" || f.Up != 200 {
		t.Fatal(f)
	}
}
func TestRates(t *testing.T) {
	p := filepath.Join(t.TempDir(), "ct")
	os.WriteFile(p, []byte(line+"\n"), 0600)
	_, sub, _ := net.ParseCIDR("192.168.100.0/24")
	n := Networks{LAN: []*net.IPNet{sub}, Local: map[string]bool{}}
	r, c := sample(p, n, nil, Cache{}, 100)
	if r.Upload != nil {
		t.Fatal("first rate is unknown")
	}
	r, _ = sample(p, n, nil, c, 102)
	if r.Upload == nil || *r.Upload != 0 {
		t.Fatal("idle must be zero")
	}
	for k := range c.Flows {
		c.Flows[k] = Counter{Up: 200, Down: 400}
	}
	r, _ = sample(p, n, nil, c, 102)
	if *r.Upload != 100 || *r.Download != 200 {
		t.Fatal(r)
	}
	r, _ = sample(p, n, nil, c, 130)
	if r.Upload != nil {
		t.Fatal("stale rate")
	}
}
