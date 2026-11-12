package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

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
	if _, err := tea.NewProgram(newBrowser(store), tea.WithAltScreen(), tea.WithMouseCellMotion()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
