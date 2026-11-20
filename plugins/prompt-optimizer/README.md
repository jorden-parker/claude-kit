# prompt-optimizer

`/optimize <draft>` rewrites a draft prompt to be clearer and more specific, then puts the rewrite in the composer so you can edit it or press Enter.

## Usage

`/optimize fix the bug` rewrites the given draft.

`/optimize` with nothing after it rewrites the text you last selected with the mouse in the transcript. With no selection either, it prints the usage line.

The rewrite is grounded in the current working directory and the last few messages of the conversation, so references like "the bug" or "that file" resolve to what they name. Nothing the draft or the conversation does not imply is added.

The rewrite model cannot open files or view images, and it is told so: the rewritten prompt is written for the agent that can. It keeps `[Image #N]` tokens verbatim, never mentions what it could not see, and does not restate the working directory. If the model still opens with such an aside, the leading paragraphs that contain one are dropped before the prompt is filled.

When the composer cannot take the text (a headless run, or a dialog holding the keys), the rewrite is copied to the clipboard and printed instead. The rewrite is also handed to the model as hidden context, so a follow-up like "do it" refers to the optimized prompt.

Images pasted into the composer alongside `/optimize` are noted for the model: a hidden line names each attached image and says it belongs with the optimized prompt, so a follow-up like "do it" treats them as part of it. The same list is given to the rewrite model, so it knows the images exist and that the agent will see them. The rewrite itself is text-only, and the composer cannot take images back, so the rewritten prompt does not re-attach them.

By default the rewrite runs on a local model through Ollama at `http://127.0.0.1:11434`. It uses whichever model Ollama has loaded, so it shares that model and Ollama does not swap it. With nothing loaded, it loads its own model, `qwen3:4b-instruct-2507-q4_K_M` (install it once with `ollama pull qwen3:4b-instruct-2507-q4_K_M`). Thinking is off.

While it works, a one-row band above the prompt shows a spinner, the elapsed seconds and a sweeping bar (the bar is dropped on narrow terminals; VS Code, which has no band, keeps the toast).

While it works, a status line under the prompt shows the step: checking Ollama, loading or waiting for the model, then writing with a token count. The rewrite streams through `curl`, so a cold model load can take up to 3 minutes; the host's 30-second limit on plugin fetches does not apply. If Ollama does not answer the status check within 3 seconds, or the rewrite passes 3 minutes, the error line names the model and the limit; nothing falls back to a cloud model. Each step, with its timing, goes to the debug log (`claude --debug`), led by `/optimize`.

With a cloud model chosen, a rate limit (429), overload (529) or server error is retried on the same model after 1, 2 and 4 seconds, the way the main conversation backs off. If the rewrite model still answers with an API error (a cloud session that cannot use it, for one), the rewrite is tried once more on the session's own model. The error line names the HTTP status and error kind when both fail.

Behind an API proxy (`ANTHROPIC_BASE_URL` is set), a cloud model's rewrite is written by a subagent on that model instead (the plugin's own `prompt-optimizer:rewriter` agent, Haiku by default; the model option overrides it), with no setting to change: some proxies refuse the background request while subagents and normal turns get through. `/optimize` answers `A subagent is rewriting the prompt…` and the status line under the prompt says so until the subagent ends. Its rewrite is then filled into the composer, replacing what is there, and a row in the transcript reports the result; when the composer cannot take it, the rewrite is copied to the clipboard and the row holds the rewrite itself. The subagent's report is dropped before it reaches the conversation, so the main model takes no turn. On this route nothing is retried, and the rewrite is not handed to the model as hidden context. A headless run on this route prints only that the subagent started: the rewrite reaches an SDK host as a `ui_log` message, and the exit code is 1 only when the subagent cannot start.

In a headless run (`claude -p "/optimize fix the bug"`) the process exits with code 1 when the rewrite fails or there is nothing to rewrite, so a script can tell.

## Settings

Both rows appear in `/config` under the plugin, and a change reloads the plugin at once.

| Row                | Default | What it does                                                                                                                                                                                                                                         |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rewrite model      | `local` | Which model rewrites the draft: `local`, `haiku`, `sonnet` or `opus`. `local` runs on Ollama's loaded model; the others use the Claude API (through a subagent when an API proxy is set), where `sonnet` stays on the draft and `haiku` drifts more. |
| Extra instructions | empty   | Appended to the rewrite rules, for a house style every rewritten prompt should follow.                                                                                                                                                               |

## Install

Installs at user scope, so it works in every directory. On any machine:

```
claude plugin marketplace add jorden-parker/claude-kit
claude plugin install prompt-optimizer@claude-kit --scope user
```

On the dev machine, add the local checkout instead:

```
claude plugin marketplace add ~/src/claude-kit
claude plugin install prompt-optimizer@claude-kit --scope user
```

The marketplace is defined in `.claude-plugin/marketplace.json` at the repo root.

## Edits

The plugin is read from this folder. After a change, run `/reload-plugins`. No reinstall is needed.

## Don't

Don't load this mod with `CLAUDE_CODE_PLUGIN_DIRS` or `--plugin-dir`. It then loads twice: once as `@inline` and once as `@claude-kit`.

## Uninstall

```
claude plugin uninstall prompt-optimizer@claude-kit
```

## Dev

```
pnpm test
pnpm typecheck
```
