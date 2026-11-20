package main

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxTitleLength = 100

var (
	planStatuses          = []string{"pending", "in-progress", "done", "blocked"}
	bannedPlanPhrases     = []string{"as appropriate", "if needed", "as needed", "where appropriate", "consider", "similar to", "etc.", "and so on", "you may", "TODO"}
	fieldLinePattern      = regexp.MustCompile(`^([a-z_]+): ?(.*)$`)
	numberedStepPattern   = regexp.MustCompile(`(?m)^\d+\.\s`)
	backtickedPattern     = regexp.MustCompile("`[^`\n]+`")
	codeFencePattern      = regexp.MustCompile("(?s)```.*?```")
	statusLinePattern     = regexp.MustCompile(`(?m)^- Status: *(.*)$`)
	orderPrefixPattern    = regexp.MustCompile(`^(\d{2})-`)
	dependencyListPattern = regexp.MustCompile(`^\d+(, ?\d+)*$`)
)

type noteFormat struct {
	Noun                   string
	HasHeadingTitle        bool
	RequiredFields         []string
	FieldChoices           map[string][]string
	FolderFields           map[string]int
	SectionsByChoice       map[string]map[string][]string
	RequiredSections       []string
	MaxSteps               int
	IsCheckCommandRequired bool
	IsBannedPhraseChecked  bool
	HasOrderPrefix         bool
}

var noteFormats = map[string]noteFormat{
	"handoffs": {
		Noun:           "handoff",
		RequiredFields: []string{"title", "project", "created", "cwd"},
		FolderFields:   map[string]int{"project": 0},
	},
	"project-notes": {
		Noun:           "project note",
		RequiredFields: []string{"title", "project", "created", "category"},
		FieldChoices:   map[string][]string{"category": {"fact", "finding", "decision", "reference", "debugging"}},
		FolderFields:   map[string]int{"project": 0, "category": 1},
		SectionsByChoice: map[string]map[string][]string{
			"category": {"debugging": {"Why these steps", "Steps taken", "Evidence", "Findings", "Next steps", "Draft Shortcut ticket"}},
		},
	},
	"small-plans": {
		Noun:                   "plan",
		RequiredFields:         []string{"title", "project", "created", "set", "order", "kind", "status"},
		FieldChoices:           map[string][]string{"kind": {"feature", "fix", "refactor", "test", "docs", "chore"}, "status": planStatuses},
		FolderFields:           map[string]int{"project": 0, "set": 1},
		RequiredSections:       []string{"Goal", "Context", "Steps", "Check", "Review"},
		MaxSteps:               6,
		IsCheckCommandRequired: true,
		IsBannedPhraseChecked:  true,
		HasOrderPrefix:         true,
	},
	"brainstorm": {
		Noun:                  "plan",
		HasHeadingTitle:       true,
		RequiredSections:      []string{"Context", "Steps"},
		IsBannedPhraseChecked: true,
	},
}

func describeFormatRefusal(sectionId string, problems []string) string {
	return fmt.Sprintf("The %s was not saved. Fix every problem and save again:\n- %s", noteFormats[sectionId].Noun, strings.Join(problems, "\n- "))
}

func parseStrictFrontMatter(text string) (map[string]string, string, []string) {
	afterOpening, hasOpening := strings.CutPrefix(text, "---\n")
	header, body, isClosed := strings.Cut(afterOpening, "\n---\n")
	if !hasOpening || !isClosed {
		return nil, text, []string{`The front matter must start with a "---" line and end with another "---" line.`}
	}
	fields := map[string]string{}
	problems := []string{}
	for lineNumber, line := range strings.Split(header, "\n") {
		field := fieldLinePattern.FindStringSubmatch(line)
		if field == nil {
			problems = append(problems, fmt.Sprintf("Line %d of the front matter is not \"name: value\": %q.", lineNumber+2, line))
			continue
		}
		if _, isDuplicate := fields[field[1]]; isDuplicate {
			problems = append(problems, fmt.Sprintf("The front matter sets %q twice.", field[1]))
		}
		fields[field[1]] = strings.TrimSpace(field[2])
	}
	return fields, body, problems
}

func listTitleProblems(title string) []string {
	switch {
	case strings.TrimSpace(title) != title:
		return []string{"The title must not start or end with spaces."}
	case !strings.ContainsFunc(title, func(character rune) bool { return unicode.IsLetter(character) || unicode.IsDigit(character) }):
		return []string{"The title must have a letter or a digit."}
	case utf8.RuneCountInString(title) > maxTitleLength:
		return []string{fmt.Sprintf("The title has %d characters; the most is %d.", utf8.RuneCountInString(title), maxTitleLength)}
	}
	return nil
}

func isIsoDate(value string) bool {
	if _, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return true
	}
	_, err := time.Parse(time.DateOnly, value)
	return err == nil
}

func listFieldProblems(format noteFormat, fields map[string]string, segments []string) []string {
	problems := []string{}
	for _, name := range format.RequiredFields {
		if fields[name] == "" {
			problems = append(problems, fmt.Sprintf("The front matter lacks %q.", name))
		}
	}
	if created := fields["created"]; created != "" && !isIsoDate(created) {
		problems = append(problems, `"created" must be an ISO date such as 2026-11-20T10:00:00.000Z.`)
	}
	for name, choices := range format.FieldChoices {
		if value := fields[name]; value != "" && !slices.Contains(choices, value) {
			problems = append(problems, fmt.Sprintf("%q must be one of: %s.", name, strings.Join(choices, ", ")))
		}
	}
	for name, segmentIndex := range format.FolderFields {
		if value := fields[name]; value != "" && segmentIndex < len(segments)-1 && value != segments[segmentIndex] {
			problems = append(problems, fmt.Sprintf("%q must match the folder the file is in: %q.", name, segments[segmentIndex]))
		}
	}
	return problems
}

func listOrderProblems(fields map[string]string, fileName string) []string {
	if fields["order"] == "" {
		return nil
	}
	order, err := strconv.Atoi(fields["order"])
	if prefix := orderPrefixPattern.FindStringSubmatch(fileName); err != nil || prefix == nil || prefix[1] != fmt.Sprintf("%02d", order) {
		return []string{fmt.Sprintf("\"order\" must match the number the file name starts with: %s.", strings.TrimSuffix(fileName, ".md"))}
	}
	dependencies := fields["depends_on"]
	if dependencies == "" || dependencies == "none" {
		return nil
	}
	isValidList := dependencyListPattern.MatchString(dependencies)
	for _, dependency := range strings.Split(dependencies, ",") {
		if dependencyOrder, err := strconv.Atoi(strings.TrimSpace(dependency)); err != nil || dependencyOrder >= order {
			isValidList = false
		}
	}
	if !isValidList {
		return []string{fmt.Sprintf("\"depends_on\" must list earlier plan numbers, such as 1, 2 (all below %d).", order)}
	}
	return nil
}

func readSections(body string) map[string]string {
	sections := map[string]string{}
	currentHeading := ""
	for _, line := range strings.Split(body, "\n") {
		if heading, isHeading := strings.CutPrefix(line, "## "); isHeading {
			currentHeading = strings.ToLower(strings.TrimSpace(heading))
			sections[currentHeading] = ""
			continue
		}
		if currentHeading != "" {
			sections[currentHeading] += line + "\n"
		}
	}
	return sections
}

func listBodyProblems(format noteFormat, fields map[string]string, body string) []string {
	if strings.TrimSpace(body) == "" {
		return []string{"The body is empty. Write the note below the front matter."}
	}
	sections := readSections(body)
	requiredSections := slices.Clone(format.RequiredSections)
	for name, sectionsByValue := range format.SectionsByChoice {
		requiredSections = append(requiredSections, sectionsByValue[fields[name]]...)
	}
	problems := []string{}
	for _, section := range requiredSections {
		if _, isPresent := sections[strings.ToLower(section)]; !isPresent {
			problems = append(problems, fmt.Sprintf("The body lacks \"## %s\".", section))
		}
	}
	if stepsSection, isPresent := sections["steps"]; isPresent && format.MaxSteps > 0 {
		stepCount := len(numberedStepPattern.FindAllString(stepsSection, -1))
		if stepCount == 0 {
			problems = append(problems, `"## Steps" needs a numbered list.`)
		}
		if stepCount > format.MaxSteps {
			problems = append(problems, fmt.Sprintf("The plan has %d steps; the most is %d. Split it into two plans.", stepCount, format.MaxSteps))
		}
	}
	if checkSection, isPresent := sections["check"]; isPresent && format.IsCheckCommandRequired && !backtickedPattern.MatchString(checkSection) {
		problems = append(problems, `"## Check" needs a command in backticks to run.`)
	}
	if format.IsBannedPhraseChecked {
		problems = append(problems, listBannedPhrases(body)...)
	}
	return problems
}

func listBannedPhrases(body string) []string {
	prose := codeFencePattern.ReplaceAllString(body, "")
	problems := []string{}
	for _, phrase := range bannedPlanPhrases {
		phrasePattern := regexp.MustCompile(`(?i)(^|[^A-Za-z])` + regexp.QuoteMeta(phrase) + `([^A-Za-z]|$)`)
		if phrasePattern.MatchString(prose) {
			problems = append(problems, fmt.Sprintf("The body uses the banned phrase %q outside code fences. Say the exact thing instead.", strings.ToLower(phrase)))
		}
	}
	return problems
}

func listHeadingProblems(text string) (map[string]string, []string) {
	fields := readHeadingFields(text)
	problems := []string{}
	if fields["title"] == "" {
		problems = append(problems, `The first line must be the title heading, such as "# Plan: Let the guard see pipes".`)
	}
	status := statusLinePattern.FindStringSubmatch(text)
	if status == nil || !slices.Contains(planStatuses, strings.TrimSpace(status[1])) {
		problems = append(problems, fmt.Sprintf(`The plan needs a "- Status:" line set to one of: %s.`, strings.Join(planStatuses, ", ")))
	}
	return fields, problems
}

func listFormatProblems(sectionId string, entryPath string, text string) []string {
	format := noteFormats[sectionId]
	if !utf8.ValidString(text) {
		return []string{"The text is not valid UTF-8."}
	}
	segments := strings.Split(entryPath, "/")
	var fields map[string]string
	var problems []string
	body := text
	if format.HasHeadingTitle {
		fields, problems = listHeadingProblems(text)
	} else {
		fields, body, problems = parseStrictFrontMatter(text)
		if fields == nil {
			return problems
		}
		problems = append(problems, listFieldProblems(format, fields, segments)...)
	}
	if fields["title"] != "" {
		problems = append(problems, listTitleProblems(fields["title"])...)
	}
	if format.HasOrderPrefix {
		problems = append(problems, listOrderProblems(fields, segments[len(segments)-1])...)
	}
	return append(problems, listBodyProblems(format, fields, body)...)
}
