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

const debuggingNote = `---
title: Profile 401: after refresh
category: debugging
project: claude-kit
created: 2026-11-19T10:00:00.000Z
---

## Steps taken

1. Logged in

| Request | Status |
| --- | --- |
| GET /profile | 401 |

- [x] reproduced

**Title:** Profile 401
**Type:** Bug

<script>alert(1)</script>
[bad](javascript:alert(1))
`

func writeNoteFile(t *testing.T, notesRoot string, relativePath string, text string) {
	t.Helper()
	notePath := filepath.Join(notesRoot, relativePath)
	if err := os.MkdirAll(filepath.Dir(notePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(notePath, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func seedNotes(t *testing.T) string {
	t.Helper()
	notesRoot := t.TempDir()
	writeNoteFile(t, notesRoot, "claude-kit/debugging/2026-11-19-profile-401.md", debuggingNote)
	writeNoteFile(t, notesRoot, "claude-kit/fact/2026-11-18-older.md", "---\ntitle: Older fact\ncategory: fact\nproject: claude-kit\ncreated: 2026-11-18T09:00:00.000Z\n---\n\nOld.\n")
	writeNoteFile(t, notesRoot, "claude-kit/fact/2026-11-19-newer.md", "---\ntitle: Newer fact\ncategory: fact\nproject: claude-kit\ncreated: 2026-11-19T09:00:00.000Z\n---\n\nNew.\n")
	writeNoteFile(t, notesRoot, "atlas/finding/2026-11-17-plain-file.md", "No front matter here.\n")
	writeNoteFile(t, notesRoot, "stray.md", "Not inside a project and category.\n")
	return notesRoot
}

func TestNotesAreReadFromProjectAndCategoryFolders(t *testing.T) {
	notes := loadNotes(seedNotes(t))

	paths := []string{}
	for _, note := range notes {
		paths = append(paths, note.Path)
	}
	expectedPaths := []string{
		"atlas/finding/2026-11-17-plain-file.md",
		"claude-kit/debugging/2026-11-19-profile-401.md",
		"claude-kit/fact/2026-11-19-newer.md",
		"claude-kit/fact/2026-11-18-older.md",
	}
	if strings.Join(paths, "\n") != strings.Join(expectedPaths, "\n") {
		t.Fatalf("paths were %v", paths)
	}
}

func TestFrontMatterFillsTheNoteAndIsNotRendered(t *testing.T) {
	note := loadNotes(seedNotes(t))[1]

	if note.Title != "Profile 401: after refresh" || note.Category != "debugging" || note.Project != "claude-kit" || note.Created != "2026-11-19T10:00:00.000Z" {
		t.Fatalf("note was %+v", note)
	}
	if strings.Contains(note.Html, "category: debugging") {
		t.Fatalf("front matter was rendered: %s", note.Html)
	}
}

func TestNoteWithoutFrontMatterTakesItsFolderAndFileName(t *testing.T) {
	note := loadNotes(seedNotes(t))[0]

	if note.Title != "2026-11-17-plain-file" || note.Category != "finding" || note.Project != "atlas" {
		t.Fatalf("note was %+v", note)
	}
	if !strings.Contains(note.Html, "<p>No front matter here.</p>") {
		t.Fatalf("html was %s", note.Html)
	}
}

func TestMarkdownIsRenderedAndUnsafeHtmlIsDropped(t *testing.T) {
	renderedHtml := loadNotes(seedNotes(t))[1].Html

	for _, expected := range []string{"<h2", "<ol>", "<table>", "<td>401</td>", `type="checkbox"`, "Profile 401<br>"} {
		if !strings.Contains(renderedHtml, expected) {
			t.Errorf("html lacks %s: %s", expected, renderedHtml)
		}
	}
	for _, unsafe := range []string{"<script", "javascript:"} {
		if strings.Contains(renderedHtml, unsafe) {
			t.Errorf("html holds %s: %s", unsafe, renderedHtml)
		}
	}
}

func requestPage(notesRoot string, host string, path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = host
	response := httptest.NewRecorder()
	newNotesServer(notesRoot).ServeHTTP(response, request)
	return response
}

func TestServerListsNotesAsJsonAndServesThePage(t *testing.T) {
	notesRoot := seedNotes(t)

	listing := requestPage(notesRoot, "127.0.0.1:4000", "/api/notes")
	var notes []noteView
	if err := json.Unmarshal(listing.Body.Bytes(), &notes); err != nil {
		t.Fatal(err)
	}
	if len(notes) != 4 || notes[2].Title != "Newer fact" {
		t.Fatalf("notes were %+v", notes)
	}

	page := requestPage(notesRoot, "localhost:4000", "/")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Project notes</title>") {
		t.Fatalf("page was %d %s", page.Code, page.Body.String())
	}
}

func TestServerRefusesOtherHosts(t *testing.T) {
	response := requestPage(seedNotes(t), "evil.example", "/api/notes")

	if response.Code != http.StatusForbidden {
		t.Fatalf("status was %d", response.Code)
	}
}

func TestMissingNotesFolderListsNothing(t *testing.T) {
	listing := requestPage(filepath.Join(t.TempDir(), "absent"), "127.0.0.1:4000", "/api/notes")

	if strings.TrimSpace(listing.Body.String()) != "[]" {
		t.Fatalf("body was %s", listing.Body.String())
	}
}
