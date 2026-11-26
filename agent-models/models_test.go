package main

import (
	"errors"
	"reflect"
	"testing"
)

func TestBuildModelListOrdersAndDeduplicates(t *testing.T) {
	environment := map[string]string{
		"ANTHROPIC_MODEL":                "pinned-a",
		"ANTHROPIC_DEFAULT_OPUS_MODEL":   "opus",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "pinned-b",
		"ANTHROPIC_CUSTOM_MODEL_OPTION":  "custom",
		"ANTHROPIC_DEFAULT_SONNET_MODEL": "pinned-a",
	}
	settings := Settings{Model: "settings-model", AvailableModels: []string{"custom", "listed"}}
	discovered := []string{"zeta", "alpha", "pinned-b", "listed"}

	actual := buildModelList(environment, settings, discovered)
	expected := []string{"sonnet", "opus", "haiku", "fable", "pinned-a", "pinned-b", "custom", "settings-model", "listed", "alpha", "zeta"}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %v\nwant %v", actual, expected)
	}
}

func TestDiscoverModelsPerProvider(t *testing.T) {
	failing := func(map[string]string, ...string) ([]byte, error) { return nil, errors.New("aws missing") }
	cases := []struct {
		name        string
		environment map[string]string
		isNoteSet   bool
	}{
		{"vertex skips discovery", map[string]string{"CLAUDE_CODE_USE_VERTEX": "1", "ANTHROPIC_API_KEY": "k"}, false},
		{"foundry skips discovery", map[string]string{"CLAUDE_CODE_USE_FOUNDRY": "true"}, false},
		{"no credentials skips discovery", map[string]string{}, false},
		{"bedrock failure becomes a note", map[string]string{"CLAUDE_CODE_USE_BEDROCK": "1"}, true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			models, note := discoverModels(testCase.environment, failing, nil, "http://127.0.0.1:1")
			if len(models) != 0 || (note != "") != testCase.isNoteSet {
				t.Fatalf("got %v, %q", models, note)
			}
		})
	}
}
