package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func loadChoices(path string) (map[string]string, error) {
	choices := map[string]string{}
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return choices, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(content, &choices); err != nil {
		return nil, err
	}
	return choices, nil
}

func saveChoice(path, agentType, model string) error {
	choices, err := loadChoices(path)
	if err != nil {
		return err
	}
	if model == "" {
		delete(choices, agentType)
	} else {
		choices[agentType] = model
	}
	content, err := json.MarshalIndent(choices, "", "  ")
	if err != nil {
		return err
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".agent-models-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temporary.Name())
	if _, err := temporary.Write(append(content, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporary.Name(), path)
}
