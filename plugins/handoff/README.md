# handoff

`/handoff [focus]` summarizes the current session into a prompt a fresh session can pick up (goal, what is done, what is left, files and commands mentioned, open questions), then fills it into the composer so you can edit it or press Enter. Every handoff is also saved as a Markdown file, filed by project, so it can be picked up later.

## Usage

The first word picks the action. Anything else is the focus, which centers the recap on one topic. There are no flags.

| Command                                | What it does                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `/handoff [focus]`                     | Recap the session into the composer                                                |
| `/handoff new [focus]`                 | Recap, then continue in a fresh session                                            |
| `/handoff save [focus]`                | Only save the recap                                                                |
| `/handoff each [focus]`                | Save one handoff per plan suggested in the conversation                            |
| `/handoff list`                        | Show this project's handoffs, newest first                                         |
| `/handoff resume [id] [extra context]` | Put a saved handoff into the composer of a fresh session: the latest, or one by id |
| `/handoff open`                        | Browse every handoff in the browser                                                |

Typing `/handoff ` suggests the actions.

- `/handoff the failing test` centers the recap on the failing test
- `/handoff new` builds the recap, runs `/clear`, then submits the recap as the first prompt of the fresh session. The recap is parked until it is submitted; if the process ends before that, the next session finds it and fills it into the composer instead. If the session cannot be cleared, the recap is filled into the composer as `/handoff` would
- `/handoff save the auth change` leaves the composer alone and prints the handoff's id and file path
- `/handoff each` is for after Claude proposes several options, such as a ranked list of ideas: each becomes its own handoff, and `/handoff resume <id>` starts a fresh session on any one of them. The latest assistant message is sent whole so long lists are not cut off
- `/handoff resume 3` runs `/clear`, then fills recap #3 into the composer of the fresh session. Nothing is sent until you press Enter, so you can read and edit it first. Words after the id are extra context: `/handoff resume 3 start with the failing test` fills recap #3 followed by `Extra context from the user: start with the failing test`. Without an id the words go to the latest handoff. The saved file is not changed. If the composer cannot be filled, the recap is copied to the clipboard and shown instead
- `/handoff list` shows the ten newest: id, time (UTC) and the recap's first line

The old dashed forms (`--new`, `--save`, `--each`, `--list`, `--resume`) still work as the first word.

## Boxes

`/handoff new`, `/handoff save` and `/handoff resume` with nothing after them open a small box above the prompt instead of running at once. The box takes the keyboard, so you can type straight away.

- **Notes box** (`new`, `save`): a three-line field for notes to the next session. Enter hands off; an empty field means no notes. The notes are guidance for whoever writes the recap, not text to include: a direction to take, or extra requests. The writer works out what they mean and writes that into the recap in its own words, so the notes do not appear word for word in the prompt or in the saved file. The recap is only written after you press Enter
- **Resume box** (`resume`): the same notes field, then a list of this project's ten newest handoffs. Enter in the field resumes the latest. Tab to the list, pick another with the arrows, and Enter resumes that one. The recap is already written, so here the notes are added under it as `Extra context from the user: …`, in the composer where you can edit them
- Each box has a button for the same action and a Cancel button. Esc closes the box. Either way nothing is written and the session is left alone
- Typing anything after the action skips the box: `/handoff new the auth change`, `/handoff save the parser`, `/handoff resume 3`, `/handoff resume start with the tests`
- Where a box cannot be drawn (a headless run, Qwen Code, pi, OpenCode), the command runs at once: `new` and `save` without notes, `resume` on the latest handoff

## Open questions

A recap can end with decisions only you can make. Before a handoff is saved, filled or handed off, `/handoff` asks them one at a time in Claude Code's own question dialog. With `/handoff save` or `/handoff new` this comes after the notes box, once the recap is written.

- Each question offers the likely answers the recap writer listed, or Yes and No, plus `Leave open`. Other takes any text
- An answer is written into the handoff under `Decisions from the user:`, so the next session starts with the decision made
- `Leave open` keeps that question under `Open questions for the user:`
- Esc stops the asking. The questions not yet answered stay open, and the handoff is still saved
- `/handoff each` asks nothing

## Where handoffs live

Each handoff is one file:

```
~/.claude/handoffs/<project>/<id>-<title>.md
```

- The project is the repository the session is in, not the folder. A linked worktree, or a worktree of a bare repository (`thing.git`, `thing/.bare`), files its handoffs with the repository it belongs to, so every worktree of one repository shares one list. This needs git 2.31 or newer; outside git, or with an older git, the project is the working directory's own name
- Ids count up per project, and `list` and `resume` look at the current project only
- The file starts with front matter (`title`, `project`, `created`, `cwd`, `focus`), then the recap. The title is the recap's first line, which the recap writer keeps to a short name of the work, and the file name is made from it. Edit or delete the files freely
- Set `HANDOFFS_DIR` to keep them somewhere else
- Handoffs that earlier versions kept in the plugin store are written out as files the first time `/handoff` runs. The `.claude/handoffs/` files that `--save` used to write inside a project are no longer written; the ones already there are left alone

## Viewer

`/handoff open` opens every handoff in your browser. It starts a small local web server (a Go program, built on first run, so it needs Go once: `brew install go`) and opens the page.

- The sidebar lists every handoff, grouped by project, newest first
- The handoff shows rendered Markdown, with the command that resumes it. Raw HTML in a handoff is not rendered
- The page reloads the handoffs when you come back to its tab
- The same page serves all four kinds of saved notes: Handoffs, Project notes, Small plans and Brainstorm plans. Pick one at the top of the sidebar. `/handoff open` opens it on Handoffs
- The server only reads the notes. It listens on `127.0.0.1`, port `47618`; set `CLAUDE_NOTES_PORT` to pick another, or `CLAUDE_NOTES_NO_OPEN=1` to skip opening the browser
- The handoff, project-notes and small-plans plugins each ship the same viewer, so any one of them is enough to run it
- It keeps running after the session ends. Running `/handoff open` again reopens the same page

From a terminal: `bash ~/src/claude-kit/plugins/handoff/bin/handoffs` runs it in the foreground; `Ctrl+C` stops it.

## How the recap is written

The recap uses the last 40 messages of the conversation. Nothing beyond the conversation is added. With no messages it says "Nothing to recap yet."

When the composer cannot take the text (a headless run, or a dialog holding the keys), the recap is copied to the clipboard and printed instead. The recap is also handed to the model as hidden context, so a follow-up like "continue from that" refers to the recap.

The recap is written by a subagent on Haiku, which gets the last 40 messages. A subagent runs as part of the session, so it also works behind an API proxy that refuses background requests while subagents and normal turns get through.

With Recap writer set to `haiku`, Haiku is asked in the background first, which skips the subagent's start-up where the API allows it. A rate-limited, overloaded or failing API is retried after 1, 2 and 4 seconds. If Haiku still returns an API error, `/handoff` says so (`Haiku could not write the recap (API error 429, rate_limit). A subagent is writing the recap…`) and starts the subagent with the same last 40 messages.

Nothing is saved until the subagent ends, so wait for it before closing the session: the status line under the prompt says `A subagent is writing the recap…` until then. When the subagent ends, its answer is saved, filled or handed off as the command asked; a toast reports the result, and the status line keeps it (`Saved as handoff #3. …`) until the next prompt. The subagent's report is dropped before it reaches the conversation (`Prompt dropped by a hook: The handoff subagent finished; its result is in the status line.`), so the session's own model takes no turn and the recap stays out of the transcript.

If the subagent cannot start, or ends with no answer, the conversation writes the recap instead: `/handoff` submits the recap rules as a normal turn, the session's own model answers, and the result is printed beneath that answer.

A host that cannot start subagents at all (Qwen Code, pi, OpenCode) gets the recap from the model call instead. There the model call returns the reply the calling model wrote and passed to the command.

## Settings

The row appears in `/config` under the plugin.

| Row          | Default    | What it does                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recap writer | `subagent` | Who writes the recap: `subagent`, `haiku` or `conversation`. `subagent` starts a Haiku subagent at once. `haiku` asks Haiku in the background first and starts the subagent when the API refuses; it is quicker where background requests are allowed. `conversation` has the session's own model write the recap as a normal turn, which leaves it in the transcript. |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install handoff@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install handoff@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall handoff@claude-kit
```

## Dev

```
pnpm test        # claude plugin test . and go test in web/
pnpm typecheck
```
