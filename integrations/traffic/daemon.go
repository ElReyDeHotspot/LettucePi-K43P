package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

const socketPath = "/var/run/chester-traffic.sock"

type collector struct {
	mu        sync.Mutex
	previous  Cache
	result    []byte
	next      time.Time
	idleAfter time.Time
	collect   func(Cache, float64) (Result, Cache)
}

// K43P has 256 MiB RAM; retain a real reserve without applying the K45P cutoff.
func pauseThresholdForBoard(board string) uint64 {
	if strings.TrimSpace(board) == "misectel,m01k43" {
		return 16 * 1024 * 1024
	}
	return 64 * 1024 * 1024
}
func trafficPauseThreshold() uint64 {
	board, _ := os.ReadFile("/tmp/sysinfo/board_name")
	return pauseThresholdForBoard(string(board))
}

func newCollector() *collector {
	return &collector{collect: func(prev Cache, now float64) (Result, Cache) {
		if available := availableMemory(); available > 0 && available < trafficPauseThreshold() {
			return Result{Success: false, RefreshSeconds: 30, Error: "Monitoring is paused while router memory is low. Retrying in 30 seconds."}, Cache{}
		}
		started := time.Now()
		r, c := sample("/proc/net/nf_conntrack", networks(), hosts(), prev, now)
		r.DurationMS = float64(time.Since(started).Microseconds()) / 1000
		if protection != nil {
			for i := range r.Flows {
				f := &r.Flows[i]
				remote := f.Destination
				if f.Direction == "Inbound" {
					remote = f.Source
				}
				f.Domain = protection.observedDomain(f.MAC, remote)
			}
		}
		r.RefreshSeconds = refreshSeconds(r.Total, r.DurationMS)
		if !r.Success {
			r.RefreshSeconds = 30
		}
		return r, c
	}}
}

func refreshSeconds(flows int, ms float64) int {
	if flows > 5000 || ms > 100 {
		return 10
	}
	if flows > 1000 || ms > 40 {
		return 5
	}
	return 2
}

func (c *collector) snapshot() []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if now.Before(c.next) && c.result != nil {
		return c.result
	}
	r, next := c.collect(c.previous, float64(now.UnixMilli())/1000)
	if r.Success {
		c.previous = next
	} else {
		c.previous = Cache{}
	}
	b, err := json.Marshal(r)
	if err != nil {
		b = []byte(`{"success":false,"refresh_seconds":30,"error":"Could not encode counters."}`)
	}
	c.result = append(b, '\n')
	c.next = now.Add(time.Duration(r.RefreshSeconds)*time.Second - time.Millisecond*100)
	c.idleAfter = now.Add(30 * time.Second)
	return c.result
}

// The only background timer frees stale RAM. It never collects traffic.
func (c *collector) expireIdle() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.idleAfter.IsZero() && time.Now().After(c.idleAfter) {
		c.previous = Cache{}
		c.result = nil
		c.idleAfter = time.Time{}
		c.next = time.Time{}
	}
}

func serve() error {
	// procd owns one instance. A root-only Unix socket adds no TCP listener.
	os.Remove(socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(socketPath)
	if err = os.Chmod(socketPath, 0600); err != nil {
		return err
	}
	protection = newGuard()
	protection.start()
	c := newCollector()
	slots := make(chan struct{}, 4)
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			c.expireIdle()
		}
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		select {
		case slots <- struct{}{}:
			go func() {
				defer func() { <-slots }()
				defer conn.Close()
				conn.SetDeadline(time.Now().Add(3 * time.Second))
				line, err := bufio.NewReader(io.LimitReader(conn, 196609)).ReadString('\n')
				if err != nil || len(line) > 196608 {
					return
				}
				if line == "snapshot\n" {
					conn.Write(c.snapshot())
				} else {
					conn.SetDeadline(time.Now().Add(20 * time.Second))
					conn.Write(guardRequest(line))
				}
			}()
		default:
			conn.SetWriteDeadline(time.Now().Add(100 * time.Millisecond))
			io.WriteString(conn, "{\"success\":false,\"refresh_seconds\":5,\"error\":\"Collector busy; retry shortly.\"}\n")
			conn.Close()
		}
	}
}

func client() {
	conn, err := net.DialTimeout("unix", socketPath, time.Second)
	if err != nil {
		fmt.Println(`{"success":false,"refresh_seconds":30,"error":"Traffic monitor is unavailable. Restart its service or reboot the router."}`)
		return
	}
	defer conn.Close()
	timeout := 4 * time.Second
	if len(os.Args) == 3 && os.Args[1] == "guard" {
		timeout = 15 * time.Second
	}
	conn.SetDeadline(time.Now().Add(timeout))
	if _, err = io.WriteString(conn, clientRequest()); err != nil {
		fmt.Println(`{"success":false,"refresh_seconds":30,"error":"Could not request traffic counters."}`)
		return
	}
	// Reply size is bounded by the 1,000-row output cap.
	data, err := io.ReadAll(io.LimitReader(conn, 2*1024*1024))
	if err != nil || !json.Valid(data) {
		fmt.Println(`{"success":false,"refresh_seconds":30,"error":"Traffic monitor timed out. Retry shortly."}`)
		return
	}
	os.Stdout.Write(data)
}

func main() {
	debug.SetMemoryLimit(96 * 1024 * 1024)
	if len(os.Args) == 2 && os.Args[1] == "serve" {
		if err := serve(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	client()
}

func clientRequest() string {
	if len(os.Args) == 3 && os.Args[1] == "guard" && len(os.Args[2]) <= 196608 && json.Valid([]byte(os.Args[2])) {
		return strings.TrimSpace(os.Args[2]) + "\n"
	}
	return "snapshot\n"
}
func guardRequest(line string) []byte {
	var req struct {
		Action string       `json:"action"`
		Config *GuardConfig `json:"config"`
	}
	if json.Unmarshal([]byte(line), &req) != nil {
		return configError(fmt.Errorf("Invalid request."))
	}
	switch req.Action {
	case "status":
	case "save":
		if req.Config == nil {
			return configError(fmt.Errorf("Protection settings are missing."))
		}
		if err := protection.save(*req.Config); err != nil {
			return configError(err)
		}
	case "update":
		protection.forceUpdate.Store(true)
		protection.queueUpdate()
	default:
		return configError(fmt.Errorf("Unknown protection action."))
	}
	b, err := json.Marshal(protection.status())
	if err != nil {
		return configError(err)
	}
	return append(b, '\n')
}
