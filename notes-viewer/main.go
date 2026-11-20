package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"syscall"
)

const defaultPort = "47618"

func openInBrowser(pageUrl string) {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	exec.Command(opener, pageUrl).Start()
}

func buildPageUrl(port string, sectionArguments []string) string {
	pageUrl := fmt.Sprintf("http://127.0.0.1:%s/", port)
	if len(sectionArguments) > 0 {
		return pageUrl + "#" + sectionArguments[0]
	}
	return pageUrl
}

func main() {
	port := os.Getenv("CLAUDE_NOTES_PORT")
	if port == "" {
		port = defaultPort
	}
	pageUrl := buildPageUrl(port, os.Args[1:])
	shouldOpenBrowser := os.Getenv("CLAUDE_NOTES_NO_OPEN") == ""

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if errors.Is(err, syscall.EADDRINUSE) {
		fmt.Printf("Claude notes are already served at %s\n", pageUrl)
		if shouldOpenBrowser {
			openInBrowser(pageUrl)
		}
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Claude notes: %s (Ctrl+C to stop)\n", pageUrl)
	if shouldOpenBrowser {
		openInBrowser(pageUrl)
	}
	if err := http.Serve(listener, newViewerServer()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
