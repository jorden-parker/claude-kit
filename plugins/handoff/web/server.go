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
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

//go:embed index.html
var indexPage []byte

var (
	markdown        = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))
	idPrefixPattern = regexp.MustCompile(`^\d+`)
)

type handoffView struct {
	Project string `json:"project"`
	Id      int    `json:"id"`
	Title   string `json:"title"`
	Created string `json:"created"`
	Focus   string `json:"focus"`
	Path    string `json:"path"`
	Html    string `json:"html"`
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

func readHandoff(handoffsRoot string, handoffPath string) (handoffView, bool) {
	text, err := os.ReadFile(handoffPath)
	if err != nil {
		return handoffView{}, false
	}
	relativePath, err := filepath.Rel(handoffsRoot, handoffPath)
	if err != nil {
		return handoffView{}, false
	}
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	fileName := strings.TrimSuffix(segments[1], ".md")
	fields, body := splitFrontMatter(string(text))
	title := fields["title"]
	if title == "" {
		title = fileName
	}
	handoffId, _ := strconv.Atoi(idPrefixPattern.FindString(fileName))
	return handoffView{
		Project: segments[0],
		Id:      handoffId,
		Title:   title,
		Created: fields["created"],
		Focus:   fields["focus"],
		Path:    strings.Join(segments, "/"),
		Html:    renderMarkdown(body),
	}, true
}

func loadHandoffs(handoffsRoot string) []handoffView {
	handoffs := []handoffView{}
	handoffPaths, _ := filepath.Glob(filepath.Join(handoffsRoot, "*", "*.md"))
	for _, handoffPath := range handoffPaths {
		if handoff, isReadable := readHandoff(handoffsRoot, handoffPath); isReadable {
			handoffs = append(handoffs, handoff)
		}
	}
	sort.SliceStable(handoffs, func(first, second int) bool {
		if handoffs[first].Project != handoffs[second].Project {
			return handoffs[first].Project < handoffs[second].Project
		}
		return handoffs[first].Id > handoffs[second].Id
	})
	return handoffs
}

func isLocalHost(hostHeader string) bool {
	hostName, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		hostName = hostHeader
	}
	return hostName == "127.0.0.1" || hostName == "localhost"
}

func newHandoffsServer(handoffsRoot string) http.Handler {
	routes := http.NewServeMux()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Write(indexPage)
	})

	routes.HandleFunc("GET /api/handoffs", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadHandoffs(handoffsRoot))
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}
