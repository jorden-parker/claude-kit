package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

//go:embed index.html
var indexPage []byte

var (
	markdown          = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))
	datePrefixPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
)

type noteView struct {
	Project  string `json:"project"`
	Category string `json:"category"`
	Title    string `json:"title"`
	Created  string `json:"created"`
	Path     string `json:"path"`
	Html     string `json:"html"`
}

func splitFrontMatter(text string) (map[string]string, string) {
	fields := map[string]string{}
	afterOpening, hasOpening := strings.CutPrefix(text, "---\n")
	if !hasOpening {
		return fields, text
	}
	header, body, isClosed := strings.Cut(afterOpening, "\n---\n")
	if !isClosed {
		return fields, text
	}
	for _, line := range strings.Split(header, "\n") {
		if name, value, isField := strings.Cut(line, ": "); isField {
			fields[name] = strings.TrimSpace(value)
		}
	}
	return fields, body
}

func renderMarkdown(text string) string {
	var rendered bytes.Buffer
	if err := markdown.Convert([]byte(text), &rendered); err != nil {
		return ""
	}
	return rendered.String()
}

func readNote(notesRoot string, notePath string) (noteView, bool) {
	text, err := os.ReadFile(notePath)
	if err != nil {
		return noteView{}, false
	}
	relativePath, err := filepath.Rel(notesRoot, notePath)
	if err != nil {
		return noteView{}, false
	}
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	fileName := strings.TrimSuffix(segments[2], ".md")
	fields, body := splitFrontMatter(string(text))
	title := fields["title"]
	if title == "" {
		title = fileName
	}
	created := fields["created"]
	if created == "" {
		created = datePrefixPattern.FindString(fileName)
	}
	return noteView{
		Project:  segments[0],
		Category: segments[1],
		Title:    title,
		Created:  created,
		Path:     strings.Join(segments, "/"),
		Html:     renderMarkdown(body),
	}, true
}

func loadNotes(notesRoot string) []noteView {
	notes := []noteView{}
	notePaths, _ := filepath.Glob(filepath.Join(notesRoot, "*", "*", "*.md"))
	for _, notePath := range notePaths {
		if note, isReadable := readNote(notesRoot, notePath); isReadable {
			notes = append(notes, note)
		}
	}
	sort.SliceStable(notes, func(first, second int) bool {
		if notes[first].Project != notes[second].Project {
			return notes[first].Project < notes[second].Project
		}
		if notes[first].Category != notes[second].Category {
			return notes[first].Category < notes[second].Category
		}
		return notes[first].Created > notes[second].Created
	})
	return notes
}

func isLocalHost(hostHeader string) bool {
	hostName, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		hostName = hostHeader
	}
	return hostName == "127.0.0.1" || hostName == "localhost"
}

func newNotesServer(notesRoot string) http.Handler {
	routes := http.NewServeMux()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Write(indexPage)
	})

	routes.HandleFunc("GET /api/notes", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadNotes(notesRoot))
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}
