package main

import (
	"archive/tar"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const limit = 8 << 20

type Entry struct {
	Path string `json:"path"`
	SHA  string `json:"sha256"`
	Base string `json:"base_sha256"`
	Size int64  `json:"size"`
	Mode uint32 `json:"mode"`
}
type Target struct {
	Version string `json:"version"`
	Build   string `json:"build"`
	Built   string `json:"built"`
	Bin     string `json:"bin"`
}
type Manifest struct {
	Format   int     `json:"format"`
	Product  string  `json:"product"`
	Board    string  `json:"board"`
	Kernel   string  `json:"kernel"`
	Base     string  `json:"base_build"`
	Revision int     `json:"revision"`
	Target   Target  `json:"target"`
	URL      string  `json:"url"`
	SHA      string  `json:"sha256"`
	Size     int64   `json:"size"`
	Notes    string  `json:"notes"`
	Files    []Entry `json:"files"`
}
type State struct {
	Revision int               `json:"revision"`
	Base     string            `json:"base_build"`
	Files    map[string]string `json:"files"`
}
type Old struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
	Mode   uint32 `json:"mode"`
}
type Journal struct {
	Old       []Old `json:"old"`
	Committed bool  `json:"committed"`
}
type Engine struct{ Root string }

var digits = regexp.MustCompile(`^[0-9]{12}([0-9]{2})?$`)
var safePath = regexp.MustCompile(`^[A-Za-z0-9_./+-]+$`)
var digest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var requestID = regexp.MustCompile(`^[a-f0-9]{32}$`)

func (e Engine) path(p string) string { return filepath.Join(e.Root, strings.TrimPrefix(p, "/")) }
func (e Engine) dir() string          { return e.path("/etc/chester-app-update") }
func (e Engine) tx() string           { return filepath.Join(e.dir(), "transaction") }
func hash(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	_, err = io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), err
}
func fields(p string) map[string]string {
	b, _ := os.ReadFile(p)
	m := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if ok {
			m[k] = v
		}
	}
	return m
}
func atomic(p string, b []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(p+".new", os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Chmod(mode)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(p+".new", p)
	}
	if err == nil {
		d, x := os.Open(filepath.Dir(p))
		if x != nil {
			return x
		}
		err = d.Sync()
		d.Close()
	}
	return err
}
func saveJSON(p string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return atomic(p, b, 0600)
}
func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err = os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst+".app-new", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Chmod(mode)
	}
	if err == nil {
		err = out.Sync()
	}
	x := out.Close()
	if err == nil {
		err = x
	}
	if err == nil {
		err = os.Rename(dst+".app-new", dst)
	}
	if err == nil {
		d, x := os.Open(filepath.Dir(dst))
		if x != nil {
			return x
		}
		err = d.Sync()
		d.Close()
	}
	return err
}
func allowed(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || !safePath.MatchString(p) || filepath.Clean(p) != p || strings.Contains(p, "..") {
		return false
	}
	for _, prefix := range []string{"www/luci-static/resources/", "www/luci-static/misectel/", "www/cgi-bin/chester-", "usr/share/luci/menu.d/", "usr/share/rpcd/acl.d/", "usr/share/ucode/luci/template/", "usr/libexec/chester-", "usr/sbin/chester-", "usr/lib/chester/"} {
		if strings.HasPrefix(p, prefix) {
			if strings.Contains(p, "kernel-profile") || strings.Contains(p, "app-update") || p == "usr/sbin/chester-update" || p == "usr/libexec/chester-engine" {
				return false
			}
			return true
		}
	}
	return false
}
func (e Engine) regularParents(p string) error {
	current := e.Root
	for _, part := range strings.Split(filepath.Clean(p), "/") {
		current = filepath.Join(current, part)
		st, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink rejected: %s", p)
		}
	}
	return nil
}
func (e Engine) state() State {
	s := State{Files: map[string]string{}}
	b, _ := os.ReadFile(filepath.Join(e.dir(), "state.json"))
	_ = json.Unmarshal(b, &s)
	if s.Base != "" && s.Base != fields(e.path("/rom/etc/chester-version"))["build"] {
		return State{Files: map[string]string{}}
	}
	if s.Files == nil {
		s.Files = map[string]string{}
	}
	return s
}
func verifyManifest(b, sig, pub []byte) (Manifest, error) {
	var m Manifest
	if len(b) > 131072 || len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize || !ed25519.Verify(pub, b, sig) {
		return m, errors.New("App update signature verification failed")
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	if m.Format != 1 || m.Revision < 0 || !digits.MatchString(m.Base) || !digits.MatchString(m.Target.Build) || !regexp.MustCompile(`^[0-9.]+$`).MatchString(m.Target.Version) || !regexp.MustCompile(`^[0-9]{1,5}$`).MatchString(m.Target.Bin) || len(m.Notes) > 4096 {
		return m, errors.New("Invalid app release metadata")
	}
	if _, err := time.Parse("2006-01-02T15:04Z", m.Target.Built); err != nil {
		if _, dayErr := time.Parse("2006-01-02", m.Target.Built); dayErr != nil {
			return m, errors.New("Invalid app build date")
		}
	}
	if m.Revision == 0 {
		if m.Target.Build != m.Base || m.Size != 0 || m.URL != "" || m.SHA != bytesHash(nil) || len(m.Files) != 0 {
			return m, errors.New("Invalid signed app baseline")
		}
		return m, nil
	}
	if m.Target.Build <= m.Base || m.Size <= 0 || m.Size > limit || !digest.MatchString(m.SHA) || len(m.Files) == 0 || len(m.Files) > 512 {
		return m, errors.New("Invalid app package metadata")
	}
	seen := map[string]bool{}
	var total int64
	for _, f := range m.Files {
		if !allowed(f.Path) || seen[f.Path] || !digest.MatchString(f.SHA) || (f.Base != "" && !digest.MatchString(f.Base)) || f.Size < 0 || f.Size > limit || (f.Mode != 0644 && f.Mode != 0755) {
			return m, errors.New("Invalid app file metadata")
		}
		seen[f.Path] = true
		total += f.Size
	}
	if total > limit {
		return m, errors.New("App update exceeds the expanded size limit")
	}
	return m, nil
}
func (e Engine) compatibleBase(m Manifest) error {
	rom := fields(e.path("/rom/etc/chester-version"))
	board, _ := os.ReadFile(e.path("/tmp/sysinfo/board_name"))
	kernel, _ := os.ReadFile(e.path("/proc/sys/kernel/osrelease"))
	if rom["product"] != m.Product || rom["build"] != m.Base || strings.TrimSpace(string(board)) != m.Board || strings.TrimSpace(string(kernel)) != m.Kernel || rom["bin"] != m.Target.Bin {
		return errors.New("This app release requires a different base firmware; use the matching full firmware update")
	}
	return nil
}
func (e Engine) compatible(m Manifest) error {
	if err := e.compatibleBase(m); err != nil {
		return err
	}
	st := e.state()
	if st.Base != "" && st.Base != m.Base {
		return errors.New("App state belongs to a different firmware base")
	}
	if m.Revision <= st.Revision {
		return errors.New("No newer app update is available")
	}
	included := map[string]bool{}
	for _, f := range m.Files {
		included[f.Path] = true
		if err := e.regularParents(f.Path); err != nil {
			return err
		}
		expected := f.Base
		if old, ok := st.Files[f.Path]; ok {
			expected = old
		}
		actual, err := hash(e.path(f.Path))
		if os.IsNotExist(err) && expected == "" {
			continue
		}
		if err != nil {
			return err
		}
		if actual != expected {
			return fmt.Errorf("Local file differs from the supported app base: %s", f.Path)
		}
	}
	for p := range st.Files {
		if !included[p] {
			return fmt.Errorf("Cumulative app release omitted a previously updated file: %s", p)
		}
	}
	return nil
}
func (e Engine) unpack(m Manifest, archive, dest string) error {
	sum, err := hash(archive)
	if err != nil {
		return err
	}
	st, err := os.Stat(archive)
	if err != nil {
		return err
	}
	if st.Size() != m.Size || sum != m.SHA {
		return errors.New("App download size or checksum mismatch")
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(io.LimitReader(gz, limit+(1<<20)))
	wanted := map[string]Entry{}
	for _, v := range m.Files {
		wanted[v.Path] = v
	}
	seen := map[string]bool{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		v, ok := wanted[h.Name]
		if !ok || seen[h.Name] || h.Typeflag != tar.TypeReg || h.Size != v.Size || !allowed(h.Name) {
			return errors.New("App archive contains an unexpected file or link")
		}
		seen[h.Name] = true
		p := filepath.Join(dest, h.Name)
		if err = os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			return err
		}
		out, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(v.Mode))
		if err != nil {
			return err
		}
		hasher := sha256.New()
		_, err = io.CopyN(io.MultiWriter(out, hasher), tr, h.Size)
		if err == nil {
			err = out.Sync()
		}
		x := out.Close()
		if err == nil {
			err = x
		}
		if err != nil {
			return err
		}
		if hex.EncodeToString(hasher.Sum(nil)) != v.SHA {
			return errors.New("App file checksum mismatch")
		}
	}
	if len(seen) != len(wanted) {
		return errors.New("App archive is missing files")
	}
	return nil
}
func (e Engine) recover() error {
	p := filepath.Join(e.tx(), "journal.json")
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return os.RemoveAll(e.tx())
	}
	if err != nil {
		return err
	}
	var j Journal
	if err = json.Unmarshal(b, &j); err != nil {
		return err
	}
	if !j.Committed {
		for _, v := range j.Old {
			if !(allowed(v.Path) || v.Path == "etc/chester-version" || v.Path == "etc/chester-app-update/state.json") {
				return errors.New("Invalid rollback path")
			}
			if err = e.regularParents(v.Path); err != nil {
				return err
			}
			if v.Exists {
				if err = copyFile(filepath.Join(e.tx(), "old", v.Path), e.path(v.Path), os.FileMode(v.Mode)); err != nil {
					return err
				}
			} else {
				if err = os.Remove(e.path(v.Path)); err != nil && !os.IsNotExist(err) {
					return err
				}
			}
		}
		syscall.Sync()
	}
	return os.RemoveAll(e.tx())
}
func (e Engine) apply(m Manifest, archive string) (err error) {
	if err = e.recover(); err != nil {
		return err
	}
	if err = e.compatible(m); err != nil {
		return err
	}
	var need uint64 = 1 << 20
	paths := []string{"etc/chester-version", "etc/chester-app-update/state.json"}
	for _, f := range m.Files {
		paths = append(paths, f.Path)
		need += uint64(f.Size)*2 + 16384
	}
	for _, p := range paths {
		if st, x := os.Stat(e.path(p)); x == nil {
			need += uint64(st.Size()) + 16384
		}
	}
	var stat syscall.Statfs_t
	if err = syscall.Statfs(e.dir(), &stat); err != nil {
		return err
	}
	if stat.Bavail*uint64(stat.Bsize) < need {
		return errors.New("Not enough writable flash for an app update and rollback; no files changed")
	}
	if err = os.MkdirAll(filepath.Join(e.tx(), "new"), 0700); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			if x := e.recover(); x != nil {
				err = fmt.Errorf("%v; rollback needs recovery: %v", err, x)
			}
		}
	}()
	if err = e.unpack(m, archive, filepath.Join(e.tx(), "new")); err != nil {
		return err
	}
	j := Journal{}
	for _, p := range paths {
		if err = e.regularParents(p); err != nil {
			return err
		}
		v := Old{Path: p}
		st, x := os.Stat(e.path(p))
		if x == nil {
			if !st.Mode().IsRegular() {
				return errors.New("Non-regular app destination")
			}
			v.Exists = true
			v.Mode = uint32(st.Mode().Perm())
			if err = copyFile(e.path(p), filepath.Join(e.tx(), "old", p), st.Mode().Perm()); err != nil {
				return err
			}
		} else if !os.IsNotExist(x) {
			return x
		}
		j.Old = append(j.Old, v)
	}
	if err = saveJSON(filepath.Join(e.tx(), "journal.json"), j); err != nil {
		return err
	}
	state := State{Revision: m.Revision, Base: m.Base, Files: map[string]string{}}
	for _, f := range m.Files {
		if err = copyFile(filepath.Join(e.tx(), "new", f.Path), e.path(f.Path), os.FileMode(f.Mode)); err != nil {
			return err
		}
		var got string
		got, err = hash(e.path(f.Path))
		if err != nil {
			return err
		}
		if got != f.SHA {
			return errors.New("Written app file verification failed")
		}
		state.Files[f.Path] = f.SHA
	}
	version := fmt.Sprintf("version=%s\nbuilt=%s\nbuild=%s\nbin=%s\nproduct=%s\napp_revision=%d\n", m.Target.Version, m.Target.Built, m.Target.Build, m.Target.Bin, m.Product, m.Revision)
	if err = atomic(e.path("/etc/chester-version"), []byte(version), 0644); err != nil {
		return err
	}
	if err = saveJSON(filepath.Join(e.dir(), "state.json"), state); err != nil {
		return err
	}
	syscall.Sync()
	j.Committed = true
	if err = saveJSON(filepath.Join(e.tx(), "journal.json"), j); err != nil {
		return err
	}
	return os.RemoveAll(e.tx())
}
func emit(v any) { b, _ := json.Marshal(v); fmt.Println(string(b)) }
func (e Engine) job(id, phase, message string) {
	_ = saveJSON(e.path("/tmp/chester-update-job.json"), map[string]any{"id": id, "phase": phase, "message": message, "updated": time.Now().Unix(), "recovering": false})
}
func curl(url, path string, max int64) error {
	cmd := exec.Command("/usr/bin/curl", "--proto", "=https", "--proto-redir", "=https", "-fL", "--connect-timeout", "10", "--max-time", "90", "--retry", "2", "--max-filesize", strconv.FormatInt(max, 10), "-o", path, url)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("App download failed: %v: %.160s", err, b)
	}
	return nil
}
func (e Engine) repo() (string, error) {
	p := fields(e.path("/rom/etc/chester-version"))["product"]
	switch p {
	case "K43P":
		return "https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K43P/refs/heads/main/apps", nil
	case "K45P":
		return "https://raw.githubusercontent.com/ElReyDeHotspot/LettucePi-K45/refs/heads/main/apps", nil
	}
	return "", errors.New("Unsupported router")
}

type Envelope struct {
	Manifest  []byte `json:"manifest"`
	Signature []byte `json:"signature"`
}

func (e Engine) decodeRelease(blob []byte) (Manifest, error) {
	if len(blob) > 262144 {
		return Manifest{}, errors.New("App channel exceeds the size limit")
	}
	var envelope Envelope
	if err := json.Unmarshal(blob, &envelope); err != nil {
		return Manifest{}, err
	}
	pub, err := os.ReadFile(filepath.Join(e.dir(), "public.key"))
	if err != nil {
		return Manifest{}, err
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(pub)))
	if err != nil {
		return Manifest{}, err
	}
	m, err := verifyManifest(envelope.Manifest, envelope.Signature, key)
	if err != nil {
		return m, err
	}
	repo, err := e.repo()
	if err != nil {
		return m, err
	}
	if m.Revision > 0 && (!strings.HasPrefix(m.URL, strings.TrimSuffix(repo, "/apps")+"/apps/releases/") || strings.Contains(m.URL, "?") || strings.Contains(m.URL, "..")) {
		return m, errors.New("Unexpected app release URL")
	}
	return m, nil
}
func (e Engine) readRelease(path string) (Manifest, error) {
	blob, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}
	return e.decodeRelease(blob)
}
func (e Engine) cached() (Manifest, error) {
	return e.readRelease(e.path("/tmp/chester-app-channel.json"))
}
func (e Engine) requestPath(id string) string {
	return e.path("/tmp/chester-app-request-" + id + ".json")
}
func (e Engine) pinRequest(id string) (Manifest, error) {
	if !requestID.MatchString(id) {
		return Manifest{}, errors.New("Invalid update request")
	}
	blob, err := os.ReadFile(e.path("/tmp/chester-app-channel.json"))
	if err != nil {
		return Manifest{}, err
	}
	m, err := e.decodeRelease(blob)
	if err == nil {
		err = e.compatible(m)
	}
	if err != nil {
		return m, err
	}
	if err = atomic(e.requestPath(id), blob, 0600); err != nil {
		return m, err
	}
	return m, nil
}
func (e Engine) fetch() (Manifest, error) {
	repo, err := e.repo()
	if err != nil {
		return Manifest{}, err
	}
	base := fields(e.path("/rom/etc/chester-version"))["build"]
	if !digits.MatchString(base) {
		return Manifest{}, errors.New("Invalid firmware base")
	}
	f, err := os.CreateTemp(e.path("/tmp"), "chester-app-channel.*")
	if err != nil {
		return Manifest{}, err
	}
	temp := f.Name()
	f.Close()
	defer os.Remove(temp)
	url := repo + "/bases/" + base + "/latest.signed.json?cb=" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if err = curl(url, temp, 262144); err != nil {
		return Manifest{}, err
	}
	m, err := e.readRelease(temp)
	if err != nil {
		return m, err
	}
	// A unique completed file keeps metadata and signature coherent even when
	// two clients check different cached channel revisions concurrently.
	if err = os.Rename(temp, e.path("/tmp/chester-app-channel.json")); err != nil {
		return m, err
	}
	return m, nil
}
func (e Engine) status(localOnly bool) {
	local := fields(e.path("/etc/chester-version"))
	rom := fields(e.path("/rom/etc/chester-version"))
	kernel, _ := os.ReadFile(e.path("/proc/sys/kernel/osrelease"))
	board, _ := os.ReadFile(e.path("/tmp/sysinfo/board_name"))
	model, _ := os.ReadFile(e.path("/tmp/sysinfo/model"))
	out := map[string]any{"ok": false, "app_update": true, "installed_version": local["version"], "installed_build": local["build"], "installed_built": local["built"], "installed_bin": rom["bin"], "installed_app": e.state().Revision, "kernel": strings.TrimSpace(string(kernel)), "board": strings.TrimSpace(string(board)), "model": strings.TrimSpace(string(model))}
	out["release_verified"] = false
	out["manifest_checked"] = false
	out["update_available"] = false
	out["requires_firmware"] = false
	out["error"] = ""
	out["os_version"] = strings.Trim(fields(e.path("/etc/os-release"))["VERSION_ID"], "\"")
	if localOnly {
		out["ok"] = true
		out["local_only"] = true
		emit(out)
		return
	}
	m, err := e.fetch()
	if err != nil {
		out["error"] = err.Error()
		emit(out)
		return
	}
	if err = e.compatibleBase(m); err != nil {
		out["error"] = err.Error()
		emit(out)
		return
	}
	out["ok"] = true
	out["manifest_checked"] = true
	out["release_verified"] = true
	out["release_board"] = m.Board
	out["latest_version"] = m.Target.Version
	out["latest_build"] = m.Target.Build
	out["latest_built"] = m.Target.Built
	out["latest_bin"] = m.Target.Bin
	out["latest_app"] = m.Revision
	out["latest_sha"] = m.SHA
	out["size"] = m.Size
	out["notes"] = m.Notes
	out["update_available"] = false
	if m.Revision > e.state().Revision {
		if err = e.compatible(m); err != nil {
			out["error"] = err.Error()
			out["requires_firmware"] = true
		} else {
			out["update_available"] = true
		}
	}
	emit(out)
}
func lock() (*os.File, error) {
	_ = os.MkdirAll("/var/lock", 0755)
	f, err := os.OpenFile("/var/lock/chester-update.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, errors.New("An update is already running")
	}
	return f, nil
}
func main() {
	syscall.Umask(0077)
	e := Engine{Root: "/"}
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Root access is required")
		os.Exit(1)
	}
	action := "status"
	if len(os.Args) > 1 {
		action = os.Args[1]
	}
	switch action {
	case "status":
		e.status(false)
	case "status-local":
		e.status(true)
	case "recover":
		f, err := lock()
		if err != nil {
			os.Exit(1)
		}
		defer f.Close()
		if err = e.recover(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "prepare-profile":
		if len(os.Args) != 3 {
			os.Exit(2)
		}
		if err := e.prepareProfile(os.Args[2]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "verify-cache":
		m, err := e.cached()
		if err == nil {
			err = e.compatible(m)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("OK: Signed app release is compatible.")
	case "install":
		if len(os.Args) != 3 || !requestID.MatchString(os.Args[2]) {
			os.Exit(2)
		}
		f, err := lock()
		if err != nil {
			fmt.Println("FAIL:", err)
			os.Exit(1)
		}
		defer f.Close()
		if _, err = e.pinRequest(os.Args[2]); err != nil {
			fmt.Println("FAIL:", err)
			os.Exit(1)
		}
		exe, _ := os.Executable()
		log, err := os.OpenFile("/tmp/chester-app-update.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			_ = os.Remove(e.requestPath(os.Args[2]))
			os.Exit(1)
		}
		defer log.Close()
		cmd := exec.Command(exe, "run-install", os.Args[2])
		cmd.ExtraFiles = []*os.File{f}
		cmd.Stdout = log
		cmd.Stderr = log
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err = cmd.Start(); err != nil {
			_ = os.Remove(e.requestPath(os.Args[2]))
			fmt.Println("FAIL:", err)
			os.Exit(1)
		}
		fmt.Println("OK: Signed app update started.")
	case "run-install":
		if len(os.Args) != 3 || !requestID.MatchString(os.Args[2]) {
			os.Exit(2)
		}
		id := os.Args[2]
		f := os.NewFile(3, "update-lock")
		if f == nil {
			os.Exit(2)
		}
		defer f.Close()
		if syscall.Flock(3, syscall.LOCK_EX|syscall.LOCK_NB) != nil {
			os.Exit(2)
		}
		e.job(id, "preparing", "Checking app compatibility and rollback space.")
		m, err := e.readRelease(e.requestPath(id))
		_ = os.Remove(e.requestPath(id))
		if err == nil {
			err = e.compatible(m)
		}
		archive := "/tmp/chester-app-package.tgz"
		if err == nil {
			e.job(id, "downloading", "Downloading the signed app update.")
			err = curl(m.URL, archive, m.Size)
		}
		if err == nil {
			e.job(id, "verifying", "Verifying the app package and every changed file.")
			err = e.apply(m, archive)
		}
		_ = os.Remove(archive)
		if err != nil {
			e.job(id, "failed", err.Error())
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		e.job(id, "installing", "App update committed. Restarting with your settings preserved.")
		time.Sleep(3 * time.Second)
		if err = exec.Command("/sbin/reboot").Run(); err != nil {
			e.job(id, "failed", "App files installed; reboot could not be started. Reboot the router to complete the update.")
		}
	default:
		os.Exit(2)
	}
}
