package main

import (
	"net/http"
	"strings"
	"testing"
)

const fixLoginSet = "small-plans/claude-kit/2026-11-19-1000-fix-login"

func readPlanIndex(t *testing.T, setPath string) string {
	t.Helper()
	text, _ := readNoteFile(t, setPath+"/index.md")
	return text
}

func TestSavingAPlanRewritesItsSetIndex(t *testing.T) {
	seedNotes(t)

	donePlan := strings.Replace(buildSmallPlan(2, "Logout clears the token."), "status: pending", "status: done", 1)
	response := sendNoteRequest(http.MethodPut, "/api/notes/"+fixLoginSet+"/02-clear-the-cached-token.md", donePlan, "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}

	index := readPlanIndex(t, fixLoginSet)
	wantedTable := strings.Join([]string{
		"| Order | Plan | Kind | Status | Depends on |",
		"| --- | --- | --- | --- | --- |",
		"| 1 | [Add the test](01-add-the-test.md) |  | done | none |",
		"| 2 | [Clear the cached token](02-clear-the-cached-token.md) | fix | done | none |",
	}, "\n")
	if !strings.HasPrefix(index, "# Plans: 2026-11-19-1000-fix-login\n") || !strings.Contains(index, wantedTable) {
		t.Fatalf("index was %q", index)
	}
}

func TestAddingAPlanListsItInItsSetIndex(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPost, "/api/notes/"+fixLoginSet+"/03-retry-the-request.md", buildSmallPlan(3, "The request is retried."), "")
	if response.Code != http.StatusCreated {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}

	if index := readPlanIndex(t, fixLoginSet); !strings.Contains(index, "| 3 | [Clear the cached token](03-retry-the-request.md) | fix | pending | none |") {
		t.Fatalf("index was %q", index)
	}
}

func TestDeletingAPlanDropsItFromItsSetIndex(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodDelete, "/api/notes/"+fixLoginSet+"/01-add-the-test.md", "", "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("status was %d", response.Code)
	}

	if index := readPlanIndex(t, fixLoginSet); strings.Contains(index, "01-add-the-test.md") || !strings.Contains(index, "02-clear-the-cached-token.md") {
		t.Fatalf("index was %q", index)
	}
}

func TestMovingAPlanRewritesBothSetIndexes(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPut, "/api/notes/"+fixLoginSet+"/02-clear-the-cached-token.md?project=atlas", strings.Replace(buildSmallPlan(2, "Logout clears the token."), "project: claude-kit", "project: atlas", 1), "")
	if response.Code != http.StatusOK {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}

	if index := readPlanIndex(t, fixLoginSet); strings.Contains(index, "02-clear") || !strings.Contains(index, "01-add-the-test.md") {
		t.Fatalf("old set index was %q", index)
	}
	if index := readPlanIndex(t, "small-plans/atlas/2026-11-19-1000-fix-login"); !strings.Contains(index, "02-clear-the-cached-token.md") {
		t.Fatalf("new set index was %q", index)
	}
}

func TestMovingTheLastPlanOfAnIndexedSetRemovesTheSetFolder(t *testing.T) {
	seedNotes(t)
	olderSet := "small-plans/claude-kit/2026-11-18-0900-add-the-viewer"
	writeNoteFile(t, olderSet+"/index.md", "# Plans: 2026-11-18-0900-add-the-viewer\n")
	movedOlderPlan := strings.Replace(buildSmallPlan(1, "The page is served."), "set: 2026-11-19-1000-fix-login", "set: 2026-11-18-0900-add-the-viewer", 1)
	movedOlderPlan = strings.Replace(movedOlderPlan, "project: claude-kit", "project: atlas", 1)

	response := sendNoteRequest(http.MethodPut, "/api/notes/"+olderSet+"/01-serve-the-page.md?project=atlas", movedOlderPlan, "")
	if response.Code != http.StatusOK {
		t.Fatalf("status was %d %s", response.Code, response.Body.String())
	}

	if _, isGroup := resolveGroupFolder("small-plans", "claude-kit", "2026-11-18-0900-add-the-viewer"); isGroup {
		t.Fatal("the emptied set folder is still there")
	}
}

func TestASetIndexIsNeitherListedNorEditable(t *testing.T) {
	seedNotes(t)
	writeNoteFile(t, fixLoginSet+"/index.md", "# Plans: 2026-11-19-1000-fix-login\n")

	for _, entry := range loadSections()[2].Entries {
		if strings.HasSuffix(entry.Path, "/index.md") {
			t.Fatalf("index listed as %+v", entry)
		}
	}
	response := sendNoteRequest(http.MethodDelete, "/api/notes/"+fixLoginSet+"/index.md", "", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("delete status was %d", response.Code)
	}
}
