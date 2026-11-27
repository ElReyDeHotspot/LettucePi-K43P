package main

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Category struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	URLs        []string `json:"urls"`
	IP          bool     `json:"ip"`
}

const hagezi = "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/"

var categories = []Category{
	{"malware", "Malware", "Known malicious domains. Threat feeds also overlap phishing and other threats.", []string{hagezi + "tif.mini-onlydomains.txt"}, false},
	{"advertising", "Advertising", "Advertising servers; page-embedded and first-party ads may remain.", []string{"https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/BaseFilter/sections/adservers.txt"}, false},
	{"trackers", "Trackers", "Analytics and tracking servers.", []string{"https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/SpywareFilter/sections/tracking_servers.txt"}, false},
	{"phishing", "Phishing", "Domains extracted from the OpenPhish community URL feed. Whole domains are filtered.", []string{"https://openphish.com/feed.txt"}, false},
	{"botnets", "Botnets", "Active botnet command-and-control IPs from Feodo Tracker.", []string{"https://feodotracker.abuse.ch/downloads/ipblocklist.txt"}, true},
	{"adult", "Adult content", "Adult-content domains. Content filters cannot cover every website.", []string{hagezi + "nsfw-onlydomains.txt"}, false},
	{"gambling", "Gambling", "A resource-conscious selection of gambling domains.", []string{hagezi + "gambling.mini-onlydomains.txt"}, false},
	{"social", "Social media", "Social networks, including Facebook, Instagram and TikTok. Messaging and streaming are separate.", []string{hagezi + "social-onlydomains.txt"}, false},
	{"telemetry", "Telemetry", "Built-in reporting endpoints for Apple and Windows/Office. Some device features may need exceptions.", []string{hagezi + "native.apple-onlydomains.txt", hagezi + "native.winoffice-onlydomains.txt"}, false},
}

type DevicePolicy struct {
	MAC           string   `json:"mac"`
	Mode          string   `json:"mode"`
	Categories    []string `json:"categories"`
	BlockInternet bool     `json:"block_internet"`
}
type GuardRule struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Value   string `json:"value"`
	MAC     string `json:"mac,omitempty"`
	Allow   bool   `json:"allow"`
	Expires int64  `json:"expires,omitempty"`
}
type GuardConfig struct {
	Revision   uint64         `json:"revision"`
	Enabled    bool           `json:"enabled"`
	Categories []string       `json:"categories"`
	Devices    []DevicePolicy `json:"devices"`
	Rules      []GuardRule    `json:"rules"`
}
type compiledPolicy struct {
	Config  GuardConfig
	Lists   map[string][]string
	IPLists map[string][]netip.Prefix
	Devices map[string]DevicePolicy
}

var domainLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var ruleID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)

func domainName(s string) string {
	s = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(s), "."))
	s = strings.TrimPrefix(s, "*.")
	if len(s) > 253 || net.ParseIP(s) != nil || !strings.Contains(s, ".") {
		return ""
	}
	for _, label := range strings.Split(s, ".") {
		if !domainLabel.MatchString(label) {
			return ""
		}
	}
	return s
}
func macAddress(s string) string {
	m, e := net.ParseMAC(s)
	if e != nil || len(m) != 6 || m[0]&1 != 0 || m.String() == "00:00:00:00:00:00" {
		return ""
	}
	return strings.ToUpper(m.String())
}
func prefix(s string) (netip.Prefix, error) {
	if ip, e := netip.ParseAddr(s); e == nil {
		return netip.PrefixFrom(ip, ip.BitLen()), nil
	}
	p, e := netip.ParsePrefix(s)
	if e != nil {
		return p, e
	}
	return p.Masked(), nil
}
func validateConfig(c *GuardConfig) error {
	if len(c.Rules) > 512 || len(c.Devices) > 256 {
		return errors.New("Use no more than 512 custom rules and 256 device policies.")
	}
	valid := map[string]bool{}
	for _, cat := range categories {
		valid[cat.ID] = true
	}
	check := func(ids []string) error {
		if len(ids) > len(categories) {
			return errors.New("Too many protection categories.")
		}
		for _, id := range ids {
			if !valid[id] {
				return errors.New("Choose an available protection category.")
			}
		}
		return nil
	}
	if err := check(c.Categories); err != nil {
		return err
	}
	seen := map[string]bool{}
	for i, d := range c.Devices {
		d.MAC = macAddress(d.MAC)
		if d.MAC == "" || seen[d.MAC] {
			return errors.New("Choose one policy per valid device MAC address.")
		}
		seen[d.MAC] = true
		if d.Mode != "inherit" && d.Mode != "custom" && d.Mode != "off" {
			return errors.New("Choose Inherit, Custom or No filtering.")
		}
		if err := check(d.Categories); err != nil {
			return err
		}
		if d.Mode == "off" && d.BlockInternet {
			return errors.New("A device cannot bypass protection and have its internet blocked.")
		}
		c.Devices[i] = d
	}
	seen = map[string]bool{}
	for i, r := range c.Rules {
		if !ruleID.MatchString(r.ID) || seen[r.ID] {
			return errors.New("Rules need unique valid identifiers.")
		}
		seen[r.ID] = true
		if r.MAC != "" {
			r.MAC = macAddress(r.MAC)
			if r.MAC == "" {
				return errors.New("Choose a valid rule device.")
			}
		}
		switch r.Kind {
		case "domain":
			r.Value = domainName(r.Value)
			if r.Value == "" {
				return errors.New("Enter a domain such as example.com, without a path.")
			}
		case "ip":
			p, e := prefix(strings.TrimSpace(r.Value))
			if e != nil || p.Addr().IsUnspecified() || p.Addr().IsMulticast() || p.Addr().IsLoopback() || p.Bits() == 0 {
				return errors.New("Enter a valid IPv4/IPv6 address or subnet; unspecified, loopback and multicast targets are excluded.")
			}
			r.Value = p.String()
		default:
			return errors.New("Choose Domain or IP / subnet.")
		}
		if r.Expires < 0 || r.Expires > time.Now().Add(366*24*time.Hour).Unix() {
			return errors.New("Choose an expiry within the next year, or Permanent.")
		}
		c.Rules[i] = r
	}
	return nil
}
func compilePolicy(c GuardConfig, lists map[string][]string) *compiledPolicy {
	p := &compiledPolicy{Config: c, Lists: lists, IPLists: map[string][]netip.Prefix{}, Devices: map[string]DevicePolicy{}}
	for _, d := range c.Devices {
		p.Devices[d.MAC] = d
	}
	for _, cat := range categories {
		if cat.IP {
			for _, v := range lists[cat.ID] {
				if ip, e := prefix(v); e == nil {
					p.IPLists[cat.ID] = append(p.IPLists[cat.ID], ip)
				}
			}
		}
	}
	return p
}
func (p *compiledPolicy) device(mac string) DevicePolicy {
	if d, ok := p.Devices[mac]; ok {
		return d
	}
	return DevicePolicy{Mode: "inherit"}
}
func (p *compiledPolicy) selected(mac string) []string {
	d := p.device(mac)
	if d.Mode == "off" {
		return nil
	}
	if d.Mode == "custom" {
		return d.Categories
	}
	return p.Config.Categories
}
func activeRule(r GuardRule, mac string) bool {
	return (r.MAC == "" || r.MAC == mac) && (r.Expires == 0 || r.Expires > time.Now().Unix())
}
func domainMatches(domain, target string) bool {
	return domain == target || strings.HasSuffix(domain, "."+target)
}
func listContains(list []string, domain string) bool {
	for {
		i := sort.SearchStrings(list, domain)
		if i < len(list) && list[i] == domain {
			return true
		}
		at := strings.IndexByte(domain, '.')
		if at < 0 {
			return false
		}
		domain = domain[at+1:]
	}
}
func (p *compiledPolicy) blockedDomain(mac, domain string) (bool, string) {
	if !p.Config.Enabled || p.device(mac).Mode == "off" {
		return false, ""
	}
	for _, r := range p.Config.Rules {
		if r.Allow && r.Kind == "domain" && activeRule(r, mac) && domainMatches(domain, r.Value) {
			return false, ""
		}
	}
	for _, r := range p.Config.Rules {
		if !r.Allow && r.Kind == "domain" && activeRule(r, mac) && domainMatches(domain, r.Value) {
			return true, r.ID
		}
	}
	for _, id := range p.selected(mac) {
		if listContains(p.Lists[id], domain) {
			return true, id
		}
	}
	return false, ""
}
func (p *compiledPolicy) blockedIP(mac string, addr netip.Addr) bool {
	if !p.Config.Enabled || p.device(mac).Mode == "off" {
		return false
	}
	if p.device(mac).BlockInternet {
		return true
	}
	for _, r := range p.Config.Rules {
		if r.Allow && r.Kind == "ip" && activeRule(r, mac) {
			sub, _ := prefix(r.Value)
			if sub.Contains(addr) {
				return false
			}
		}
	}
	for _, r := range p.Config.Rules {
		if !r.Allow && r.Kind == "ip" && activeRule(r, mac) {
			sub, _ := prefix(r.Value)
			if sub.Contains(addr) {
				return true
			}
		}
	}
	for _, id := range p.selected(mac) {
		for _, sub := range p.IPLists[id] {
			if sub.Contains(addr) {
				return true
			}
		}
	}
	return false
}
func configError(err error) []byte {
	return []byte(fmt.Sprintf("{\"success\":false,\"error\":%q}\n", err.Error()))
}
