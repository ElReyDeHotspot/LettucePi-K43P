package main

import (
	"bytes"
	"testing"
)

func TestProfileReconstructionBothDirections(t *testing.T) {
	a := bytes.Repeat([]byte{0xa5}, 2048)
	b := append(append([]byte(nil), a...), 1, 2, 3)
	b[10] = 9
	b[100] = 8
	profiles := Profiles{Profiles: map[string]Profile{"pcie": {Size: len(a), SHA: bytesHash(a)}, "usb3": {Size: len(b), SHA: bytesHash(b)}}, Patches: map[string][]Patch{"pcie": {{Offset: 10, Data: []byte{0xa5}}, {Offset: 100, Data: []byte{0xa5}}}, "usb3": {{Offset: 10, Data: []byte{9}}, {Offset: 100, Data: []byte{8}}, {Offset: 2048, Data: []byte{1, 2, 3}}}}}
	for _, p := range []struct {
		source, target []byte
		name           string
	}{{a, b, "usb3"}, {b, a, "pcie"}, {a, a, "pcie"}} {
		out, err := reconstruct(profiles, p.source, p.name)
		if err != nil || !bytes.Equal(out, p.target) {
			t.Fatal("profile mismatch", err)
		}
	}
	corrupted := append([]byte(nil), a...)
	corrupted[50] ^= 1
	if _, err := reconstruct(profiles, corrupted, "usb3"); err == nil {
		t.Fatal("unrecognized kernel accepted")
	}
	profiles.Patches["usb3"][0].Data[0] ^= 1
	if _, err := reconstruct(profiles, a, "usb3"); err == nil {
		t.Fatal("corrupt reconstruction accepted")
	}
}
