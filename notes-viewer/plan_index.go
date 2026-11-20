package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const planIndexFileName = "index.md"

const planIndexIntro = "This index is rewritten each time a plan of this set is saved, edited, moved, deleted or changes status. Build the plans in this order: a plan waits until every plan in its Depends on column is done."

var numberedPlanFileName = regexp.MustCompile(`^\d+-.*\.md$`)

func isPlanIndex(layout sectionLayout, entryPath string) bool {
	return layout.HasEditableSets && filepath.Base(entryPath) == planIndexFileName
}

func pruneEmptyFolders(sectionRoot string, folder string) {
	for ; folder != sectionRoot && strings.HasPrefix(folder, sectionRoot); folder = filepath.Dir(folder) {
		if os.Remove(folder) != nil {
			return
		}
	}
}

func composePlanIndexRow(planName string, planText string) string {
	fields, _ := splitFrontMatter(planText)
	title := fields["title"]
	if title == "" {
		title = planName
	}
	dependencies := fields["depends_on"]
	if dependencies == "" {
		dependencies = "none"
	}
	order, _ := strconv.Atoi(strings.SplitN(planName, "-", 2)[0])
	return fmt.Sprintf("| %d | [%s](%s) | %s | %s | %s |", order, title, planName, fields["kind"], fields["status"], dependencies)
}

func rewritePlanIndex(layout sectionLayout, setFolder string) {
	if !layout.HasEditableSets {
		return
	}
	folderEntries, err := os.ReadDir(setFolder)
	if err != nil {
		return
	}
	rows := []string{}
	for _, folderEntry := range folderEntries {
		if folderEntry.Type().IsRegular() && numberedPlanFileName.MatchString(folderEntry.Name()) {
			planText, _ := os.ReadFile(filepath.Join(setFolder, folderEntry.Name()))
			rows = append(rows, composePlanIndexRow(folderEntry.Name(), string(planText)))
		}
	}
	indexPath := filepath.Join(setFolder, planIndexFileName)
	if len(rows) == 0 {
		os.Remove(indexPath)
		pruneEmptyFolders(resolveSectionRoot(layout), setFolder)
		return
	}
	lines := append([]string{
		"# Plans: " + filepath.Base(setFolder),
		"",
		planIndexIntro,
		"",
		"| Order | Plan | Kind | Status | Depends on |",
		"| --- | --- | --- | --- | --- |",
	}, rows...)
	os.WriteFile(indexPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}
