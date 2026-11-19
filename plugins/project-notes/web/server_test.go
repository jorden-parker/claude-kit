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

const tokenPlan = `---
title: Clear the cached token
project: claude-kit
kind: fix
status: in-progress
depends_on: 1
created: 2026-11-19T10:00:00.000Z
---

## Steps
1. Clear the token.

<script>alert(1)</script>
`

func writeNoteFile(t *testing.T, relativePath string, text string) {
	t.Helper()
	notePath := filepath.Join(os.Getenv("HOME"), ".claude", relativePath)
	if err := os.MkdirAll(filepath.Dir(notePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(notePath, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func seedNotes(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	for _, rootVariable := range []string{"HANDOFFS_DIR", "PROJECT_NOTES_DIR", "SMALL_PLANS_DIR", "BRAINSTORM_DIR"} {
		t.Setenv(rootVariable, "")
	}
	writeNoteFile(t, "handoffs/claude-kit/001-add-the-viewer.md", "---\ntitle: Add the viewer\ncreated: 2026-11-17T09:00:00.000Z\nfocus: the sidebar\n---\n\nOlder handoff.\n")
	writeNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md", "---\ntitle: Fix the login\ncreated: 2026-11-18T09:00:00.000Z\n---\n\nNewer handoff.\n")
	writeNoteFile(t, "handoffs/atlas/001-plain-file.md", "No front matter here.\n")
	writeNoteFile(t, "handoffs/stray.md", "Not inside a project folder.\n")
	writeNoteFile(t, "project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md", "---\ntitle: The cache is stale\n---\n\nA finding.\n")
	writeNoteFile(t, "project-notes/claude-kit/decision/2026-11-15-use-one-port.md", "---\ntitle: Use one port\ncreated: 2026-11-15T08:00:00.000Z\n---\n\nA decision.\n")
	writeNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/02-clear-the-cached-token.md", tokenPlan)
	writeNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md", "---\ntitle: Add the test\nstatus: done\n---\n\nFirst.\n")
	writeNoteFile(t, "small-plans/claude-kit/2026-11-18-0900-add-the-viewer/01-serve-the-page.md", "---\ntitle: Serve the page\n---\n\nOlder set.\n")
	writeNoteFile(t, "small-plans/claude-kit/stray.md", "Not inside a set folder.\n")
	writeNoteFile(t, "brainstorm/claude-kit/brainstorm-2026-11-16-1332.html", "<p>The ideas page.</p>\n")
	writeNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-16-1333/index.md", "# Plans: Guard fixes\n")
	writeNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", "# Plan: Let the guard see pipes\n\n- Status: done\n- Kind: change\n- Depends on: none\n\n## Goal\n\nThe guard reads later stages.\n")
	writeNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/step-01.md", "# Step 01: Add the pipeline tests\n\nWrite the failing test.\n")
	writeNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-17-0900/01-newer-run/plan.md", "# Plan: Newer run\n\n- Status: pending\n")
}

func listPaths(section sectionView) string {
	paths := []string{}
	for _, entry := range section.Entries {
		paths = append(paths, entry.Path)
	}
	return strings.Join(paths, "\n")
}

func TestSectionsAreHandoffsThenProjectNotesThenSmallPlans(t *testing.T) {
	seedNotes(t)

	titles := []string{}
	for _, section := range loadSections() {
		titles = append(titles, section.Id+"="+section.Title)
	}
	if strings.Join(titles, ",") != "handoffs=Handoffs,project-notes=Project notes,small-plans=Small plans,brainstorm=Brainstorm plans" {
		t.Fatalf("sections were %v", titles)
	}
}

func TestHandoffsAreSortedByProjectThenNewestFirst(t *testing.T) {
	seedNotes(t)

	paths := listPaths(loadSections()[0])
	if paths != "atlas/001-plain-file.md\nclaude-kit/002-fix-the-login.md\nclaude-kit/001-add-the-viewer.md" {
		t.Fatalf("paths were %s", paths)
	}
}

func TestProjectNotesAreGroupedByCategoryAndDatedByTheirFileName(t *testing.T) {
	seedNotes(t)

	notes := loadSections()[1]
	if listPaths(notes) != "claude-kit/decision/2026-11-15-use-one-port.md\nclaude-kit/finding/2026-11-16-the-cache-is-stale.md" {
		t.Fatalf("paths were %s", listPaths(notes))
	}
	finding := notes.Entries[1]
	if finding.Group != "finding" || finding.Created != "2026-11-16" || finding.Project != "claude-kit" {
		t.Fatalf("finding was %+v", finding)
	}
}

func TestSmallPlansAreSortedByNewestSetThenOrder(t *testing.T) {
	seedNotes(t)

	paths := listPaths(loadSections()[2])
	expectedPaths := []string{
		"claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md",
		"claude-kit/2026-11-19-1000-fix-login/02-clear-the-cached-token.md",
		"claude-kit/2026-11-18-0900-add-the-viewer/01-serve-the-page.md",
	}
	if paths != strings.Join(expectedPaths, "\n") {
		t.Fatalf("paths were %s", paths)
	}
}

func TestFrontMatterFillsTheEntryAndIsNotRendered(t *testing.T) {
	seedNotes(t)

	plan := loadSections()[2].Entries[1]
	if plan.Title != "Clear the cached token" || plan.Group != "2026-11-19-1000-fix-login" || plan.Fields["status"] != "in-progress" || plan.Fields["depends_on"] != "1" {
		t.Fatalf("plan was %+v", plan)
	}
	if strings.Contains(plan.Html, "kind: fix") || strings.Contains(plan.Html, "<script") {
		t.Fatalf("front matter or raw html was rendered: %s", plan.Html)
	}
	if !strings.Contains(plan.Html, "<ol>") {
		t.Fatalf("markdown was not rendered: %s", plan.Html)
	}
}

func TestEntryWithoutFrontMatterTakesItsFileName(t *testing.T) {
	seedNotes(t)

	handoff := loadSections()[0].Entries[0]
	if handoff.Title != "001-plain-file" || handoff.Name != "001-plain-file" || handoff.Project != "atlas" || handoff.Group != "" {
		t.Fatalf("handoff was %+v", handoff)
	}
}

func TestBrainstormPlansAreReadFromTheirHeadingAndShowTheirSteps(t *testing.T) {
	seedNotes(t)

	brainstorm := loadSections()[3]
	if listPaths(brainstorm) != "claude-kit/plans/plan-2026-11-17-0900/01-newer-run/plan.md\nclaude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md" {
		t.Fatalf("paths were %s", listPaths(brainstorm))
	}
	plan := brainstorm.Entries[1]
	if plan.Title != "Let the guard see pipes" || plan.Name != "01-guard-pipe-stages" || plan.Group != "plan-2026-11-16-1333" || plan.Fields["status"] != "done" || plan.Fields["depends_on"] != "none" {
		t.Fatalf("plan was %+v", plan)
	}
	if !strings.Contains(plan.Html, "The guard reads later stages.") || !strings.Contains(plan.Html, "Step 01: Add the pipeline tests") {
		t.Fatalf("the plan or its step was not rendered: %s", plan.Html)
	}
}

func TestRootVariableMovesASection(t *testing.T) {
	seedNotes(t)
	movedRoot := t.TempDir()
	t.Setenv("HANDOFFS_DIR", movedRoot)
	if err := os.MkdirAll(filepath.Join(movedRoot, "moved"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(movedRoot, "moved", "001-elsewhere.md"), []byte("Moved.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if paths := listPaths(loadSections()[0]); paths != "moved/001-elsewhere.md" {
		t.Fatalf("paths were %s", paths)
	}
}

func requestPage(host string, path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = host
	response := httptest.NewRecorder()
	newViewerServer().ServeHTTP(response, request)
	return response
}

func TestServerListsSectionsAsJsonAndServesThePage(t *testing.T) {
	seedNotes(t)

	listing := requestPage("127.0.0.1:4000", "/api/sections")
	var sections []sectionView
	if err := json.Unmarshal(listing.Body.Bytes(), &sections); err != nil {
		t.Fatal(err)
	}
	if len(sections) != 4 || len(sections[0].Entries) != 3 || sections[2].Entries[0].Title != "Add the test" {
		t.Fatalf("sections were %+v", sections)
	}

	page := requestPage("localhost:4000", "/")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Claude notes</title>") {
		t.Fatalf("page was %d %s", page.Code, page.Body.String())
	}
}

func TestServerRefusesOtherHosts(t *testing.T) {
	seedNotes(t)

	if response := requestPage("evil.example", "/api/sections"); response.Code != http.StatusForbidden {
		t.Fatalf("status was %d", response.Code)
	}
}

func TestMissingFoldersListEmptySections(t *testing.T) {
	t.Setenv("HOME", filepath.Join(t.TempDir(), "absent"))

	for _, section := range loadSections() {
		if section.Entries == nil || len(section.Entries) != 0 {
			t.Fatalf("section was %+v", section)
		}
	}
}

func TestPageUrlOpensTheNamedSection(t *testing.T) {
	if pageUrl := buildPageUrl("47618", []string{"small-plans"}); pageUrl != "http://127.0.0.1:47618/#small-plans" {
		t.Fatalf("url was %s", pageUrl)
	}
	if pageUrl := buildPageUrl("47618", nil); pageUrl != "http://127.0.0.1:47618/" {
		t.Fatalf("url was %s", pageUrl)
	}
}
