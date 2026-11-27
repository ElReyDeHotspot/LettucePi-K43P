package main

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

type observedName struct {
	Name  string
	Until time.Time
}
type guardDNS struct {
	udp, tcp  *dns.Server
	mu        sync.RWMutex
	known     map[string]Host
	networks  Networks
	refreshed time.Time
	observed  map[string]observedName
	slots     chan struct{}
}

func (g *guard) startDNS() error {
	g.dnsMu.Lock()
	defer g.dnsMu.Unlock()
	if g.dns != nil {
		return nil
	}
	packet, e := net.ListenPacket("udp", ":5354")
	if e != nil {
		return errors.New("Could not open the local filtering DNS port.")
	}
	listener, e := net.Listen("tcp", ":5354")
	if e != nil {
		packet.Close()
		return errors.New("Could not open the local filtering DNS TCP port.")
	}
	d := &guardDNS{known: hosts(), networks: networks(), observed: map[string]observedName{}, refreshed: time.Now(), slots: make(chan struct{}, 64)}
	handler := dns.HandlerFunc(func(w dns.ResponseWriter, r *dns.Msg) { g.handleDNS(d, w, r) })
	d.udp = &dns.Server{PacketConn: packet, Handler: handler, UDPSize: 4096, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second}
	d.tcp = &dns.Server{Listener: listener, Handler: handler, ReadTimeout: 3 * time.Second, WriteTimeout: 3 * time.Second, MaxTCPQueries: 16}
	g.dns = d
	go d.udp.ActivateAndServe()
	go d.tcp.ActivateAndServe()
	return nil
}
func (g *guard) stopDNS() {
	g.dnsMu.Lock()
	defer g.dnsMu.Unlock()
	if g.dns == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	g.dns.udp.ShutdownContext(ctx)
	g.dns.tcp.ShutdownContext(ctx)
	g.dns = nil
}
func (d *guardDNS) clientMAC(ip string) string {
	d.mu.RLock()
	h := d.known[ip]
	stale := time.Since(d.refreshed) > 5*time.Second
	d.mu.RUnlock()
	if stale {
		d.mu.Lock()
		if time.Since(d.refreshed) > 5*time.Second {
			d.known = hosts()
			d.networks = networks()
			d.refreshed = time.Now()
		}
		h = d.known[ip]
		d.mu.Unlock()
	}
	return h.MAC
}
func (g *guard) handleDNS(d *guardDNS, w dns.ResponseWriter, r *dns.Msg) {
	fail := func(code int) { m := new(dns.Msg); m.SetRcode(r, code); w.WriteMsg(m) }
	select {
	case d.slots <- struct{}{}:
		defer func() { <-d.slots }()
	default:
		fail(dns.RcodeServerFailure)
		return
	}
	if r.Opcode != dns.OpcodeQuery || len(r.Question) != 1 || r.Question[0].Qclass != dns.ClassINET {
		fail(dns.RcodeRefused)
		return
	}
	source, _, e := net.SplitHostPort(w.RemoteAddr().String())
	if e != nil {
		fail(dns.RcodeRefused)
		return
	}
	ip := net.ParseIP(source)
	if ip == nil {
		fail(dns.RcodeRefused)
		return
	}
	// The nftables input guard limits this listener to LAN; this second check
	// also keeps direct WAN requests from using it as an open resolver.
	mac := d.clientMAC(ip.String())
	d.mu.RLock()
	lan := d.networks.lan(ip.String())
	d.mu.RUnlock()
	if !ip.IsLoopback() && !lan {
		fail(dns.RcodeRefused)
		return
	}
	p := g.policy.Load()
	if p == nil || !p.Config.Enabled {
		fail(dns.RcodeRefused)
		return
	}
	question := strings.ToLower(strings.TrimSuffix(r.Question[0].Name, "."))
	blocked, key := p.blockedDomain(mac, question)
	refuse := func() {
		g.recordBlock(key)
		m := new(dns.Msg)
		m.SetRcode(r, dns.RcodeNameError)
		m.RecursionAvailable = true
		m.AuthenticatedData = false
		m.Ns = []dns.RR{&dns.SOA{Hdr: dns.RR_Header{Name: question + ".", Rrtype: dns.TypeSOA, Class: dns.ClassINET, Ttl: 30}, Ns: "localhost.", Mbox: "hostmaster.localhost.", Serial: 1, Refresh: 60, Retry: 60, Expire: 60, Minttl: 30}}
		w.WriteMsg(m)
	}
	if blocked {
		refuse()
		return
	}
	network := "udp"
	if _, ok := w.RemoteAddr().(*net.TCPAddr); ok {
		network = "tcp"
	}
	client := &dns.Client{Net: network, Timeout: 2 * time.Second, UDPSize: 4096}
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	answer, _, e := client.ExchangeContext(ctx, r, "127.0.0.1:53")
	if e == nil && answer.Truncated && network == "udp" {
		client.Net = "tcp"
		answer, _, e = client.ExchangeContext(ctx, r, "127.0.0.1:53")
	}
	if e != nil {
		fail(dns.RcodeServerFailure)
		return
	}
	for _, record := range answer.Answer {
		if cname, ok := record.(*dns.CNAME); ok {
			if bad, reason := p.blockedDomain(mac, strings.ToLower(strings.TrimSuffix(cname.Target, "."))); bad {
				key = reason
				refuse()
				return
			}
		}
	}
	if mac != "" {
		d.mu.Lock()
		now := time.Now()
		if len(d.observed) > 4096 {
			for key, v := range d.observed {
				if now.After(v.Until) {
					delete(d.observed, key)
				}
			}
		}
		for _, record := range answer.Answer {
			var addr string
			switch rr := record.(type) {
			case *dns.A:
				addr = rr.A.String()
			case *dns.AAAA:
				addr = rr.AAAA.String()
			}
			if addr != "" && (len(d.observed) < 4096 || d.observed[mac+"|"+addr].Name != "") {
				ttl := time.Duration(record.Header().Ttl) * time.Second
				if ttl > time.Hour {
					ttl = time.Hour
				}
				d.observed[mac+"|"+addr] = observedName{Name: question, Until: now.Add(ttl)}
			}
		}
		d.mu.Unlock()
	}
	w.WriteMsg(answer)
}
func (g *guard) observedDomain(mac, ip string) string {
	g.dnsMu.Lock()
	d := g.dns
	g.dnsMu.Unlock()
	if d == nil {
		return ""
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ""
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	v := d.observed[mac+"|"+parsed.String()]
	if time.Now().Before(v.Until) {
		return v.Name
	}
	return ""
}
