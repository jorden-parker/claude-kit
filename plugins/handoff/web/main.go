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

const defaultPort = "47616"

func openInBrowser(pageUrl string) {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	exec.Command(opener, pageUrl).Start()
}

func resolveHandoffsRoot() string {
	if handoffsRoot := os.Getenv("HANDOFFS_DIR"); handoffsRoot != "" {
		return handoffsRoot
	}
	homeFolder, _ := os.UserHomeDir()
	return filepath.Join(homeFolder, ".claude", "handoffs")
}

func main() {
	port := os.Getenv("HANDOFFS_PORT")
	if port == "" {
		port = defaultPort
	}
	pageUrl := fmt.Sprintf("http://127.0.0.1:%s/", port)
	shouldOpenBrowser := os.Getenv("HANDOFFS_NO_OPEN") == ""

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if errors.Is(err, syscall.EADDRINUSE) {
		fmt.Printf("Handoffs are already served at %s\n", pageUrl)
		if shouldOpenBrowser {
			openInBrowser(pageUrl)
		}
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Handoffs: %s (Ctrl+C to stop)\n", pageUrl)
	if shouldOpenBrowser {
		openInBrowser(pageUrl)
	}
	if err := http.Serve(listener, newHandoffsServer(resolveHandoffsRoot())); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
