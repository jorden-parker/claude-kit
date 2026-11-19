---
description: "Hand the work off to a fresh session: save a recap, list this project's handoffs, resume one, or open them all in the browser"
---

This command runs through the `mcp__handoff__run_handoff` tool. The user's arguments are inside the <arguments> tags.

<arguments>
{{args}}
</arguments>

The first word of the arguments picks the case. Call the tool once.

**Case 1: the first word is `list`, `open` or `resume`** (`resume [id] [extra context]`). Call `mcp__handoff__run_handoff` with `args` set to the arguments exactly as written. Do not set `modelReply`. Show the tool's reply to the user, word for word.

**Case 2: anything else** (no arguments, a focus, or a first word of `save`, `new` or `each`).

1. Write the reply yourself from this conversation first. Do not run other tools for it.
   - Unless the first word is `each`, write one prompt that a fresh coding-agent session could receive to continue the work in this conversation. The working directory and the conversation are the only sources: invent nothing they do not contain. Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions. If the focus (the arguments without a first word of `save` or `new`) is not empty, center the prompt on it and keep the rest brief. Output only the prompt, with no preamble, quotes or explanation.
   - When the first word is `each`, write one prompt per separate plan, idea or task the conversation suggests, usually listed in the latest assistant message. The working directory and the conversation are the only sources: invent nothing they do not contain. Each prompt must stand alone: start with a one-line title naming the plan, then give its goal, the rationale and files the conversation gives for it, and what "done" means. If the focus (the arguments after `each`) is not empty, only cover the plans it names. Separate the prompts with a line containing only `---handoff---`. Output only the prompts and separators, with no preamble, numbering, quotes or explanation.
2. Call `mcp__handoff__run_handoff` with:
   - `args`: the arguments exactly as written, except that a first word of `new` is replaced by `save`.
   - `modelReply`: the text you wrote in step 1.
3. Show the tool's reply to the user, word for word.
   - If the first word was `new`, add one line after it: this session cannot be cleared from a tool, so start a new session yourself and run `/handoff resume` there to continue the handoff just saved.
