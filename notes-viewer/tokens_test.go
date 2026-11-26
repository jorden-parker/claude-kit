package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const ledgerSessionText = `{
  "session": "aaa-111",
  "project": "claude-kit",
  "updatedAt": "2026-11-20T15:36:47.976Z",
  "contextTokens": 1000,
  "lastNudgeTokens": 0,
  "main": {"claude-opus-5-5": {"input": 1, "cacheWrite": 10, "cacheRead": 100, "output": 1000}},
  "subagents": {"claude-haiku-5-5": {"input": 2, "cacheWrite": 20, "cacheRead": 200, "output": 2000}},
  "resultCharactersByTool": {"Bash": 500}
}
`

func writeLedgerFile(t *testing.T, ledgerRoot string, fileName string, text string) {
	t.Helper()
	if err := os.MkdirAll(ledgerRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ledgerRoot, fileName), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLedgerSessionsAreReadAndSummed(t *testing.T) {
	ledgerRoot := t.TempDir()
	writeLedgerFile(t, ledgerRoot, "aaa-111.json", ledgerSessionText)
	writeLedgerFile(t, ledgerRoot, "broken.json", "{not json")
	writeLedgerFile(t, ledgerRoot, "notes.txt", "ignored")

	sessions := readLedgerSessions(ledgerRoot)
	if len(sessions) != 1 || sessions[0].Project != "claude-kit" {
		t.Fatalf("sessions were %+v", sessions)
	}
	if total := sumTokens(sessions[0].Main) + sumTokens(sessions[0].Subagents); total != 3333 {
		t.Fatalf("total was %d", total)
	}
}

func TestTokenSectionGroupsSessionsByProject(t *testing.T) {
	ledgerRoot := t.TempDir()
	t.Setenv("TOKEN_LEDGER_DIR", ledgerRoot)
	writeLedgerFile(t, ledgerRoot, "aaa-111.json", ledgerSessionText)
	writeLedgerFile(t, ledgerRoot, "bbb-222.json", strings.Replace(ledgerSessionText, "aaa-111", "bbb-222", 1))
	writeLedgerFile(t, ledgerRoot, "ccc-333.json", strings.Replace(ledgerSessionText, `"claude-kit"`, `"atlas"`, 1))

	section := loadTokenSection()
	if section.Identifier != "tokens" || section.Title != "Token use" || len(section.Entries) != 2 {
		t.Fatalf("section was %+v", section)
	}
	atlas, claudeKit := section.Entries[0], section.Entries[1]
	if atlas.Project != "atlas" || atlas.Fields["total_tokens"] != "3333" || atlas.Fields["share"] != "0.500" {
		t.Fatalf("atlas was %+v", atlas.Fields)
	}
	if claudeKit.Fields["sessions"] != "2" || claudeKit.Fields["total_tokens"] != "6666" || claudeKit.Fields["share"] != "1.000" {
		t.Fatalf("claude-kit was %+v", claudeKit.Fields)
	}
	if !strings.Contains(claudeKit.Html, "bbb-222") {
		t.Fatalf("html was %s", claudeKit.Html)
	}
}

func TestServerListsTokenUseAsJson(t *testing.T) {
	ledgerRoot := t.TempDir()
	t.Setenv("TOKEN_LEDGER_DIR", ledgerRoot)
	writeLedgerFile(t, ledgerRoot, "aaa-111.json", ledgerSessionText)

	response := requestPage("127.0.0.1:4000", "/api/tokens")
	var section sectionView
	if err := json.Unmarshal(response.Body.Bytes(), &section); err != nil {
		t.Fatalf("body was %d %s", response.Code, response.Body.String())
	}
	if section.Title != "Token use" || len(section.Entries) != 1 || section.Entries[0].Fields["total_tokens"] != "3333" {
		t.Fatalf("section was %+v", section)
	}
}
