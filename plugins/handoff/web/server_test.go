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

const parserHandoff = `---
title: Continue the parser: rewrite
project: claude-kit
created: 2026-11-19T10:00:00.000Z
cwd: /src/claude-kit
focus: the parser
---

## What is left

1. Finish the tokenizer

| File | State |
| --- | --- |
| parser.ts | half done |

- [x] tests written

**Goal:** a faster parser
**Next:** run pnpm test

<script>alert(1)</script>
[bad](javascript:alert(1))
`

func writeHandoffFile(t *testing.T, handoffsRoot string, relativePath string, text string) {
	t.Helper()
	handoffPath := filepath.Join(handoffsRoot, relativePath)
	if err := os.MkdirAll(filepath.Dir(handoffPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(handoffPath, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func seedHandoffs(t *testing.T) string {
	t.Helper()
	handoffsRoot := t.TempDir()
	writeHandoffFile(t, handoffsRoot, "claude-kit/003-continue-the-parser.md", parserHandoff)
	writeHandoffFile(t, handoffsRoot, "claude-kit/002-older.md", "---\ntitle: Older handoff\nproject: claude-kit\ncreated: 2026-11-18T09:00:00.000Z\n---\n\nOld.\n")
	writeHandoffFile(t, handoffsRoot, "claude-kit/010-newest.md", "---\ntitle: Newest handoff\nproject: claude-kit\ncreated: 2026-11-19T12:00:00.000Z\n---\n\nNew.\n")
	writeHandoffFile(t, handoffsRoot, "atlas/001-plain-file.md", "No front matter here.\n")
	writeHandoffFile(t, handoffsRoot, "stray.md", "Not inside a project.\n")
	return handoffsRoot
}

func TestHandoffsAreReadFromProjectFoldersNewestFirst(t *testing.T) {
	handoffs := loadHandoffs(seedHandoffs(t))

	paths := []string{}
	for _, handoff := range handoffs {
		paths = append(paths, handoff.Path)
	}
	expectedPaths := []string{
		"atlas/001-plain-file.md",
		"claude-kit/010-newest.md",
		"claude-kit/003-continue-the-parser.md",
		"claude-kit/002-older.md",
	}
	if strings.Join(paths, "\n") != strings.Join(expectedPaths, "\n") {
		t.Fatalf("paths were %v", paths)
	}
}

func TestFrontMatterFillsTheHandoffAndIsNotRendered(t *testing.T) {
	handoff := loadHandoffs(seedHandoffs(t))[2]

	if handoff.Title != "Continue the parser: rewrite" || handoff.Id != 3 || handoff.Project != "claude-kit" || handoff.Created != "2026-11-19T10:00:00.000Z" || handoff.Focus != "the parser" {
		t.Fatalf("handoff was %+v", handoff)
	}
	if strings.Contains(handoff.Html, "focus: the parser") {
		t.Fatalf("front matter was rendered: %s", handoff.Html)
	}
}

func TestHandoffWithoutFrontMatterTakesItsFolderAndFileName(t *testing.T) {
	handoff := loadHandoffs(seedHandoffs(t))[0]

	if handoff.Title != "001-plain-file" || handoff.Id != 1 || handoff.Project != "atlas" {
		t.Fatalf("handoff was %+v", handoff)
	}
	if !strings.Contains(handoff.Html, "<p>No front matter here.</p>") {
		t.Fatalf("html was %s", handoff.Html)
	}
}

func TestMarkdownIsRenderedAndUnsafeHtmlIsDropped(t *testing.T) {
	renderedHtml := loadHandoffs(seedHandoffs(t))[2].Html

	for _, expected := range []string{"<h2", "<ol>", "<table>", "<td>half done</td>", `type="checkbox"`, "a faster parser<br>"} {
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

func requestPage(handoffsRoot string, host string, path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = host
	response := httptest.NewRecorder()
	newHandoffsServer(handoffsRoot).ServeHTTP(response, request)
	return response
}

func TestServerListsHandoffsAsJsonAndServesThePage(t *testing.T) {
	handoffsRoot := seedHandoffs(t)

	listing := requestPage(handoffsRoot, "127.0.0.1:4000", "/api/handoffs")
	var handoffs []handoffView
	if err := json.Unmarshal(listing.Body.Bytes(), &handoffs); err != nil {
		t.Fatal(err)
	}
	if len(handoffs) != 4 || handoffs[1].Title != "Newest handoff" {
		t.Fatalf("handoffs were %+v", handoffs)
	}

	page := requestPage(handoffsRoot, "localhost:4000", "/")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Handoffs</title>") {
		t.Fatalf("page was %d %s", page.Code, page.Body.String())
	}
}

func TestServerRefusesOtherHosts(t *testing.T) {
	response := requestPage(seedHandoffs(t), "evil.example", "/api/handoffs")

	if response.Code != http.StatusForbidden {
		t.Fatalf("status was %d", response.Code)
	}
}

func TestMissingHandoffsFolderListsNothing(t *testing.T) {
	listing := requestPage(filepath.Join(t.TempDir(), "absent"), "127.0.0.1:4000", "/api/handoffs")

	if strings.TrimSpace(listing.Body.String()) != "[]" {
		t.Fatalf("body was %s", listing.Body.String())
	}
}
