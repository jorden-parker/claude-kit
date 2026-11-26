package main

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Agent struct {
	Type         string
	DefaultModel string
}

func parseFrontmatter(text string) map[string]string {
	fields := map[string]string{}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return fields
	}
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		key, value, isPair := strings.Cut(line, ":")
		if !isPair {
			continue
		}
		fields[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return fields
}

func loadAgents(repository string) ([]Agent, error) {
	paths, err := filepath.Glob(filepath.Join(repository, "plugins", "*", "agents", "*.md"))
	if err != nil {
		return nil, err
	}
	var agents []Agent
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		fields := parseFrontmatter(string(content))
		name := fields["name"]
		if name == "" {
			continue
		}
		defaultModel := fields["model"]
		if defaultModel == "" {
			defaultModel = "inherit"
		}
		pluginFolder := filepath.Base(filepath.Dir(filepath.Dir(path)))
		agents = append(agents, Agent{Type: pluginFolder + ":" + name, DefaultModel: defaultModel})
	}
	sort.Slice(agents, func(first, second int) bool { return agents[first].Type < agents[second].Type })
	return agents, nil
}

func findRepositoryRoot(start string) (string, error) {
	directory := start
	for {
		if _, err := os.Stat(filepath.Join(directory, ".claude-plugin", "marketplace.json")); err == nil {
			return directory, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", errors.New("no .claude-plugin/marketplace.json found above " + start)
		}
		directory = parent
	}
}
