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
set: 2026-11-19-1000-fix-login
order: 2
kind: fix
status: in-progress
depends_on: 1
created: 2026-11-19T10:00:00.000Z
---

## Goal
The profile request works after a refresh.

## Steps
1. Clear the token.

<script>alert(1)</script>
`

func writePlanFile(t *testing.T, plansRoot string, relativePath string, text string) {
	t.Helper()
	planPath := filepath.Join(plansRoot, relativePath)
	if err := os.MkdirAll(filepath.Dir(planPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(planPath, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func seedPlans(t *testing.T) string {
	t.Helper()
	plansRoot := t.TempDir()
	writePlanFile(t, plansRoot, "claude-kit/2026-11-19-1000-fix-login/02-clear-the-cached-token.md", tokenPlan)
	writePlanFile(t, plansRoot, "claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md", "---\ntitle: Add the test\nkind: test\nstatus: done\n---\n\nFirst.\n")
	writePlanFile(t, plansRoot, "claude-kit/2026-11-18-0900-handoff-001-add-the-viewer/01-serve-the-page.md", "---\ntitle: Serve the page\nkind: feature\nstatus: pending\n---\n\nOlder set.\n")
	writePlanFile(t, plansRoot, "atlas/2026-11-17-0800-tidy/01-plain-file.md", "No front matter here.\n")
	writePlanFile(t, plansRoot, "claude-kit/stray.md", "Not inside a set folder.\n")
	return plansRoot
}

func TestPlansAreSortedByProjectThenNewestSetThenOrder(t *testing.T) {
	plans := loadPlans(seedPlans(t))

	paths := []string{}
	for _, plan := range plans {
		paths = append(paths, plan.Path)
	}
	expectedPaths := []string{
		"atlas/2026-11-17-0800-tidy/01-plain-file.md",
		"claude-kit/2026-11-19-1000-fix-login/01-add-the-test.md",
		"claude-kit/2026-11-19-1000-fix-login/02-clear-the-cached-token.md",
		"claude-kit/2026-11-18-0900-handoff-001-add-the-viewer/01-serve-the-page.md",
	}
	if strings.Join(paths, "\n") != strings.Join(expectedPaths, "\n") {
		t.Fatalf("paths were %v", paths)
	}
}

func TestFrontMatterFillsThePlanAndIsNotRendered(t *testing.T) {
	plan := loadPlans(seedPlans(t))[2]

	if plan.Title != "Clear the cached token" || plan.Kind != "fix" || plan.Status != "in-progress" || plan.DependsOn != "1" || plan.Project != "claude-kit" || plan.Set != "2026-11-19-1000-fix-login" {
		t.Fatalf("plan was %+v", plan)
	}
	if strings.Contains(plan.Html, "kind: fix") || strings.Contains(plan.Html, "<script") {
		t.Fatalf("front matter or raw html was rendered: %s", plan.Html)
	}
	if !strings.Contains(plan.Html, "<ol>") {
		t.Fatalf("markdown was not rendered: %s", plan.Html)
	}
}

func TestPlanWithoutFrontMatterTakesItsFileNameAndIsPending(t *testing.T) {
	plan := loadPlans(seedPlans(t))[0]

	if plan.Title != "01-plain-file" || plan.Status != "pending" || plan.Kind != "chore" || plan.Project != "atlas" {
		t.Fatalf("plan was %+v", plan)
	}
}

func requestPage(plansRoot string, host string, path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Host = host
	response := httptest.NewRecorder()
	newPlansServer(plansRoot).ServeHTTP(response, request)
	return response
}

func TestServerListsPlansAsJsonAndServesThePage(t *testing.T) {
	plansRoot := seedPlans(t)

	listing := requestPage(plansRoot, "127.0.0.1:4000", "/api/plans")
	var plans []planView
	if err := json.Unmarshal(listing.Body.Bytes(), &plans); err != nil {
		t.Fatal(err)
	}
	if len(plans) != 4 || plans[1].Title != "Add the test" {
		t.Fatalf("plans were %+v", plans)
	}

	page := requestPage(plansRoot, "localhost:4000", "/")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Small plans</title>") {
		t.Fatalf("page was %d %s", page.Code, page.Body.String())
	}
}

func TestServerRefusesOtherHosts(t *testing.T) {
	response := requestPage(seedPlans(t), "evil.example", "/api/plans")

	if response.Code != http.StatusForbidden {
		t.Fatalf("status was %d", response.Code)
	}
}

func TestMissingPlansFolderListsNothing(t *testing.T) {
	listing := requestPage(filepath.Join(t.TempDir(), "absent"), "127.0.0.1:4000", "/api/plans")

	if strings.TrimSpace(listing.Body.String()) != "[]" {
		t.Fatalf("body was %s", listing.Body.String())
	}
}
