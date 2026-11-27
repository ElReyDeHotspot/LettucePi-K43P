package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const guardDir = "/etc/chester-traffic"

type feedState struct {
	Entries int    `json:"entries"`
	Updated int64  `json:"updated"`
	Error   string `json:"error,omitempty"`
}
type guard struct {
	mu            sync.Mutex
	config        GuardConfig
	lists         map[string][]string
	feeds         map[string]feedState
	policy        atomic.Pointer[compiledPolicy]
	updating      bool
	forceUpdate   atomic.Bool
	lastError     string
	appliedScript string
	cleared       int
	pending       chan struct{}
	blocked       atomic.Uint64
	hits          sync.Map
	dnsMu         sync.Mutex
	dns           *guardDNS
}

var protection *guard

func newGuard() *guard {
	g := &guard{lists: map[string][]string{}, feeds: map[string]feedState{}, pending: make(chan struct{}, 1)}
	b, _ := os.ReadFile(guardDir + "/config.json")
	if json.Unmarshal(b, &g.config) != nil || validateConfig(&g.config) != nil {
		g.config = GuardConfig{}
	}
	g.lists = g.cachedLists(g.config)
	g.policy.Store(compilePolicy(g.config, g.lists))
	return g
}
func (g *guard) start() {
	if !g.config.Enabled {
		if e := applyNFT(g.policy.Load()); e != nil {
			g.lastError = e.Error()
		}
	}
	if g.config.Enabled {
		if e := g.startDNS(); e != nil {
			g.lastError = e.Error()
		} else if e = applyNFT(g.policy.Load()); e != nil {
			g.lastError = e.Error()
		} else if n, e := clearBlockedFlows(g.policy.Load()); e != nil {
			g.lastError = e.Error()
		} else {
			g.cleared = n
		}
	}
	if g.lastError == "" {
		g.appliedScript = nftPolicy(g.policy.Load(), bridgeNames())
	}
	go g.worker()
	if g.config.Enabled {
		g.queueUpdate()
	}
}
func (g *guard) queueUpdate() {
	select {
	case g.pending <- struct{}{}:
	default:
	}
}
func (g *guard) status() map[string]interface{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	feedCopy := map[string]feedState{}
	for id, state := range g.feeds {
		feedCopy[id] = state
	}
	counts := map[string]uint64{}
	g.hits.Range(func(k, v interface{}) bool { counts[k.(string)] = v.(*atomic.Uint64).Load(); return true })
	return map[string]interface{}{"success": true, "config": g.config, "categories": categories, "feeds": feedCopy, "updating": g.updating, "error": g.lastError, "blocked_dns": g.blocked.Load(), "hits": counts, "cleared_connections": g.cleared, "dns_ready": g.dns != nil, "acceleration_note": "New blocked flows are dropped before offload. Matching active TCP/UDP connections are deleted through ctnetlink; hardware-offloaded TCP teardown was verified on this router."}
}
func (g *guard) save(c GuardConfig) error {
	if e := validateConfig(&c); e != nil {
		return e
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if c.Revision != g.config.Revision {
		return errors.New("Protection settings changed in another tab. Reload this page before saving.")
	}
	c.Revision++
	old := g.policy.Load()
	candidateLists := g.cachedLists(c)
	candidate := compilePolicy(c, candidateLists)
	started := false
	if c.Enabled && g.dns == nil {
		if e := g.startDNS(); e != nil {
			return e
		}
		started = true
	}
	rollback := func() {
		g.policy.Store(old)
		applyNFT(old)
		if started {
			g.stopDNS()
		}
	}
	if e := applyNFT(candidate); e != nil {
		if started {
			g.stopDNS()
		}
		return e
	}
	g.policy.Store(candidate)
	if c.Enabled {
		n, e := clearBlockedFlows(candidate)
		if e != nil {
			rollback()
			return fmt.Errorf("Rules were not saved because active connections could not be cleared: %w", e)
		}
		g.cleared = n
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	if e := atomicFile(guardDir+"/config.json", b); e != nil {
		rollback()
		return errors.New("Could not save protection settings.")
	}
	g.config = c
	g.lists = candidateLists
	g.appliedScript = nftPolicy(candidate, bridgeNames())
	g.lastError = ""
	if !c.Enabled {
		g.stopDNS()
		time.AfterFunc(time.Second, debug.FreeOSMemory)
	} else {
		g.queueUpdate()
	}
	return nil
}
func atomicFile(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(path+".tmp", path)
}
func categoriesIn(c GuardConfig) map[string]bool {
	out := map[string]bool{}
	if !c.Enabled {
		return out
	}
	for _, id := range c.Categories {
		out[id] = true
	}
	for _, d := range c.Devices {
		if d.Mode == "custom" {
			for _, id := range d.Categories {
				out[id] = true
			}
		}
	}
	return out
}
func (g *guard) usedCategories() map[string]bool { return categoriesIn(g.config) }
func (g *guard) cachedLists(c GuardConfig) map[string][]string {
	out := map[string][]string{}
	wanted := categoriesIn(c)
	total := 0
	for _, cat := range categories {
		if !wanted[cat.ID] {
			continue
		}
		if list, ok := g.lists[cat.ID]; ok {
			out[cat.ID] = list
			total += len(list)
			continue
		}
		f, e := os.Open(guardDir + "/" + cat.ID + ".gz")
		if e != nil {
			continue
		}
		z, e := gzip.NewReader(f)
		if e == nil {
			var list []string
			if json.NewDecoder(io.LimitReader(z, 10*1024*1024)).Decode(&list) == nil && len(list) <= 250000 && total+len(list) <= 400000 {
				if !sort.StringsAreSorted(list) {
					sort.Strings(list)
				}
				out[cat.ID] = list
				total += len(list)
				info, _ := f.Stat()
				g.feeds[cat.ID] = feedState{Entries: len(list), Updated: info.ModTime().Unix()}
			}
			z.Close()
		}
		f.Close()
	}
	return out
}

func parseFeed(reader io.Reader, ipOnly bool) ([]string, error) {
	scanner := bufio.NewScanner(io.LimitReader(reader, 8*1024*1024+1))
	scanner.Buffer(make([]byte, 4096), 65536)
	seen := map[string]bool{}
	bytesRead := 0
	knownIPHeader := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.Contains(strings.ToLower(line), "feodo") {
			knownIPHeader = true
		}
		bytesRead += len(scanner.Bytes()) + 1
		if bytesRead > 8*1024*1024 {
			return nil, errors.New("List exceeds the 8 MB download limit.")
		}
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") || strings.HasPrefix(line, "[") || strings.HasPrefix(line, "@@") {
			continue
		}
		var entry string
		if ipOnly {
			if p, e := prefix(strings.Fields(line)[0]); e == nil && p.Addr().IsGlobalUnicast() && !p.Addr().IsPrivate() {
				entry = p.String()
			}
		} else {
			switch {
			case strings.HasPrefix(line, "||") && strings.HasSuffix(line, "^"):
				entry = domainName(strings.TrimSuffix(strings.TrimPrefix(line, "||"), "^"))
			case strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://"):
				if u, e := url.Parse(line); e == nil {
					entry = domainName(u.Hostname())
				}
			default:
				fields := strings.Fields(line)
				if len(fields) == 1 {
					entry = domainName(fields[0])
				} else if len(fields) > 1 && (fields[0] == "0.0.0.0" || fields[0] == "127.0.0.1") {
					entry = domainName(fields[1])
				}
			}
		}
		if entry != "" {
			seen[entry] = true
		}
		if len(seen) > 250000 {
			return nil, errors.New("List exceeds the 250,000-entry limit.")
		}
	}
	if e := scanner.Err(); e != nil {
		return nil, e
	}
	out := make([]string, 0, len(seen))
	for v := range seen {
		out = append(out, v)
	}
	sort.Strings(out)
	if len(out) == 0 && (!ipOnly || !knownIPHeader) {
		return nil, errors.New("List contained no supported domains; last good copy retained.")
	}
	return out, nil
}
func availableMemory() uint64 {
	b, _ := os.ReadFile("/proc/meminfo")
	for _, line := range strings.Split(string(b), "\n") {
		var kb uint64
		if _, e := fmt.Sscanf(line, "MemAvailable: %d kB", &kb); e == nil {
			return kb * 1024
		}
	}
	return 0
}
func downloadCategory(cat Category) ([]string, error) {
	if n := availableMemory(); n > 0 && n < 128*1024*1024 {
		return nil, errors.New("Update postponed: less than 128 MB of available RAM.")
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || len(via) > 3 {
			return errors.New("List redirect rejected")
		}
		return nil
	}}
	seen := map[string]bool{}
	for _, source := range cat.URLs {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		req, _ := http.NewRequestWithContext(ctx, "GET", source, nil)
		req.Header.Set("User-Agent", "Chester-K45P-Protection/1.0")
		res, e := client.Do(req)
		if e != nil {
			cancel()
			return nil, errors.New("Could not download the list; last good copy retained.")
		}
		if res.StatusCode != 200 {
			res.Body.Close()
			cancel()
			return nil, fmt.Errorf("List server returned HTTP %d; last good copy retained.", res.StatusCode)
		}
		list, e := parseFeed(res.Body, cat.IP)
		res.Body.Close()
		cancel()
		if e != nil {
			return nil, e
		}
		for _, v := range list {
			seen[v] = true
		}
		if len(seen) > 250000 {
			return nil, errors.New("Category exceeds its entry limit.")
		}
	}
	out := make([]string, 0, len(seen))
	for v := range seen {
		out = append(out, v)
	}
	sort.Strings(out)
	return out, nil
}
func (g *guard) update() {
	g.mu.Lock()
	if g.updating {
		g.mu.Unlock()
		return
	}
	used := g.usedCategories()
	generation := g.config.Revision
	g.updating = true
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		g.updating = false
		again := g.config.Enabled && g.config.Revision != generation
		g.mu.Unlock()
		if again {
			g.queueUpdate()
		}
	}()
	force := g.forceUpdate.Swap(false)
	for _, cat := range categories {
		if !used[cat.ID] {
			continue
		}
		g.mu.Lock()
		state := g.feeds[cat.ID]
		stillSelected := g.usedCategories()[cat.ID]
		_, loaded := g.lists[cat.ID]
		g.mu.Unlock()
		if !stillSelected {
			continue
		}
		interval := 8 * time.Hour
		if cat.ID == "botnets" {
			interval = 15 * time.Minute
		}
		if !force && loaded && state.Updated > 0 && time.Since(time.Unix(state.Updated, 0)) < interval {
			continue
		}
		list, e := downloadCategory(cat)
		g.mu.Lock()
		if e != nil {
			state.Error = e.Error()
			g.feeds[cat.ID] = state
			g.mu.Unlock()
			continue
		}
		if !g.usedCategories()[cat.ID] {
			g.mu.Unlock()
			continue
		}
		total := len(list)
		for id, other := range g.lists {
			if id != cat.ID {
				total += len(other)
			}
		}
		if total > 400000 {
			state.Error = "Total list size exceeds the 400,000-entry memory limit; last good copy retained."
			g.feeds[cat.ID] = state
			g.mu.Unlock()
			continue
		}
		candidateLists := map[string][]string{}
		for id, l := range g.lists {
			candidateLists[id] = l
		}
		candidateLists[cat.ID] = list
		candidate := compilePolicy(g.config, candidateLists)
		old := g.policy.Load()
		if cat.IP {
			e = applyNFT(candidate)
			if e == nil {
				_, e = clearBlockedFlows(candidate)
			}
		}
		if e == nil {
			g.policy.Store(candidate)
			g.lists = candidateLists
			if cat.IP {
				g.appliedScript = nftPolicy(candidate, bridgeNames())
			}
			var zipped bytes.Buffer
			z := gzip.NewWriter(&zipped)
			json.NewEncoder(z).Encode(list)
			z.Close()
			if e = atomicFile(guardDir+"/"+cat.ID+".gz", zipped.Bytes()); e != nil {
				state.Error = "Protection is active, but the list cache could not be saved."
			} else {
				state.Error = ""
			}
			state.Entries = len(list)
			state.Updated = time.Now().Unix()
		} else {
			g.policy.Store(old)
			applyNFT(old)
			state.Error = "Could not activate list safely: " + e.Error()
		}
		g.feeds[cat.ID] = state
		g.mu.Unlock()
	}
}
func (g *guard) worker() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	lastCheck := time.Time{}
	lastNetwork := strings.Join(bridgeNames(), "|")
	for {
		select {
		case <-g.pending:
			go g.update()
		case <-ticker.C:
			g.mu.Lock()
			if !g.config.Enabled {
				g.mu.Unlock()
				continue
			}
			p := g.policy.Load()
			network := strings.Join(bridgeNames(), "|")
			script := nftPolicy(p, bridgeNames())
			if script != g.appliedScript || network != lastNetwork {
				if e := applyNFT(p); e != nil {
					g.lastError = e.Error()
				} else {
					if _, e := clearBlockedFlows(p); e != nil {
						g.lastError = e.Error()
					} else {
						g.appliedScript = script
						lastNetwork = network
					}
				}
			}
			g.mu.Unlock()
			if time.Since(lastCheck) > 15*time.Minute {
				lastCheck = time.Now()
				go g.update()
			}
		}
	}
}
func (g *guard) recordBlock(key string) {
	g.blocked.Add(1)
	v, _ := g.hits.LoadOrStore(key, &atomic.Uint64{})
	v.(*atomic.Uint64).Add(1)
}
