package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/renderer/html"
)

//go:embed index.html
var indexPage []byte

const maxNoteBytes = 4 << 20

var projectNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

var (
	markdown            = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithRendererOptions(html.WithHardWraps()))
	datePrefixPattern   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)
	headingPattern      = regexp.MustCompile(`^# (?:Plan: )?(.+)$`)
	headingFieldPattern = regexp.MustCompile(`^- ([A-Za-z ]+): (.+)$`)
)

type sectionLayout struct {
	Identifier         string
	Title              string
	RootVariable       string
	HomeFolder         string
	EntryPattern       string
	GroupSegment       int
	HasEntryFolder     bool
	HasEditableSets    bool
	IsNewestGroupFirst bool
	IsNewestEntryFirst bool
}

var sectionLayouts = []sectionLayout{
	{Identifier: "handoffs", Title: "Handoffs", RootVariable: "HANDOFFS_DIR", HomeFolder: ".local/share/handoffs", EntryPattern: "*/*.md", IsNewestEntryFirst: true},
	{Identifier: "project-notes", Title: "Project Notes", RootVariable: "PROJECT_NOTES_DIR", HomeFolder: ".local/share/project-notes", EntryPattern: "*/*/*.md", GroupSegment: 1, IsNewestEntryFirst: true},
	{Identifier: "small-plans", Title: "Small Plans", RootVariable: "SMALL_PLANS_DIR", HomeFolder: ".local/share/small-plans", EntryPattern: "*/*/*.md", GroupSegment: 1, IsNewestGroupFirst: true, HasEditableSets: true},
	{Identifier: "brainstorm", Title: "Brainstorm Plans", RootVariable: "BRAINSTORM_DIR", HomeFolder: ".local/share/brainstorm", EntryPattern: "*/plans/*/*/plan.md", GroupSegment: 2, HasEntryFolder: true, IsNewestGroupFirst: true},
}

type entryView struct {
	Section string            `json:"section"`
	Project string            `json:"project"`
	Group   string            `json:"group"`
	Name    string            `json:"name"`
	Title   string            `json:"title"`
	Created string            `json:"created"`
	Fields  map[string]string `json:"fields"`
	Path    string            `json:"path"`
	Html    string            `json:"html"`
	Source  string            `json:"source"`
}

type sectionView struct {
	Identifier string      `json:"id"`
	Title      string      `json:"title"`
	Entries    []entryView `json:"entries"`
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
	if layout.HomeFolder != "" {
		return filepath.Join(homeFolder, layout.HomeFolder)
	}
	return filepath.Join(homeFolder, ".claude", layout.Identifier)
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
		Section: layout.Identifier,
		Project: segments[0],
		Group:   group,
		Name:    entryName,
		Title:   toTitleCase(readField(fields, "title", entryName)),
		Created: readField(fields, "created", datePrefixPattern.FindString(entryName)),
		Fields:  fields,
		Path:    strings.Join(segments, "/"),
		Html:    renderMarkdown(body),
		Source:  string(text),
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
		if isPlanIndex(layout, entryPath) {
			continue
		}
		if entry, isReadable := readEntry(layout, sectionRoot, entryPath); isReadable {
			entries = append(entries, entry)
		}
	}
	sort.SliceStable(entries, func(first, second int) bool {
		return isListedBefore(layout, entries[first], entries[second])
	})
	return sectionView{Identifier: layout.Identifier, Title: layout.Title, Entries: entries}
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

func findSectionLayout(sectionId string) (sectionLayout, bool) {
	for _, layout := range sectionLayouts {
		if layout.Identifier == sectionId {
			return layout, true
		}
	}
	return sectionLayout{}, false
}

func resolveEntryLocation(sectionId string, entryPath string) (sectionLayout, string, bool) {
	layout, isKnown := findSectionLayout(sectionId)
	if !isKnown || filepath.ToSlash(filepath.Clean(entryPath)) != entryPath {
		return layout, "", false
	}
	if isEntry, _ := filepath.Match(layout.EntryPattern, entryPath); !isEntry || isPlanIndex(layout, entryPath) {
		return layout, "", false
	}
	return layout, filepath.Join(resolveSectionRoot(layout), filepath.FromSlash(entryPath)), true
}

func resolveEntryPath(sectionId string, entryPath string) (sectionLayout, string, bool) {
	layout, absolutePath, isEntry := resolveEntryLocation(sectionId, entryPath)
	if !isEntry {
		return layout, "", false
	}
	if fileInfo, err := os.Stat(absolutePath); err != nil || !fileInfo.Mode().IsRegular() {
		return layout, "", false
	}
	return layout, absolutePath, true
}

func isFolderName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, `/\`)
}

func resolveGroupFolder(sectionId string, project string, group string) (string, bool) {
	layout, isKnown := findSectionLayout(sectionId)
	if !isKnown || !layout.HasEditableSets || !isFolderName(project) || !isFolderName(group) {
		return "", false
	}
	groupFolder := filepath.Join(resolveSectionRoot(layout), project, group)
	if folderInfo, err := os.Stat(groupFolder); err != nil || !folderInfo.IsDir() {
		return "", false
	}
	return groupFolder, true
}

func createNoteFile(notePath string, text []byte) error {
	noteFile, err := os.OpenFile(notePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, writeErr := noteFile.Write(text)
	if closeErr := noteFile.Close(); writeErr == nil {
		writeErr = closeErr
	}
	return writeErr
}

func findNextHandoffName(projectFolder string, entryName string) string {
	highestId := 0
	handoffPaths, _ := filepath.Glob(filepath.Join(projectFolder, "*.md"))
	for _, handoffPath := range handoffPaths {
		idText, _, _ := strings.Cut(filepath.Base(handoffPath), "-")
		if handoffId, err := strconv.Atoi(idText); err == nil && handoffId > highestId {
			highestId = handoffId
		}
	}
	slug := entryName
	if _, nameAfterId, hasId := strings.Cut(entryName, "-"); hasId {
		slug = nameAfterId
	}
	return fmt.Sprintf("%03d-%s.md", highestId+1, slug)
}

func findFreeNoteName(noteFolder string, entryName string) string {
	freeName := entryName + ".md"
	for suffix := 2; ; suffix++ {
		if _, err := os.Stat(filepath.Join(noteFolder, freeName)); errors.Is(err, fs.ErrNotExist) {
			return freeName
		}
		freeName = fmt.Sprintf("%s-%d.md", entryName, suffix)
	}
}

func planProjectMove(layout sectionLayout, entryPath string, newProject string) (string, int, string) {
	if !projectNamePattern.MatchString(newProject) {
		return "", http.StatusBadRequest, "A project name starts with a letter or digit and holds only letters, digits, dots, dashes and underscores."
	}
	segments := strings.Split(entryPath, "/")
	entryName := strings.TrimSuffix(segments[len(segments)-1], ".md")
	targetFolder := filepath.Join(append([]string{resolveSectionRoot(layout), newProject}, segments[1:len(segments)-1]...)...)
	targetFolderPath := strings.Join(append([]string{newProject}, segments[1:len(segments)-1]...), "/")
	switch layout.Identifier {
	case "handoffs":
		return targetFolderPath + "/" + findNextHandoffName(targetFolder, entryName), 0, ""
	case "project-notes":
		return targetFolderPath + "/" + findFreeNoteName(targetFolder, entryName), 0, ""
	case "small-plans":
		orderPrefix, _, _ := strings.Cut(entryName, "-")
		if takenPlans, _ := filepath.Glob(filepath.Join(targetFolder, orderPrefix+"-*.md")); len(takenPlans) > 0 {
			return "", http.StatusConflict, fmt.Sprintf("Plan %s already exists in the set %s of %s. Change the plan's order first, or move it to another project.", orderPrefix, segments[1], newProject)
		}
		return targetFolderPath + "/" + entryName + ".md", 0, ""
	}
	return "", http.StatusBadRequest, "Brainstorm plans can't change project: each run's index.md lists its plans, so moving one breaks both runs."
}

func moveNoteFile(sectionRoot string, notePath string, targetPath string, text []byte) error {
	targetFile := filepath.Join(sectionRoot, filepath.FromSlash(targetPath))
	if err := os.MkdirAll(filepath.Dir(targetFile), 0o755); err != nil {
		return err
	}
	if err := createNoteFile(targetFile, text); err != nil {
		return err
	}
	if err := os.Remove(notePath); err != nil {
		return err
	}
	pruneEmptyFolders(sectionRoot, filepath.Dir(notePath))
	return nil
}

func isSameOrigin(request *http.Request) bool {
	origin := request.Header.Get("Origin")
	return origin == "" || origin == "http://"+request.Host
}

func newViewerServer() http.Handler {
	routes := http.NewServeMux()

	sourceDirectory := devSourceDirectory()

	routes.HandleFunc("GET /{$}", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		if sourceDirectory == "" {
			writer.Write(indexPage)
			return
		}
		page, err := readDevPage(sourceDirectory)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		writer.Write(page)
	})

	if sourceDirectory != "" {
		routes.HandleFunc("GET /api/live-reload", func(writer http.ResponseWriter, request *http.Request) {
			streamPageChanges(sourceDirectory, writer, request)
		})
	}

	routes.HandleFunc("GET /api/sections", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadSections())
	})

	routes.HandleFunc("GET /api/tokens", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(loadTokenSection())
	})

	routes.HandleFunc("PUT /api/notes/{section}/{path...}", func(writer http.ResponseWriter, request *http.Request) {
		layout, notePath, isEntry := resolveEntryPath(request.PathValue("section"), request.PathValue("path"))
		if !isEntry {
			http.Error(writer, "Note not found.", http.StatusNotFound)
			return
		}
		entryPath := request.PathValue("path")
		newProject := request.URL.Query().Get("project")
		isMove := newProject != "" && newProject != strings.Split(entryPath, "/")[0]
		targetPath := entryPath
		if isMove {
			movedPath, refusalStatus, refusal := planProjectMove(layout, entryPath, newProject)
			if refusal != "" {
				http.Error(writer, refusal, refusalStatus)
				return
			}
			targetPath = movedPath
		}
		text, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxNoteBytes))
		if err != nil {
			http.Error(writer, "Note too large.", http.StatusRequestEntityTooLarge)
			return
		}
		if problems := listFormatProblems(layout.Identifier, targetPath, string(text)); len(problems) > 0 {
			http.Error(writer, describeFormatRefusal(layout.Identifier, problems), http.StatusUnprocessableEntity)
			return
		}
		if !isMove {
			if err := os.WriteFile(notePath, text, 0o644); err != nil {
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			rewritePlanIndex(layout, filepath.Dir(notePath))
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		if err := moveNoteFile(resolveSectionRoot(layout), notePath, targetPath, text); err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		rewritePlanIndex(layout, filepath.Dir(notePath))
		rewritePlanIndex(layout, filepath.Dir(filepath.Join(resolveSectionRoot(layout), filepath.FromSlash(targetPath))))
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(map[string]string{"path": targetPath})
	})

	routes.HandleFunc("POST /api/notes/{section}/{path...}", func(writer http.ResponseWriter, request *http.Request) {
		layout, notePath, isEntry := resolveEntryLocation(request.PathValue("section"), request.PathValue("path"))
		if !isEntry || !layout.HasEditableSets {
			http.Error(writer, "Plans can only be added to an existing small plan set.", http.StatusNotFound)
			return
		}
		if folderInfo, err := os.Stat(filepath.Dir(notePath)); err != nil || !folderInfo.IsDir() {
			http.Error(writer, "Set not found.", http.StatusNotFound)
			return
		}
		text, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxNoteBytes))
		if err != nil {
			http.Error(writer, "Note too large.", http.StatusRequestEntityTooLarge)
			return
		}
		if problems := listFormatProblems(request.PathValue("section"), request.PathValue("path"), string(text)); len(problems) > 0 {
			http.Error(writer, describeFormatRefusal(request.PathValue("section"), problems), http.StatusUnprocessableEntity)
			return
		}
		err = createNoteFile(notePath, text)
		if errors.Is(err, fs.ErrExist) {
			http.Error(writer, "A plan with that file name already exists.", http.StatusConflict)
			return
		}
		if err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		rewritePlanIndex(layout, filepath.Dir(notePath))
		writer.WriteHeader(http.StatusCreated)
	})

	routes.HandleFunc("DELETE /api/notes/{section}/{path...}", func(writer http.ResponseWriter, request *http.Request) {
		layout, notePath, isEntry := resolveEntryPath(request.PathValue("section"), request.PathValue("path"))
		if !isEntry {
			http.Error(writer, "Note not found.", http.StatusNotFound)
			return
		}
		removeNote := os.Remove
		if layout.HasEntryFolder {
			notePath = filepath.Dir(notePath)
			removeNote = os.RemoveAll
		}
		if err := removeNote(notePath); err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		rewritePlanIndex(layout, filepath.Dir(notePath))
		writer.WriteHeader(http.StatusNoContent)
	})

	routes.HandleFunc("DELETE /api/groups/{section}/{project}/{group}", func(writer http.ResponseWriter, request *http.Request) {
		groupFolder, isGroup := resolveGroupFolder(request.PathValue("section"), request.PathValue("project"), request.PathValue("group"))
		if !isGroup {
			http.Error(writer, "Group not found.", http.StatusNotFound)
			return
		}
		if err := os.RemoveAll(groupFolder); err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	})

	routes.HandleFunc("POST /api/projects/{project}/rename", func(writer http.ResponseWriter, request *http.Request) {
		newProject := request.URL.Query().Get("to")
		if status, refusal := renameProject(request.PathValue("project"), newProject); refusal != "" {
			http.Error(writer, refusal, status)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		json.NewEncoder(writer).Encode(map[string]string{"project": newProject})
	})

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLocalHost(request.Host) || !isSameOrigin(request) {
			http.Error(writer, "Forbidden.", http.StatusForbidden)
			return
		}
		if path.Clean(request.URL.Path) != request.URL.Path {
			http.Error(writer, "Bad path.", http.StatusBadRequest)
			return
		}
		routes.ServeHTTP(writer, request)
	})
}

var titleAcronyms = map[string]bool{
	"ai": true, "api": true, "ui": true, "ux": true, "cli": true, "ci": true, "pr": true, "url": true, "id": true,
	"mcp": true, "sdk": true, "json": true, "html": true, "css": true, "llm": true, "pdf": true, "sql": true, "csv": true,
}

var titleSmallWords = map[string]bool{
	"a": true, "an": true, "the": true, "and": true, "but": true, "or": true, "nor": true, "for": true, "so": true,
	"yet": true, "as": true, "at": true, "by": true, "in": true, "of": true, "on": true, "to": true, "up": true,
	"via": true, "vs": true,
}

var slashCompoundPattern = regexp.MustCompile(`^\pL+(/\pL+)+$`)

func splitSlashCompound(word string) []string {
	if slashCompoundPattern.MatchString(word) {
		return strings.Split(word, "/")
	}
	return []string{word}
}

func capitalizeTitleWord(word string, canLowerSmallWord bool) string {
	lower := strings.ToLower(word)
	runes := []rune(word)
	switch {
	case titleAcronyms[lower]:
		return strings.ToUpper(word)
	case lower == "ios":
		return "iOS"
	case strings.IndexFunc(string(runes[1:]), unicode.IsUpper) >= 0:
		return word
	case strings.Contains(word, "-") && word == lower:
		return word
	case titleSmallWords[lower] && canLowerSmallWord:
		return lower
	}
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func toTitleCase(title string) string {
	words := strings.Fields(title)
	for wordIndex, word := range words {
		isEdgeWord := wordIndex == 0 || wordIndex == len(words)-1
		parts := splitSlashCompound(word)
		canLowerSmallWord := !isEdgeWord && len(parts) == 1
		for partIndex, part := range parts {
			parts[partIndex] = capitalizeTitleWord(part, canLowerSmallWord)
		}
		words[wordIndex] = strings.Join(parts, "/")
	}
	return strings.Join(words, " ")
}
