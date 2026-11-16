package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
)

func openInBrowser(pageUrl string) {
	opener := "xdg-open"
	if runtime.GOOS == "darwin" {
		opener = "open"
	}
	exec.Command(opener, pageUrl).Start()
}

func main() {
	storePath := os.Getenv("SESSION_NOTES_STORE")
	store, err := loadStore(storePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Could not read the session notes in %s.\n", storePath)
		os.Exit(1)
	}
	if len(store.rawSessions) == 0 {
		fmt.Println("No session notes yet.")
		return
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+os.Getenv("SESSION_NOTES_PORT"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	pageUrl := fmt.Sprintf("http://%s/", listener.Addr())
	fmt.Printf("Session notes: %s (Ctrl+C to stop)\n", pageUrl)
	if os.Getenv("SESSION_NOTES_NO_OPEN") == "" {
		openInBrowser(pageUrl)
	}
	if err := http.Serve(listener, newNotesServer(storePath)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
