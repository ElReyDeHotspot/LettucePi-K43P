package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const runtimeDir = "/tmp/chester-scan"
const maxCommandOutput = 262144
const fullScanSeconds = 300

var nameRE = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$`)
var portRE = regexp.MustCompile(`^/dev/(mhi_DUN|ttyUSB[0-9]+|ttyACM[0-9]+)$`)

type Cell struct {
	BandSource string   `json:"band_source,omitempty"`
	RAT        string   `json:"rat"`
	Band       string   `json:"band,omitempty"`
	ARFCN      string   `json:"arfcn"`
	PCI        string   `json:"pci"`
	MCC        string   `json:"mcc,omitempty"`
	MNC        string   `json:"mnc,omitempty"`
	Provider   string   `json:"provider"`
	CellID     string   `json:"cell_id,omitempty"`
	TAC        string   `json:"tac,omitempty"`
	ENB        string   `json:"enb,omitempty"`
	RSRP       *float64 `json:"rsrp,omitempty"`
	RSRQ       *float64 `json:"rsrq,omitempty"`
	SINR       *float64 `json:"sinr,omitempty"`
	Source     string   `json:"source"`
}
type Result struct {
	Modem     string            `json:"modem"`
	Mode      string            `json:"mode"`
	Timestamp int64             `json:"timestamp"`
	Cells     []Cell            `json:"cells"`
	Raw       map[string]string `json:"raw"`
	Notes     []string          `json:"notes"`
	Supported []string          `json:"supported"`
}
type State struct {
	Elapsed int64   `json:"elapsed"`
	Running bool    `json:"running"`
	PID     int     `json:"pid"`
	Started int64   `json:"started"`
	Modem   string  `json:"modem"`
	Mode    string  `json:"mode"`
	Phase   string  `json:"phase"`
	Message string  `json:"message"`
	Result  *Result `json:"result,omitempty"`
}

func output(v any) { json.NewEncoder(os.Stdout).Encode(v) }
func atomicState(s State) {
	b, _ := json.Marshal(s)
	if os.WriteFile(runtimeDir+"/state.tmp", b, 0600) == nil {
		os.Rename(runtimeDir+"/state.tmp", runtimeDir+"/state.json")
	}
}
func readState() State {
	var s State
	b, _ := os.ReadFile(runtimeDir + "/state.json")
	json.Unmarshal(b, &s)
	return s
}
func alive(pid int) bool {
	if pid <= 1 {
		return false
	}
	b, e := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	return e == nil && bytes.Contains(b, []byte("chester-scan")) && syscall.Kill(pid, 0) == nil
}
func cleanupSIMLock(pid int) {
	b, _ := os.ReadFile("/tmp/chester-sim.lock/scan.pid")
	if strings.TrimSpace(string(b)) == strconv.Itoa(pid) {
		os.Remove("/tmp/chester-sim.lock/scan.pid")
		os.Remove("/tmp/chester-sim.lock")
	}
}
func status() State {
	s := readState()
	if s.Result != nil {
		s.Result.Cells = parse(s.Result.Raw)
	}
	if s.Running {
		s.Elapsed = time.Now().Unix() - s.Started
		if s.Elapsed < 0 {
			s.Elapsed = 0
		}
	}
	if s.Running && !alive(s.PID) && time.Now().Unix()-s.Started > 5 {
		s.Running = false
		s.Phase = "failed"
		s.Message = "The scan was interrupted. Your previous completed results are still available."
		cleanupSIMLock(s.PID)
		atomicState(s)
	}
	return s
}
func run(seconds int, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, name, args...)
	var out cappedBuffer
	c.Stdout = &out
	c.Stderr = &out
	err := c.Run()
	if ctx.Err() != nil {
		return out.String(), errors.New("modem response timed out")
	}
	return out.String(), err
}

type cappedBuffer struct{ bytes.Buffer }

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if left := maxCommandOutput - b.Len(); left > 0 {
		if len(p) > left {
			p = p[:left]
		}
		b.Buffer.Write(p)
	}
	return n, nil
}
func uci(key string) string { v, _ := run(3, "uci", "-q", "get", key); return strings.TrimSpace(v) }
func validMode(mode string) bool {
	return mode == "nearby" || mode == "lte" || mode == "nr" || mode == "all"
}
func modemPort(modem string) (string, error) {
	if !nameRE.MatchString(modem) || uci("qmodem."+modem) != "modem-device" {
		return "", errors.New("Choose a configured modem")
	}
	if strings.ToLower(uci("qmodem."+modem+".manufacturer")) != "quectel" {
		return "", errors.New("This scanner currently supports Quectel modems")
	}
	p := uci("qmodem." + modem + ".at_port")
	if !portRE.MatchString(p) {
		return "", errors.New("The configured AT port is unavailable")
	}
	return p, nil
}
func at(port, command string, seconds int) (string, error) {
	key := regexp.MustCompile(`[^A-Za-z0-9_]`).ReplaceAllString(port, "_")
	f, e := os.OpenFile("/var/lock/qmodem-at-"+key+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return "", e
	}
	defer f.Close()
	deadline := time.Now().Add(10 * time.Second)
	for syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		if time.Now().After(deadline) {
			return "", errors.New("The modem is busy. Try again shortly")
		}
		time.Sleep(100 * time.Millisecond)
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	var text string
	var err error
	if strings.HasPrefix(command, "AT+QSCAN=") && command != "AT+QSCAN=?" {
		// Preserve the daemon's timeout/partial-response fields. tom_modem's
		// UBUS wrapper prints only successful response text and loses these.
		send := func(cmd string, timeout int) (string, error) {
			request, _ := json.Marshal(map[string]any{"at_port": port, "at_cmd": cmd, "timeout": timeout})
			reply, e := run(timeout+5, "ubus", "-S", "-t", strconv.Itoa(timeout+3), "call", "at-daemon", "sendat", string(request))
			if e != nil {
				return "", e
			}
			return scanReply(reply)
		}
		// As in QManager, prove the channel responsive immediately before a
		// long command, under the same shared AT lock as the scan itself.
		warm, e := send("AT", 3)
		if e != nil || !regexp.MustCompile(`(?m)(^|[\r\n])OK(?:[\r\n]|$)`).MatchString(warm) {
			return warm, errors.New("The modem AT channel is not ready for a full scan")
		}
		text, err = send(command, seconds)
		if err != nil {
			// Consume a late response and check channel health before releasing
			// the AT lock. Do not retry a timed-out scan automatically.
			if _, recovery := send("AT", 3); recovery != nil {
				err = fmt.Errorf("%w; AT channel recovery is pending", err)
			}
		}
	} else {
		text, err = run(seconds+5, "tom_modem", "-u", "-d", port, "-o", "a", "-t", strconv.Itoa(seconds), "-c", command)
	}
	if regexp.MustCompile(`(?m)(^|[\r\n])(?:\+CM[ES] ERROR[^\r\n]*|ERROR)(?:[\r\n]|$)`).MatchString(text) {
		return text, errors.New("The modem rejected this command")
	}
	if err != nil {
		return text, err
	}
	if !regexp.MustCompile(`(?m)(^|[\r\n])OK(?:[\r\n]|$)`).MatchString(text) {
		return text, errors.New("The modem did not return a complete response")
	}
	return text, nil
}
func scanReply(reply string) (string, error) {
	var response struct {
		Status   string `json:"status"`
		Response string `json:"response"`
		Partial  string `json:"partial_response"`
		Message  string `json:"message"`
	}
	if err := json.Unmarshal([]byte(reply), &response); err != nil {
		return "", errors.New("Could not decode the modem scan response")
	}
	text := response.Response
	if text == "" {
		text = response.Partial
	}
	if response.Status != "success" {
		message := response.Message
		if message == "" {
			message = "The modem did not complete the scan"
		}
		return text, errors.New(message)
	}
	return text, nil
}

// Some firmware returns only the enable flag until NR measurement reporting
// is enabled. Use it for this snapshot only, preserving the original setting.
func nrMeasurementState(text string) (string, bool) {
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "+QNWCFG:") {
			continue
		}
		v := fields(strings.TrimPrefix(line, "+QNWCFG:"))
		if get(v, 0) == "nr5g_meas_info" && (get(v, 1) == "0" || get(v, 1) == "1") {
			return v[1], true
		}
	}
	return "", false
}
func nrMeasurements(query func(string, int) (string, error), pause func(time.Duration)) (text string, err error) {
	const command = `AT+QNWCFG="nr5g_meas_info"`
	text, err = query(command, 5)
	if err != nil {
		return text, err
	}
	state, known := nrMeasurementState(text)
	if !known {
		return text, errors.New("NR neighbour measurements are not supported by this firmware")
	}
	if state == "1" {
		return text, nil
	}
	// Restore even if enabling times out: the modem may still have applied it.
	defer func() {
		if _, e := query(command+",0", 5); e != nil {
			err = errors.Join(err, fmt.Errorf("Could not restore NR measurement setting: %w", e))
		}
	}()
	if _, err = query(command+",1", 5); err != nil {
		return text, err
	}
	pause(time.Second)
	return query(command, 5)
}
func fields(line string) []string {
	r := csv.NewReader(strings.NewReader(strings.TrimSpace(line)))
	r.TrimLeadingSpace = true
	r.FieldsPerRecord = -1
	v, e := r.Read()
	if e != nil {
		return nil
	}
	for i := range v {
		v[i] = strings.TrimSpace(v[i])
	}
	return v
}
func number(v string, lo, hi float64) *float64 {
	n, e := strconv.ParseFloat(v, 64)
	if e != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < lo || n > hi {
		return nil
	}
	return &n
}
func get(v []string, i int) string {
	if i < 0 || i >= len(v) || v[i] == "-" || v[i] == "" {
		return ""
	}
	return v[i]
}
func provider(mcc, mnc string) string {
	// Network owner labels; MVNO branding is not broadcast by these commands.
	names := map[string]string{"310260": "T-Mobile", "310240": "T-Mobile", "310410": "AT&T", "311480": "Verizon", "311490": "T-Mobile", "313100": "AT&T FirstNet", "313340": "DISH", "313350": "DISH", "313360": "DISH", "311580": "U.S. Cellular"}
	if mcc == "" || mnc == "" {
		return "Not reported"
	}
	if n := names[mcc+mnc]; n != "" {
		return n
	}
	return "Network " + mcc + "-" + mnc
}
func cell(rat string, v []string, freq, pci int, source string) (Cell, bool) {
	c := Cell{RAT: rat, ARFCN: get(v, freq), PCI: get(v, pci), Source: source, Provider: "Not reported"}
	max := 503.
	if rat == "5G" {
		max = 1007
	}
	return c, regexp.MustCompile(`^[0-9]+$`).MatchString(c.ARFCN) && regexp.MustCompile(`^[0-9]+$`).MatchString(c.PCI) && number(c.ARFCN, 0, 3279165) != nil && number(c.PCI, 0, max) != nil
}
func plmn(c *Cell, mcc, mnc string) {
	if regexp.MustCompile(`^[0-9]{3}$`).MatchString(mcc) && regexp.MustCompile(`^[0-9]{2,3}$`).MatchString(mnc) {
		c.MCC = mcc
		c.MNC = mnc
		c.Provider = provider(mcc, mnc)
	}
}
func band(c *Cell, n string) {
	if number(n, 1, 1024) == nil {
		return
	}
	prefix := "B"
	if c.RAT == "5G" {
		prefix = "n"
	}
	c.Band = prefix + n
}
func identity(c *Cell, id, tac string) {
	hex := regexp.MustCompile(`^[0-9A-Fa-f]{1,10}$`)
	if hex.MatchString(id) {
		c.CellID = strings.ToUpper(id)
		if c.RAT == "LTE" {
			if n, e := strconv.ParseUint(id, 16, 32); e == nil {
				c.ENB = strconv.FormatUint(n>>8, 10)
			}
		}
	}
	if hex.MatchString(tac) {
		c.TAC = strings.ToUpper(tac)
	}
}

// ETSI TS 136 101 table 5.7.3-1. Restricted to verified, disjoint downlink ranges.
func lteBand(channel string) string {
	n, e := strconv.Atoi(channel)
	if e != nil {
		return ""
	}
	if n >= 66436 && n <= 67335 {
		return "B66"
	}
	for _, r := range [][3]int{{1, 0, 599}, {2, 600, 1199}, {3, 1200, 1949}, {4, 1950, 2399}, {5, 2400, 2649}, {7, 2750, 3449}, {8, 3450, 3799}, {12, 5010, 5179}, {13, 5180, 5279}, {14, 5280, 5379}, {17, 5730, 5849}, {20, 6150, 6449}, {25, 8040, 8689}, {26, 8690, 9039}, {28, 9210, 9659}, {29, 9660, 9769}, {30, 9770, 9869}, {38, 37750, 38249}, {40, 38650, 39649}, {41, 39650, 41589}, {48, 55240, 56739}} {
		if n >= r[1] && n <= r[2] {
			return "B" + strconv.Itoa(r[0])
		}
	}
	return ""
}
func parse(raw map[string]string) []Cell {
	out := []Cell{}
	for _, kind := range []string{"serving", "carriers", "neighbors", "nr_neighbors", "scan"} {
		if raw["scan"] != "" && kind != "scan" {
			continue
		}
		for _, line := range strings.Split(strings.ReplaceAll(raw[kind], "\r", "\n"), "\n") {
			line = strings.TrimSpace(line)
			idx := strings.Index(line, ":")
			if idx < 0 || (!strings.HasPrefix(line, "+QENG:") && !strings.HasPrefix(line, "+QCAINFO:") && !strings.HasPrefix(line, "+QSCAN:") && !(kind == "nr_neighbors" && strings.HasPrefix(line, "+QNWCFG:"))) {
				continue
			}
			v := fields(line[idx+1:])
			if len(v) < 2 {
				continue
			}
			var c Cell
			var ok bool
			switch kind {
			case "nr_neighbors":
				if v[0] != "nr5g_meas_info" || get(v, 1) != "1" {
					continue
				}
				c, ok = cell("5G", v, 2, 3, "Neighbor")
				if !ok {
					continue
				}
				c.RSRP = number(get(v, 4), -160, -20)
				c.RSRQ = number(get(v, 5), -50, 0)
				c.SINR = number(get(v, 6), -30, 100)
			case "scan":
				rat := "LTE"
				if v[0] == "NR5G" {
					rat = "5G"
				} else if v[0] != "LTE" {
					continue
				}
				c, ok = cell(rat, v, 3, 4, "Detected")
				if !ok {
					continue
				}
				plmn(&c, get(v, 1), get(v, 2))
				c.RSRP = number(get(v, 5), -160, -20)
				c.RSRQ = number(get(v, 6), -50, 0)
				identity(&c, get(v, 9), get(v, 10))
				band(&c, get(v, 12))
			case "neighbors":
				if !strings.HasPrefix(v[0], "neighbourcell") || v[1] != "LTE" {
					continue
				}
				c, ok = cell("LTE", v, 2, 3, "Neighbor")
				if !ok {
					continue
				}
				a, b := 4, 5
				if v[0] == "neighbourcell" {
					a, b = 5, 4
				}
				c.RSRQ = number(get(v, a), -50, 0)
				c.RSRP = number(get(v, b), -160, -20)
				if v[0] != "neighbourcell" {
					c.SINR = number(get(v, 7), -30, 100)
				}
			case "serving":
				if v[0] == "servingcell" {
					if len(v) < 3 {
						continue
					}
					v = v[2:]
				}
				if len(v) < 2 {
					continue
				}
				if v[0] == "LTE" {
					c, ok = cell("LTE", v, 6, 5, "Serving")
					if !ok {
						continue
					}
					plmn(&c, get(v, 2), get(v, 3))
					band(&c, get(v, 7))
					identity(&c, get(v, 4), get(v, 10))
					c.RSRP = number(get(v, 11), -160, -20)
					c.RSRQ = number(get(v, 12), -50, 0)
					c.SINR = number(get(v, 14), -30, 100)
				} else if v[0] == "NR5G-NSA" {
					c, ok = cell("5G", v, 7, 3, "Serving")
					if !ok {
						continue
					}
					plmn(&c, get(v, 1), get(v, 2))
					band(&c, get(v, 8))
					c.RSRP = number(get(v, 4), -160, -20)
					c.RSRQ = number(get(v, 6), -50, 0)
					c.SINR = number(get(v, 5), -30, 100)
				} else if v[0] == "NR5G-SA" {
					c, ok = cell("5G", v, 7, 5, "Serving")
					if !ok {
						continue
					}
					plmn(&c, get(v, 2), get(v, 3))
					band(&c, get(v, 8))
					identity(&c, get(v, 4), get(v, 6))
					c.RSRP = number(get(v, 10), -160, -20)
					c.RSRQ = number(get(v, 11), -50, 0)
					c.SINR = number(get(v, 12), -30, 100)
				} else {
					continue
				}
			case "carriers":
				if v[0] != "PCC" && v[0] != "SCC" {
					continue
				}
				rat := "LTE"
				if strings.Contains(get(v, 3), "NR5G") {
					rat = "5G"
				}
				pci := 5
				if rat == "5G" && len(v) == 5 {
					pci = 4
				}
				c, ok = cell(rat, v, 1, pci, v[0])
				if !ok {
					continue
				}
				b := regexp.MustCompile(`BAND ([0-9]+)`).FindStringSubmatch(get(v, 3))
				if len(b) == 2 {
					band(&c, b[1])
				}
				if rat == "LTE" {
					c.RSRP = number(get(v, 6), -160, -20)
					c.RSRQ = number(get(v, 7), -50, 0)
					c.SINR = number(get(v, 9), -30, 100)
				}
			}
			if c.RAT == "LTE" {
				if derived := lteBand(c.ARFCN); derived != "" && c.Band != derived {
					c.BandSource = "LTE channel table"
					if c.Band != "" {
						c.BandSource += "; modem reported " + c.Band
					}
					c.Band = derived
				}
			}
			out = append(out, c)
		}
	}
	// Enrich exact channel/PCI matches only; do not assign a provider by frequency.
	merged := []Cell{}
	for _, c := range out {
		found := -1
		for i, x := range merged {
			if x.RAT == c.RAT && x.ARFCN == c.ARFCN && x.PCI == c.PCI && (x.MCC == "" || c.MCC == "" || x.MCC == c.MCC && x.MNC == c.MNC) {
				found = i
				break
			}
		}
		if found < 0 {
			merged = append(merged, c)
			continue
		}
		x := &merged[found]
		if x.Band == "" {
			x.Band = c.Band
			x.BandSource = c.BandSource
		}
		if x.MCC == "" && c.MCC != "" {
			plmn(x, c.MCC, c.MNC)
		}
		if x.RSRP == nil {
			x.RSRP = c.RSRP
		}
		if x.RSRQ == nil {
			x.RSRQ = c.RSRQ
		}
		if x.SINR == nil {
			x.SINR = c.SINR
		}
		if !strings.Contains(x.Source, c.Source) {
			x.Source += " · " + c.Source
		}
	}
	sort.SliceStable(merged, func(i, j int) bool {
		a, b := merged[i].RSRP, merged[j].RSRP
		if a == nil {
			return false
		}
		return b == nil || *a > *b
	})
	return merged
}
func supported(raw string) []string {
	out := []string{}
	m := regexp.MustCompile(`\+QSCAN:\s*\(([^)]*)\)`).FindStringSubmatch(raw)
	if len(m) < 2 {
		return out
	}
	for _, p := range strings.Split(m[1], ",") {
		n := strings.Split(strings.TrimSpace(p), "-")
		a, _ := strconv.Atoi(n[0])
		b := a
		if len(n) == 2 {
			b, _ = strconv.Atoi(n[1])
		}
		if a < 1 || b > 4 || b < a {
			continue
		}
		for k := a; k <= b; k++ {
			if k <= 3 {
				out = append(out, map[int]string{1: "lte", 2: "nr", 3: "all"}[k])
			}
		}
	}
	return out
}
func contains(a []string, v string) bool {
	for _, x := range a {
		if x == v {
			return true
		}
	}
	return false
}
func worker(modem, mode string) {
	inherited := os.NewFile(3, "scan-lock")
	if inherited != nil {
		defer inherited.Close()
	}
	s := readState()
	s.Running = true
	s.PID = os.Getpid()
	s.Modem = modem
	s.Mode = mode
	s.Phase = "running"
	s.Message = "Reading serving cells, carriers and nearby cells…"
	atomicState(s)
	defer func() {
		s.Running = false
		s.Elapsed = time.Now().Unix() - s.Started
		cleanupSIMLock(os.Getpid())
		atomicState(s)
	}()
	fail := func(e error) { s.Phase = "failed"; s.Message = e.Error() }
	if e := os.Mkdir("/tmp/chester-sim.lock", 0700); e != nil {
		fail(errors.New("A SIM operation is running. Wait for it to finish"))
		return
	}
	os.WriteFile("/tmp/chester-sim.lock/scan.pid", []byte(strconv.Itoa(os.Getpid())), 0600)
	if _, e := os.Stat("/tmp/chester-link-test.lock"); e == nil {
		fail(errors.New("Wait for the current speed test to finish"))
		return
	}
	port, e := modemPort(modem)
	if e != nil {
		fail(e)
		return
	}
	result := &Result{Modem: modem, Mode: mode, Raw: map[string]string{}, Cells: []Cell{}, Notes: []string{}, Supported: []string{}}
	capText, capErr := at(port, "AT+QSCAN=?", 5)
	result.Raw["capability"] = capText
	if capErr == nil {
		result.Supported = supported(capText)
	}
	cmds := [][2]string{{"serving", `AT+QENG="servingcell"`}, {"carriers", "AT+QCAINFO"}, {"neighbors", `AT+QENG="neighbourcell"`}}
	failedNearby := 0
	for _, cmd := range cmds {
		text, e := at(port, cmd[1], 5)
		result.Raw[cmd[0]] = text
		if e != nil {
			failedNearby++
			result.Notes = append(result.Notes, cmd[0]+": "+e.Error())
		}
	}
	if mode == "nearby" {
		text, e := nrMeasurements(func(command string, seconds int) (string, error) { return at(port, command, seconds) }, time.Sleep)
		result.Raw["nr_neighbors"] = text
		if e != nil {
			result.Notes = append(result.Notes, "5G neighbors: "+e.Error())
		}
	}
	if mode != "nearby" {
		if !contains(result.Supported, mode) {
			fail(errors.New("This modem did not confirm support for the selected full scan. Use nearby refresh instead"))
			return
		}
		s.Message = "Scanning nearby networks. Allow up to 5 minutes; closing this page does not stop the scan."
		atomicState(s)
		cmd := "AT+QSCAN=" + map[string]string{"lte": "1", "nr": "2", "all": "3"}[mode]
		command := cmd + ",1"
		text, e := at(port, command, fullScanSeconds)
		result.Raw["scan"] = text
		if e != nil && strings.Contains(e.Error(), "rejected") {
			command = cmd
			text, e = at(port, command, fullScanSeconds)
			result.Raw["scan"] = text
		}
		// Keep the actual attempt available even if automatic Nearby recovery
		// replaces the current UI result. This contains no firmware settings.
		errorText := ""
		if e != nil {
			errorText = e.Error()
		}
		attempt, _ := json.Marshal(map[string]any{"command": command, "timestamp": time.Now().Unix(), "raw": text, "error": errorText})
		os.WriteFile(runtimeDir+"/last-full-attempt.json", attempt, 0600)
		if e != nil {
			fail(fmt.Errorf("Full scan did not complete: %v. Previous completed results are retained", e))
			return
		}
	}
	result.Cells = parse(result.Raw)
	result.Timestamp = time.Now().Unix()
	if len(result.Cells) == 0 && failedNearby == 3 && mode == "nearby" {
		fail(errors.New("The modem did not return cell information. Check its AT port and try again"))
		return
	}
	result.Notes = append(result.Notes, "Cells are radio sectors, not verified physical tower locations. Neighbors can omit provider, band and cell identity; full scans may not include 5G NSA cells.")
	s.Result = result
	s.Phase = "completed"
	s.Message = fmt.Sprintf("Found %d distinct cells", len(result.Cells))
}
func start(modem, mode, accepted string) {
	if !validMode(mode) {
		output(map[string]any{"success": false, "error": "Choose a valid scan type"})
		return
	}
	if mode != "nearby" && accepted != "1" {
		output(map[string]any{"success": false, "error": "Review the full-scan service notice first"})
		return
	}
	if _, e := modemPort(modem); e != nil {
		output(map[string]any{"success": false, "error": e.Error()})
		return
	}
	f, e := os.OpenFile(runtimeDir+"/lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		output(map[string]any{"success": false, "error": "Could not open scanner lock"})
		return
	}
	defer f.Close()
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		output(map[string]any{"success": false, "error": "A scan is already running"})
		return
	}
	s := status()
	s.Running = true
	s.PID = 0
	s.Started = time.Now().Unix()
	s.Mode = mode
	s.Modem = modem
	s.Phase = "starting"
	s.Message = "Preparing scan…"
	atomicState(s)
	self, _ := os.Executable()
	cmd := exec.Command(self, "worker", modem, mode)
	cmd.ExtraFiles = []*os.File{f}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	log, _ := os.OpenFile(runtimeDir+"/worker.log", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if log != nil {
		defer log.Close()
		cmd.Stdout = log
		cmd.Stderr = log
	}
	if e := cmd.Start(); e != nil {
		s.Running = false
		s.Phase = "failed"
		s.Message = "Could not start scan"
		atomicState(s)
		output(map[string]any{"success": false, "error": s.Message})
		return
	}
	cmd.Process.Release()
	output(map[string]any{"success": true})
}
func main() {
	os.MkdirAll(runtimeDir, 0700)
	d, e := os.Lstat(runtimeDir)
	if e != nil || !d.IsDir() || d.Mode().Perm()&0077 != 0 || d.Sys().(*syscall.Stat_t).Uid != 0 {
		output(map[string]any{"success": false, "error": "Scanner runtime directory is not private"})
		return
	}
	if len(os.Args) == 2 && os.Args[1] == "status" {
		output(status())
		return
	}
	if len(os.Args) == 5 && os.Args[1] == "start" {
		start(os.Args[2], os.Args[3], os.Args[4])
		return
	}
	if len(os.Args) == 4 && os.Args[1] == "worker" && validMode(os.Args[3]) && nameRE.MatchString(os.Args[2]) {
		worker(os.Args[2], os.Args[3])
		return
	}
	io.WriteString(os.Stderr, "usage: chester-scan status | start MODEM nearby|lte|nr|all ACCEPTED\n")
	os.Exit(2)
}
