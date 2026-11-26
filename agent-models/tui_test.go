package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

func press(current tea.Model, code rune) tea.Model {
	next, _ := current.Update(tea.KeyPressMsg{Code: code})
	return next
}

func TestChoosingAModelSavesAndReturnsToAgents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-models.json")
	agents := []Agent{{Type: "guards:worker", DefaultModel: "haiku"}, {Type: "handoff:recap", DefaultModel: "inherit"}}
	var current tea.Model = newApp(agents, []string{"sonnet", "opus"}, "discovery failed", path, map[string]string{})
	current, _ = current.Update(tea.WindowSizeMsg{Width: 80, Height: 24})

	current = press(current, tea.KeyEnter)
	if !strings.Contains(current.(app).View().Content, "Agent default (haiku)") {
		t.Fatal("model screen should list the agent default first")
	}
	current = press(current, tea.KeyDown)
	current = press(current, tea.KeyDown)
	current = press(current, tea.KeyEnter)

	content, err := os.ReadFile(path)
	if err != nil || string(content) != "{\n  \"guards:worker\": \"opus\"\n}\n" {
		t.Fatalf("got %q, %v", content, err)
	}
	view := current.(app).View().Content
	if !strings.Contains(view, "opus (saved)") || !strings.Contains(view, "discovery failed") {
		t.Fatalf("agent screen missing saved model or note:\n%s", view)
	}
}

func TestEscapeGoesBackWithoutSaving(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-models.json")
	var current tea.Model = newApp([]Agent{{Type: "a:b", DefaultModel: "inherit"}}, []string{"sonnet"}, "", path, map[string]string{})
	current, _ = current.Update(tea.WindowSizeMsg{Width: 80, Height: 24})
	current = press(current, tea.KeyEnter)
	current = press(current, tea.KeyDown)
	current = press(current, tea.KeyEscape)
	if _, err := os.Stat(path); err == nil {
		t.Fatal("nothing should be saved")
	}
	if !strings.Contains(current.(app).View().Content, "inherit (agent default)") {
		t.Fatal("should be back on the agent screen")
	}
}

func TestQuitKeyQuits(t *testing.T) {
	var current tea.Model = newApp([]Agent{{Type: "a:b", DefaultModel: "inherit"}}, nil, "", "unused", map[string]string{})
	_, command := current.Update(tea.KeyPressMsg{Code: 'q', Text: "q"})
	if command == nil {
		t.Fatal("expected a quit command")
	}
	if _, isQuit := command().(tea.QuitMsg); !isQuit {
		t.Fatal("expected QuitMsg")
	}
}
