package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func isFolderPresent(relativePath string) bool {
	folderInfo, err := os.Stat(filepath.Join(os.Getenv("HOME"), ".claude", relativePath))
	return err == nil && folderInfo.IsDir()
}

func TestRenamingAProjectMovesEveryFolderAndRewritesProjectLines(t *testing.T) {
	seedNotes(t)
	writeNoteFile(t, "handoffs/claude-kit/003-valid.md", validHandoff)

	response := sendNoteRequest(http.MethodPost, "/api/projects/claude-kit/rename?to=claude-tools", "", "")
	if response.Code != http.StatusOK {
		t.Fatalf("answered %d %s", response.Code, response.Body.String())
	}
	var renamed struct {
		Project string `json:"project"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &renamed); err != nil || renamed.Project != "claude-tools" {
		t.Fatalf("answered %s", response.Body.String())
	}
	for _, sectionId := range []string{"handoffs", "project-notes", "small-plans", "brainstorm"} {
		if isFolderPresent(sectionId + "/claude-kit") {
			t.Fatalf("%s/claude-kit is still there", sectionId)
		}
		if !isFolderPresent(sectionId + "/claude-tools") {
			t.Fatalf("%s/claude-tools is missing", sectionId)
		}
	}
	text, _ := readNoteFile(t, "handoffs/claude-tools/003-valid.md")
	if !strings.Contains(text, "\nproject: claude-tools\n") || strings.Contains(text, "project: claude-kit") {
		t.Fatalf("the project line was not rewritten: %q", text)
	}
	if problems := listFormatProblems("handoffs", "claude-tools/003-valid.md", text); len(problems) > 0 {
		t.Fatalf("the renamed handoff breaks the format rules: %v", problems)
	}
	if _, isPresent := readNoteFile(t, "brainstorm/claude-tools/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md"); !isPresent {
		t.Fatal("the brainstorm plan did not move")
	}
	if !isFolderPresent("handoffs/atlas") {
		t.Fatal("another project was touched")
	}
}

func TestRenamingAProjectRefusesBadRequests(t *testing.T) {
	seedNotes(t)

	refusals := map[string]int{
		"/api/projects/claude-kit/rename?to=":           http.StatusBadRequest,
		"/api/projects/claude-kit/rename?to=..":         http.StatusBadRequest,
		"/api/projects/claude-kit/rename?to=a%2Fb":      http.StatusBadRequest,
		"/api/projects/claude-kit/rename?to=has%20gap":  http.StatusBadRequest,
		"/api/projects/claude-kit/rename?to=claude-kit": http.StatusBadRequest,
		"/api/projects/claude-kit/rename?to=atlas":      http.StatusConflict,
		"/api/projects/missing/rename?to=fresh":         http.StatusNotFound,
		"/api/projects/../rename?to=fresh":              http.StatusBadRequest,
	}
	for refusedUrl, expectedStatus := range refusals {
		response := sendNoteRequest(http.MethodPost, refusedUrl, "", "")
		if response.Code != expectedStatus || strings.TrimSpace(response.Body.String()) == "" {
			t.Fatalf("%s answered %d %q, expected %d", refusedUrl, response.Code, response.Body.String(), expectedStatus)
		}
	}
	if !isFolderPresent("handoffs/claude-kit") || !isFolderPresent("brainstorm/claude-kit") {
		t.Fatal("a refused rename moved a folder")
	}
}

func TestRenamingAProjectRefusesCrossOriginRequests(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPost, "/api/projects/claude-kit/rename?to=fresh", "", "http://evil.example")
	if response.Code != http.StatusForbidden || !isFolderPresent("handoffs/claude-kit") {
		t.Fatalf("answered %d", response.Code)
	}
}
