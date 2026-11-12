package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/charmbracelet/bubbles/help"
	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/list"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type screenKind int

const (
	listScreen screenKind = iota
	sessionScreen
	confirmScreen
)

const sessionRowNoteIndex = -1

var (
	viewKey    = key.NewBinding(key.WithKeys("enter", "v"), key.WithHelp("enter", "view"))
	editKey    = key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "edit note"))
	deleteKey  = key.NewBinding(key.WithKeys("d"), key.WithHelp("d", "delete"))
	confirmKey = key.NewBinding(key.WithKeys("y", "Y"))
	backKey    = key.NewBinding(key.WithKeys("esc", "q", "backspace", "left"), key.WithHelp("esc/q", "back to list"))
	scrollKey  = key.NewBinding(key.WithKeys("up", "down"), key.WithHelp("↑/↓", "scroll"))

	titleStyle       = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	sessionRowStyle  = lipgloss.NewStyle().Bold(true)
	noteRowStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("250"))
	selectedRowStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("212")).Bold(true)
	promptStyle      = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("203"))
	statusStyle      = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

type noteRow struct {
	sessionIndex int
	noteIndex    int
	text         string
}

func (row noteRow) FilterValue() string { return row.text }

func (row noteRow) isSession() bool { return row.noteIndex == sessionRowNoteIndex }

type editorClosedMessage struct {
	notePath     string
	sessionIndex int
	noteIndex    int
	editorError  error
}

func formatStartTime(startedAt string) string {
	if len(startedAt) >= 16 {
		return startedAt[:10] + " " + startedAt[11:16]
	}
	return startedAt
}

func sessionTitle(entry session) string {
	startTime := formatStartTime(entry.StartedAt)
	if startTime == "" {
		startTime = "unknown time"
	}
	titleParts := []string{startTime}
	if entry.WorkingDirectory != "" {
		titleParts = append(titleParts, entry.WorkingDirectory)
	}
	if len(entry.Prompts) > 0 {
		titleParts = append(titleParts, displayText(entry.Prompts[0]))
	}
	return strings.Join(titleParts, "  ")
}

func buildRows(sessions []session) []noteRow {
	rows := []noteRow{}
	for sessionIndex, entry := range sessions {
		rows = append(rows, noteRow{sessionIndex, sessionRowNoteIndex, sessionTitle(entry)})
		for noteIndex, note := range entry.Notes {
			rows = append(rows, noteRow{sessionIndex, noteIndex, "    note " + displayText(note)})
		}
	}
	return rows
}

func rowItems(store *noteStore) []list.Item {
	items := []list.Item{}
	for _, row := range buildRows(store.sessions()) {
		items = append(items, row)
	}
	return items
}

func formatSession(sessionIndex int, entry session) string {
	lines := []string{fmt.Sprintf("[%d] %s UTC  %s", sessionIndex+1, formatStartTime(entry.StartedAt), entry.WorkingDirectory)}
	for _, prompt := range entry.Prompts {
		lines = append(lines, "  > "+displayText(prompt))
	}
	for noteIndex, note := range entry.Notes {
		lines = append(lines, fmt.Sprintf("  note %d %s", noteIndex+1, displayText(note)))
	}
	for _, file := range entry.Files {
		lines = append(lines, "  edited "+displayText(file))
	}
	for _, command := range entry.Commands {
		lines = append(lines, "  $ "+displayText(command))
	}
	return strings.Join(lines, "\n")
}

type rowDelegate struct{}

func (rowDelegate) Height() int                         { return 1 }
func (rowDelegate) Spacing() int                        { return 0 }
func (rowDelegate) Update(tea.Msg, *list.Model) tea.Cmd { return nil }

func (rowDelegate) Render(writer io.Writer, rows list.Model, index int, listItem list.Item) {
	row := listItem.(noteRow)
	style := noteRowStyle
	if row.isSession() {
		style = sessionRowStyle
	}
	text := "  " + row.text
	if index == rows.Index() {
		style = selectedRowStyle
		text = "> " + row.text
	}
	fmt.Fprint(writer, style.MaxWidth(rows.Width()).Render(text))
}

type browser struct {
	store       *noteStore
	rows        list.Model
	sessionView viewport.Model
	helpView    help.Model
	screen      screenKind
	viewedIndex int
	status      string
}

func newBrowser(store *noteStore) browser {
	rows := list.New(rowItems(store), rowDelegate{}, 0, 0)
	rows.Title = "Session notes"
	rows.Styles.Title = titleStyle
	rows.SetShowStatusBar(false)
	rows.KeyMap.NextPage = key.NewBinding(key.WithKeys("right", "l", "pgdown", "f"), key.WithHelp("→/l/pgdn", "next page"))
	browserKeys := func() []key.Binding { return []key.Binding{viewKey, editKey, deleteKey} }
	rows.AdditionalShortHelpKeys = browserKeys
	rows.AdditionalFullHelpKeys = browserKeys
	return browser{store: store, rows: rows, sessionView: viewport.New(0, 0), helpView: help.New()}
}

func (current browser) Init() tea.Cmd { return nil }

func (current browser) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch message := message.(type) {
	case tea.WindowSizeMsg:
		current.rows.SetSize(message.Width, message.Height-1)
		current.sessionView.Width = message.Width
		current.sessionView.Height = message.Height - 2
		return current, nil
	case editorClosedMessage:
		return current.saveEditedNote(message), nil
	case tea.KeyMsg:
		switch current.screen {
		case sessionScreen:
			if key.Matches(message, backKey) {
				current.screen = listScreen
				return current, nil
			}
			var command tea.Cmd
			current.sessionView, command = current.sessionView.Update(message)
			return current, command
		case confirmScreen:
			current.screen = listScreen
			if key.Matches(message, confirmKey) {
				current = current.deleteSelected()
			}
			if len(current.rows.Items()) == 0 {
				return current, tea.Quit
			}
			return current, nil
		}
		selected, hasSelection := current.rows.SelectedItem().(noteRow)
		if hasSelection && current.rows.FilterState() != list.Filtering {
			switch {
			case key.Matches(message, viewKey):
				return current.openSession(selected.sessionIndex), nil
			case key.Matches(message, editKey):
				if selected.isSession() {
					return current, nil
				}
				return current.openEditor(selected)
			case key.Matches(message, deleteKey):
				current.screen = confirmScreen
				return current, nil
			}
		}
	}
	var command tea.Cmd
	current.rows, command = current.rows.Update(message)
	return current, command
}

func (current browser) openSession(sessionIndex int) browser {
	current.viewedIndex = sessionIndex
	sessionText := formatSession(sessionIndex, current.store.sessions()[sessionIndex])
	current.sessionView.SetContent(lipgloss.NewStyle().Width(current.sessionView.Width).Render(sessionText))
	current.sessionView.GotoTop()
	current.screen = sessionScreen
	return current
}

func editorCommandLine() []string {
	for _, editor := range []string{os.Getenv("VISUAL"), os.Getenv("EDITOR")} {
		if words := strings.Fields(editor); len(words) > 0 {
			return words
		}
	}
	return []string{"vi"}
}

func (current browser) openEditor(row noteRow) (browser, tea.Cmd) {
	noteFile, err := os.CreateTemp("", "session-note-*.txt")
	if err != nil {
		current.status = "Could not open the editor: " + err.Error()
		return current, nil
	}
	noteFile.WriteString(displayText(current.store.sessions()[row.sessionIndex].Notes[row.noteIndex]) + "\n")
	noteFile.Close()
	commandLine := append(editorCommandLine(), noteFile.Name())
	editorProcess := exec.Command(commandLine[0], commandLine[1:]...)
	return current, tea.ExecProcess(editorProcess, func(err error) tea.Msg {
		return editorClosedMessage{noteFile.Name(), row.sessionIndex, row.noteIndex, err}
	})
}

func (current browser) saveEditedNote(message editorClosedMessage) browser {
	defer os.Remove(message.notePath)
	if message.editorError != nil {
		current.status = "The editor failed: " + message.editorError.Error()
		return current
	}
	contents, err := os.ReadFile(message.notePath)
	if err != nil {
		current.status = "Could not read the edited note: " + err.Error()
		return current
	}
	noteText := normalizeNoteText(string(contents))
	if noteText == "" {
		current.status = "The note was empty, so it was left as it was."
		return current
	}
	if err := current.store.replaceNote(message.sessionIndex, message.noteIndex, []string{noteText}); err != nil {
		current.status = "Could not save the note: " + err.Error()
		return current
	}
	current.status = "Note saved."
	return current.refreshRows()
}

func (current browser) deleteSelected() browser {
	selected := current.rows.SelectedItem().(noteRow)
	var deleteError error
	if selected.isSession() {
		deleteError = current.store.deleteSession(selected.sessionIndex)
		current.status = "Session deleted."
	} else {
		deleteError = current.store.replaceNote(selected.sessionIndex, selected.noteIndex, nil)
		current.status = "Note deleted."
	}
	if deleteError != nil {
		current.status = "Could not delete: " + deleteError.Error()
	}
	return current.refreshRows()
}

func (current browser) refreshRows() browser {
	current.rows.SetItems(rowItems(current.store))
	if rowCount := len(current.rows.Items()); current.rows.Index() >= rowCount && rowCount > 0 {
		current.rows.Select(rowCount - 1)
	}
	return current
}

func (current browser) View() string {
	if current.screen == sessionScreen {
		header := titleStyle.Render(fmt.Sprintf("Session %d", current.viewedIndex+1))
		footer := current.helpView.ShortHelpView([]key.Binding{scrollKey, backKey})
		return lipgloss.JoinVertical(lipgloss.Left, header, current.sessionView.View(), footer)
	}
	bottomLine := statusStyle.Render(current.status)
	if current.screen == confirmScreen {
		question := "Delete this session and its notes? y/N"
		if selected, hasSelection := current.rows.SelectedItem().(noteRow); hasSelection && !selected.isSession() {
			question = "Delete this note? y/N"
		}
		bottomLine = promptStyle.Render(question)
	}
	return current.rows.View() + "\n" + bottomLine
}
