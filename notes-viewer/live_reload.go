package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const liveReloadScript = `<script>new EventSource("/api/live-reload").onmessage = () => location.reload();</script>`

const pageCheckInterval = 200 * time.Millisecond

func devSourceDirectory() string {
	return os.Getenv("CLAUDE_NOTES_DEV")
}

func readDevPage(sourceDirectory string) ([]byte, error) {
	page, err := os.ReadFile(filepath.Join(sourceDirectory, "index.html"))
	if err != nil {
		return nil, err
	}
	return bytes.Replace(page, []byte("</body>"), []byte(liveReloadScript+"</body>"), 1), nil
}

func readPageModifiedTime(sourceDirectory string) time.Time {
	pageStat, err := os.Stat(filepath.Join(sourceDirectory, "index.html"))
	if err != nil {
		return time.Time{}
	}
	return pageStat.ModTime()
}

func streamPageChanges(sourceDirectory string, writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.WriteHeader(http.StatusOK)
	http.NewResponseController(writer).Flush()

	lastModifiedTime := readPageModifiedTime(sourceDirectory)
	ticker := time.NewTicker(pageCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-request.Context().Done():
			return
		case <-ticker.C:
			modifiedTime := readPageModifiedTime(sourceDirectory)
			if modifiedTime.Equal(lastModifiedTime) {
				continue
			}
			lastModifiedTime = modifiedTime
			writer.Write([]byte("data: reload\n\n"))
			http.NewResponseController(writer).Flush()
		}
	}
}
