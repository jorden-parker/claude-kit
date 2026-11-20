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
	markdown            = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))
	datePrefixPattern   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
	headingPattern      = regexp.MustCompile(`^# (?:Plan: )?(.+)$`)
	headingFieldPattern = regexp.MustCompile(`^- ([A-Za-z ]+): (.+)$`)
)

type sectionLayout struct {
	Id                 string
	Title              string
	RootVariable       string
	EntryPattern       string
	GroupSegment       int
	HasEntryFolder     bool
	IsNewestGroupFirst bool
	IsNewestEntryFirst bool
}

var sectionLayouts = []sectionLayout{
	{Id: "handoffs", Title: "Handoffs", RootVariable: "HANDOFFS_DIR", EntryPattern: "*/*.md", IsNewestEntryFirst: true},
	{Id: "project-notes", Title: "Project notes", RootVariable: "PROJECT_NOTES_DIR", EntryPattern: "*/*/*.md", GroupSegment: 1, IsNewestEntryFirst: true},
	{Id: "small-plans", Title: "Small plans", RootVariable: "SMALL_PLANS_DIR", EntryPattern: "*/*/*.md", GroupSegment: 1, IsNewestGroupFirst: true},
	{Id: "brainstorm", Title: "Brainstorm plans", RootVariable: "BRAINSTORM_DIR", EntryPattern: "*/plans/*/*/plan.md", GroupSegment: 2, HasEntryFolder: true, IsNewestGroupFirst: true},
}

type entryView struct {
	Project string            `json:"project"`
	Group   string            `json:"group"`
	Name    string            `json:"name"`
	Title   string            `json:"title"`
	Created string            `json:"created"`
	Fields  map[string]string `json:"fields"`
	Path    string            `json:"path"`
	Html    string            `json:"html"`
}

type sectionView struct {
	Id      string      `json:"id"`
	Title   string      `json:"title"`
	Entries []entryView `json:"entries"`
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

func readHeadingFields(body string) map[string]string {
	fields := map[string]string{}
	lines := strings.Split(body, "\n")
	heading := headingPattern.FindStringSubmatch(lines[0])
	if heading == nil {
		return fields
	}
	fields["title"] = heading[1]
	for _, line := range lines[1:] {
		field := headingFieldPattern.FindStringSubmatch(line)
		if field == nil && strings.TrimSpace(line) != "" {
			break
		}
		if field != nil {
			fields[strings.ReplaceAll(strings.ToLower(field[1]), " ", "_")] = strings.TrimSpace(field[2])
		}
	}
	return fields
}

func appendStepFiles(planBody string, planFolder string) string {
	stepPaths, _ := filepath.Glob(filepath.Join(planFolder, "step-*.md"))
	for _, stepPath := range stepPaths {
		if stepText, err := os.ReadFile(stepPath); err == nil {
			planBody += "\n\n---\n\n" + string(stepText)
		}
	}
	return planBody
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

func resolveSectionRoot(layout sectionLayout) string {
	if sectionRoot := os.Getenv(layout.RootVariable); sectionRoot != "" {
		return sectionRoot
	}
	homeFolder, _ := os.UserHomeDir()
	return filepath.Join(homeFolder, ".claude", layout.Id)
}

func readEntry(layout sectionLayout, sectionRoot string, entryPath string) (entryView, bool) {
	text, err := os.ReadFile(entryPath)
	if err != nil {
		return entryView{}, false
	}
	relativePath, err := filepath.Rel(sectionRoot, entryPath)
	if err != nil {
		return entryView{}, false
	}
	segments := strings.Split(filepath.ToSlash(relativePath), "/")
	entryName := strings.TrimSuffix(segments[len(segments)-1], ".md")
	fields, body := splitFrontMatter(string(text))
	if len(fields) == 0 {
		fields = readHeadingFields(body)
	}
	if layout.HasEntryFolder {
		entryName = segments[len(segments)-2]
		body = appendStepFiles(body, filepath.Dir(entryPath))
	}
	group := ""
	if layout.GroupSegment > 0 {
		group = segments[layout.GroupSegment]
	}
	return entryView{
		Project: segments[0],
		Group:   group,
		Name:    entryName,
		Title:   readField(fields, "title", entryName),
		Created: readField(fields, "created", datePrefixPattern.FindString(entryName)),
		Fields:  fields,
		Path:    strings.Join(segments, "/"),
		Html:    renderMarkdown(body),
	}, true
}

func isListedBefore(layout sectionLayout, first entryView, second entryView) bool {
	if first.Project != second.Project {
		return first.Project < second.Project
	}
	if first.Group != second.Group {
		return (first.Group > second.Group) == layout.IsNewestGroupFirst
	}
	if !layout.IsNewestEntryFirst {
		return first.Path < second.Path
	}
	if first.Created != second.Created {
		return first.Created > second.Created
	}
	return first.Path > second.Path
}

func loadSection(layout sectionLayout) sectionView {
	sectionRoot := resolveSectionRoot(layout)
	entries := []entryView{}
	entryPaths, _ := filepath.Glob(filepath.Join(sectionRoot, filepath.FromSlash(layout.EntryPattern)))
	for _, entryPath := range entryPaths {
		if entry, isReadable := readEntry(layout, sectionRoot, entryPath); isReadable {
			entries = append(entries, entry)
		}
	}
	sort.SliceStable(entries, func(first, second int) bool {
		return isListedBefore(layout, entries[first], entries[second])
	})
	return sectionView{Id: layout.Id, Title: layout.Title, Entries: entries}
}

func loadSections() []sectionView {
	sections := []sectionView{}
	for _, layout := range sectionLayouts {
		sections = append(sections, loadSection(layout))
	}
	return sections
}

func isLocalHost(hostHeader string) bool {
	hostName, _, err := net.SplitHostPort(hostHeader)
	if err != nil {
		hostName = hostHeader
	}
	return hostName == "127.0.0.1" || hostName == "localhost"
}

func newViewerServer() http.Handler {
	routes := http.NewServeMux()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		writer.Write(indexPage)
	})

	routes.HandleFunc("GET /api/sections", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadSections())
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}
