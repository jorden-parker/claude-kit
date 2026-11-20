package main

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeDevPage(t *testing.T, text string) string {
	t.Helper()
	sourceDirectory := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDirectory, "index.html"), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_NOTES_DEV", sourceDirectory)
	return sourceDirectory
}

func TestPageIsTheEmbeddedOneWithoutLiveReloadOutsideDevMode(t *testing.T) {
	t.Setenv("CLAUDE_NOTES_DEV", "")

	page := requestPage("localhost:4000", "/")
	if page.Body.String() != string(indexPage) {
		t.Fatal("page was not the embedded index.html")
	}
	if response := requestPage("localhost:4000", "/api/live-reload"); response.Code != http.StatusNotFound {
		t.Fatalf("live reload status was %d", response.Code)
	}
}

func TestDevModeServesThePageFromDiskWithTheLiveReloadScript(t *testing.T) {
	sourceDirectory := writeDevPage(t, "<html><body>first</body></html>")
	if err := os.WriteFile(filepath.Join(sourceDirectory, "index.html"), []byte("<html><body>edited</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	body := requestPage("localhost:4000", "/").Body.String()
	if !strings.Contains(body, "edited") || !strings.Contains(body, `new EventSource("/api/live-reload")`) {
		t.Fatalf("page was %s", body)
	}
	if strings.Index(body, "EventSource") > strings.Index(body, "</body>") {
		t.Fatalf("live reload script is not inside the body: %s", body)
	}
}

func TestLiveReloadStreamSendsReloadWhenThePageChanges(t *testing.T) {
	sourceDirectory := writeDevPage(t, "<html><body>first</body></html>")
	server := httptest.NewServer(newViewerServer())
	defer server.Close()

	response, err := http.Get(server.URL + "/api/live-reload")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("content type was %q", contentType)
	}

	later := time.Now().Add(2 * time.Second)
	if err := os.WriteFile(filepath.Join(sourceDirectory, "index.html"), []byte("<html><body>second</body></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(sourceDirectory, "index.html"), later, later); err != nil {
		t.Fatal(err)
	}

	receivedLine := make(chan string)
	go func() {
		scanner := bufio.NewScanner(response.Body)
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "data:") {
				receivedLine <- scanner.Text()
				return
			}
		}
	}()
	select {
	case line := <-receivedLine:
		if line != "data: reload" {
			t.Fatalf("event was %q", line)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no reload event after the page changed")
	}
}
