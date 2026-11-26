// Chester's uplink-routed wrapper around M-Lab's reference NDT7 runner.
// Linux only; no route, firewall or persistent configuration changes here.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"syscall"
	"time"

	"github.com/m-lab/locate/api/locate"
	ndt7 "github.com/m-lab/ndt7-client-go"
	"github.com/m-lab/ndt7-client-go/internal/emitter"
	"github.com/m-lab/ndt7-client-go/internal/runner"
)

func main() {
	dev := flag.String("interface", "", "Required uplink device")
	source := flag.String("source", "", "Required uplink IPv4 address")
	flag.Parse()
	ip := net.ParseIP(*source).To4()
	if ip == nil || *dev == "" {
		fmt.Fprintln(os.Stderr, "A device and IPv4 address are required")
		os.Exit(2)
	}
	if _, err := net.InterfaceByName(*dev); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	control := func(network, address string, raw syscall.RawConn) error {
		var e error
		err := raw.Control(func(fd uintptr) {
			// chester-link-test routes this mark through the requested uplink.
			// Binding the socket to the device also restricts receive traffic
			// and prevents replies on the K43P's PCIe modem path.
			e = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, 0x10000000)
		})
		if err != nil {
			return err
		}
		return e
	}
	resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		// Apply the same source address and routing mark to DNS and test traffic.
		d := net.Dialer{Timeout: 4 * time.Second, Control: control, LocalAddr: &net.UDPAddr{IP: ip}}
		return d.DialContext(ctx, "udp4", "1.1.1.1:53")
	}}
	dialer := &net.Dialer{Timeout: 7 * time.Second, Control: control, Resolver: resolver, LocalAddr: &net.TCPAddr{IP: ip}}
	dial := func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, "tcp4", address)
	}
	factory := func() *ndt7.Client {
		c := ndt7.NewClient("Chester-K45P-link-test", "1.0")
		c.Scheme = "wss"
		c.Dialer.NetDialContext = dial
		c.Dialer.Proxy = nil
		loc := locate.NewClient(ndt7.MakeUserAgent(c.ClientName, c.ClientVersion))
		loc.HTTPClient = &http.Client{Timeout: 12 * time.Second, Transport: &http.Transport{DialContext: dial}}
		c.Locate = loc
		return c
	}
	r := runner.New(runner.RunnerOptions{Download: true, Upload: true, Timeout: 50 * time.Second, ClientFactory: factory}, emitter.NewJSON(os.Stdout), nil)
	os.Exit(len(r.RunTestsOnce()))
}
