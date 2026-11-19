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

const defaultPort = "47615"

func openInBrowser(pageUrl string) {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	exec.Command(opener, pageUrl).Start()
}

func resolveNotesRoot() string {
	if notesRoot := os.Getenv("PROJECT_NOTES_DIR"); notesRoot != "" {
		return notesRoot
	}
	homeFolder, _ := os.UserHomeDir()
	return filepath.Join(homeFolder, ".claude", "project-notes")
}

func main() {
	port := os.Getenv("PROJECT_NOTES_PORT")
	if port == "" {
		port = defaultPort
	}
	pageUrl := fmt.Sprintf("http://127.0.0.1:%s/", port)
	shouldOpenBrowser := os.Getenv("PROJECT_NOTES_NO_OPEN") == ""

	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if errors.Is(err, syscall.EADDRINUSE) {
		fmt.Printf("Project notes are already served at %s\n", pageUrl)
		if shouldOpenBrowser {
			openInBrowser(pageUrl)
		}
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Project notes: %s (Ctrl+C to stop)\n", pageUrl)
	if shouldOpenBrowser {
		openInBrowser(pageUrl)
	}
	if err := http.Serve(listener, newNotesServer(resolveNotesRoot())); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
