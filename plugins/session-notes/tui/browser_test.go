package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

const fixtureStore = `{"notes": [
  {"sessionId": "session-b", "cwd": "/repo", "startedAt": "2026-11-12T09:30:00.000Z",
   "prompts": ["fix the login bug"], "files": ["/repo/login.ts"], "commands": ["pnpm test"],
   "notes": ["Login bug was a stale cookie", "Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"]},
  {"sessionId": "session-a", "cwd": "/old", "startedAt": "2026-11-01T10:00:00.000Z",
   "prompts": ["old prompt"], "files": [], "commands": []}
]}`

func writeStore(t *testing.T, contents string) string {
	t.Helper()
	storePath := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(storePath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return storePath
}

func openBrowser(t *testing.T, storePath string) browser {
	t.Helper()
	store, err := loadStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	updated, _ := newBrowser(store).Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	return updated.(browser)
}

func keyPress(keys string) tea.KeyMsg {
	switch keys {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	}
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(keys)}
}

func pressKeys(current browser, keys ...string) (browser, tea.Cmd) {
	var lastCommand tea.Cmd
	for _, pressed := range keys {
		var updated tea.Model
		updated, lastCommand = current.Update(keyPress(pressed))
		current = updated.(browser)
	}
	return current, lastCommand
}

func storedNotes(t *testing.T, storePath string, sessionIndex int) []string {
	t.Helper()
	contents, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Notes []struct {
			SessionID string   `json:"sessionId"`
			Notes     []string `json:"notes"`
		} `json:"notes"`
	}
	if err := json.Unmarshal(contents, &document); err != nil {
		t.Fatal(err)
	}
	return document.Notes[sessionIndex].Notes
}

func storedSessionIds(t *testing.T, storePath string) []string {
	t.Helper()
	contents, _ := os.ReadFile(storePath)
	var document struct {
		Notes []struct {
			SessionID string `json:"sessionId"`
		} `json:"notes"`
	}
	if err := json.Unmarshal(contents, &document); err != nil {
		t.Fatal(err)
	}
	sessionIds := []string{}
	for _, session := range document.Notes {
		sessionIds = append(sessionIds, session.SessionID)
	}
	return sessionIds
}

func expectStrings(t *testing.T, description string, expected, actual []string) {
	t.Helper()
	if strings.Join(expected, "|") != strings.Join(actual, "|") {
		t.Errorf("%s\n  expected: %q\n  actual:   %q", description, expected, actual)
	}
}

func isQuit(command tea.Cmd) bool {
	if command == nil {
		return false
	}
	_, isQuitMessage := command().(tea.QuitMsg)
	return isQuitMessage
}

func TestRowsListEverySessionWithNotesWithItsNotesIndented(t *testing.T) {
	store, _ := loadStore(writeStore(t, fixtureStore))
	rowTexts := []string{}
	for _, row := range buildRows(store.sessions()) {
		rowTexts = append(rowTexts, row.text)
	}
	expectStrings(t, "rows", []string{
		"2026-11-12 09:30  /repo",
		"    Login bug was a stale cookie",
		"    Deploy is on Friday",
		"    Left to do …",
	}, rowTexts)
}

func TestRowsTolerateSessionsWithMissingFields(t *testing.T) {
	store, err := loadStore(writeStore(t, `{"notes": [{"sessionId": "partial", "notes": ["Plain note", {"text": "object note"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	rowTexts := []string{}
	for _, row := range buildRows(store.sessions()) {
		rowTexts = append(rowTexts, row.text)
	}
	expectStrings(t, "rows", []string{"unknown time", "    Plain note", `    {"text":"object note"}`}, rowTexts)
}

func TestLoadStoreRejectsAnUnreadableStore(t *testing.T) {
	if _, err := loadStore(writeStore(t, "not json")); err == nil {
		t.Error("expected an error for a store that is not JSON")
	}
}

func TestDeleteRemovesTheSelectedNoteAfterConfirming(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	pressKeys(openBrowser(t, storePath), "j", "j", "d", "y")
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestArrowKeysMoveTheSelection(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	pressKeys(openBrowser(t, storePath), "down", "d", "y")
	expectStrings(t, "notes", []string{"Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestDeleteKeepsTheNoteWhenNotConfirmed(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	pressKeys(openBrowser(t, storePath), "j", "j", "d", "n")
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestDeleteAsksBeforeDeleting(t *testing.T) {
	current, _ := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "j", "d")
	if !strings.Contains(current.View(), "Delete this note? y/N") {
		t.Errorf("expected a delete prompt, got:\n%s", current.View())
	}
}

func TestDeleteOnASessionRemovesTheWholeSession(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	pressKeys(openBrowser(t, storePath), "d", "y")
	expectStrings(t, "sessions", []string{}, storedSessionIds(t, storePath))
}

func TestEnterOpensTheSessionWithAVisibleWayBack(t *testing.T) {
	current, _ := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "enter")
	view := current.View()
	for _, expected := range []string{"Note 1", "Login bug was a stale cookie", "Left to do", "○ Ship the fix", "✓ Wrote the test", "esc", "back"} {
		if !strings.Contains(view, expected) {
			t.Errorf("session view is missing %q:\n%s", expected, view)
		}
	}
	for _, sessionData := range []string{"fix the login bug", "pnpm test", "login.ts"} {
		if strings.Contains(view, sessionData) {
			t.Errorf("session view shows session data %q:\n%s", sessionData, view)
		}
	}
}

func TestEscLeavesTheSessionView(t *testing.T) {
	current, _ := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "enter", "esc")
	if current.screen != listScreen {
		t.Errorf("expected the list after esc, got screen %v", current.screen)
	}
}

func TestQLeavesTheSessionViewWithoutQuitting(t *testing.T) {
	current, command := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "enter", "q")
	if current.screen != listScreen || isQuit(command) {
		t.Errorf("expected q in the session view to go back to the list")
	}
}

func TestQQuitsFromTheList(t *testing.T) {
	_, command := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "q")
	if !isQuit(command) {
		t.Error("expected q in the list to quit")
	}
}

func TestEditOnASessionDoesNothing(t *testing.T) {
	_, command := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "e")
	if command != nil {
		t.Error("expected no editor for a session row")
	}
}

func TestEditOnANoteOpensTheEditor(t *testing.T) {
	_, command := pressKeys(openBrowser(t, writeStore(t, fixtureStore)), "j", "e")
	if command == nil {
		t.Error("expected the editor to open for a note row")
	}
}

func TestEditedNoteIsSaved(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	editedPath := filepath.Join(t.TempDir(), "note.txt")
	os.WriteFile(editedPath, []byte("Cookie expiry\nwas wrong\n\n"), 0o600)
	openBrowser(t, storePath).Update(editorClosedMessage{notePath: editedPath, sessionIndex: 0, noteIndex: 0})
	expectStrings(t, "notes", []string{"Cookie expiry\nwas wrong", "Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestEmptiedNoteIsLeftAsItWas(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	editedPath := filepath.Join(t.TempDir(), "note.txt")
	os.WriteFile(editedPath, []byte("  \n"), 0o600)
	openBrowser(t, storePath).Update(editorClosedMessage{notePath: editedPath, sessionIndex: 0, noteIndex: 0})
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestLongNoteTextIsKeptWhole(t *testing.T) {
	if length := len([]rune(normalizeNoteText(strings.Repeat("é", 6000)))); length != 6000 {
		t.Errorf("expected 6000 characters, got %d", length)
	}
}

func TestDeletingTheLastNoteRemovesTheSession(t *testing.T) {
	storePath := writeStore(t, `{"notes": [
  {"sessionId": "only-note", "notes": ["Only"]},
  {"sessionId": "kept", "notes": ["Kept"]}
]}`)
	pressKeys(openBrowser(t, storePath), "j", "d", "y")
	expectStrings(t, "sessions", []string{"kept"}, storedSessionIds(t, storePath))
}

func TestFullViewScrollsToTheEndOfALongNote(t *testing.T) {
	bullets := []string{"## Done"}
	for i := 1; i <= 60; i++ {
		bullets = append(bullets, fmt.Sprintf("- Finished task number %d with a long explanation of what changed and why it was decided", i))
	}
	encodedNote, _ := json.Marshal(strings.Join(bullets, "\n"))
	storePath := writeStore(t, `{"notes": [{"sessionId": "long", "startedAt": "2026-11-12T09:30:00.000Z", "cwd": "/repo", "notes": [`+string(encodedNote)+`]}]}`)
	current, _ := pressKeys(openBrowser(t, storePath), "enter")
	for range 300 {
		current, _ = pressKeys(current, "down")
	}
	if !strings.Contains(current.View(), "number 60 ") || !strings.Contains(current.View(), "end of session") {
		t.Errorf("expected the last bullet at the bottom, got:\n%s", current.View())
	}
	if lines := strings.Count(current.View(), "\n") + 1; lines > 24 {
		t.Errorf("expected the view to fit 24 rows, got %d", lines)
	}
}

func openLongSession(t *testing.T) browser {
	t.Helper()
	bullets := []string{"## Done"}
	for i := 1; i <= 60; i++ {
		bullets = append(bullets, fmt.Sprintf("- Finished task number %d", i))
	}
	encodedNote, _ := json.Marshal(strings.Join(bullets, "\n"))
	current, _ := pressKeys(openBrowser(t, writeStore(t, `{"notes": [{"sessionId": "long", "notes": [`+string(encodedNote)+`]}]}`)), "enter")
	return current
}

func TestFullViewSaysWhenMoreIsBelow(t *testing.T) {
	if view := openLongSession(t).View(); !strings.Contains(view, "more below") {
		t.Errorf("expected a more-below hint, got:\n%s", view)
	}
}

func TestMouseWheelScrollsTheFullView(t *testing.T) {
	current := openLongSession(t)
	for range 30 {
		updated, _ := current.Update(tea.MouseMsg{Button: tea.MouseButtonWheelDown, Action: tea.MouseActionPress})
		current = updated.(browser)
	}
	if !strings.Contains(current.View(), "number 60") {
		t.Errorf("expected the wheel to reach the last bullet, got:\n%s", current.View())
	}
}
