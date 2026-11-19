package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

//go:embed index.html
var indexPage []byte

var markdown = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))

type planView struct {
	Project   string `json:"project"`
	Set       string `json:"set"`
	Title     string `json:"title"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	DependsOn string `json:"dependsOn"`
	Created   string `json:"created"`
	Path      string `json:"path"`
	Html      string `json:"html"`
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

func readField(fields map[string]string, name string, fallback string) string {
	if value := fields[name]; value != "" {
		return value
	}
	return fallback
}

func readPlan(plansRoot string, planPath string) (planView, bool) {
	text, err := os.ReadFile(planPath)
	if err != nil {
		return planView{}, false
	}
	relativePath, err := filepath.Rel(plansRoot, planPath)
	if err != nil {
		return planView{}, false
	}
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	fields, body := splitFrontMatter(string(text))
	return planView{
		Project:   segments[0],
		Set:       segments[1],
		Title:     readField(fields, "title", strings.TrimSuffix(segments[2], ".md")),
		Kind:      readField(fields, "kind", "chore"),
		Status:    readField(fields, "status", "pending"),
		DependsOn: fields["depends_on"],
		Created:   fields["created"],
		Path:      strings.Join(segments, "/"),
		Html:      renderMarkdown(body),
	}, true
}

func loadPlans(plansRoot string) []planView {
	plans := []planView{}
	planPaths, _ := filepath.Glob(filepath.Join(plansRoot, "*", "*", "*.md"))
	for _, planPath := range planPaths {
		if plan, isReadable := readPlan(plansRoot, planPath); isReadable {
			plans = append(plans, plan)
		}
	}
	sort.SliceStable(plans, func(first, second int) bool {
		if plans[first].Project != plans[second].Project {
			return plans[first].Project < plans[second].Project
		}
		if plans[first].Set != plans[second].Set {
			return plans[first].Set > plans[second].Set
		}
		return plans[first].Path < plans[second].Path
	})
	return plans
}

func isLocalHost(hostHeader string) bool {
	hostName, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		hostName = hostHeader
	}
	return hostName == "127.0.0.1" || hostName == "localhost"
}

func newPlansServer(plansRoot string) http.Handler {
	routes := http.NewServeMux()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Write(indexPage)
	})

	routes.HandleFunc("GET /api/plans", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadPlans(plansRoot))
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}
