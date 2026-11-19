package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
)

const defaultPort = "47617"

func openInBrowser(pageUrl string) {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	exec.Command(opener, pageUrl).Start()
}

func resolvePlansRoot() string {
	if plansRoot := os.Getenv("SMALL_PLANS_DIR"); plansRoot != "" {
		return plansRoot
	}
	homeFolder, _ := os.UserHomeDir()
	return filepath.Join(homeFolder, ".claude", "small-plans")
}

func main() {
	port := os.Getenv("SMALL_PLANS_PORT")
	if port == "" {
		port = defaultPort
	}
	pageUrl := fmt.Sprintf("http://127.0.0.1:%s/", port)
	shouldOpenBrowser := os.Getenv("SMALL_PLANS_NO_OPEN") == ""

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if errors.Is(err, syscall.EADDRINUSE) {
		fmt.Printf("Small plans are already served at %s\n", pageUrl)
		if shouldOpenBrowser {
			openInBrowser(pageUrl)
		}
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Small plans: %s (Ctrl+C to stop)\n", pageUrl)
	if shouldOpenBrowser {
		openInBrowser(pageUrl)
	}
	if err := http.Serve(listener, newPlansServer(resolvePlansRoot())); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
