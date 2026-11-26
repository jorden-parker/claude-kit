package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"
)

const anthropicBaseURL = "https://api.anthropic.com"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "agent-models:", err)
		os.Exit(1)
	}
}

func run() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	repository := flag.String("repo", "", "repository root (default: found from the working directory)")
	choicesPath := flag.String("file", filepath.Join(home, ".claude", "agent-models.json"), "saved choices file")
	isListOnly := flag.Bool("list", false, "print agents and models, then exit")
	flag.Parse()

	if *repository == "" {
		workingDirectory, err := os.Getwd()
		if err != nil {
			return err
		}
		if *repository, err = findRepositoryRoot(workingDirectory); err != nil {
			return err
		}
	}
	agents, err := loadAgents(*repository)
	if err != nil {
		return err
	}
	settings, err := loadSettings(filepath.Join(home, ".claude", "settings.json"))
	if err != nil {
		return err
	}
	environment := mergeEnvironment(processEnvironment(), settings.Env)
	discovered, note := discoverModels(environment, runAws, nil, anthropicBaseURL)
	models := buildModelList(environment, settings, discovered)
	choices, err := loadChoices(*choicesPath)
	if err != nil {
		return err
	}

	if *isListOnly {
		for _, agent := range agents {
			effective := agent.DefaultModel
			if saved, isSaved := choices[agent.Type]; isSaved {
				effective = saved
			}
			fmt.Printf("%s\t%s\n", agent.Type, effective)
		}
		fmt.Println()
		for _, model := range models {
			fmt.Println(model)
		}
		if note != "" {
			fmt.Println()
			fmt.Println(note)
		}
		return nil
	}
	_, err = tea.NewProgram(newApp(agents, models, note, *choicesPath, choices)).Run()
	return err
}
