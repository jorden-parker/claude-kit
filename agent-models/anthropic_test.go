package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestFetchAnthropicModelsFollowsPagesAndSendsHeaders(t *testing.T) {
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.URL.RequestURI())
		if request.Header.Get("anthropic-version") != "2023-06-01" || request.Header.Get("x-api-key") != "key-1" || request.Header.Get("Authorization") != "" {
			t.Errorf("bad headers %v", request.Header)
		}
		if request.URL.Query().Get("after_id") == "" {
			fmt.Fprint(writer, `{"data":[{"id":"m1"},{"id":"m2"}],"has_more":true,"last_id":"m2"}`)
			return
		}
		fmt.Fprint(writer, `{"data":[{"id":"m3"}],"has_more":false}`)
	}))
	defer server.Close()

	models, err := fetchAnthropicModels(server.Client(), server.URL, map[string]string{"ANTHROPIC_API_KEY": "key-1"})
	if err != nil || !reflect.DeepEqual(models, []string{"m1", "m2", "m3"}) {
		t.Fatalf("got %v, %v", models, err)
	}
	if len(requests) != 2 || requests[0] != "/v1/models?limit=1000" || !strings.Contains(requests[1], "after_id=m2") {
		t.Fatalf("unexpected requests %v", requests)
	}
}

func TestFetchAnthropicModelsUsesBearerForAuthToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer tok" || request.Header.Get("x-api-key") != "" {
			t.Errorf("bad headers %v", request.Header)
		}
		fmt.Fprint(writer, `{"data":[],"has_more":false}`)
	}))
	defer server.Close()
	if _, err := fetchAnthropicModels(server.Client(), server.URL, map[string]string{"ANTHROPIC_AUTH_TOKEN": "tok"}); err != nil {
		t.Fatal(err)
	}
}

func TestFetchAnthropicModelsReportsHttpFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "nope", http.StatusUnauthorized)
	}))
	defer server.Close()
	_, err := fetchAnthropicModels(server.Client(), server.URL, map[string]string{"ANTHROPIC_API_KEY": "k"})
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("got %v", err)
	}
}
