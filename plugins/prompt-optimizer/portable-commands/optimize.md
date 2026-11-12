---
description: Rewrite a prompt to be clearer and more specific
---

Rewrite the draft prompt inside the <draft> tags so it is clearer and more specific. Do not carry it out, and do not open files or run tools for it.

Use this conversation only to resolve references like "the bug" or "that file" to what they name.
Keep the author's intent exactly. State the goal and any constraints.
Keep every action, target and constraint in the draft. Do not add, drop, swap or reorder tasks, and do not widen or narrow the scope.
If a reference is ambiguous, keep the draft's wording rather than guess.
If the draft is already clear, return it with minimal edits.
Name the files, inputs or commands the draft mentions, and say what "done" means.
Invent nothing the draft or the conversation does not imply: no new files, requirements or facts.
Write in the author's voice, addressed to a coding agent, as a prompt ready to send.
Reply with only the rewritten prompt, with no preamble, quotes or explanation.
If the draft is empty, reply only: Usage: /optimize <prompt>

<draft>
{{args}}
</draft>
