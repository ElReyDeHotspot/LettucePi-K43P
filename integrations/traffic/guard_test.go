package main

import (
	"fmt"
	"net/netip"
	"strings"
	"testing"
)

func TestPolicyAllowScope(t *testing.T) {
	c := GuardConfig{Enabled: true, Categories: []string{"social"}, Devices: []DevicePolicy{{MAC: "02:00:00:00:00:02", Mode: "custom", Categories: []string{"trackers"}}, {MAC: "02:00:00:00:00:04", Mode: "off"}}, Rules: []GuardRule{{ID: "blocked", Kind: "domain", Value: "blocked.example"}, {ID: "allowed", Kind: "domain", Value: "ok.blocked.example", Allow: true}, {ID: "ip", Kind: "ip", Value: "2001:db8::/32"}, {ID: "allowip", Kind: "ip", Value: "2001:db8:1::/48", Allow: true}}}
	if e := validateConfig(&c); e != nil {
		t.Fatal(e)
	}
	p := compilePolicy(c, map[string][]string{"social": {"social.example"}, "trackers": {"tracker.example"}})
	for _, s := range []struct {
		mac, domain string
		want        bool
	}{{"", "sub.blocked.example", true}, {"", "ok.blocked.example", false}, {"", "notblocked.example", false}, {"", "social.example", true}, {"02:00:00:00:00:02", "social.example", false}, {"02:00:00:00:00:02", "tracker.example", true}, {"02:00:00:00:00:04", "blocked.example", false}} {
		got, _ := p.blockedDomain(s.mac, s.domain)
		if got != s.want {
			t.Fatalf("%+v got %v", s, got)
		}
	}
	if !p.blockedIP("", netip.MustParseAddr("2001:db8:2::1")) || p.blockedIP("", netip.MustParseAddr("2001:db8:1::1")) {
		t.Fatal("IPv6 allow precedence")
	}
}
func TestValidation(t *testing.T) {
	for _, r := range []GuardRule{{ID: "x", Kind: "domain", Value: "example.com; reboot"}, {ID: "x", Kind: "domain", Value: "https://example.com/path"}, {ID: "x", Kind: "ip", Value: "0.0.0.0/0"}, {ID: "x", Kind: "ip", Value: "127.0.0.1"}, {ID: "x", Kind: "ip", Value: "::1"}} {
		c := GuardConfig{Rules: []GuardRule{r}}
		if validateConfig(&c) == nil {
			t.Fatal("accepted", r)
		}
	}
	c := GuardConfig{Devices: []DevicePolicy{{MAC: "FF:FF:FF:FF:FF:FF", Mode: "off"}}}
	if validateConfig(&c) == nil {
		t.Fatal("multicast MAC")
	}
}
func TestFeeds(t *testing.T) {
	in := "# header\n||ads.example^\n@@||allowed.example^\n0.0.0.0 tracker.example\nhttps://phish.example/path\nads.example\n"
	l, e := parseFeed(strings.NewReader(in), false)
	if e != nil || strings.Join(l, ",") != "ads.example,phish.example,tracker.example" {
		t.Fatal(l, e)
	}
	if _, e = parseFeed(strings.NewReader("<html>Unavailable</html>"), false); e == nil {
		t.Fatal("accepted HTML")
	}
	if _, e = parseFeed(strings.NewReader("<html>Unavailable</html>"), true); e == nil {
		t.Fatal("accepted empty IP feed")
	}
	if l, e = parseFeed(strings.NewReader("# Feodo Tracker\n"), true); e != nil || len(l) != 0 {
		t.Fatal("valid zero active indicators", e)
	}
}
func TestNftSetScaling(t *testing.T) {
	c := GuardConfig{Enabled: true, Devices: []DevicePolicy{{MAC: "02:00:00:00:00:02", Mode: "custom"}}}
	for i := 0; i < 400; i++ {
		c.Rules = append(c.Rules, GuardRule{ID: fmt.Sprint("r", i), Kind: "ip", Value: fmt.Sprintf("192.0.%d.%d/32", i/250, i%250+1)})
	}
	s := nftPolicy(compilePolicy(c, nil), []string{"br-lan"})
	if strings.Count(s, "counter drop") > 10 {
		t.Fatal("rules grew with entries")
	}
	if !strings.Contains(s, "set custom4") || !strings.Contains(s, "redirect to :5354") {
		t.Fatal("missing policy structures")
	}
}
