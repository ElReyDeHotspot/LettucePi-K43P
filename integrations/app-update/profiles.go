package main

// Store only the differences between the two captured vendor FIT profiles.
// The complete current profile is already present in each kernel UBI volume.
// This helper reconstructs and verifies a temporary file; it never writes UBI.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

type Profile struct {
	Size int    `json:"size"`
	SHA  string `json:"sha256"`
}
type Patch struct {
	Offset int    `json:"offset"`
	Data   []byte `json:"data"`
}
type Profiles struct {
	Profiles map[string]Profile `json:"profiles"`
	Patches  map[string][]Patch `json:"patches"`
}

func bytesHash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func reconstruct(profiles Profiles, current []byte, target string) ([]byte, error) {
	wanted, ok := profiles.Profiles[target]
	if !ok || wanted.Size < 1024 || wanted.Size > 8<<20 || !digest.MatchString(wanted.SHA) {
		return nil, errors.New("Invalid captured profile")
	}
	source := ""
	for name, p := range profiles.Profiles {
		if p.Size > 0 && p.Size <= len(current) && bytesHash(current[:p.Size]) == p.SHA {
			source = name
			break
		}
	}
	if source == "" {
		return nil, errors.New("Current kernel does not match a captured vendor profile; no changes made")
	}
	output := make([]byte, wanted.Size)
	copy(output, current)
	if source != target {
		for _, patch := range profiles.Patches[target] {
			if patch.Offset < 0 || patch.Offset > len(output) || len(patch.Data) > len(output)-patch.Offset {
				return nil, errors.New("Invalid profile patch")
			}
			copy(output[patch.Offset:], patch.Data)
		}
	}
	if bytesHash(output) != wanted.SHA {
		return nil, errors.New("Reconstructed vendor profile failed verification")
	}
	return output, nil
}
func (e Engine) prepareProfile(target string) error {
	if target != "pcie" && target != "usb3" {
		return errors.New("Unknown modem profile")
	}
	raw, err := os.ReadFile(e.path("usr/lib/chester/kernel-profiles.json"))
	if err != nil {
		return err
	}
	if len(raw) > 1<<20 {
		return errors.New("Profile metadata too large")
	}
	var profiles Profiles
	if err = json.Unmarshal(raw, &profiles); err != nil {
		return err
	}
	maximum := 0
	for _, p := range profiles.Profiles {
		if p.Size > maximum {
			maximum = p.Size
		}
	}
	if maximum <= 0 || maximum > 8<<20 {
		return errors.New("Invalid profile size")
	}
	entries, err := os.ReadDir(e.path("sys/class/ubi"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !regexp.MustCompile(`^ubi[0-9]+_[0-9]+$`).MatchString(name) {
			continue
		}
		label, _ := os.ReadFile(e.path(filepath.Join("sys/class/ubi", name, "name")))
		if string(label) != "kernel\n" {
			continue
		}
		f, x := os.Open(e.path(filepath.Join("dev", name)))
		if x != nil {
			continue
		}
		data, _ := io.ReadAll(io.LimitReader(f, int64(maximum)))
		f.Close()
		out, x := reconstruct(profiles, data, target)
		if x != nil {
			continue
		}
		dest := e.path("tmp/chester-kernel-profile-" + target + ".fit")
		if x = atomic(dest, out, 0600); x != nil {
			return x
		}
		fmt.Println(dest)
		return nil
	}
	return errors.New("No matching captured kernel profile found; no changes made")
}
