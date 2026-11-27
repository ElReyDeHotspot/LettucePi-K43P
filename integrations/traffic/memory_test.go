package main

import "testing"

func TestBoardSpecificMemoryReserve(t *testing.T) {
	const mib = 1024 * 1024
	for _, tc := range []struct {
		board     string
		available uint64
		paused    bool
	}{
		{"misectel,m01k43", 38 * mib, false},
		{"misectel,m01k43\n", 16 * mib, false},
		{"misectel,m01k43", 15 * mib, true},
		{"misectel,m02k45", 38 * mib, true},
		{"misectel,m02k45", 64 * mib, false},
		{"unknown", 38 * mib, true},
	} {
		if got := tc.available < pauseThresholdForBoard(tc.board); got != tc.paused {
			t.Fatalf("board %q available %d paused=%v, want %v", tc.board, tc.available, got, tc.paused)
		}
	}
}
