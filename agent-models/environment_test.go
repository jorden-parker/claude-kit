package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestMergeEnvironmentPrefersProcessValues(t *testing.T) {
	processEnvironment := map[string]string{"A": "process", "B": "only-process"}
	settingsEnvironment := map[string]string{"A": "settings", "C": "only-settings"}
	expected := map[string]string{"A": "process", "B": "only-process", "C": "only-settings"}
	actual := mergeEnvironment(processEnvironment, settingsEnvironment)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("got %v, want %v", actual, expected)
	}
}

func TestLoadSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	writeFile(t, path, `{"env":{"CLAUDE_CODE_USE_BEDROCK":"1","NUMBER":5},"model":"opus-x","availableModels":["m1","m2"]}`)
	settings, err := loadSettings(path)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Env["CLAUDE_CODE_USE_BEDROCK"] != "1" || settings.Model != "opus-x" || len(settings.AvailableModels) != 2 {
		t.Fatalf("unexpected settings %+v", settings)
	}
	if _, hasNumber := settings.Env["NUMBER"]; hasNumber {
		t.Fatal("non-string env values should be ignored")
	}
}

func TestLoadSettingsMissingFileIsEmpty(t *testing.T) {
	settings, err := loadSettings(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil || len(settings.Env) != 0 {
		t.Fatalf("got %+v, %v", settings, err)
	}
}

func TestIsEnabled(t *testing.T) {
	for value, expected := range map[string]bool{"1": true, "true": true, "TRUE": true, "0": false, "": false, "no": false} {
		if isEnabled(value) != expected {
			t.Fatalf("isEnabled(%q) should be %v", value, expected)
		}
	}
}
