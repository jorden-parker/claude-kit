package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func readMovedPath(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	if response.Code != http.StatusOK {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}
	var moved struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	return moved.Path
}

func buildMovedHandoff(project string) string {
	return strings.Replace(validHandoff, "project: claude-kit", "project: "+project, 1)
}

func TestMovingAHandoffTakesTheNextNumberInTheNewProject(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPut, "/api/notes/handoffs/claude-kit/001-add-the-viewer.md?project=atlas", buildMovedHandoff("atlas"), "")
	if movedPath := readMovedPath(t, response); movedPath != "atlas/002-add-the-viewer.md" {
		t.Fatalf("moved path was %s", movedPath)
	}
	if text, _ := readNoteFile(t, "handoffs/atlas/002-add-the-viewer.md"); text != buildMovedHandoff("atlas") {
		t.Fatalf("moved file was %q", text)
	}
	if _, isPresent := readNoteFile(t, "handoffs/claude-kit/001-add-the-viewer.md"); isPresent {
		t.Fatal("the old handoff is still there")
	}
}

func TestMovingAProjectNoteKeepsItsCategoryAndName(t *testing.T) {
	seedNotes(t)

	text := strings.Replace(validProjectNote, "project: claude-kit", "project: atlas", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md?project=atlas", text, "")
	if movedPath := readMovedPath(t, response); movedPath != "atlas/finding/2026-11-16-the-cache-is-stale.md" {
		t.Fatalf("moved path was %s", movedPath)
	}
	if _, isPresent := readNoteFile(t, "project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md"); isPresent {
		t.Fatal("the old note is still there")
	}
}

func TestMovingAProjectNoteOntoATakenNameAddsANumber(t *testing.T) {
	seedNotes(t)
	writeNoteFile(t, "project-notes/atlas/finding/2026-11-16-the-cache-is-stale.md", validProjectNote)

	text := strings.Replace(validProjectNote, "project: claude-kit", "project: atlas", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/project-notes/claude-kit/finding/2026-11-16-the-cache-is-stale.md?project=atlas", text, "")
	if movedPath := readMovedPath(t, response); movedPath != "atlas/finding/2026-11-16-the-cache-is-stale-2.md" {
		t.Fatalf("moved path was %s", movedPath)
	}
}

func TestMovingTheLastSmallPlanOfASetRemovesTheEmptySetFolder(t *testing.T) {
	seedNotes(t)

	plan := strings.Replace(buildSmallPlan(1, "Serve the page."), "set: 2026-11-19-1000-fix-login", "set: 2026-11-18-0900-add-the-viewer", 1)
	plan = strings.Replace(plan, "project: claude-kit", "project: atlas", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/small-plans/claude-kit/2026-11-18-0900-add-the-viewer/01-serve-the-page.md?project=atlas", plan, "")
	if movedPath := readMovedPath(t, response); movedPath != "atlas/2026-11-18-0900-add-the-viewer/01-serve-the-page.md" {
		t.Fatalf("moved path was %s", movedPath)
	}
	if groupFolder, isGroup := resolveGroupFolder("small-plans", "claude-kit", "2026-11-18-0900-add-the-viewer"); isGroup {
		t.Fatalf("the empty set folder %s is still there", groupFolder)
	}
}

func TestMovingASmallPlanOntoATakenNumberIsRefused(t *testing.T) {
	seedNotes(t)
	writeNoteFile(t, "small-plans/atlas/2026-11-19-1000-fix-login/01-other.md", "Taken.\n")

	plan := strings.Replace(buildSmallPlan(1, "Add the test."), "project: claude-kit", "project: atlas", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md?project=atlas", plan, "")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "Plan 01 already exists") {
		t.Fatalf("answered %d %s", response.Code, response.Body.String())
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md"); !isPresent {
		t.Fatal("the plan was removed")
	}
}

func TestMovingKeepsTheFormatRules(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPut, "/api/notes/handoffs/claude-kit/002-fix-the-login.md?project=atlas", validHandoff, "")
	if response.Code != http.StatusUnprocessableEntity || !strings.Contains(response.Body.String(), `"project" must match the folder the file is in: "atlas"`) {
		t.Fatalf("answered %d %s", response.Code, response.Body.String())
	}
	if _, isPresent := readNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md"); !isPresent {
		t.Fatal("the handoff was moved anyway")
	}
}

func TestMovingRefusesBadProjectNamesAndBrainstormPlans(t *testing.T) {
	seedNotes(t)

	refusedMoves := map[string]string{
		"/api/notes/handoffs/claude-kit/002-fix-the-login.md?project=..":                                         buildMovedHandoff(".."),
		"/api/notes/handoffs/claude-kit/002-fix-the-login.md?project=a%2Fb":                                      buildMovedHandoff("a/b"),
		"/api/notes/handoffs/claude-kit/002-fix-the-login.md?project=-":                                          buildMovedHandoff("-"),
		"/api/notes/brainstorm/claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md?project=atlas": validBrainstormPlan,
	}
	for refusedUrl, text := range refusedMoves {
		if response := sendNoteRequest(http.MethodPut, refusedUrl, text, ""); response.Code < 400 {
			t.Fatalf("%s answered %d", refusedUrl, response.Code)
		}
	}
	if _, isPresent := readNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md"); !isPresent {
		t.Fatal("a refused move removed the handoff")
	}
}
