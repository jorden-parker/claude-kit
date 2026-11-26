# agent-models

A terminal UI for choosing which model each of this repo's subagents (`plugins/*/agents/*.md`) runs on.

## Run

    claude-agent-models

Link it once with `ln -s ~/src/claude-kit/agent-models/claude-agent-models ~/.local/bin/claude-agent-models` (`claude-kit-update` does this too). It builds on first run and works from any folder. From source instead: `cd agent-models && go run .`

Flags: `-repo <path>` (default: the folder above the working directory that holds `.claude-plugin/marketplace.json`), `-file <path>` (default `~/.claude/agent-models.json`), `-list` (print agents, models and any discovery note, then exit).

Keys: enter opens an agent and then saves the highlighted model, `/` filters, esc goes back without saving, q or ctrl+c quits.

## Saved choices

A JSON object `{ "<plugin>:<agent name>": "<model>" }` in `~/.claude/agent-models.json`, written atomically with sorted keys. Choosing "Agent default" removes the key. Unknown keys in the file are kept.

## Available models

Aliases (`sonnet`, `opus`, `haiku`, `fable`), then pinned ids from the `ANTHROPIC_*MODEL*` variables and `model` / `availableModels` in `~/.claude/settings.json`, then discovered ids, sorted. The environment is the process env plus the `env` object of `~/.claude/settings.json` for keys the process lacks.

- Bedrock (`CLAUDE_CODE_USE_BEDROCK` 1/true): runs the `aws` CLI (`list-inference-profiles` for SYSTEM_DEFINED and APPLICATION, `list-foundation-models --by-provider anthropic`) and keeps Anthropic entries.
- Vertex or Foundry: no discovery.
- Otherwise, with `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`: pages through `<ANTHROPIC_BASE_URL or https://api.anthropic.com>/v1/models`.

A discovery failure is shown as a dim note and never stops the program.
