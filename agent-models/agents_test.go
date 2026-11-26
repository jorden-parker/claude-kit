package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseFrontmatter(t *testing.T) {
	cases := []struct {
		name     string
		text     string
		expected map[string]string
	}{
		{"plain fields", "---\nname: worker\nmodel: haiku\n---\nbody: x\n", map[string]string{"name": "worker", "model": "haiku"}},
		{"quoted value and colon", "---\nname: \"a\"\ndescription: Does x: y\n---\n", map[string]string{"name": "a", "description": "Does x: y"}},
		{"no frontmatter", "just text\n", map[string]string{}},
		{"windows line endings", "---\r\nname: w\r\n---\r\n", map[string]string{"name": "w"}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			actual := parseFrontmatter(testCase.text)
			if !reflect.DeepEqual(actual, testCase.expected) {
				t.Fatalf("got %v, want %v", actual, testCase.expected)
			}
		})
	}
}

func writeFile(t *testing.T, path string, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLoadAgentsUsesPluginFolderAndDefaultsToInherit(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, "plugins", "guards", "agents", "worker.md"), "---\nname: worker\nmodel: haiku\n---\n")
	writeFile(t, filepath.Join(repo, "plugins", "handoff", "agents", "recap.md"), "---\nname: recap\n---\n")

	agents, err := loadAgents(repo)
	if err != nil {
		t.Fatal(err)
	}
	expected := []Agent{{Type: "guards:worker", DefaultModel: "haiku"}, {Type: "handoff:recap", DefaultModel: "inherit"}}
	if !reflect.DeepEqual(agents, expected) {
		t.Fatalf("got %v, want %v", agents, expected)
	}
}

func TestFindRepositoryRootWalksUp(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, ".claude-plugin", "marketplace.json"), "{}")
	deep := filepath.Join(repo, "a", "b")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	found, err := findRepositoryRoot(deep)
	if err != nil || found != repo {
		t.Fatalf("got %q, %v", found, err)
	}
	if _, err := findRepositoryRoot(t.TempDir()); err == nil {
		t.Fatal("expected an error outside a repo")
	}
}
