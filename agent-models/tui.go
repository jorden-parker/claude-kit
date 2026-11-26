package main

import (
	"strings"

	"charm.land/bubbles/v2/list"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

type listEntry struct {
	title       string
	description string
	value       string
}

func (entry listEntry) FilterValue() string { return entry.title }
func (entry listEntry) Title() string       { return entry.title }
func (entry listEntry) Description() string { return entry.description }

type app struct {
	agents       []Agent
	models       []string
	note         string
	path         string
	choices      map[string]string
	agentList    list.Model
	modelList    list.Model
	isChoosing   bool
	chosenAgent  Agent
	errorMessage string
	width        int
	height       int
}

var (
	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	noteStyle  = lipgloss.NewStyle().Faint(true)
)

func newApp(agents []Agent, models []string, note, path string, choices map[string]string) app {
	instance := app{agents: agents, models: models, note: note, path: path, choices: choices, width: 80, height: 24}
	instance.agentList = instance.buildList(instance.agentEntries())
	return instance
}

func (instance app) buildList(entries []list.Item) list.Model {
	built := list.New(entries, list.NewDefaultDelegate(), instance.width, instance.listHeight())
	built.SetShowTitle(false)
	built.SetShowHelp(true)
	return built
}

func (instance app) listHeight() int {
	reserved := 2
	if instance.note != "" {
		reserved++
	}
	if instance.errorMessage != "" {
		reserved++
	}
	return max(instance.height-reserved, 3)
}

func (instance app) agentEntries() []list.Item {
	entries := make([]list.Item, 0, len(instance.agents))
	for _, agent := range instance.agents {
		description := agent.DefaultModel + " (agent default)"
		if saved, isSaved := instance.choices[agent.Type]; isSaved {
			description = saved + " (saved)"
		}
		entries = append(entries, listEntry{title: agent.Type, description: description})
	}
	return entries
}

func (instance app) modelEntries(agent Agent) []list.Item {
	entries := []list.Item{listEntry{title: "Agent default (" + agent.DefaultModel + ")", value: ""}}
	for _, model := range instance.models {
		entries = append(entries, listEntry{title: model, value: model})
	}
	return entries
}

func (instance app) Init() tea.Cmd { return nil }

func (instance app) activeList() *list.Model {
	if instance.isChoosing {
		return &instance.modelList
	}
	return &instance.agentList
}

func (instance app) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	if size, isSize := message.(tea.WindowSizeMsg); isSize {
		instance.width, instance.height = size.Width, size.Height
		instance.agentList.SetSize(instance.width, instance.listHeight())
		if instance.isChoosing {
			instance.modelList.SetSize(instance.width, instance.listHeight())
		}
		return instance, nil
	}
	if press, isPress := message.(tea.KeyPressMsg); isPress {
		active := instance.activeList()
		isTyping := active.SettingFilter()
		switch {
		case press.String() == "ctrl+c", press.String() == "q" && !isTyping:
			return instance, tea.Quit
		case press.String() == "esc" && instance.isChoosing && active.FilterState() == list.Unfiltered:
			instance.isChoosing = false
			return instance, nil
		case press.String() == "enter" && !isTyping:
			return instance.handleEnter()
		}
	}
	var command tea.Cmd
	if instance.isChoosing {
		instance.modelList, command = instance.modelList.Update(message)
	} else {
		instance.agentList, command = instance.agentList.Update(message)
	}
	return instance, command
}

func (instance app) handleEnter() (tea.Model, tea.Cmd) {
	if !instance.isChoosing {
		index := instance.agentList.GlobalIndex()
		if index < 0 || index >= len(instance.agents) {
			return instance, nil
		}
		instance.chosenAgent = instance.agents[index]
		instance.modelList = instance.buildList(instance.modelEntries(instance.chosenAgent))
		instance.isChoosing = true
		return instance, nil
	}
	entry, isEntry := instance.modelList.SelectedItem().(listEntry)
	if !isEntry {
		return instance, nil
	}
	if err := saveChoice(instance.path, instance.chosenAgent.Type, entry.value); err != nil {
		instance.errorMessage = "Could not save: " + err.Error()
		return instance, nil
	}
	instance.errorMessage = ""
	if entry.value == "" {
		delete(instance.choices, instance.chosenAgent.Type)
	} else {
		instance.choices[instance.chosenAgent.Type] = entry.value
	}
	instance.isChoosing = false
	instance.agentList.SetItems(instance.agentEntries())
	return instance, nil
}

func (instance app) View() tea.View {
	heading := "Agent models"
	body := instance.agentList.View()
	if instance.isChoosing {
		heading = "Model for " + instance.chosenAgent.Type
		body = instance.modelList.View()
	}
	lines := []string{titleStyle.Render(heading), body}
	if instance.errorMessage != "" {
		lines = append(lines, instance.errorMessage)
	}
	if instance.note != "" {
		lines = append(lines, noteStyle.Render(instance.note))
	}
	view := tea.NewView(strings.Join(lines, "\n"))
	view.AltScreen = true
	return view
}
