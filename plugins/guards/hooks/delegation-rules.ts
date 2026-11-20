import type { HookEvent, HookResult } from "./types.ts";

const DELEGATION_RULES = `# Delegation: keep the main context for decisions

Subagent replies cost the main context a few hundred characters; the reads behind them do not. Delegate by default, not only in /small-plans or /brainstorm build.

Delegate:
- Lookups needing more than one search or file read (repo sweeps, tracing callers, "where is X handled", summarizing logs or diffs): \`guards:context-scout\`.
- Mechanical, fully specified edits across several files (renames, the same change in many places, applying a written list of fixes): an Agent call with \`model: "haiku"\`, or \`model: "sonnet"\` when it needs judgement. Give exact files, the change, and the check to run.
- Independent pieces of work: several Agent calls in one message so they run in parallel.

Do it inline:
- One Read of a file you can already name, one Grep, or a one-file edit.
- Design choices, debugging hypotheses, and reviewing a subagent's result: the main model owns these.

Every Agent call that runs on the session model (\`general-purpose\`, \`claude\`, no \`subagent_type\`) must name a \`model\`. A delegate's prompt carries the goal, the start paths and what is already ruled out; it replies with the conclusion and path:line references, never file dumps.`;

export function decide(_event: HookEvent): HookResult {
  if (process.env.GUARDS_DELEGATE_GUARD === "0") return null;
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: DELEGATION_RULES,
      },
    },
  };
}
