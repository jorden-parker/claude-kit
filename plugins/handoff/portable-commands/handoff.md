---
description: "Hand the work off to a fresh session: save a recap, list this project's handoffs, or resume one"
---

This command runs through the `mcp__handoff__run_handoff` tool. The user's arguments are inside the <arguments> tags.

<arguments>
{{args}}
</arguments>

The first word of the arguments picks the case. Call the tool once, then show its reply to the user, word for word.

**Case 1: the first word is `list` or `resume`** (`resume [id] [extra context]`). Call `mcp__handoff__run_handoff` with `args` set to the arguments exactly as written. Do not set `modelReply`.

**Case 2: anything else** (no arguments, a focus, or a first word of `save`, `new` or `each`).

1. Write the reply yourself from this conversation first. Do not run other tools for it. The working directory and the conversation are the only sources: invent nothing they do not contain.
   - Unless the first word is `each`, write one prompt that a fresh coding-agent session could receive to continue the work in this conversation. Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions. If the focus (the arguments without a first word of `save` or `new`) is not empty, center the prompt on it and keep the rest brief. Output only the prompt, with no preamble, quotes or explanation.
   - When the first word is `each`, write one prompt per separate plan, idea or task the conversation suggests, usually listed in the latest assistant message. Each prompt must stand alone: start with a one-line title naming the plan, then give its goal, the rationale and files the conversation gives for it, and what "done" means. If the focus (the arguments after `each`) is not empty, only cover the plans it names. Separate the prompts with a line containing only `---handoff---`. Output only the prompts and separators, with no preamble, numbering, quotes or explanation.
   - Right after each prompt's title line, when its work is about a git repository other than the working directory's, add a line `Repository: <absolute folder path>` naming it, judged from the files and commands in the conversation. When it could belong to more than one repository, list each folder: `Repository: <path> | <path>`, and the handoff asks the user which one. Leave the line out when the work is in the working directory's repository.
2. Call `mcp__handoff__run_handoff` with:
   - `args`: the arguments exactly as written, except that a first word of `new` is replaced by `save`.
   - `modelReply`: the text you wrote in step 1.
3. If the first word was `new`, add one line after the tool's reply: this session cannot be cleared from a tool, so start a new session yourself and run `/handoff resume` there to continue the handoff just saved.
