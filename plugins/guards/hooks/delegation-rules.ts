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
  return `# Use the least expensive complete workflow

- Handle a bounded task directly: targeted reads, edits, writes and verification are allowed. Do not delegate a small task just to satisfy a character limit.
- Send verbose research to guards:context-scout; ask for conclusions, evidence and path:line references rather than raw output.
- Delegate well-specified implementation and its check together to guards:worker. Avoid writing a full implementation in the delegation prompt.
${otherAgentRule}
- Check the actual resolved model and total cost including retries before assuming delegation saves money. Saved per-agent model overrides remain authoritative.
- Resume the same worker for corrections when the host supports resume; otherwise send a concise correction with the previous result. Escalate ambiguous work rather than repeatedly restarting cheap workers.
- Batch related work. Run checks yourself or through a worker and report their result. Ask the user only for steps requiring their credentials, device or interaction.
- For verbose commands use bun <guards-plugin-path>/bin/compact-run <command> [arguments...] when available; it retains full logs and preserves exit status. Keep full logs in files and return short summaries. Start a fresh session at a task boundary when accumulated context is no longer useful; preserve useful context while completing a task.`;
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
