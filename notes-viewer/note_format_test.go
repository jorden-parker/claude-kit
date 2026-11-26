package main

import (
	"net/http"
	"strings"
	"testing"
)

const validHandoff = "---\ntitle: Fix the login\nproject: claude-kit\ncreated: 2026-11-18T09:00:00.000Z\ncwd: /Users/me/src/claude-kit\n---\n\nThe login works again.\n"

const validProjectNote = "---\ntitle: The cache is stale\nproject: claude-kit\ncreated: 2026-11-16T08:00:00.000Z\ncategory: finding\n---\n\nThe cache keeps old pages after a deploy.\n"

const validDebuggingNote = "---\ntitle: Login loops forever\nproject: claude-kit\ncreated: 2026-11-16T08:00:00.000Z\ncategory: debugging\n---\n\n## Why these steps\n\nA.\n\n## Steps taken\n\nB.\n\n## Evidence\n\nC.\n\n## Findings\n\nD.\n\n## Next steps\n\nE.\n\n## Draft Shortcut ticket\n\nF.\n"

const validSmallPlan = "---\ntitle: Clear the cached token\nproject: claude-kit\ncreated: 2026-11-19T10:00:00.000Z\nset: 2026-11-19-1000-fix-login\norder: 2\nkind: fix\nstatus: pending\ndepends_on: 1\n---\n\n## Goal\n\nLogout clears the token.\n\n## Context\n\nThe token lives in `auth.ts`.\n\n## Steps\n\n1. Clear the token.\n2. Run the tests.\n\n## Check\n\n- Run: `npm test`\n- Expect: all pass\n\n## Review\n\n- The token is cleared.\n"

const validBrainstormPlan = "# Plan: Let the guard see pipes\n\n- Status: pending\n- Kind: change\n\n## Context\n\nThe guard reads one stage.\n\n## Steps\n\n- [Step 01](step-01.md)\n"

const smallPlanPath = "claude-kit/2026-11-19-1000-fix-login/02-clear-the-token.md"

type formatCase struct {
	name            string
	sectionId       string
	entryPath       string
	text            string
	expectedProblem string
}

func TestValidNotesHaveNoFormatProblems(t *testing.T) {
	validCases := []formatCase{
		{name: "handoff", sectionId: "handoffs", entryPath: "claude-kit/002-fix-the-login.md", text: validHandoff},
		{name: "project note", sectionId: "project-notes", entryPath: "claude-kit/finding/2026-11-16-the-cache-is-stale.md", text: validProjectNote},
		{name: "debugging note", sectionId: "project-notes", entryPath: "claude-kit/debugging/2026-11-16-login-loops.md", text: validDebuggingNote},
		{name: "small plan", sectionId: "small-plans", entryPath: smallPlanPath, text: validSmallPlan},
		{name: "small plan with a banned phrase inside a code fence", sectionId: "small-plans", entryPath: smallPlanPath, text: strings.Replace(validSmallPlan, "## Review", "```\nconsider this\n```\n\n## Review", 1)},
		{name: "brainstorm plan", sectionId: "brainstorm", entryPath: "claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", text: validBrainstormPlan},
	}
	for _, validCase := range validCases {
		if problems := listFormatProblems(validCase.sectionId, validCase.entryPath, validCase.text); len(problems) != 0 {
			t.Errorf("%s had problems: %v", validCase.name, problems)
		}
	}
}

func TestInvalidNotesNameEachFormatProblem(t *testing.T) {
	invalidCases := []formatCase{
		{"not utf-8", "handoffs", "claude-kit/002-fix-the-login.md", "\xff\xfe", "not valid UTF-8"},
		{"no front matter", "handoffs", "claude-kit/002-fix-the-login.md", "Rewritten.\n", `start with a "---" line`},
		{"unclosed front matter", "handoffs", "claude-kit/002-fix-the-login.md", "---\ntitle: Fix the login\n", `start with a "---" line`},
		{"malformed field line", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "cwd:", "cwd =", 1), `is not "name: value"`},
		{"duplicate field", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "cwd:", "title: Again\ncwd:", 1), `sets "title" twice`},
		{"missing field", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "cwd: /Users/me/src/claude-kit\n", "", 1), `lacks "cwd"`},
		{"bad created date", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "2026-11-18T09:00:00.000Z", "yesterday", 1), `"created" must be an ISO date`},
		{"empty title", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "title: Fix the login", "title: ", 1), `lacks "title"`},
		{"title without letters", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "Fix the login", "--- !!", 1), "letter or a digit"},
		{"title too long", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "Fix the login", strings.Repeat("a", 101), 1), "the most is 100"},
		{"empty body", "handoffs", "claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "The login works again.\n", "  \n", 1), "The body is empty"},
		{"project folder mismatch", "handoffs", "atlas/002-fix-the-login.md", validHandoff, `"project" must match`},
		{"unknown category", "project-notes", "claude-kit/finding/2026-11-16-the-cache-is-stale.md", strings.Replace(validProjectNote, "category: finding", "category: rumour", 1), `"category" must be one of`},
		{"category folder mismatch", "project-notes", "claude-kit/decision/2026-11-16-the-cache-is-stale.md", validProjectNote, `"category" must match`},
		{"debugging note missing a section", "project-notes", "claude-kit/debugging/2026-11-16-login-loops.md", strings.Replace(validDebuggingNote, "## Evidence", "## Proof", 1), `lacks "## Evidence"`},
		{"unknown kind", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "kind: fix", "kind: hack", 1), `"kind" must be one of`},
		{"unknown status", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "status: pending", "status: maybe", 1), `"status" must be one of`},
		{"set folder mismatch", "small-plans", "claude-kit/2026-11-18-0900-other/02-clear-the-token.md", validSmallPlan, `"set" must match`},
		{"order file name mismatch", "small-plans", "claude-kit/2026-11-19-1000-fix-login/03-clear-the-token.md", validSmallPlan, `"order" must match`},
		{"depends on a later plan", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "depends_on: 1", "depends_on: 3", 1), `"depends_on" must list earlier plan numbers`},
		{"missing plan section", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "## Review", "## Notes", 1), `lacks "## Review"`},
		{"steps without a numbered list", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "1. Clear the token.\n2. Run the tests.", "Clear the token.", 1), `"## Steps" needs a numbered list`},
		{"too many steps", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "2. Run the tests.", "2. B.\n3. C.\n4. D.\n5. E.\n6. F.\n7. G.", 1), "the most is 6"},
		{"check without a command", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "`npm test`", "npm test", 1), `"## Check" needs a command in backticks`},
		{"banned phrase", "small-plans", smallPlanPath, strings.Replace(validSmallPlan, "Clear the token.", "Clear the token as needed.", 1), `banned phrase "as needed"`},
		{"brainstorm without a title heading", "brainstorm", "claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", strings.Replace(validBrainstormPlan, "# Plan: Let the guard see pipes\n\n", "", 1), "title heading"},
		{"brainstorm without a status", "brainstorm", "claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", strings.Replace(validBrainstormPlan, "- Status: pending\n", "", 1), `"- Status:" line`},
		{"brainstorm missing context", "brainstorm", "claude-kit/plans/plan-2026-11-16-1333/01-guard-pipe-stages/plan.md", strings.Replace(validBrainstormPlan, "## Context", "## Background", 1), `lacks "## Context"`},
	}
	for _, invalidCase := range invalidCases {
		problems := strings.Join(listFormatProblems(invalidCase.sectionId, invalidCase.entryPath, invalidCase.text), "\n")
		if !strings.Contains(problems, invalidCase.expectedProblem) {
			t.Errorf("%s: problems %q lack %q", invalidCase.name, problems, invalidCase.expectedProblem)
		}
	}
}

func TestSavingAnInvalidNoteIsRefusedWithEveryProblem(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPut, "/api/notes/handoffs/claude-kit/002-fix-the-login.md", strings.Replace(validHandoff, "cwd: /Users/me/src/claude-kit\n", "", 1)+"", "")
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status was %d", response.Code)
	}
	if body := response.Body.String(); !strings.HasPrefix(body, "The handoff was not saved. Fix every problem and save again:\n- ") || !strings.Contains(body, `lacks "cwd"`) {
		t.Fatalf("body was %q", body)
	}
	if text, _ := readNoteFile(t, "handoffs/claude-kit/002-fix-the-login.md"); strings.Contains(text, "The login works again.") {
		t.Fatal("the invalid note was saved")
	}
}

func TestAddingAnInvalidPlanIsRefused(t *testing.T) {
	seedNotes(t)

	response := sendNoteRequest(http.MethodPost, "/api/notes/small-plans/claude-kit/2026-11-19-1000-fix-login/03-ship-it.md", "---\ntitle: Ship it\n---\n\nShip.\n", "")
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status was %d", response.Code)
	}
	if _, isPresent := readNoteFile(t, "small-plans/claude-kit/2026-11-19-1000-fix-login/03-ship-it.md"); isPresent {
		t.Fatal("the invalid plan was saved")
	}
}

func TestAHandoffWithATopicLineHasNoFormatProblems(t *testing.T) {
	topicHandoff := "---\ntitle: Compare the vendors\nproject: research\ncreated: 2026-11-18T09:00:00.000Z\ncwd: /Users/me/notes\ntopic: research\n---\n\nThe shortlist is ready.\n"

	if problems := listFormatProblems("handoffs", "research/001-compare-the-vendors.md", topicHandoff); len(problems) != 0 {
		t.Errorf("problems: %v", problems)
	}
}
