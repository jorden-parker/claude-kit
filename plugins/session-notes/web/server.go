package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

//go:embed index.html
var indexPage []byte

var (
	headingPattern = regexp.MustCompile(`^(?:#{1,6}\s+(.*)|\*\*(.+?)\*\*:?)$`)
	bulletPattern  = regexp.MustCompile(`^(\s*)[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$`)
	markdown       = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))
)

type noteLine struct {
	Text      string `json:"text"`
	IsHeading bool   `json:"isHeading"`
}

type noteView struct {
	Number  int    `json:"number"`
	Text    string `json:"text"`
	Preview string `json:"preview"`
	Html    string `json:"html"`
}

type sessionView struct {
	Number  int        `json:"number"`
	Title   string     `json:"title"`
	Project string     `json:"project"`
	Notes   []noteView `json:"notes"`
}

func formatStartTime(startedAt string) string {
	if len(startedAt) >= 16 {
		return startedAt[:10] + " " + startedAt[11:16] + " UTC"
	}
	return startedAt
}

func sessionTitle(entry session) string {
	startTime := formatStartTime(entry.StartedAt)
	if startTime == "" {
		startTime = "unknown time"
	}
	if entry.WorkingDirectory == "" {
		return startTime
	}
	return startTime + " · " + entry.WorkingDirectory
}

func formatNoteLine(line string) noteLine {
	if heading := headingPattern.FindStringSubmatch(line); heading != nil {
		return noteLine{strings.TrimSpace(heading[1] + heading[2]), true}
	}
	bullet := bulletPattern.FindStringSubmatch(line)
	if bullet == nil {
		return noteLine{strings.TrimSpace(line), false}
	}
	marker := map[string]string{"": "•", " ": "○", "x": "✓", "X": "✓"}[bullet[2]]
	return noteLine{bullet[1] + marker + " " + bullet[3], false}
}

func notePreview(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if preview := strings.TrimSpace(formatNoteLine(line).Text); preview != "" {
			return preview
		}
	}
	return ""
}

func renderMarkdown(text string) string {
	var rendered bytes.Buffer
	if err := markdown.Convert([]byte(text), &rendered); err != nil {
		return ""
	}
	return rendered.String()
}

func viewSessions(sessions []session) []sessionView {
	views := []sessionView{}
	for sessionIndex, entry := range sessions {
		notes := []noteView{}
		for noteIndex, rawNote := range entry.Notes {
			text := noteText(rawNote)
			notes = append(notes, noteView{noteIndex + 1, text, notePreview(text), renderMarkdown(text)})
		}
		views = append(views, sessionView{sessionIndex + 1, sessionTitle(entry), entry.WorkingDirectory, notes})
	}
	return views
}

func isLocalHost(hostHeader string) bool {
	hostName, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		hostName = hostHeader
	}
	return hostName == "127.0.0.1" || hostName == "localhost"
}

func isOwnOrigin(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	return request.Method == http.MethodGet || origin == "" || origin == "http://"+request.Host
}

func newNotesServer(storePath string) http.Handler {
	var storeLock sync.Mutex
	routes := http.NewServeMux()

	withStore := func(respond func(http.ResponseWriter, *http.Request, *noteStore)) http.HandlerFunc {
		return func(writer http.ResponseWriter, request *http.Request) {
			storeLock.Lock()
			defer storeLock.Unlock()
			store, err := loadStore(storePath)
			if err != nil {
				http.Error(writer, fmt.Sprintf("Could not read the session notes in %s.", storePath), http.StatusInternalServerError)
				return
			}
			respond(writer, request, store)
		}
	}

	findSession := func(writer http.ResponseWriter, request *http.Request, store *noteStore) (int, bool) {
		sessionNumber, err := strconv.Atoi(request.PathValue("session"))
		if err != nil || sessionNumber < 1 || sessionNumber > len(store.rawSessions) {
			http.Error(writer, fmt.Sprintf("No session %s.", request.PathValue("session")), http.StatusNotFound)
			return 0, false
		}
		return sessionNumber - 1, true
	}

	findNote := func(writer http.ResponseWriter, request *http.Request, store *noteStore) (int, int, bool) {
		sessionIndex, isFound := findSession(writer, request, store)
		if !isFound {
			return 0, 0, false
		}
		noteNumber, err := strconv.Atoi(request.PathValue("note"))
		if err != nil || noteNumber < 1 || noteNumber > len(store.sessions()[sessionIndex].Notes) {
			http.Error(writer, fmt.Sprintf("No note %s in session %d.", request.PathValue("note"), sessionIndex+1), http.StatusNotFound)
			return 0, 0, false
		}
		return sessionIndex, noteNumber - 1, true
	}

	respondToSave := func(writer http.ResponseWriter, err error) {
		if err != nil {
			http.Error(writer, "Could not save the session notes.", http.StatusInternalServerError)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Write(indexPage)
	})

	routes.HandleFunc("GET /api/sessions", withStore(func(writer http.ResponseWriter, request *http.Request, store *noteStore) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(viewSessions(store.sessions()))
	}))

	routes.HandleFunc("PUT /api/sessions/{session}/notes/{note}", withStore(func(writer http.ResponseWriter, request *http.Request, store *noteStore) {
		sessionIndex, noteIndex, isFound := findNote(writer, request, store)
		if !isFound {
			return
		}
		var amendment struct {
			Text string `json:"text"`
		}
		json.NewDecoder(request.Body).Decode(&amendment)
		text := normalizeNoteText(amendment.Text)
		if text == "" {
			http.Error(writer, "The note needs some text.", http.StatusBadRequest)
			return
		}
		respondToSave(writer, store.replaceNote(sessionIndex, noteIndex, []string{text}))
	}))

	routes.HandleFunc("DELETE /api/sessions/{session}/notes/{note}", withStore(func(writer http.ResponseWriter, request *http.Request, store *noteStore) {
		sessionIndex, noteIndex, isFound := findNote(writer, request, store)
		if isFound {
			respondToSave(writer, store.replaceNote(sessionIndex, noteIndex, nil))
		}
	}))

	routes.HandleFunc("DELETE /api/sessions/{session}", withStore(func(writer http.ResponseWriter, request *http.Request, store *noteStore) {
		if sessionIndex, isFound := findSession(writer, request, store); isFound {
			respondToSave(writer, store.deleteSession(sessionIndex))
		}
	}))

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) || !isOwnOrigin(request) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}
