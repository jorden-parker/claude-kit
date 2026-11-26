package main

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

const systemProfilesFixture = `{"inferenceProfileSummaries":[
 {"inferenceProfileId":"us.anthropic.claude-sonnet-4","inferenceProfileArn":"arn:aws:bedrock:us::inference-profile/us.anthropic.claude-sonnet-4","models":[{"modelArn":"arn:aws:bedrock:us::foundation-model/anthropic.claude-sonnet-4"}]},
 {"inferenceProfileId":"us.meta.llama","inferenceProfileArn":"arn:aws:bedrock:us::inference-profile/us.meta.llama","models":[{"modelArn":"arn:aws:bedrock:us::foundation-model/meta.llama"}]}
]}`

const applicationProfilesFixture = `{"inferenceProfileSummaries":[
 {"inferenceProfileId":"abc123","inferenceProfileArn":"arn:aws:bedrock:us:1:application-inference-profile/abc123","models":[{"modelArn":"arn:aws:bedrock:us::foundation-model/anthropic.claude-haiku"}]},
 {"inferenceProfileId":"def456","inferenceProfileArn":"arn:aws:bedrock:us:1:application-inference-profile/def456","models":[{"modelArn":"arn:aws:bedrock:us::foundation-model/amazon.nova"}]}
]}`

const foundationFixture = `{"modelSummaries":[{"modelId":"anthropic.claude-3-haiku"},{"modelId":"anthropic.claude-opus"}]}`

func TestParseInferenceProfiles(t *testing.T) {
	system, err := parseInferenceProfiles([]byte(systemProfilesFixture), "inferenceProfileId")
	if err != nil || !reflect.DeepEqual(system, []string{"us.anthropic.claude-sonnet-4"}) {
		t.Fatalf("system: got %v, %v", system, err)
	}
	application, err := parseInferenceProfiles([]byte(applicationProfilesFixture), "inferenceProfileArn")
	expected := []string{"arn:aws:bedrock:us:1:application-inference-profile/abc123"}
	if err != nil || !reflect.DeepEqual(application, expected) {
		t.Fatalf("application: got %v, %v", application, err)
	}
}

func TestParseFoundationModels(t *testing.T) {
	models, err := parseFoundationModels([]byte(foundationFixture))
	if err != nil || !reflect.DeepEqual(models, []string{"anthropic.claude-3-haiku", "anthropic.claude-opus"}) {
		t.Fatalf("got %v, %v", models, err)
	}
	if _, err := parseFoundationModels([]byte("not json")); err == nil {
		t.Fatal("expected a parse error")
	}
}

func TestDiscoverBedrockRunsThreeCommandsAndKeepsPartialResults(t *testing.T) {
	var commands []string
	run := func(environment map[string]string, arguments ...string) ([]byte, error) {
		commands = append(commands, strings.Join(arguments, " "))
		switch arguments[2] {
		case "--type-equals":
			if arguments[3] == "SYSTEM_DEFINED" {
				return []byte(systemProfilesFixture), nil
			}
			return nil, errors.New("access denied")
		}
		return []byte(foundationFixture), nil
	}
	models, err := discoverBedrock(run, map[string]string{})
	if len(commands) != 3 {
		t.Fatalf("expected 3 commands, got %v", commands)
	}
	if !strings.Contains(commands[0], "list-inference-profiles --type-equals SYSTEM_DEFINED --output json") {
		t.Fatalf("unexpected first command %q", commands[0])
	}
	if len(models) != 3 || err == nil || !strings.Contains(err.Error(), "access denied") {
		t.Fatalf("got %v, %v", models, err)
	}
}
