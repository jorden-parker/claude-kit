package main

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type folderRename struct {
	from string
	to   string
}

func planProjectRename(project string, newProject string) ([]folderRename, int, string) {
	if !isFolderName(project) {
		return nil, http.StatusBadRequest, "Bad project name."
	}
	if !projectNamePattern.MatchString(newProject) {
		return nil, http.StatusBadRequest, "A project name starts with a letter or digit and holds only letters, digits, dots, dashes and underscores."
	}
	if newProject == project {
		return nil, http.StatusBadRequest, "The new name is the same as the old one."
	}
	renames := []folderRename{}
	for _, layout := range sectionLayouts {
		sectionRoot := resolveSectionRoot(layout)
		projectFolder := filepath.Join(sectionRoot, project)
		if folderInfo, err := os.Stat(projectFolder); err != nil || !folderInfo.IsDir() {
			continue
		}
		targetFolder := filepath.Join(sectionRoot, newProject)
		if _, err := os.Lstat(targetFolder); err == nil {
			return nil, http.StatusConflict, fmt.Sprintf("%s already has a project called %s. Pick another name, or move its notes first.", layout.Title, newProject)
		}
		renames = append(renames, folderRename{from: projectFolder, to: targetFolder})
	}
	if len(renames) == 0 {
		return nil, http.StatusNotFound, fmt.Sprintf("No project called %s.", project)
	}
	return renames, 0, ""
}

func renameFolders(renames []folderRename) error {
	for done, rename := range renames {
		if err := os.Rename(rename.from, rename.to); err != nil {
			for _, undone := range renames[:done] {
				os.Rename(undone.to, undone.from)
			}
			return err
		}
	}
	return nil
}

func replaceFrontMatterProject(text string, project string, newProject string) (string, bool) {
	afterOpening, hasOpening := strings.CutPrefix(text, "---\n")
	if !hasOpening {
		return text, false
	}
	header, body, isClosed := strings.Cut(afterOpening, "\n---\n")
	if !isClosed {
		return text, false
	}
	lines := strings.Split(header, "\n")
	for index, line := range lines {
		if line == "project: "+project {
			lines[index] = "project: " + newProject
			return "---\n" + strings.Join(lines, "\n") + "\n---\n" + body, true
		}
	}
	return text, false
}

func rewriteProjectLines(projectFolder string, project string, newProject string) error {
	return filepath.WalkDir(projectFolder, func(filePath string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(filePath) != ".md" {
			return err
		}
		text, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		if rewritten, isChanged := replaceFrontMatterProject(string(text), project, newProject); isChanged {
			return os.WriteFile(filePath, []byte(rewritten), 0o644)
		}
		return nil
	})
}

func renameProject(project string, newProject string) (int, string) {
	renames, refusalStatus, refusal := planProjectRename(project, newProject)
	if refusal != "" {
		return refusalStatus, refusal
	}
	if err := renameFolders(renames); err != nil {
		return http.StatusInternalServerError, err.Error()
	}
	for _, rename := range renames {
		if err := rewriteProjectLines(rename.to, project, newProject); err != nil {
			return http.StatusInternalServerError, "The folders were renamed, but a project: line could not be rewritten: " + err.Error()
		}
	}
	return http.StatusOK, ""
}
