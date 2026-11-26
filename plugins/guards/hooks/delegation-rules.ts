import { isClaudeLiteSession } from "./claude-lite.ts";
import {
  DEFAULT_DELEGATION_MODEL,
  resolveDelegationModel,
} from "./delegate-guard.ts";
import type { HookEvent, HookResult } from "./types.ts";

function composeDelegationRules(delegationModel: string): string {
  const isDefaultModel = delegationModel === DEFAULT_DELEGATION_MODEL;
  const otherAgentRule = isDefaultModel
    ? '- Any other Agent call names a model: `"haiku"` by default, `"sonnet"` only after Haiku failed the task.'
    : `- Every Agent call names model: \`"${delegationModel}"\`, including \`guards:context-scout\` and \`guards:worker\`.`;
  const lookupScope = isDefaultModel
    ? "since the last Haiku delegation"
    : "since the last delegation";
  return `# You are the orchestrator: plan, delegate, coordinate

The main session does no hands-on work. It hands each piece to a subagent and works from the summaries.

- Lookups that need more than one file read or one search: \`guards:context-scout\`. Read one file or symbol you can already name yourself.
- One Edit or MultiEdit of up to 1,000 changed characters (old and new strings together) you make yourself. Read just the lines around the change first (offset and limit). Larger edits, any Write, and any check (tests, typecheck, lint, build, running the app): \`guards:worker\`. Give it the goal, the files, the exact change and the check to run.
${otherAgentRule}
- Send independent pieces as several Agent calls in one message.
- Keep for yourself: talking to the user, planning, judging results, short git commands, notes under ~/.claude or the scratchpad, and a glance at a path:line a subagent cited.

Hooks deny main-session edits to project files over 1,000 changed characters and every Write, and lookups past 20,000 characters ${lookupScope}. When a subagent reports BLOCKED or its result looks wrong, send a corrected task to a new subagent.

Checks are yours, never the user's: report the command and its result line. Ask the user only for steps that need them (an interactive login, a physical device, their own credentials), written as a \`! <command>\` line. A Stop hook blocks a reply that hands a check to the user.`;
}

export function decide(_event: HookEvent): HookResult {
  if (process.env.GUARDS_DELEGATE_GUARD === "0") return null;
  if (isClaudeLiteSession(process.env.ANTHROPIC_BASE_URL)) return null;
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: composeDelegationRules(resolveDelegationModel()),
      },
    },
  };
}
