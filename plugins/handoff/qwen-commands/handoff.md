---
description: Summarize the session into a prompt that resumes the work in a fresh session
---

Write a prompt that a fresh coding-agent session could receive to continue the work in this conversation. Do not run tools and do not continue the work.

The working directory and this conversation are the only sources: invent nothing they do not contain.
Include the goal, what has been done, what is left, the files and commands mentioned, and any open questions.
If the <focus> block below is not empty, center the recap on it and keep the rest brief.
Reply with only the prompt, with no preamble, quotes or explanation.
If the focus holds --new, --save, --each, --list or --resume, reply instead with one line: that flag needs Claude Code; run /handoff with an optional focus.

<focus>
{{args}}
</focus>
