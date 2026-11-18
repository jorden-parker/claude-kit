import { transcriptTail } from "./browser-check.ts";
import { GIT_OPTIONS, withoutQuotedText } from "./bash-guard.ts";
import { deny, type HookEvent, type HookResult } from "./types.ts";

const LOOKUP_BUDGET = 40_000;
const SCOUT_AGENT = "guards:context-scout";
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
    process.env.GUARDS_DELEGATE_GUARD === "0" || event.agent_id !== undefined
  );
}

function exploreProblem(event: HookEvent): HookResult {
  const input = event.tool_input ?? {};
  const isExplore = input.subagent_type === "Explore";
  if (!isExplore || input.model === "haiku") return null;
  return deny(
    `Explore subagents must run on Haiku. Re-send this Agent call with model: "haiku", or use subagent_type: "${SCOUT_AGENT}" instead.`
  );
}

function budgetReason(spent: number): string {
  return `This session has read or searched ${spent} characters since the last Haiku delegation, over the ${LOOKUP_BUDGET} budget. Delegate the rest of the reading and searching to the ${SCOUT_AGENT} agent (Haiku) through the Agent tool, and ask it for the conclusion with file:line references. The budget resets only when you delegate to it or to an agent spawned with model: "haiku".`;
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
    (block.input?.model === "haiku" ||
      block.input?.subagent_type === SCOUT_AGENT)
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
  if (isAgentCall(event)) return exploreProblem(event);
  if (!isLookup(event.tool_name, event.tool_input)) return null;
  const spent = lookupCharacters(transcript);
  return spent < LOOKUP_BUDGET ? null : deny(budgetReason(spent));
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
