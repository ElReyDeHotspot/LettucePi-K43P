package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func sha(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func write(t *testing.T, p string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, b, 0644); err != nil {
		t.Fatal(err)
	}
}
func fixture(t *testing.T) (Engine, Manifest, string) {
	t.Helper()
	e := Engine{Root: t.TempDir()}
	write(t, e.path("rom/etc/chester-version"), []byte("product=K43P\nbuild=20261126145149\nbin=63\n"))
	write(t, e.path("etc/chester-version"), []byte("product=K43P\nbuild=20261126145149\nbin=63\n"))
	write(t, e.path("tmp/sysinfo/board_name"), []byte("misectel,m01k43\n"))
	write(t, e.path("proc/sys/kernel/osrelease"), []byte("6.12.85\n"))
	_ = os.MkdirAll(e.dir(), 0700)
	path := "www/luci-static/resources/view/chester-update/index.js"
	old := []byte("old UI")
	next := []byte("new UI")
	write(t, e.path(path), old)
	m := Manifest{Format: 1, Product: "K43P", Board: "misectel,m01k43", Kernel: "6.12.85", Base: "20261126145149", Revision: 1, Target: Target{Version: "25.12", Build: "20261126163000", Built: "2026-11-26T16:30Z", Bin: "63"}, Files: []Entry{{Path: path, SHA: sha(next), Base: sha(old), Size: int64(len(next)), Mode: 0644}}}
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tarw := tar.NewWriter(gz)
	_ = tarw.WriteHeader(&tar.Header{Name: path, Mode: 0644, Size: int64(len(next)), Typeflag: tar.TypeReg})
	_, _ = tarw.Write(next)
	_ = tarw.Close()
	_ = gz.Close()
	archive := filepath.Join(t.TempDir(), "apps.tgz")
	write(t, archive, b.Bytes())
	m.SHA = sha(b.Bytes())
	m.Size = int64(b.Len())
	return e, m, archive
}
func TestSignedInstallAndPreservedSettings(t *testing.T) {
	e, m, p := fixture(t)
	write(t, e.path("etc/config/network"), []byte("customer network"))
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	raw, _ := json.Marshal(m)
	sig := ed25519.Sign(key, raw)
	if _, err := verifyManifest(raw, sig, pub); err != nil {
		t.Fatal(err)
	}
	if err := e.apply(m, p); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(e.path(m.Files[0].Path))
	if string(got) != "new UI" {
		t.Fatal("file missing")
	}
	b, _ := os.ReadFile(e.path("etc/config/network"))
	if string(b) != "customer network" {
		t.Fatal("settings changed")
	}
	if e.state().Revision != 1 {
		t.Fatal("state missing")
	}
	if err := e.compatible(m); err == nil {
		t.Fatal("replay accepted")
	}
}
func TestSignatureAndCompatibilityFailures(t *testing.T) {
	for _, name := range []string{"signature", "board", "kernel", "base", "path", "config", "profile", "conflict", "archive hash", "archive size"} {
		t.Run(name, func(t *testing.T) {
			e, m, p := fixture(t)
			pub, key, _ := ed25519.GenerateKey(rand.Reader)
			switch name {
			case "board":
				m.Board = "misectel,m02k45"
			case "kernel":
				m.Kernel = "6.12.94"
			case "base":
				m.Base = "20261126000000"
			case "path":
				m.Files[0].Path = "../../etc/shadow"
			case "config":
				m.Files[0].Path = "etc/config/network"
			case "profile":
				m.Files[0].Path = "usr/lib/chester/kernel-profile-pcie.fit"
			case "conflict":
				write(t, e.path(m.Files[0].Path), []byte("local edit"))
			case "archive hash":
				m.SHA = sha([]byte("wrong"))
			case "archive size":
				m.Size++
			}
			raw, _ := json.Marshal(m)
			sig := ed25519.Sign(key, raw)
			if name == "signature" {
				sig[0] ^= 1
			}
			_, err := verifyManifest(raw, sig, pub)
			if err == nil {
				err = e.apply(m, p)
			}
			if err == nil {
				t.Fatal("invalid update accepted")
			}
			if e.state().Revision != 0 {
				t.Fatal("failed update committed")
			}
		})
	}
}
func TestArchiveLinkRejected(t *testing.T) {
	e, m, p := fixture(t)
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	_ = tw.WriteHeader(&tar.Header{Name: m.Files[0].Path, Linkname: "/etc/shadow", Typeflag: tar.TypeSymlink})
	_ = tw.Close()
	_ = gz.Close()
	write(t, p, b.Bytes())
	m.SHA = sha(b.Bytes())
	m.Size = int64(b.Len())
	if err := e.apply(m, p); err == nil {
		t.Fatal("archive symlink accepted")
	}
}
func TestDestinationSymlinkRejected(t *testing.T) {
	e, m, p := fixture(t)
	_ = os.Remove(e.path(m.Files[0].Path))
	if err := os.Symlink("/etc/shadow", e.path(m.Files[0].Path)); err != nil {
		t.Fatal(err)
	}
	if err := e.apply(m, p); err == nil {
		t.Fatal("destination link accepted")
	}
}
func TestPowerLossRollback(t *testing.T) {
	e, m, _ := fixture(t)
	path := m.Files[0].Path
	old, _ := os.ReadFile(e.path(path))
	write(t, filepath.Join(e.tx(), "old", path), old)
	j := Journal{Old: []Old{{Path: path, Exists: true, Mode: 0644}, {Path: "www/luci-static/resources/created.js", Exists: false}}}
	if err := saveJSON(filepath.Join(e.tx(), "journal.json"), j); err != nil {
		t.Fatal(err)
	}
	write(t, e.path(path), []byte("interrupted write"))
	write(t, e.path(j.Old[1].Path), []byte("new file"))
	if err := e.recover(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(e.path(path))
	if !bytes.Equal(got, old) {
		t.Fatal("rollback did not restore original")
	}
	if _, err := os.Stat(e.path(j.Old[1].Path)); !os.IsNotExist(err) {
		t.Fatal("rollback left new file")
	}
}
func TestCommittedTransactionIsNotRolledBack(t *testing.T) {
	e, m, _ := fixture(t)
	p := m.Files[0].Path
	write(t, e.path(p), []byte("committed file"))
	if err := saveJSON(filepath.Join(e.tx(), "journal.json"), Journal{Committed: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.recover(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(e.path(p))
	if string(got) != "committed file" {
		t.Fatal("committed data rolled back")
	}
}

func TestSignedBaselineAndStateReset(t *testing.T) {
	e, m, _ := fixture(t)
	m.Revision = 0
	m.Files = nil
	m.Size = 0
	m.URL = ""
	m.SHA = bytesHash(nil)
	m.Target.Build = m.Base
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	raw, _ := json.Marshal(m)
	if _, err := verifyManifest(raw, ed25519.Sign(key, raw), pub); err != nil {
		t.Fatal(err)
	}
	if err := e.compatible(m); err == nil {
		t.Fatal("baseline must not install")
	}
	if err := saveJSON(filepath.Join(e.dir(), "state.json"), State{Revision: 7, Base: "20261126000000", Files: map[string]string{"old": "state"}}); err != nil {
		t.Fatal(err)
	}
	if e.state().Revision != 0 {
		t.Fatal("old firmware app state survived a base change")
	}
	m.Size = 1
	raw, _ = json.Marshal(m)
	if _, err := verifyManifest(raw, ed25519.Sign(key, raw), pub); err == nil {
		t.Fatal("baseline with payload accepted")
	}
}

func TestMinutePrecisionVendorBaseline(t *testing.T) {
	e, m, _ := fixture(t)
	m.Base = "202611260019"
	m.Target.Built = "2026-11-26"
	m.Target.Build = m.Base
	m.Revision = 0
	m.Size = 0
	m.Files = nil
	m.URL = ""
	m.SHA = bytesHash(nil)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	raw, _ := json.Marshal(m)
	if _, err := verifyManifest(raw, ed25519.Sign(key, raw), pub); err != nil {
		t.Fatal(err)
	}
	_ = e
}

func TestInsufficientFlashDoesNotTouchFiles(t *testing.T) {
	e, m, p := fixture(t)
	var st syscall.Statfs_t
	if err := syscall.Statfs(e.dir(), &st); err != nil {
		t.Fatal(err)
	}
	// A sparse metadata file makes the rollback budget exceed free flash without
	// consuming that space or writing a large payload.
	if err := os.Truncate(e.path("etc/chester-version"), int64(st.Bavail)*st.Bsize+(2<<20)); err != nil {
		t.Fatal(err)
	}
	if err := e.apply(m, p); err == nil {
		t.Fatal("insufficient rollback space accepted")
	}
	got, _ := os.ReadFile(e.path(m.Files[0].Path))
	if string(got) != "old UI" {
		t.Fatal("file changed before flash-space preflight")
	}
	if _, err := os.Stat(filepath.Join(e.tx(), "journal.json")); !os.IsNotExist(err) {
		t.Fatal("transaction started despite insufficient space")
	}
}

func TestInterruptedVersionAndRevisionAreRolledBack(t *testing.T) {
	e, m, _ := fixture(t)
	oldVersion, _ := os.ReadFile(e.path("etc/chester-version"))
	oldState := []byte(`{"revision":0,"base_build":"20261126145149","files":{}}`)
	write(t, e.path("etc/chester-app-update/state.json"), oldState)
	oldFiles := map[string][]byte{m.Files[0].Path: []byte("old UI"), "etc/chester-version": oldVersion, "etc/chester-app-update/state.json": oldState}
	j := Journal{}
	for path, data := range oldFiles {
		write(t, filepath.Join(e.tx(), "old", path), data)
		j.Old = append(j.Old, Old{Path: path, Exists: true, Mode: 0644})
	}
	if err := saveJSON(filepath.Join(e.tx(), "journal.json"), j); err != nil {
		t.Fatal(err)
	}
	for path := range oldFiles {
		write(t, e.path(path), []byte("interrupted update"))
	}
	if err := e.recover(); err != nil {
		t.Fatal(err)
	}
	for path, data := range oldFiles {
		got, _ := os.ReadFile(e.path(path))
		if !bytes.Equal(got, data) {
			t.Fatal("rollback mismatch", path)
		}
	}
	if e.state().Revision != 0 {
		t.Fatal("app counter advanced after rollback")
	}
}

func TestCoherentEnvelopeAndPinnedWorkerRelease(t *testing.T) {
	e, m, _ := fixture(t)
	m.URL = "https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/refs/heads/main/apps/releases/test/package.tgz"
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	write(t, filepath.Join(e.dir(), "public.key"), []byte(base64.StdEncoding.EncodeToString(pub)))
	raw, _ := json.Marshal(m)
	sig := ed25519.Sign(key, raw)
	blob, _ := json.Marshal(Envelope{Manifest: raw, Signature: sig})
	write(t, e.path("tmp/chester-app-channel.json"), blob)
	id := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := e.pinRequest(id); err != nil {
		t.Fatal(err)
	}
	next := m
	next.Revision = 2
	next.Target.Build = "20261126170000"
	nextRaw, _ := json.Marshal(next)
	nextSig := ed25519.Sign(key, nextRaw)
	nextBlob, _ := json.Marshal(Envelope{Manifest: nextRaw, Signature: nextSig})
	write(t, e.path("tmp/chester-app-channel.json"), nextBlob)
	pinned, err := e.readRelease(e.requestPath(id))
	if err != nil || pinned.Revision != 1 {
		t.Fatal("worker release was replaced by another client check", err)
	}
	latest, err := e.cached()
	if err != nil || latest.Revision != 2 {
		t.Fatal("current channel did not advance", err)
	}
	mixed, _ := json.Marshal(Envelope{Manifest: raw, Signature: nextSig})
	if _, err := e.decodeRelease(mixed); err == nil {
		t.Fatal("mixed metadata and signature accepted")
	}
	if _, err := e.decodeRelease(bytes.Repeat([]byte{'x'}, 262145)); err == nil {
		t.Fatal("oversized channel accepted")
	}
}
