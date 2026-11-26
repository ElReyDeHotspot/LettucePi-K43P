package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const journalDir = "/etc/chester-scan"
const journalPath = journalDir + "/recovery.json"

type preference struct{ Query, Value, Set string }
type pausedProcess struct {
	PID     int
	Command string
}
type networkCheck struct {
	Device string `json:"device"`
	IPv4   bool   `json:"ipv4"`
	IPv6   bool   `json:"ipv6"`
}
type recoveryReport struct {
	SettingsRestored bool         `json:"settings_restored"`
	Before           networkCheck `json:"before"`
	After            networkCheck `json:"after"`
	Redial           bool         `json:"data_session_restarted"`
	Message          string       `json:"message"`
}
type scanSession struct {
	Expires                                    int64
	Token                                      string
	Owner                                      int
	Boot, Modem, Port, Interface, Registration string
	Preferences                                []preference
	Checks                                     map[string]string
	ConfigHashes                               string
	Paused                                     []pausedProcess
	Before                                     networkCheck
}

func responseLines(text string) []string {
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && line != "OK" && !strings.HasPrefix(line, "AT") {
			lines = append(lines, line)
		}
	}
	return lines
}
func semantic(text string) string { return strings.Join(responseLines(text), "\n") }
func registrationRestore(text string) (string, error) {
	for _, line := range responseLines(text) {
		if !strings.HasPrefix(line, "+COPS:") {
			continue
		}
		v := fields(strings.TrimPrefix(line, "+COPS:"))
		mode := get(v, 0)
		if mode == "0" || mode == "2" {
			return "AT+COPS=" + mode, nil
		}
		if (mode == "1" || mode == "4") && contains([]string{"0", "1", "2"}, get(v, 1)) && regexp.MustCompile(`^[A-Za-z0-9 ._-]{1,64}$`).MatchString(get(v, 2)) {
			cmd := "AT+COPS=" + mode + "," + v[1] + ",\"" + v[2] + "\""
			if len(v) > 3 {
				if !regexp.MustCompile(`^[0-9]{1,2}$`).MatchString(v[3]) {
					break
				}
				cmd += "," + v[3]
			}
			return cmd, nil
		}
	}
	return "", errors.New("Could not preserve the modem's network selection")
}
func readPreference(query, text string) (preference, error) {
	for _, line := range responseLines(text) {
		if !strings.HasPrefix(line, "+QNWPREFCFG:") {
			continue
		}
		v := fields(strings.TrimPrefix(line, "+QNWPREFCFG:"))
		if len(v) == 2 && query == `AT+QNWPREFCFG="`+v[0]+`"` && regexp.MustCompile(`^[A-Za-z0-9:.-]{1,512}$`).MatchString(v[1]) {
			return preference{Query: query, Value: semantic(text), Set: query + "," + v[1]}, nil
		}
	}
	return preference{}, errors.New("Could not preserve the modem's radio preferences")
}
func privateJournalDir() error {
	if e := os.MkdirAll(journalDir, 0700); e != nil {
		return e
	}
	d, e := os.Lstat(journalDir)
	if e != nil || !d.IsDir() || d.Mode().Perm()&0077 != 0 || d.Sys().(*syscall.Stat_t).Uid != 0 {
		return errors.New("Scan recovery directory is not private")
	}
	return nil
}
func saveSession(j *scanSession) error {
	if e := privateJournalDir(); e != nil {
		return e
	}
	b, e := json.Marshal(j)
	if e != nil {
		return e
	}
	f, e := os.OpenFile(journalPath+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return e
	}
	if e = os.Rename(journalPath+".tmp", journalPath); e != nil {
		return e
	}
	d, e := os.Open(journalDir)
	if e == nil {
		e = d.Sync()
		d.Close()
	}
	return e
}
func readSession() (*scanSession, error) {
	if e := privateJournalDir(); e != nil {
		return nil, e
	}
	var j scanSession
	b, e := os.ReadFile(journalPath)
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &j); e != nil {
		return nil, e
	}
	if !nameRE.MatchString(j.Modem) || !portRE.MatchString(j.Port) || !nameRE.MatchString(j.Interface) || j.Token == "" {
		return nil, errors.New("Invalid recovery journal")
	}
	return &j, nil
}
func configFingerprint() string {
	text, e := run(5, "sha256sum", "/etc/config/qmodem", "/etc/config/network", "/etc/config/firewall", "/etc/config/misectel")
	if e != nil {
		return ""
	}
	return strings.TrimSpace(text)
}
func processCommand(pid int) string {
	b, _ := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	return string(b)
}
func pauseReaders(j *scanSession) error {
	entries, _ := os.ReadDir("/proc")
	for _, entry := range entries {
		pid, e := strconv.Atoi(entry.Name())
		if e != nil || pid <= 1 {
			continue
		}
		command := processCommand(pid)
		reader := strings.HasPrefix(command, "/usr/sbin/chester-simd\x00") || ((strings.Contains(command, "/usr/share/qmodem/network_monitor.sh\x00") || strings.Contains(command, "/usr/share/qmodem/modem_monitor.sh\x00")) && strings.Contains(command, j.Modem))
		if !reader {
			continue
		}
		status, _ := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
		if regexp.MustCompile(`(?m)^State:\s+[Tt]`).Match(status) {
			continue
		}
		// Persist compensation before stopping a process, including the exact
		// cmdline and boot identity so a reused PID is never resumed by mistake.
		j.Paused = append(j.Paused, pausedProcess{PID: pid, Command: command})
		if e = saveSession(j); e != nil {
			return e
		}
		if e = syscall.Kill(pid, syscall.SIGSTOP); e != nil && !errors.Is(e, syscall.ESRCH) {
			return e
		}
	}
	return nil
}
func resumeReaders(j *scanSession) {
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if strings.TrimSpace(string(boot)) != j.Boot {
		return
	}
	for _, p := range j.Paused {
		if processCommand(p.PID) == p.Command {
			syscall.Kill(p.PID, syscall.SIGCONT)
		}
	}
}
func networkDevice(iface string) string {
	text, e := run(5, "ubus", "-S", "call", "network.interface."+iface, "status")
	if e != nil {
		return ""
	}
	var v struct {
		Device string `json:"l3_device"`
	}
	json.Unmarshal([]byte(text), &v)
	if nameRE.MatchString(v.Device) {
		return v.Device
	}
	return ""
}

var probeNetwork = func(iface string) networkCheck {
	dev := networkDevice(iface)
	if dev == "" {
		dev = networkDevice(iface + "v6")
	}
	n := networkCheck{Device: dev}
	if dev == "" {
		return n
	}
	for _, p := range []struct {
		family       int
		tool, target string
	}{{4, "ping", "1.1.1.1"}, {4, "ping", "8.8.8.8"}, {6, "ping6", "2606:4700:4700::1111"}, {6, "ping6", "2001:4860:4860::8888"}} {
		if p.family == 4 && n.IPv4 || p.family == 6 && n.IPv6 {
			continue
		}
		_, e := run(4, p.tool, "-I", dev, "-q", "-c", "1", "-W", "2", p.target)
		if e == nil {
			if p.family == 4 {
				n.IPv4 = true
			} else {
				n.IPv6 = true
			}
		}
	}
	return n
}

func requiredRecovered(before, after networkCheck) bool {
	return (!before.IPv4 || after.IPv4) && (!before.IPv6 || after.IPv6)
}
func networkSummary(before, after networkCheck) string {
	family := func(was, now bool) string {
		if now {
			return "Verified"
		}
		if !was {
			return "Unavailable Before Scan"
		}
		return "Not Recovered"
	}
	return "IPv4: " + family(before.IPv4, after.IPv4) + " · IPv6: " + family(before.IPv6, after.IPv6)
}

var sessionAT = at
var sessionFingerprint = configFingerprint
var sessionProbe = func(iface string) networkCheck { return probeNetwork(iface) }
var sessionRun = run
var sessionSleep = time.Sleep
var clearSession = func() error {
	e := os.Remove(journalPath)
	if os.IsNotExist(e) {
		return nil
	}
	return e
}

func prepareSession(modem, port string) (*scanSession, error) {
	j := &scanSession{Token: strconv.FormatInt(time.Now().UnixNano(), 36), Owner: os.Getpid(), Expires: time.Now().Add(15 * time.Minute).Unix(), Modem: modem, Port: port, Checks: map[string]string{}}
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	j.Boot = strings.TrimSpace(string(boot))
	j.Interface = uci("qmodem." + modem + ".alias")
	if !nameRE.MatchString(j.Interface) {
		j.Interface = modem
	}
	text, e := sessionAT(port, "AT+COPS?", 8)
	if e != nil {
		return nil, e
	}
	j.Registration, e = registrationRestore(text)
	if e != nil {
		return nil, e
	}
	for _, key := range []string{"mode_pref", "nr5g_disable_mode", "lte_band", "nr5g_band", "nsa_nr5g_band"} {
		query := `AT+QNWPREFCFG="` + key + `"`
		text, e := sessionAT(port, query, 5)
		if e != nil {
			if key == "mode_pref" {
				return nil, e
			}
			continue
		}
		p, e := readPreference(query, text)
		if e != nil {
			return nil, e
		}
		j.Preferences = append(j.Preferences, p)
	}
	for _, query := range []string{"AT+QUIMSLOT?", "AT+CGDCONT?", `AT+QMBNCFG="list"`} {
		if text, e := sessionAT(port, query, 5); e == nil {
			j.Checks[query] = semantic(text)
		}
	}
	j.ConfigHashes = sessionFingerprint()
	if j.ConfigHashes == "" {
		return nil, errors.New("Could not preserve the saved modem configuration")
	}
	j.Before = sessionProbe(j.Interface)
	if e = saveSession(j); e != nil {
		return nil, e
	}
	self, _ := os.Executable()
	guard := exec.Command(self, "guard", j.Token)
	guard.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if e = guard.Start(); e != nil {
		os.Remove(journalPath)
		return nil, e
	}
	guard.Process.Release()
	if e = pauseReaders(j); e != nil {
		return j, e
	}
	if _, e = sessionAT(port, "AT+COPS=2", 60); e != nil {
		return j, e
	}
	confirmation, e := sessionAT(port, "AT+COPS?", 5)
	if e != nil || !regexp.MustCompile(`\+COPS:\s*2(?:[\r\n]|$)`).MatchString(confirmation) {
		return j, errors.New("The modem did not confirm temporary deregistration")
	}
	return j, nil
}
func restoreSession(j *scanSession, phase func(string)) (*recoveryReport, error) {
	r := &recoveryReport{Before: j.Before}
	defer resumeReaders(j)
	phase("Restoring Original Registration and Radio Settings…")
	_, e := sessionAT(j.Port, j.Registration, 90)
	if e != nil {
		return r, e
	}
	for _, p := range j.Preferences {
		text, e := sessionAT(j.Port, p.Query, 5)
		if e != nil {
			return r, e
		}
		if semantic(text) != p.Value {
			if _, e = sessionAT(j.Port, p.Set, 10); e != nil {
				return r, e
			}
		}
		text, e = sessionAT(j.Port, p.Query, 5)
		if e != nil || semantic(text) != p.Value {
			return r, fmt.Errorf("Could not restore %s", p.Query)
		}
	}
	for query, expected := range j.Checks {
		text, e := sessionAT(j.Port, query, 5)
		if e != nil || semantic(text) != expected {
			return r, errors.New("SIM, APN or Modem Profile Changed; Recovery Needs Attention")
		}
	}
	if sessionFingerprint() != j.ConfigHashes {
		return r, errors.New("Saved Configuration Changed; Recovery Needs Attention")
	}
	text, e := sessionAT(j.Port, "AT+COPS?", 5)
	if e != nil {
		return r, e
	}
	actual, e := registrationRestore(text)
	if e != nil || actual != j.Registration {
		return r, errors.New("The Original Network Selection Was Not Restored")
	}
	phase("Checking Cellular IPv4 and IPv6 Recovery…")
	for attempt := 0; attempt < 15; attempt++ {
		r.After = sessionProbe(j.Interface)
		if requiredRecovered(j.Before, r.After) {
			break
		}
		if attempt == 3 {
			phase("Reconnecting the Cellular Data Session…")
			r.Redial = true
			sessionRun(75, "/etc/init.d/qmodem_network", "reconfigure", j.Modem)
		}
		sessionSleep(3 * time.Second)
	}
	// A redial can reapply configured radio preferences. Verify/compensate
	// once more before releasing the SIM policy and reporting completion.
	for _, p := range j.Preferences {
		text, e := sessionAT(j.Port, p.Query, 5)
		if e != nil {
			return r, e
		}
		if semantic(text) != p.Value {
			if _, e = sessionAT(j.Port, p.Set, 10); e != nil {
				return r, e
			}
			text, e = sessionAT(j.Port, p.Query, 5)
			if e != nil || semantic(text) != p.Value {
				return r, errors.New("Radio Preference Recovery Failed")
			}
		}
	}
	for query, expected := range j.Checks {
		text, e := sessionAT(j.Port, query, 5)
		if e != nil || semantic(text) != expected {
			return r, errors.New("SIM, APN or Modem Profile Recovery Failed")
		}
	}
	if sessionFingerprint() != j.ConfigHashes {
		return r, errors.New("Saved Configuration Changed During Data Recovery")
	}
	r.SettingsRestored = true
	for attempt := 0; attempt < 5; attempt++ {
		r.After = sessionProbe(j.Interface)
		if requiredRecovered(j.Before, r.After) {
			break
		}
		sessionSleep(3 * time.Second)
	}
	r.Message = networkSummary(j.Before, r.After)
	if e = clearSession(); e != nil {
		return r, e
	}
	if !requiredRecovered(j.Before, r.After) {
		return r, errors.New("Scan Finished; " + r.Message)
	}
	return r, nil
}
func recoverOrphan(token string) {
	// Wait until the owner exits. No additional modem polling while it runs.
	for {
		j, e := readSession()
		if e != nil || token != "" && j.Token != token {
			return
		}
		boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
		ownerLive := strings.TrimSpace(string(boot)) == j.Boot && alive(j.Owner) && strings.Contains(processCommand(j.Owner), "chester-scan\x00worker\x00")
		if ownerLive && (j.Expires == 0 || time.Now().Unix() < j.Expires) {
			time.Sleep(2 * time.Second)
			continue
		}
		if ownerLive {
			syscall.Kill(j.Owner, syscall.SIGTERM)
			time.Sleep(2 * time.Second)
			if alive(j.Owner) {
				syscall.Kill(j.Owner, syscall.SIGKILL)
			}
		}
		f, e := os.OpenFile(runtimeDir+"/lock", os.O_CREATE|os.O_RDWR, 0600)
		if e != nil {
			return
		}
		if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
			f.Close()
			time.Sleep(2 * time.Second)
			continue
		}
		latest, e := readSession()
		if e != nil || latest.Token != j.Token {
			f.Close()
			return
		}
		// Recovery after a reboot must never act on the previous boot's PIDs.
		// Pause the new boot's readers instead, then resume exactly those.
		if j.Boot != strings.TrimSpace(string(boot)) {
			j.Boot = strings.TrimSpace(string(boot))
			j.Paused = nil
			if e = saveSession(j); e != nil {
				f.Close()
				return
			}
			if e = pauseReaders(j); e != nil {
				resumeReaders(j)
				f.Close()
				return
			}
		}
		s := readState()
		s.Running = true
		s.PID = os.Getpid()
		s.Phase = "restoring"
		os.Mkdir("/tmp/chester-sim.lock", 0700)
		os.WriteFile("/tmp/chester-sim.lock/scan.pid", []byte(strconv.Itoa(os.Getpid())), 0600)
		r, e := restoreSession(j, func(message string) { s.Message = message; atomicState(s) })
		s.Recovery = r
		s.Running = false
		s.Phase = "interrupted"
		s.Message = "The Scan Was Interrupted. Original Settings Restored. " + r.Message
		_, journalError := os.Stat(journalPath)
		pending := !os.IsNotExist(journalError)
		if e != nil {
			s.Phase = "recovery_failed"
			s.Message = e.Error()
			if pending {
				s.Running = true
				s.Phase = "restoring"
				s.Message = "Recovery Is Retrying While the Modem Becomes Ready…"
			}
		}
		atomicState(s)
		if !pending {
			cleanupSIMLock(os.Getpid())
		}
		f.Close()
		if !pending {
			return
		}
		time.Sleep(20 * time.Second)
	}
}
