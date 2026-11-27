---
name: small-plans-menu
description: Split work into small plans a small model can build, then build a set or one plan with small-model agents
argument-hint: "[work to plan] | handoff [id] [extra context] | build [set] [plan order] | rename [set] [new name] | review [set] [plan order] | board"
disable-model-invocation: true
---

Arguments: $ARGUMENTS

Load `${CLAUDE_PLUGIN_ROOT}/skills/small-plans-menu/instructions.md` and follow it with the arguments above. It contains the command instructions and tool names.
