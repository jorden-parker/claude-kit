package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
)

type Settings struct {
	Env             map[string]string
	Model           string
	AvailableModels []string
}

func processEnvironment() map[string]string {
	environment := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		environment[key] = value
	}
	return environment
}

func mergeEnvironment(processValues, settingsValues map[string]string) map[string]string {
	merged := map[string]string{}
	for key, value := range settingsValues {
		merged[key] = value
	}
	for key, value := range processValues {
		merged[key] = value
	}
	return merged
}

func loadSettings(path string) (Settings, error) {
	settings := Settings{Env: map[string]string{}}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	var raw struct {
		Env             map[string]any `json:"env"`
		Model           string         `json:"model"`
		AvailableModels []string       `json:"availableModels"`
	}
	if err := json.Unmarshal(content, &raw); err != nil {
		return settings, err
	}
	for key, value := range raw.Env {
		if text, isText := value.(string); isText {
			settings.Env[key] = text
		}
	}
	settings.Model = raw.Model
	settings.AvailableModels = raw.AvailableModels
	return settings, nil
}

func isEnabled(value string) bool {
	return value == "1" || strings.EqualFold(value, "true")
}
