package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestWorkerLockDoesNotLeakToRecoveryGuard(t *testing.T) {
	mode := os.Getenv("CHESTER_SCAN_LOCK_TEST")
	if mode == "guard" {
		entries, _ := os.ReadDir("/proc/self/fd")
		for _, entry := range entries {
			target, _ := os.Readlink("/proc/self/fd/" + entry.Name())
			if target == os.Getenv("CHESTER_SCAN_LOCK_PATH") {
				os.Exit(2)
			}
		}
		os.Exit(0)
	}
	if mode == "worker" {
		lock := inheritedWorkerLock()
		if lock == nil {
			os.Exit(3)
		}
		defer lock.Close()
		child := exec.Command(os.Args[0], "-test.run=^TestWorkerLockDoesNotLeakToRecoveryGuard$")
		child.Env = append(os.Environ(), "CHESTER_SCAN_LOCK_TEST=guard")
		if e := child.Run(); e != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}
	f, e := os.CreateTemp(t.TempDir(), "scan-lock")
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	child := exec.Command(os.Args[0], "-test.run=^TestWorkerLockDoesNotLeakToRecoveryGuard$")
	child.ExtraFiles = []*os.File{f}
	child.Env = append(os.Environ(), "CHESTER_SCAN_LOCK_TEST=worker", "CHESTER_SCAN_LOCK_PATH="+f.Name())
	if e := child.Run(); e != nil {
		t.Fatal("Recovery guard inherited worker lock:", e)
	}
}

func TestPreserveAutomaticManualAndDeregisteredSelection(t *testing.T) {
	for _, tc := range []struct{ reply, want string }{
		{`+COPS: 0,2,"310260",13`, "AT+COPS=0"},
		{`+COPS: 1,2,"311480",7`, `AT+COPS=1,2,"311480",7`},
		{`+COPS: 4,0,"T-Mobile",13`, `AT+COPS=4,0,"T-Mobile",13`},
		{`+COPS: 2`, "AT+COPS=2"},
	} {
		got, e := registrationRestore(tc.reply)
		if e != nil || got != tc.want {
			t.Fatalf("%q %v", got, e)
		}
	}
	for _, bad := range []string{`ERROR`, `+COPS: 3`, `+COPS: 1,2,"310260;AT+CFUN=0",7`, `+COPS: 1,2,"310260",bad`} {
		if _, e := registrationRestore(bad); e == nil {
			t.Fatal(bad)
		}
	}
}
func TestRadioPreferenceRestoreParsing(t *testing.T) {
	p, e := readPreference(`AT+QNWPREFCFG="mode_pref"`, "AT+QNWPREFCFG=\"mode_pref\"\r\r\n+QNWPREFCFG: \"mode_pref\",LTE:NR5G\r\nOK\r\n")
	if e != nil || p.Set != `AT+QNWPREFCFG="mode_pref",LTE:NR5G` {
		t.Fatal(p, e)
	}
	if _, e = readPreference(`AT+QNWPREFCFG="mode_pref"`, `+QNWPREFCFG: "mode_pref",AUTO;AT+CFUN=0`); e == nil {
		t.Fatal("unsafe preference accepted")
	}
}
func TestDualStackRequirementsAndUnavailability(t *testing.T) {
	both := networkCheck{IPv4: true, IPv6: true}
	v4 := networkCheck{IPv4: true}
	if requiredRecovered(both, v4) {
		t.Fatal("IPv6 recovery failure hidden")
	}
	if !requiredRecovered(v4, v4) {
		t.Fatal("unavailable baseline IPv6 blocked scan")
	}
	if !strings.Contains(networkSummary(v4, v4), "IPv6: Unavailable Before Scan") {
		t.Fatal("unavailable IPv6 reported as recovered")
	}
}
func TestRecoveryCompensatesRadioChangesAndRedial(t *testing.T) {
	oldAT, oldHash, oldProbe, oldRun, oldSleep, oldClear := sessionAT, sessionFingerprint, sessionProbe, sessionRun, sessionSleep, clearSession
	t.Cleanup(func() {
		sessionAT, sessionFingerprint, sessionProbe, sessionRun, sessionSleep, clearSession = oldAT, oldHash, oldProbe, oldRun, oldSleep, oldClear
	})
	for _, test := range []string{"normal", "redial", "ipv6 failure", "setting failure"} {
		t.Run(test, func(t *testing.T) {
			radio := "AUTO"
			registered := false
			redial := false
			cleared := false
			queries := 0
			p, _ := readPreference(`AT+QNWPREFCFG="mode_pref"`, `+QNWPREFCFG: "mode_pref",LTE:NR5G`)
			j := &scanSession{Port: "/dev/mhi_DUN", Modem: "m1", Interface: "pcie0", Registration: "AT+COPS=0", Preferences: []preference{p}, ConfigHashes: "original", Before: networkCheck{IPv4: true, IPv6: true}}
			sessionFingerprint = func() string { return "original" }
			sessionAT = func(port, cmd string, seconds int) (string, error) {
				if cmd == "AT+COPS=0" {
					registered = true
					return "OK", nil
				}
				if !registered {
					t.Fatal("preferences restored before registration")
				}
				if cmd == "AT+COPS?" {
					return `+COPS: 0,2,"310260",13`, nil
				}
				if cmd == p.Query {
					return `+QNWPREFCFG: "mode_pref",` + radio, nil
				}
				if cmd == p.Set {
					if test == "setting failure" {
						return "", errors.New("modem refused")
					}
					radio = "LTE:NR5G"
					return "OK", nil
				}
				t.Fatal(cmd)
				return "", nil
			}
			sessionProbe = func(string) networkCheck {
				queries++
				return networkCheck{IPv4: true, IPv6: test != "ipv6 failure" && (test != "redial" || redial)}
			}
			sessionRun = func(seconds int, name string, args ...string) (string, error) {
				if name != "/etc/init.d/qmodem_network" || args[0] != "reconfigure" || args[1] != "m1" {
					t.Fatal(name, args)
				}
				redial = true
				radio = "AUTO"
				return "", nil
			}
			sessionSleep = func(time.Duration) {}
			clearSession = func() error { cleared = true; return nil }
			r, e := restoreSession(j, func(string) {})
			if test == "setting failure" {
				if e == nil || cleared {
					t.Fatal("failed restore discarded journal")
				}
				return
			}
			if !r.SettingsRestored || radio != "LTE:NR5G" || !cleared {
				t.Fatal(r, radio, cleared)
			}
			if test == "ipv6 failure" {
				if e == nil || r.After.IPv6 || !redial {
					t.Fatal("IPv6 outage hidden", r, e)
				}
				return
			}
			if e != nil || !r.After.IPv4 || !r.After.IPv6 {
				t.Fatal(r, e)
			}
			if test == "redial" && (!redial || !r.Redial || queries < 5) {
				t.Fatal("data restart not verified")
			}
		})
	}
}
