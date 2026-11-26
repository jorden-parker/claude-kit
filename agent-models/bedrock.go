package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
)

type CommandRunner func(environment map[string]string, arguments ...string) ([]byte, error)

func runAws(environment map[string]string, arguments ...string) ([]byte, error) {
	command := exec.Command("aws", arguments...)
	command.Env = os.Environ()
	for key, value := range environment {
		command.Env = append(command.Env, key+"="+value)
	}
	output, err := command.Output()
	if err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) && len(exitError.Stderr) > 0 {
			return nil, errors.New(strings.TrimSpace(string(exitError.Stderr)))
		}
	}
	return output, err
}

func parseInferenceProfiles(data []byte, identifierField string) ([]string, error) {
	var parsed struct {
		Summaries []map[string]any `json:"inferenceProfileSummaries"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	var identifiers []string
	for _, summary := range parsed.Summaries {
		identifier, _ := summary[identifierField].(string)
		if identifier == "" {
			continue
		}
		mentionsAnthropic := strings.Contains(identifier, "anthropic")
		models, _ := summary["models"].([]any)
		for _, model := range models {
			entry, _ := model.(map[string]any)
			arn, _ := entry["modelArn"].(string)
			mentionsAnthropic = mentionsAnthropic || strings.Contains(arn, "anthropic")
		}
		if mentionsAnthropic {
			identifiers = append(identifiers, identifier)
		}
	}
	return identifiers, nil
}

func parseFoundationModels(data []byte) ([]string, error) {
	var parsed struct {
		Summaries []struct {
			ModelId string `json:"modelId"`
		} `json:"modelSummaries"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	var identifiers []string
	for _, summary := range parsed.Summaries {
		identifiers = append(identifiers, summary.ModelId)
	}
	return identifiers, nil
}

func discoverBedrock(run CommandRunner, environment map[string]string) ([]string, error) {
	var models []string
	var failures []error
	collect := func(parse func([]byte) ([]string, error), arguments ...string) {
		output, err := run(environment, arguments...)
		if err == nil {
			var found []string
			if found, err = parse(output); err == nil {
				models = append(models, found...)
			}
		}
		if err != nil {
			failures = append(failures, errors.New("aws "+arguments[1]+": "+err.Error()))
		}
	}
	profiles := func(field string) func([]byte) ([]string, error) {
		return func(data []byte) ([]string, error) { return parseInferenceProfiles(data, field) }
	}
	collect(profiles("inferenceProfileId"), "bedrock", "list-inference-profiles", "--type-equals", "SYSTEM_DEFINED", "--output", "json")
	collect(profiles("inferenceProfileArn"), "bedrock", "list-inference-profiles", "--type-equals", "APPLICATION", "--output", "json")
	collect(parseFoundationModels, "bedrock", "list-foundation-models", "--by-provider", "anthropic", "--output", "json")
	return models, errors.Join(failures...)
}
