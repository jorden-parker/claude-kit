import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptTail } from "./browser-check.ts";
import { GIT_OPTIONS, withoutQuotedText } from "./bash-guard.ts";
import { isClaudeLiteSession } from "./claude-lite.ts";
import { deny, type HookEvent, type HookResult } from "./types.ts";

export const DEFAULT_DELEGATION_MODEL = "haiku";
const LOOKUP_BUDGET = 20_000;
const WARNING_LINE = 10_000;
const SMALL_EDIT_LIMIT = 1_000;
const SCOUT_PROMPT_LIMIT = 1_500;
const SCOUT_AGENT = "guards:context-scout";
const WORKER_AGENT = "guards:worker";
const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const DEFAULT_AGENT = "general-purpose";
const SESSION_MODEL_AGENTS = [DEFAULT_AGENT, "claude"];
const LOOKUP_TOOLS = ["Read", "Grep", "Glob"];
const DELEGATION_TOOLS = ["Agent", "Task"];
const TOOL_BLOCK_MARK = '"tool_';
const MAX_TRANSCRIPT_BYTES = 10_000_000;
const LOOKUP_PROGRAMS = String.raw`cat|head|tail|less|more|bat|sed\s+-n|grep|rg|find|fd|ls|tree|git\s+${GIT_OPTIONS}(?:grep|log|diff|show|blame|ls-files)`;
const WRITES_INSTEAD_OF_READING = String.raw`(?!\s*(?:<<|>))`;
const LOOKUP_COMMAND = new RegExp(
  String.raw`(?:^|[;&(\n\`]|\|\|)\s*(?:\w+=\S*\s+)*(?:${LOOKUP_PROGRAMS})\b${WRITES_INSTEAD_OF_READING}`
);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n[ \t]*\2\b/g;

export function resolveDelegationModel(): string {
  return process.env.GUARDS_DELEGATE_MODEL || DEFAULT_DELEGATION_MODEL;
}

type TranscriptLine = {
  isSidechain?: boolean;
  message?: { content?: unknown };
};

type Tally = { spent: number; lookupIds: Set<string> };

function isLookup(
  toolName: string | undefined,
  toolInput: Record<string, any> | undefined
): boolean {
  if (LOOKUP_TOOLS.includes(toolName ?? "")) return true;
  return (
    toolName === "Bash" &&
    LOOKUP_COMMAND.test(
      withoutQuotedText((toolInput?.command ?? "").replace(HEREDOC, "<<"))
    )
  );
}

function isAgentCall(event: HookEvent): boolean {
  return DELEGATION_TOOLS.includes(event.tool_name ?? "");
}

function isExempt(event: HookEvent): boolean {
  return (
    process.env.GUARDS_DELEGATE_GUARD === "0" ||
    isClaudeLiteSession(process.env.ANTHROPIC_BASE_URL) ||
    event.agent_id !== undefined
  );
}

function delegationProblem(event: HookEvent): HookResult {
  const input = event.tool_input ?? {};
  const agentType = input.subagent_type ?? DEFAULT_AGENT;
  const promptLength = String(input.prompt ?? "").length;
  if (agentType === "Explore") {
    return deny(`Explore is denied. Use subagent_type: "${SCOUT_AGENT}".`);
  }
  if (agentType === SCOUT_AGENT && promptLength > SCOUT_PROMPT_LIMIT) {
    return deny(
      `The scout prompt is ${promptLength} characters; the limit is ${SCOUT_PROMPT_LIMIT}. Send only the question and the paths to start from.`
    );
  }
  const delegationModel = resolveDelegationModel();
  if (
    [SCOUT_AGENT, WORKER_AGENT].includes(agentType) &&
    delegationModel !== DEFAULT_DELEGATION_MODEL &&
    input.model !== delegationModel
  ) {
    return deny(
      `GUARDS_DELEGATE_MODEL is "${delegationModel}". Name model: "${delegationModel}" on this ${agentType} call.`
    );
  }
  if (SESSION_MODEL_AGENTS.includes(agentType) && input.model === undefined) {
    return deny(
      `Use subagent_type: "${WORKER_AGENT}" to write code or run checks, "${SCOUT_AGENT}" to read or search, or name model: "${delegationModel}". With no model, this agent runs on the session model, the costliest choice.`
    );
  }
  return null;
}

function orchestrationFolders(): string[] {
  return [join(homedir(), ".claude"), tmpdir(), "/tmp", "/private/tmp"];
}

function changedCharacters(edit: any): number {
  const oldString = edit?.old_string;
  const newString = edit?.new_string;
  if (typeof oldString !== "string" || typeof newString !== "string") {
    return Infinity;
  }
  return oldString.length + newString.length;
}

function isSmallEdit(event: HookEvent): boolean {
  const input = event.tool_input ?? {};
  const edits = event.tool_name === "MultiEdit" ? input.edits : [input];
  if (!Array.isArray(edits) || edits.length === 0) return false;
  const total = edits.reduce((sum, edit) => sum + changedCharacters(edit), 0);
  return total <= SMALL_EDIT_LIMIT;
}

function isProjectEdit(event: HookEvent): boolean {
  if (!EDIT_TOOLS.includes(event.tool_name ?? "")) return false;
  if (isSmallEdit(event)) return false;
  const input = event.tool_input ?? {};
  const filePath = String(input.file_path ?? input.notebook_path ?? "");
  return !orchestrationFolders().some((folder) =>
    filePath.startsWith(`${folder}/`)
  );
}

function editReason(event: HookEvent): string {
  const limit = SMALL_EDIT_LIMIT.toLocaleString("en-US");
  return `The main session makes only one Edit or MultiEdit of up to ${limit} changed characters (old and new strings together) to a project file. Send edits over ${limit} changed characters, and every Write, to ${WORKER_AGENT} through the Agent tool: the files, the exact change and the check to run. Blocked: ${event.tool_name} of ${event.tool_input?.file_path ?? event.tool_input?.notebook_path}.`;
}

function budgetReason(spent: number): string {
  return `${spent} characters read or searched since the last Haiku delegation; the budget is ${LOOKUP_BUDGET}. Send the remaining lookups to ${SCOUT_AGENT} through the Agent tool.`;
}

function budgetWarning(spent: number): HookResult {
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Lookups have used ${spent} of ${LOOKUP_BUDGET} characters; at the budget the next one is denied. Send further multi-file lookups to ${SCOUT_AGENT}.`,
      },
    },
  };
}

function parseLine(line: string): TranscriptLine | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function resetTally(tally: Tally): void {
  tally.spent = 0;
  tally.lookupIds.clear();
}

function resultSize(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (total, block) =>
      total + (typeof block?.text === "string" ? block.text.length : 0),
    0
  );
}

function isHaikuDelegation(block: any): boolean {
  return (
    DELEGATION_TOOLS.includes(block.name) &&
    ([DEFAULT_DELEGATION_MODEL, resolveDelegationModel()].includes(
      block.input?.model
    ) ||
      [SCOUT_AGENT, WORKER_AGENT].includes(block.input?.subagent_type))
  );
}

function applyToolUse(tally: Tally, block: any): void {
  if (isHaikuDelegation(block)) {
    resetTally(tally);
  } else if (isLookup(block.name, block.input)) {
    tally.lookupIds.add(block.id);
  }
}

function applyBlock(tally: Tally, block: any): void {
  if (block?.type === "tool_use") {
    applyToolUse(tally, block);
  } else if (
    block?.type === "tool_result" &&
    tally.lookupIds.has(block.tool_use_id)
  ) {
    tally.spent += resultSize(block.content);
  }
}

function applyLine(tally: Tally, line: TranscriptLine): void {
  const content = line.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) applyBlock(tally, block);
  }
}

function lookupCharacters(transcript: string): number {
  const tally: Tally = { spent: 0, lookupIds: new Set() };
  for (const text of transcript.split("\n")) {
    const line = text.includes(TOOL_BLOCK_MARK) ? parseLine(text) : undefined;
    if (line && line.isSidechain !== true) applyLine(tally, line);
  }
  return tally.spent;
}

function needsTranscript(event: HookEvent): boolean {
  return (
    !isExempt(event) &&
    !isAgentCall(event) &&
    isLookup(event.tool_name, event.tool_input)
  );
}

export function decideDelegation(
  event: HookEvent,
  transcript: string
): HookResult {
  if (isExempt(event)) return null;
  if (isProjectEdit(event)) return deny(editReason(event));
  if (isAgentCall(event)) return delegationProblem(event);
  if (!isLookup(event.tool_name, event.tool_input)) return null;
  const spent = lookupCharacters(transcript);
  if (spent >= LOOKUP_BUDGET) return deny(budgetReason(spent));
  return spent >= WARNING_LINE ? budgetWarning(spent) : null;
}

export function decideDelegationFromTranscript(
  event: HookEvent,
  maxBytes = MAX_TRANSCRIPT_BYTES
): HookResult {
  const path = event.transcript_path;
  const transcript =
    path && needsTranscript(event) ? transcriptTail(path, maxBytes) : "";
  return decideDelegation(event, transcript);
}
