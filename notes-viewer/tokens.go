package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type tokenTotals struct {
	Input      int `json:"input"`
	CacheWrite int `json:"cacheWrite"`
	CacheRead  int `json:"cacheRead"`
	Output     int `json:"output"`
}

type ledgerSession struct {
	Session   string                 `json:"session"`
	Project   string                 `json:"project"`
	UpdatedAt string                 `json:"updatedAt"`
	Main      map[string]tokenTotals `json:"main"`
	Subagents map[string]tokenTotals `json:"subagents"`
}

func resolveLedgerRoot() string {
	if ledgerRoot := os.Getenv("TOKEN_LEDGER_DIR"); ledgerRoot != "" {
		return ledgerRoot
	}
	homeFolder, _ := os.UserHomeDir()
	return filepath.Join(homeFolder, ".cache", "token-ledger", "sessions")
}

func sumTokens(totalsByModel map[string]tokenTotals) int {
	sum := 0
	for _, totals := range totalsByModel {
		sum += totals.Input + totals.CacheWrite + totals.CacheRead + totals.Output
	}
	return sum
}

func readLedgerSessions(ledgerRoot string) []ledgerSession {
	sessions := []ledgerSession{}
	sessionPaths, _ := filepath.Glob(filepath.Join(ledgerRoot, "*.json"))
	for _, sessionPath := range sessionPaths {
		text, err := os.ReadFile(sessionPath)
		var session ledgerSession
		if err != nil || json.Unmarshal(text, &session) != nil || session.Project == "" {
			continue
		}
		sessions = append(sessions, session)
	}
	return sessions
}

func describeTokenProject(project string, sessions []ledgerSession, projectTotal int, largestTotal int) entryView {
	sort.Slice(sessions, func(first, second int) bool { return sessions[first].UpdatedAt > sessions[second].UpdatedAt })
	table := []string{"| Session | Updated | Tokens |", "| --- | --- | ---: |"}
	for _, session := range sessions {
		sessionTotal := sumTokens(session.Main) + sumTokens(session.Subagents)
		table = append(table, fmt.Sprintf("| %s | %s | %d |", session.Session, session.UpdatedAt, sessionTotal))
	}
	share := 0.0
	if largestTotal > 0 {
		share = float64(projectTotal) / float64(largestTotal)
	}
	return entryView{
		Section: "tokens",
		Project: project,
		Name:    project,
		Title:   project,
		Created: sessions[0].UpdatedAt,
		Fields: map[string]string{
			"sessions":     strconv.Itoa(len(sessions)),
			"total_tokens": strconv.Itoa(projectTotal),
			"share":        strconv.FormatFloat(share, 'f', 3, 64),
		},
		Path: project,
		Html: renderMarkdown(strings.Join(table, "\n")),
	}
}

func loadTokenSection() sectionView {
	sessionsByProject := map[string][]ledgerSession{}
	for _, session := range readLedgerSessions(resolveLedgerRoot()) {
		sessionsByProject[session.Project] = append(sessionsByProject[session.Project], session)
	}
	totalsByProject := map[string]int{}
	largestTotal := 0
	for project, sessions := range sessionsByProject {
		for _, session := range sessions {
			totalsByProject[project] += sumTokens(session.Main) + sumTokens(session.Subagents)
		}
		largestTotal = max(largestTotal, totalsByProject[project])
	}
	entries := []entryView{}
	for project, sessions := range sessionsByProject {
		entries = append(entries, describeTokenProject(project, sessions, totalsByProject[project], largestTotal))
	}
	sort.Slice(entries, func(first, second int) bool { return entries[first].Project < entries[second].Project })
	return sectionView{Identifier: "tokens", Title: "Token Use", Entries: entries}
}
