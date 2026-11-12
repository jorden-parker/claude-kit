package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxNoteLength = 2000

type session struct {
	StartedAt        string            `json:"startedAt"`
	WorkingDirectory string            `json:"cwd"`
	Notes            []json.RawMessage `json:"notes"`
}

type noteStore struct {
	path        string
	document    map[string]json.RawMessage
	rawSessions []json.RawMessage
}

func loadStore(storePath string) (*noteStore, error) {
	contents, err := os.ReadFile(storePath)
	if err != nil {
		return nil, err
	}
	store := &noteStore{path: storePath}
	if err := json.Unmarshal(contents, &store.document); err != nil {
		return nil, err
	}
	if store.document == nil {
		store.document = map[string]json.RawMessage{}
	}
	if rawNotes, hasNotes := store.document["notes"]; hasNotes && string(rawNotes) != "null" {
		if err := json.Unmarshal(rawNotes, &store.rawSessions); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (store *noteStore) sessions() []session {
	parsedSessions := make([]session, len(store.rawSessions))
	for i, rawSession := range store.rawSessions {
		json.Unmarshal(rawSession, &parsedSessions[i])
	}
	return parsedSessions
}

func noteText(rawValue json.RawMessage) string {
	var text string
	if err := json.Unmarshal(rawValue, &text); err != nil {
		var compacted bytes.Buffer
		json.Compact(&compacted, rawValue)
		text = compacted.String()
	}
	return text
}

func normalizeNoteText(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}
	normalized := []rune(strings.Trim(strings.Join(lines, "\n"), "\n "))
	if len(normalized) > maxNoteLength {
		normalized = normalized[:maxNoteLength]
	}
	return string(normalized)
}

func (store *noteStore) deleteSession(sessionIndex int) error {
	store.rawSessions = append(store.rawSessions[:sessionIndex:sessionIndex], store.rawSessions[sessionIndex+1:]...)
	return store.save()
}

func (store *noteStore) replaceNote(sessionIndex, noteIndex int, replacement []string) error {
	var sessionFields map[string]json.RawMessage
	if err := json.Unmarshal(store.rawSessions[sessionIndex], &sessionFields); err != nil {
		return err
	}
	notes := store.sessions()[sessionIndex].Notes
	if noteIndex >= len(notes) {
		return fmt.Errorf("no note %d in session %d", noteIndex+1, sessionIndex+1)
	}
	updatedNotes := append([]json.RawMessage{}, notes[:noteIndex]...)
	for _, text := range replacement {
		encodedText, _ := json.Marshal(text)
		updatedNotes = append(updatedNotes, encodedText)
	}
	updatedNotes = append(updatedNotes, notes[noteIndex+1:]...)
	encodedNotes, _ := json.Marshal(updatedNotes)
	sessionFields["notes"] = encodedNotes
	encodedSession, _ := json.Marshal(sessionFields)
	store.rawSessions[sessionIndex] = encodedSession
	return store.save()
}

func (store *noteStore) save() error {
	encodedSessions, _ := json.Marshal(store.rawSessions)
	store.document["notes"] = encodedSessions
	encodedDocument, _ := json.Marshal(store.document)
	temporaryFile, err := os.CreateTemp(filepath.Dir(store.path), filepath.Base(store.path)+".*")
	if err != nil {
		return err
	}
	if _, err := temporaryFile.Write(encodedDocument); err != nil {
		temporaryFile.Close()
		os.Remove(temporaryFile.Name())
		return err
	}
	temporaryFile.Close()
	return os.Rename(temporaryFile.Name(), store.path)
}
