package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChoicesRoundTripDeleteAndUnknownKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "agent-models.json")
	writeFile(t, path, `{"other:unknown":"keep-me"}`)

	if err := saveChoice(path, "guards:worker", "opus"); err != nil {
		t.Fatal(err)
	}
	if err := saveChoice(path, "handoff:recap", "haiku"); err != nil {
		t.Fatal(err)
	}
	choices, err := loadChoices(path)
	if err != nil || choices["guards:worker"] != "opus" || choices["other:unknown"] != "keep-me" {
		t.Fatalf("got %v, %v", choices, err)
	}

	if err := saveChoice(path, "guards:worker", ""); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(path)
	expected := "{\n  \"handoff:recap\": \"haiku\",\n  \"other:unknown\": \"keep-me\"\n}\n"
	if string(content) != expected {
		t.Fatalf("got %q, want %q", content, expected)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("temp file left behind: %v", entries)
	}
}

func TestLoadChoicesMissingFileIsEmpty(t *testing.T) {
	choices, err := loadChoices(filepath.Join(t.TempDir(), "none.json"))
	if err != nil || len(choices) != 0 {
		t.Fatalf("got %v, %v", choices, err)
	}
}
