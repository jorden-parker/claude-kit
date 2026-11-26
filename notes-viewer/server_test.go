package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
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

func noteFilePath(relativePath string) string {
	home := os.Getenv("HOME")
	return filepath.Join(home, ".local", "share", relativePath)
}

func writeNoteFile(t *testing.T, relativePath string, text string) {
	t.Helper()
	notePath := noteFilePath(relativePath)
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
		titles = append(titles, section.Identifier+"="+section.Title)
	}
	if strings.Join(titles, ",") != "handoffs=Handoffs,project-notes=Project Notes,small-plans=Small Plans,brainstorm=Brainstorm Plans" {
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
	if plan.Title != "Clear the Cached Token" || plan.Group != "2026-11-19-1000-fix-login" || plan.Fields["status"] != "in-progress" || plan.Fields["depends_on"] != "1" {
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
	if plan.Title != "Let the Guard See Pipes" || plan.Name != "01-guard-pipe-stages" || plan.Group != "plan-2026-11-16-1333" || plan.Fields["status"] != "done" || plan.Fields["depends_on"] != "none" {
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
	if len(sections) != 4 || len(sections[0].Entries) != 3 || sections[2].Entries[0].Title != "Add the Test" {
		t.Fatalf("sections were %+v", sections)
	}

	page := requestPage("localhost:4000", "/")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Claude notes</title>") {
		t.Fatalf("page was %d %s", page.Code, page.Body.String())
	}
}

func TestPageHasCollapsibleGroupsFilterAndSections(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	for _, expected := range []string{"claude-notes:collapsed", "entry-section", "entry-created", `"note-filter"`} {
		if !strings.Contains(page, expected) {
			t.Fatalf("page is missing %q", expected)
		}
	}
	if strings.Contains(page, "entry-title-toggle") {
		t.Error("the page still has a collapse toggle on the note title")
	}
	if strings.Contains(page, "entry-details") {
		t.Error("the page still renders detail pills")
	}
}

func TestPageHasSidebarToggleAndNoGreeting(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	for _, expected := range []string{"claude-notes:sidebar", `id="sidebar-open"`, "sidebar-toggle"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("page is missing %q", expected)
		}
	}
	if strings.Contains(page, "greetByHour") {
		t.Fatal("page still greets by the hour")
	}
}

func TestPageKeepsContentsVisible(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	if !strings.Contains(page, "@container note") {
		t.Fatal("page has no note container query for the contents list")
	}
	for _, forbidden := range []string{"min-width: 1420px", "wideScreen"} {
		if strings.Contains(page, forbidden) {
			t.Fatalf("page still has %q", forbidden)
		}
	}
}

func TestPageHasProjectSwitcherAndStatusDots(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	for _, expected := range []string{"claude-notes:project", "project-switcher", "status-dot", "progress-count"} {
		if !strings.Contains(page, expected) {
			t.Fatalf("page is missing %q", expected)
		}
	}
}

func TestPageFormatsProjectNamesAndKinds(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	if !strings.Contains(page, "formatProjectName") {
		t.Fatal("page is missing formatProjectName")
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

func TestSectionsDefaultToTheirHomeFolders(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, rootVariable := range []string{"HANDOFFS_DIR", "PROJECT_NOTES_DIR", "SMALL_PLANS_DIR", "BRAINSTORM_DIR"} {
		t.Setenv(rootVariable, "")
	}
	for _, layout := range sectionLayouts {
		wantRoot := filepath.Join(home, ".local", "share", layout.Identifier)
		if resolveSectionRoot(layout) != wantRoot {
			t.Fatalf("%s root was %s, want %s", layout.Identifier, resolveSectionRoot(layout), wantRoot)
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

func sendNoteRequest(method string, path string, body string, origin string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Host = "127.0.0.1:4000"
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	response := httptest.NewRecorder()
	newViewerServer().ServeHTTP(response, request)
	return response
}

func buildSmallPlan(order int, goal string) string {
	plan := strings.Replace(validSmallPlan, "order: 2", fmt.Sprintf("order: %d", order), 1)
	plan = strings.Replace(plan, "depends_on: 1\n", "", 1)
	return strings.Replace(plan, "Logout clears the token.", goal, 1)
}

func readNoteFile(t *testing.T, relativePath string) (string, bool) {
	t.Helper()
	text, err := os.ReadFile(noteFilePath(relativePath))
	return string(text), err == nil
}

func TestEntriesCarryTheirSectionAndRawSource(t *testing.T) {
	seedNotes(t)

	plan := loadSections()[2].Entries[1]
	if plan.Section != "small-plans" || plan.Source != tokenPlan {
		t.Fatalf("plan was %+v", plan)
	}
}

func TestPutSavesTheNoteText(t *testing.T) {
	seedNotes(t)

	rewrittenHandoff := strings.Replace(validHandoff, "The login works again.", "Rewritten.", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/handoffs/claude-kit/002-fix-the-login.md", rewrittenHandoff, "http://127.0.0.1:4000")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}
	if text, _ := readNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md"); text != rewrittenHandoff {
		t.Fatalf("file was %q", text)
	}
}

func TestDeleteRemovesTheNote(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodDelete, "/api/notes/project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md", "", "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d", response.Code)
	}
	if _, isPresent := readNoteFile(t, "project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md"); isPresent {
		t.Fatal("the note still exists")
	}
}

func TestDeletingABrainstormPlanRemovesItsFolder(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodDelete, "/api/notes/brainstorm/claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", "", "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d", response.Code)
	}
	if _, isPresent := readNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/step-01.md"); isPresent {
		t.Fatal("the step file still exists")
	}
	if _, isPresent := readNoteFile(t, "brainstorm/claude-kit/plans/plan-2026-11-16-1333/index.md"); !isPresent {
		t.Fatal("the run index was removed")
	}
}

func TestNoteChangesRefusePathsOutsideTheSectionEntries(t *testing.T) {
	seedNotes(t)

	refusedPaths := []string{
		"/api/notes/handoffs/../project-notes/claude-kit/decision/2026-11-15-use-one-port.md",
		"/api/notes/handoffs/stray.md",
		"/api/notes/handoffs/claude-kit/missing.md",
		"/api/notes/brainstorm/claude-kit/plans/plan-2026-11-16-1333/index.md",
		"/api/notes/unknown/claude-kit/001-add-the-viewer.md",
	}
	for _, refusedPath := range refusedPaths {
		if response := sendNoteRequest(http.MethodDelete, refusedPath, "", ""); response.Code < 400 {
			t.Fatalf("%s answered %d", refusedPath, response.Code)
		}
	}
	if _, isPresent := readNoteFile(t, "handoffs/stray.md"); !isPresent {
		t.Fatal("the stray file was removed")
	}
}

func TestNoteChangesRefuseOtherOrigins(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPut, "/api/notes/handoffs/claude-kit/002-fix-the-login.md", "Hijacked.\n", "https://evil.example")
	if response.Code != http.StatusForbidden {
		t.Fatalf("status was %d", response.Code)
	}
	if text, _ := readNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md"); strings.Contains(text, "Hijacked") {
		t.Fatal("the note was overwritten")
	}
}

func TestDeletingASmallPlanGroupRemovesTheWholeSet(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodDelete, "/api/groups/small-plans/claude-kit/2026-11-19-1000-fix-login", "", "http://127.0.0.1:4000")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"); isPresent {
		t.Fatal("the set still exists")
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/2026-11-18-0900-add-the-viewer/01-serve-the-page.md"); !isPresent {
		t.Fatal("another set was removed")
	}
}

func TestGroupDeletesRefuseOtherSectionsAndUnknownGroups(t *testing.T) {
	seedNotes(t)

	refusedPaths := []string{
		"/api/groups/project-notes/claude-kit/finding",
		"/api/groups/small-plans/claude-kit/missing-set",
		"/api/groups/small-plans/claude-kit/..",
		"/api/groups/small-plans/claude-kit/stray.md",
		"/api/groups/small-plans/claude-kit/2026-11-19-1000-fix-login%2F..%2F..",
	}
	for _, refusedPath := range refusedPaths {
		if response := sendNoteRequest(http.MethodDelete, refusedPath, "", ""); response.Code < 400 {
			t.Fatalf("%s answered %d", refusedPath, response.Code)
		}
	}
	if _, isPresent := readNoteFile(t, "project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md"); !isPresent {
		t.Fatal("a project note group was removed")
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/stray.md"); !isPresent {
		t.Fatal("the stray file was removed")
	}
}

func TestSmallPlansCanBeUpdatedAndDeleted(t *testing.T) {
	seedNotes(t)

	planUrl := "/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"
	if response := sendNoteRequest(http.MethodPut, planUrl, buildSmallPlan(1, "Logout clears the token, with more."), ""); response.Code != http.StatusNoContent {
		t.Fatalf("update answered %d", response.Code)
	}
	if text, _ := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"); !strings.Contains(text, "with more") {
		t.Fatalf("plan was %q", text)
	}
	if response := sendNoteRequest(http.MethodDelete, planUrl, "", ""); response.Code != http.StatusNoContent {
		t.Fatalf("delete answered %d", response.Code)
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"); isPresent {
		t.Fatal("the plan still exists")
	}
}

func TestPostAddsANewSmallPlanToASet(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPost, "/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/03-ship-it.md", buildSmallPlan(3, "Ship."), "http://127.0.0.1:4000")
	if response.Code != http.StatusCreated {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}
	if text, _ := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/03-ship-it.md"); !strings.Contains(text, "Ship.") {
		t.Fatalf("plan was %q", text)
	}
	if plans := loadSections()[2]; len(plans.Entries) != 4 {
		t.Fatalf("plans were %s", listPaths(plans))
	}
}

func TestPostRefusesExistingPlansMissingSetsAndOtherSections(t *testing.T) {
	seedNotes(t)

	refusedPaths := []string{
		"/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md",
		"/api/notes/small-plans/claude-kit/missing-set/01-new.md",
		"/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/notes.txt",
		"/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/../escape.md",
		"/api/notes/handoffs/claude-kit/003-new.md",
	}
	for _, refusedPath := range refusedPaths {
		if response := sendNoteRequest(http.MethodPost, refusedPath, "Overwritten.\n", ""); response.Code < 400 {
			t.Fatalf("%s answered %d", refusedPath, response.Code)
		}
	}
	if text, _ := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"); strings.Contains(text, "Overwritten") {
		t.Fatal("an existing plan was overwritten")
	}
}

func TestPageKnowsEveryTitleAcronym(t *testing.T) {
	seedNotes(t)

	page := requestPage("localhost:4000", "/").Body.String()
	acronymSetPattern := regexp.MustCompile(`const titleAcronyms = new Set\(\[([^\]]*)\]\)`)
	match := acronymSetPattern.FindStringSubmatch(page)
	if match == nil {
		t.Fatal("the page has no titleAcronyms set")
	}
	for acronym := range titleAcronyms {
		if !strings.Contains(match[1], `"`+acronym+`"`) {
			t.Errorf("the page's titleAcronyms set is missing %q", acronym)
		}
	}
}

func TestToTitleCase(t *testing.T) {
	cases := []struct{ title, want string }{
		{"Ai meal suggestion disclosure", "AI Meal Suggestion Disclosure"},
		{"add the viewer", "Add the Viewer"},
		{"GitHub sync for the api", "GitHub Sync for the API"},
		{"the end of the", "The End of The"},
		{"ios  app", "iOS App"},
		{"claude-kit notes viewer", "claude-kit Notes Viewer"},
		{"move notes into claude-kit-private", "Move Notes Into claude-kit-private"},
		{"thumbs up/down", "Thumbs Up/Down"},
		{"Thumbs up/down buttons", "Thumbs Up/Down Buttons"},
		{"api/cli parity", "API/CLI Parity"},
		{"the /handoff command", "The /handoff Command"},
		{"sign-in/sign-up flow", "sign-in/sign-up Flow"},
	}
	for _, testCase := range cases {
		if got := toTitleCase(testCase.title); got != testCase.want {
			t.Errorf("toTitleCase(%q) = %q, want %q", testCase.title, got, testCase.want)
		}
	}
}

func TestAHandoffTopicFolderThatIsNotARepositoryIsListedAndItsNoteIsServed(t *testing.T) {
	seedNotes(t)
	topicHandoff := "---\ntitle: Compare the vendors\nproject: research\ncreated: 2026-11-18T09:00:00.000Z\ncwd: /Users/me/notes\ntopic: research\n---\n\nThe shortlist is ready.\n"
	writeNoteFile(t, "handoffs/research/001-compare-the-vendors.md", topicHandoff)

	writeNoteFile(t, "project-notes/claude-kit/api-cleanup/2026-11-14-trim-the-routes.md", "---\ntitle: Trim the routes\n---\n\nA note.\n")

	var topicEntry *entryView
	sections := loadSections()
	handoffs := sections[0]
	for index := range handoffs.Entries {
		if handoffs.Entries[index].Project == "research" {
			topicEntry = &handoffs.Entries[index]
		}
	}
	if topicEntry == nil {
		t.Fatalf("no research entry in %s", listPaths(handoffs))
	}
	if topicEntry.Title != "Compare the Vendors" || topicEntry.Source != topicHandoff || !strings.Contains(topicEntry.Html, "The shortlist is ready.") {
		t.Fatalf("entry was %+v", topicEntry)
	}
	groupTitle := ""
	for _, groupedEntry := range sections[1].Entries {
		if groupedEntry.Group == "api-cleanup" {
			groupTitle = groupedEntry.GroupTitle
		}
	}
	if groupTitle != "API Cleanup" {
		t.Errorf("group title was %q, want %q", groupTitle, "API Cleanup")
	}
}

func TestFormatGroupTitle(t *testing.T) {
	for _, testCase := range []struct{ group, want string }{
		{"api-cleanup", "API Cleanup"},
		{"finding", "Finding"},
		{"add-the-viewer", "Add the Viewer"},
		{"v2-migration", "V2 Migration"},
		{"plan-2026-11-16-1333", "plan-2026-11-16-1333"},
		{"", ""},
	} {
		if got := formatGroupTitle(testCase.group); got != testCase.want {
			t.Errorf("formatGroupTitle(%q) = %q, want %q", testCase.group, got, testCase.want)
		}
	}
}
