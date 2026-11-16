package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fixtureStore = `{"notes": [
  {"sessionId": "session-b", "cwd": "/repo", "startedAt": "2026-11-12T09:30:00.000Z",
   "prompts": ["fix the login bug"], "files": ["/repo/login.ts"], "commands": ["pnpm test"],
   "notes": ["Login bug was a stale cookie", "Deploy is on Friday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"]},
  {"sessionId": "session-a", "cwd": "/old", "startedAt": "2026-11-01T10:00:00.000Z",
   "prompts": ["old prompt"], "files": [], "commands": []},
  {"sessionId": "session-c", "cwd": "/other", "startedAt": "2026-11-13T08:00:00.000Z", "notes": ["Other note"]}
]}`

func writeStore(t *testing.T, contents string) string {
	t.Helper()
	storePath := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(storePath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return storePath
}

func sendRequest(t *testing.T, storePath, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Host = "127.0.0.1:4321"
	recorder := httptest.NewRecorder()
	newNotesServer(storePath).ServeHTTP(recorder, request)
	return recorder
}

func storedNotes(t *testing.T, storePath string, sessionIndex int) []string {
	t.Helper()
	contents, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Notes []struct {
			Notes []string `json:"notes"`
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

func expectStatus(t *testing.T, expected int, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != expected {
		t.Errorf("status: expected %d, got %d (%s)", expected, recorder.Code, recorder.Body.String())
	}
}

func listedSessions(t *testing.T, storePath string) []sessionView {
	t.Helper()
	recorder := sendRequest(t, storePath, http.MethodGet, "/api/sessions", "")
	expectStatus(t, http.StatusOK, recorder)
	var sessions []sessionView
	if err := json.Unmarshal(recorder.Body.Bytes(), &sessions); err != nil {
		t.Fatal(err)
	}
	return sessions
}

func TestLoadStoreRejectsAnUnreadableStore(t *testing.T) {
	if _, err := loadStore(writeStore(t, "not json")); err == nil {
		t.Error("expected an error for a store that is not JSON")
	}
}

func TestPageIsServed(t *testing.T) {
	recorder := sendRequest(t, writeStore(t, fixtureStore), http.MethodGet, "/", "")
	expectStatus(t, http.StatusOK, recorder)
	if !strings.Contains(recorder.Body.String(), "<title>Session notes</title>") {
		t.Error("expected the session notes page")
	}
}

func TestSessionsListEverySessionWithNotesNumberedLikeTheCli(t *testing.T) {
	sessions := listedSessions(t, writeStore(t, fixtureStore))
	titles := []string{}
	for _, session := range sessions {
		titles = append(titles, session.Title)
	}
	expectStrings(t, "titles", []string{"2026-11-12 09:30 UTC · /repo", "2026-11-13 08:00 UTC · /other"}, titles)
	if sessions[1].Number != 2 || sessions[0].Notes[2].Number != 3 {
		t.Errorf("unexpected numbering: %+v", sessions)
	}
}

func TestNotesCarryTheirTextAndFormattedLines(t *testing.T) {
	note := listedSessions(t, writeStore(t, fixtureStore))[0].Notes[2]
	if note.Text != "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test" {
		t.Errorf("text: %q", note.Text)
	}
	formatted := []string{}
	for _, line := range note.Lines {
		prefix := ""
		if line.IsHeading {
			prefix = "# "
		}
		formatted = append(formatted, prefix+line.Text)
	}
	expectStrings(t, "lines", []string{"# Left to do", "○ Ship the fix", "# Done", "✓ Wrote the test"}, formatted)
}

func TestSessionsTolerateMissingFields(t *testing.T) {
	sessions := listedSessions(t, writeStore(t, `{"notes": [{"sessionId": "partial", "notes": ["Plain note", {"text": "object note"}]}]}`))
	if sessions[0].Title != "unknown time" {
		t.Errorf("title: %q", sessions[0].Title)
	}
	expectStrings(t, "notes", []string{"Plain note", `{"text":"object note"}`}, []string{sessions[0].Notes[0].Text, sessions[0].Notes[1].Text})
}

func TestNewNotesShowWithoutRestarting(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	server := newNotesServer(storePath)
	os.WriteFile(storePath, []byte(`{"notes": [{"notes": ["Fresh note"]}]}`), 0o600)
	request := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	request.Host = "localhost:4321"
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if !strings.Contains(recorder.Body.String(), "Fresh note") {
		t.Errorf("expected the fresh note, got %s", recorder.Body.String())
	}
}

func TestAmendReplacesTheNoteInPlace(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	expectStatus(t, http.StatusNoContent, sendRequest(t, storePath, http.MethodPut, "/api/sessions/1/notes/2", `{"text": "  Deploy moved to Monday \n"}`))
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "Deploy moved to Monday", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestAmendKeepsLongTextWhole(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	longText := strings.Repeat("x", 6000)
	sendRequest(t, storePath, http.MethodPut, "/api/sessions/1/notes/1", `{"text": "`+longText+`"}`)
	if storedNotes(t, storePath, 0)[0] != longText {
		t.Error("expected the long note kept whole")
	}
}

func TestAmendWithEmptyTextChangesNothing(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	recorder := sendRequest(t, storePath, http.MethodPut, "/api/sessions/1/notes/1", `{"text": "  "}`)
	expectStatus(t, http.StatusBadRequest, recorder)
	if !strings.Contains(recorder.Body.String(), "The note needs some text.") {
		t.Errorf("body: %s", recorder.Body.String())
	}
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "Deploy is on Friday"}, storedNotes(t, storePath, 0)[:2])
}

func TestDeleteRemovesTheNote(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	expectStatus(t, http.StatusNoContent, sendRequest(t, storePath, http.MethodDelete, "/api/sessions/1/notes/2", ""))
	expectStrings(t, "notes", []string{"Login bug was a stale cookie", "## Left to do\n- [ ] Ship the fix\n## Done\n- [x] Wrote the test"}, storedNotes(t, storePath, 0))
}

func TestDeletingTheLastNoteRemovesTheSession(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	sendRequest(t, storePath, http.MethodDelete, "/api/sessions/2/notes/1", "")
	expectStrings(t, "sessions", []string{"session-b"}, storedSessionIds(t, storePath))
}

func TestDeleteSessionRemovesTheWholeSession(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	expectStatus(t, http.StatusNoContent, sendRequest(t, storePath, http.MethodDelete, "/api/sessions/1", ""))
	expectStrings(t, "sessions", []string{"session-c"}, storedSessionIds(t, storePath))
}

func TestMissingNoteIsNotFound(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	expectStatus(t, http.StatusNotFound, sendRequest(t, storePath, http.MethodDelete, "/api/sessions/1/notes/9", ""))
	expectStatus(t, http.StatusNotFound, sendRequest(t, storePath, http.MethodDelete, "/api/sessions/9", ""))
	expectStatus(t, http.StatusNotFound, sendRequest(t, storePath, http.MethodDelete, "/api/sessions/0", ""))
}

func TestForeignHostIsRefused(t *testing.T) {
	storePath := writeStore(t, fixtureStore)
	request := httptest.NewRequest(http.MethodDelete, "/api/sessions/1", nil)
	request.Host = "evil.example:4321"
	recorder := httptest.NewRecorder()
	newNotesServer(storePath).ServeHTTP(recorder, request)
	expectStatus(t, http.StatusForbidden, recorder)
	expectStrings(t, "sessions", []string{"session-b", "session-a", "session-c"}, storedSessionIds(t, storePath))
}
