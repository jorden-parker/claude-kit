package main

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

var modelAliases = []string{"sonnet", "opus", "haiku", "fable"}

var pinnedModelVariables = []string{
	"ANTHROPIC_MODEL",
	"ANTHROPIC_DEFAULT_OPUS_MODEL",
	"ANTHROPIC_DEFAULT_SONNET_MODEL",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"ANTHROPIC_DEFAULT_FABLE_MODEL",
	"ANTHROPIC_CUSTOM_MODEL_OPTION",
}

func buildModelList(environment map[string]string, settings Settings, discovered []string) []string {
	var ordered []string
	ordered = append(ordered, modelAliases...)
	for _, variable := range pinnedModelVariables {
		ordered = append(ordered, environment[variable])
	}
	ordered = append(ordered, settings.Model)
	ordered = append(ordered, settings.AvailableModels...)
	sortedDiscovered := append([]string(nil), discovered...)
	sort.Strings(sortedDiscovered)
	ordered = append(ordered, sortedDiscovered...)

	seen := map[string]bool{}
	var models []string
	for _, model := range ordered {
		if model != "" && !seen[model] {
			seen[model] = true
			models = append(models, model)
		}
	}
	return models
}

func discoverModels(environment map[string]string, run CommandRunner, client *http.Client, defaultBaseURL string) ([]string, string) {
	var models []string
	var failure error
	switch {
	case isEnabled(environment["CLAUDE_CODE_USE_BEDROCK"]):
		models, failure = discoverBedrock(run, environment)
	case isEnabled(environment["CLAUDE_CODE_USE_VERTEX"]), isEnabled(environment["CLAUDE_CODE_USE_FOUNDRY"]):
	case environment["ANTHROPIC_API_KEY"] != "" || environment["ANTHROPIC_AUTH_TOKEN"] != "":
		baseURL := defaultBaseURL
		if configured := environment["ANTHROPIC_BASE_URL"]; configured != "" {
			baseURL = configured
		}
		if client == nil {
			client = &http.Client{Timeout: 20 * time.Second}
		}
		models, failure = fetchAnthropicModels(client, baseURL, environment)
	}
	if failure != nil {
		return models, "Model discovery failed: " + strings.ReplaceAll(failure.Error(), "\n", "; ")
	}
	return models, ""
}
