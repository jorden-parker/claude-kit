package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

func fetchAnthropicModels(client *http.Client, baseURL string, environment map[string]string) ([]string, error) {
	var models []string
	afterIdentifier := ""
	for {
		address := strings.TrimRight(baseURL, "/") + "/v1/models?limit=1000"
		if afterIdentifier != "" {
			address += "&after_id=" + url.QueryEscape(afterIdentifier)
		}
		request, err := http.NewRequest(http.MethodGet, address, nil)
		if err != nil {
			return models, err
		}
		request.Header.Set("anthropic-version", "2023-06-01")
		if apiKey := environment["ANTHROPIC_API_KEY"]; apiKey != "" {
			request.Header.Set("x-api-key", apiKey)
		} else {
			request.Header.Set("Authorization", "Bearer "+environment["ANTHROPIC_AUTH_TOKEN"])
		}
		response, err := client.Do(request)
		if err != nil {
			return models, err
		}
		var page struct {
			Data []struct {
				Id string `json:"id"`
			} `json:"data"`
			HasMore bool   `json:"has_more"`
			LastId  string `json:"last_id"`
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return models, fmt.Errorf("models request failed: HTTP %d", response.StatusCode)
		}
		err = json.NewDecoder(response.Body).Decode(&page)
		response.Body.Close()
		if err != nil {
			return models, err
		}
		for _, entry := range page.Data {
			models = append(models, entry.Id)
		}
		if !page.HasMore || len(page.Data) == 0 {
			return models, nil
		}
		afterIdentifier = page.Data[len(page.Data)-1].Id
	}
}
