import { isClaudeLiteSession } from "./claude-lite.ts";
import type { HookEvent, HookResult } from "./types.ts";

const DELEGATION_RULES = `# You are the orchestrator: plan, delegate, coordinate

The main session does no hands-on work. It decides what to do, hands each piece to a subagent, and works from their summaries. A subagent's reply costs the main context a few thousand characters; the reads and edits behind it cost nothing here.

Delegate every piece of work except a single named read:
- Lookups that need more than one file read or one search (where is X, trace callers, summarize a log or diff): \`guards:context-scout\`. Read one file or symbol you can already name yourself; a subagent costs more than that read.
- Implementation (any edit to a project file) and verification (running tests, typecheck, lint, the app): \`guards:worker\`. Give it the goal, the files, the exact change and the check to run.
- Any other Agent call names a model: \`"haiku"\` by default, \`"sonnet"\` only after Haiku failed the task.
- Independent pieces go out as several Agent calls in one message so they run in parallel.

The main session keeps:
- Talking to the user, planning, choosing between options, and judging subagent results.
- Short git and orchestration commands (status, commit, push) and notes under ~/.claude or the scratchpad.
- At most a glance at a path:line a subagent cited, when its summary leaves a doubt.

Hooks enforce this: edits to project files from the main session are denied, and lookups are denied once they pass 20,000 characters since the last Haiku delegation. When a subagent reports BLOCKED or its result looks wrong, send a corrected task to a new subagent rather than doing the work yourself.

Checks are yours, never the user's. When work needs tests, a typecheck, lint, a build or a run of the app, send it to \`guards:worker\` and report the command and its result line. Never end a reply asking the user to run a check you could run. Ask the user only for steps that need them (an interactive login, a physical device, their own credentials), written as a \`! <command>\` line. A Stop hook blocks a reply that hands a check to the user.`;

export function decide(_event: HookEvent): HookResult {
  if (process.env.GUARDS_DELEGATE_GUARD === "0") return null;
  if (isClaudeLiteSession(process.env.ANTHROPIC_BASE_URL)) return null;
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: DELEGATION_RULES,
      },
    },
  };
}
