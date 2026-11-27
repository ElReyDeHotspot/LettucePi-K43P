package main

import (
	"bufio"
	"container/heap"
	"context"
	"net"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Tuple struct {
	Src   string `json:"src"`
	Dst   string `json:"dst"`
	Sport string `json:"sport"`
	Dport string `json:"dport"`
}
type Flow struct {
	Acceleration    string `json:"acceleration,omitempty"`
	Domain          string `json:"domain,omitempty"`
	ID              string `json:"id"`
	Protocol        string `json:"protocol"`
	State           string `json:"state"`
	Direction       string `json:"direction"`
	Source          string `json:"source"`
	Destination     string `json:"destination"`
	SourcePort      string `json:"source_port"`
	DestinationPort string `json:"destination_port"`
	MAC             string `json:"mac,omitempty"`
	Hostname        string `json:"hostname,omitempty"`
	Bytes           uint64 `json:"bytes"`
	Packets         uint64 `json:"packets"`
	Up              uint64 `json:"-"`
	Down            uint64 `json:"-"`
	Accounted       bool   `json:"accounted"`
}
type Counter struct {
	Up   uint64
	Down uint64
}
type Cache struct {
	At    float64
	Flows map[string]Counter
}
type Result struct {
	RefreshSeconds int      `json:"refresh_seconds"`
	RatesLimited   bool     `json:"rates_limited"`
	Success        bool     `json:"success"`
	Error          string   `json:"error,omitempty"`
	Timestamp      float64  `json:"timestamp"`
	Flows          []Flow   `json:"flows"`
	Total          int      `json:"total"`
	Limited        bool     `json:"limited"`
	Accounting     bool     `json:"accounting"`
	Bytes          uint64   `json:"bytes"`
	Packets        uint64   `json:"packets"`
	Upload         *float64 `json:"upload"`
	Download       *float64 `json:"download"`
	DurationMS     float64  `json:"duration_ms"`
}

func number(s string) uint64 { n, _ := strconv.ParseUint(s, 10, 64); return n }

// The proc format repeats tuple/counter keys for original and reply directions.
func parse(line string) (Flow, Tuple, Tuple, bool) {
	fields := strings.Fields(line)
	if len(fields) < 6 {
		return Flow{}, Tuple{}, Tuple{}, false
	}
	f := Flow{Protocol: fields[2]}
	tuples := [2]Tuple{}
	bytes := [2]uint64{}
	packets := [2]uint64{}
	have := [2]bool{}
	side := -1
	zone := "0"
	// Offloaded proc records omit the normal timeout/state fields. Find tuples
	// by key rather than assuming fixed column offsets after the protocol.
	for _, v := range fields[4:] {
		if v == "[HW_OFFLOAD]" {
			f.Acceleration = "hardware"
		}
		if v == "[OFFLOAD]" && f.Acceleration == "" {
			f.Acceleration = "software"
		}
		kv := strings.SplitN(v, "=", 2)
		if len(kv) != 2 {
			if !strings.HasPrefix(v, "[") && side < 0 && strings.ContainsAny(v, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
				f.State = v
			}
			continue
		}
		k, x := kv[0], kv[1]
		if k == "src" {
			side++
			if side > 1 {
				break
			}
		}
		if k == "zone" {
			zone = x
		}
		if side < 0 || side > 1 {
			continue
		}
		t := &tuples[side]
		switch k {
		case "src":
			t.Src = x
		case "dst":
			t.Dst = x
		case "sport":
			t.Sport = x
		case "dport":
			t.Dport = x
		case "type":
			t.Sport = x
		case "code":
			t.Dport = x
		case "id":
			t.Sport += "/" + x
		case "bytes":
			bytes[side] = number(x)
			have[side] = true
		case "packets":
			packets[side] = number(x)
		}
	}
	a, b := tuples[0], tuples[1]
	if net.ParseIP(a.Src) == nil || net.ParseIP(a.Dst) == nil || net.ParseIP(b.Src) == nil {
		return f, a, b, false
	}
	f.ID = strings.Join([]string{fields[0], f.Protocol, a.Src, a.Dst, a.Sport, a.Dport, zone}, "|")
	f.Source = a.Src
	f.Destination = a.Dst
	f.SourcePort = a.Sport
	f.DestinationPort = a.Dport
	f.Up = bytes[0]
	f.Down = bytes[1]
	f.Bytes = bytes[0] + bytes[1]
	f.Packets = packets[0] + packets[1]
	f.Accounted = have[0] && have[1]
	return f, a, b, true
}

type Networks struct {
	Local map[string]bool
	LAN   []*net.IPNet
}

func networks() Networks {
	n := Networks{Local: map[string]bool{}}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		as, _ := i.Addrs()
		for _, a := range as {
			ip, sub, e := net.ParseCIDR(a.String())
			if e != nil {
				continue
			}
			n.Local[ip.String()] = true
			// OpenWrt LAN and user VLAN bridges; WAN interfaces are deliberately excluded.
			if strings.HasPrefix(i.Name, "br-") {
				n.LAN = append(n.LAN, sub)
			}
		}
	}
	return n
}
func (n Networks) lan(ip string) bool {
	p := net.ParseIP(ip)
	for _, s := range n.LAN {
		if s.Contains(p) {
			return true
		}
	}
	return false
}
func classify(f *Flow, a, b Tuple, n Networks) {
	a.Src = net.ParseIP(a.Src).String()
	a.Dst = net.ParseIP(a.Dst).String()
	b.Src = net.ParseIP(b.Src).String()
	switch {
	case n.Local[a.Src]:
		f.Direction = "Router"
	case n.lan(a.Src) && n.lan(a.Dst):
		f.Direction = "Local"
	case n.lan(a.Src):
		f.Direction = "Outbound"
	case n.lan(b.Src) && !n.Local[b.Src]:
		f.Direction = "Inbound"
		f.Destination = b.Src
		f.DestinationPort = b.Sport
		f.Up, f.Down = f.Down, f.Up
	case n.Local[a.Dst]:
		f.Direction = "Router"
		f.Up, f.Down = f.Down, f.Up
	default:
		f.Direction = "Other"
	}
}

type Host struct{ MAC, Name string }

func hosts() map[string]Host {
	out := map[string]Host{}
	b, _ := os.ReadFile("/tmp/dhcp.leases")
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) >= 4 {
			h := Host{MAC: strings.ToUpper(f[1]), Name: f[3]}
			if h.Name == "*" {
				h.Name = ""
			}
			out[f[2]] = h
		}
	}
	b, _ = os.ReadFile("/proc/net/arp")
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) >= 4 && f[3] != "00:00:00:00:00:00" {
			h := out[f[0]]
			h.MAC = strings.ToUpper(f[3])
			out[f[0]] = h
		}
	}
	// Neighbor cache supplies IPv6 MACs without triggering discovery traffic.
	b, _ = os.ReadFile("/tmp/hosts/odhcpd")
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "#") {
			continue
		}
		f := strings.Fields(l)
		if len(f) > 1 && net.ParseIP(f[0]) != nil {
			h := out[f[0]]
			h.Name = f[1]
			out[f[0]] = h
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	b, _ = exec.CommandContext(ctx, "/usr/bin/ip", "-6", "neigh", "show").Output()
	byMAC := map[string]string{}
	for _, h := range out {
		if h.MAC != "" && h.Name != "" {
			byMAC[h.MAC] = h.Name
		}
	}
	for _, l := range strings.Split(string(b), "\n") {
		f := strings.Fields(l)
		if len(f) < 5 {
			continue
		}
		ip := net.ParseIP(f[0])
		if ip == nil {
			continue
		}
		for i := 1; i+1 < len(f); i++ {
			if f[i] == "lladdr" {
				mac := strings.ToUpper(f[i+1])
				out[ip.String()] = Host{MAC: mac, Name: byMAC[mac]}
				break
			}
		}
	}
	return out
}
func sample(proc string, n Networks, known map[string]Host, prev Cache, now float64) (Result, Cache) {
	started := time.Now()
	r := Result{Success: true, Timestamp: now, Flows: []Flow{}, Accounting: true}
	next := Cache{At: now, Flows: map[string]Counter{}}
	file, e := os.Open(proc)
	if e != nil {
		r.Success = false
		r.Error = "Connection counters are unavailable."
		return r, next
	}
	defer file.Close()
	scan := bufio.NewScanner(file)
	scan.Buffer(make([]byte, 4096), 16384)
	var du, dd uint64
	top := flowHeap{}
	for scan.Scan() {
		f, a, b, ok := parse(scan.Text())
		if !ok {
			continue
		}
		classify(&f, a, b, n)
		client := f.Source
		if f.Direction == "Inbound" {
			client = f.Destination
		}
		h := known[net.ParseIP(client).String()]
		f.MAC = h.MAC
		f.Hostname = h.Name
		r.Total++
		r.Bytes += f.Bytes
		r.Packets += f.Packets
		r.Accounting = r.Accounting && f.Accounted
		if len(next.Flows) < 16384 {
			next.Flows[f.ID] = Counter{f.Up, f.Down}
		}
		if old, ok := prev.Flows[f.ID]; ok && f.Up >= old.Up && f.Down >= old.Down && (f.Direction == "Outbound" || f.Direction == "Inbound") {
			du += f.Up - old.Up
			dd += f.Down - old.Down
		}
		if len(top) < 1000 {
			heap.Push(&top, f)
		} else if f.Bytes > top[0].Bytes {
			top[0] = f
			heap.Fix(&top, 0)
		}
		if r.Total%64 == 0 && time.Since(started) > 200*time.Millisecond {
			r.Success = false
			r.Error = "The router is busy. Monitoring is backing off for 30 seconds."
			break
		}
	}
	if scan.Err() != nil {
		r.Success = false
		r.Error = "Could not read all connection counters."
	}
	elapsed := now - prev.At
	r.RatesLimited = r.Total > 16384 || len(prev.Flows) >= 16384
	if prev.At > 0 && elapsed >= 0.5 && elapsed <= 15 && r.Accounting && !r.RatesLimited && r.Success {
		u, d := float64(du)/elapsed, float64(dd)/elapsed
		r.Upload = &u
		r.Download = &d
	}
	r.Flows = []Flow(top)
	sort.Slice(r.Flows, func(i, j int) bool {
		if r.Flows[i].Bytes == r.Flows[j].Bytes {
			return r.Flows[i].ID < r.Flows[j].ID
		}
		return r.Flows[i].Bytes > r.Flows[j].Bytes
	})
	r.Limited = r.Total > len(r.Flows)
	r.DurationMS = float64(time.Since(started).Microseconds()) / 1000
	return r, next
}

// Retain only the largest 1,000 display rows, regardless of conntrack table size.
type flowHeap []Flow

func (h flowHeap) Len() int            { return len(h) }
func (h flowHeap) Less(i, j int) bool  { return h[i].Bytes < h[j].Bytes }
func (h flowHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *flowHeap) Push(v interface{}) { *h = append(*h, v.(Flow)) }
func (h *flowHeap) Pop() interface{}   { a := *h; v := a[len(a)-1]; *h = a[:len(a)-1]; return v }
