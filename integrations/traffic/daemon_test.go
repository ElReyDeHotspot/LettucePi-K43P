package main

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestAdaptive(t *testing.T) {
	for _, s := range []struct {
		count int
		ms    float64
		want  int
	}{{200, 8, 2}, {1500, 10, 5}, {100, 50, 5}, {6000, 5, 10}, {200, 101, 10}} {
		if got := refreshSeconds(s.count, s.ms); got != s.want {
			t.Fatalf("%+v got %d", s, got)
		}
	}
}
func TestSharedAndIdle(t *testing.T) {
	var calls atomic.Int32
	c := &collector{collect: func(prev Cache, now float64) (Result, Cache) {
		calls.Add(1)
		return Result{Success: true, RefreshSeconds: 2}, Cache{At: now}
	}}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if !json.Valid(c.snapshot()) {
				t.Error("invalid snapshot")
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatal("duplicated collection", calls.Load())
	}
	c.idleAfter = time.Now().Add(-time.Second)
	c.expireIdle()
	if c.result != nil || c.previous.At != 0 {
		t.Fatal("idle cache retained")
	}
	if calls.Load() != 1 {
		t.Fatal("idle timer collected traffic")
	}
}
