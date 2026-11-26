import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const DEFAULT_NUDGE_GROWTH_TOKENS = 40_000;
const NUDGE_STEP_TOKENS = 50_000;
const REPORTED_TOOLS = 3;

type TokenTotals = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

type TotalsByModel = Record<string, TokenTotals>;

type TranscriptSummary = {
  byModel: TotalsByModel;
  contextTokens: number;
  startContextTokens: number;
  resultCharactersByTool: Record<string, number>;
  startedAt?: string;
};

export type LedgerEntry = {
  session: string;
  project: string;
  updatedAt: string;
  startedAt?: string;
  contextTokens: number;
  lastNudgeTokens: number;
  main: TotalsByModel;
  subagents: TotalsByModel;
  resultCharactersByTool: Record<string, number>;
};

export type StopEvent = {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
};

type ApiUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
};

type TranscriptMessage = {
  id?: string;
  role?: string;
  stop_reason?: string;
  model?: string;
  usage?: ApiUsage;
  content?: unknown;
};

type TranscriptLine = {
  timestamp?: string;
  message?: TranscriptMessage;
};

const toTotals = (usage: ApiUsage): TokenTotals => ({
  input: usage.input_tokens ?? 0,
  cacheWrite: usage.cache_creation_input_tokens ?? 0,
  cacheRead: usage.cache_read_input_tokens ?? 0,
  output: usage.output_tokens ?? 0,
});

const addTotals = (first: TokenTotals, second: TokenTotals): TokenTotals => ({
  input: first.input + second.input,
  cacheWrite: first.cacheWrite + second.cacheWrite,
  cacheRead: first.cacheRead + second.cacheRead,
  output: first.output + second.output,
});

function mergeByModel(summaries: TotalsByModel[]): TotalsByModel {
  const merged: TotalsByModel = {};
  for (const byModel of summaries) {
    for (const [model, totals] of Object.entries(byModel)) {
      merged[model] = merged[model] ? addTotals(merged[model], totals) : totals;
    }
  }
  return merged;
}

function parseLine(text: string): TranscriptLine | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseMessage(text: string): TranscriptMessage | undefined {
  return parseLine(text)?.message;
}

function resultSize(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let size = 0;
  for (const block of content) {
    if (typeof block?.text === "string") size += block.text.length;
  }
  return size;
}

type SummaryState = {
  usageByMessage: Map<string, { model: string; usage: ApiUsage }>;
  toolNames: Map<string, string>;
  resultCharactersByTool: Record<string, number>;
  firstUsage?: ApiUsage;
  lastUsage: ApiUsage;
  startedAt?: string;
};

function recordUsage(state: SummaryState, message: TranscriptMessage): void {
  if (!message.usage || !message.id) return;
  state.usageByMessage.set(message.id, {
    model: message.model ?? "unknown",
    usage: message.usage,
  });
  state.firstUsage ??= message.usage;
  state.lastUsage = message.usage;
}

const contextSize = (usage: ApiUsage): number => {
  const totals = toTotals(usage);
  return totals.input + totals.cacheWrite + totals.cacheRead;
};

function recordBlock(state: SummaryState, block: any): void {
  if (block?.type === "tool_use") {
    state.toolNames.set(block.id, block.name);
  } else if (block?.type === "tool_result") {
    const toolName = state.toolNames.get(block.tool_use_id) ?? "unknown";
    state.resultCharactersByTool[toolName] =
      (state.resultCharactersByTool[toolName] ?? 0) + resultSize(block.content);
  }
}

export function summarizeTranscript(transcript: string): TranscriptSummary {
  const state: SummaryState = {
    usageByMessage: new Map(),
    toolNames: new Map(),
    resultCharactersByTool: {},
    lastUsage: {},
  };
  for (const text of transcript.split("\n")) {
    const line = parseLine(text);
    if (typeof line?.timestamp === "string") state.startedAt ??= line.timestamp;
    const message = line?.message;
    if (!message) continue;
    recordUsage(state, message);
    for (const block of Array.isArray(message.content) ? message.content : []) {
      recordBlock(state, block);
    }
  }
  return {
    byModel: mergeByModel(
      [...state.usageByMessage.values()].map(({ model, usage }) => ({
        [model]: toTotals(usage),
      }))
    ),
    contextTokens: contextSize(state.lastUsage),
    startContextTokens: contextSize(state.firstUsage ?? {}),
    resultCharactersByTool: state.resultCharactersByTool,
    startedAt: state.startedAt,
  };
}

function hasLastReply(transcript: string): boolean {
  for (const text of transcript.split("\n").reverse()) {
    const message = parseMessage(text);
    if (message?.role === "assistant")
      return message.stop_reason !== "tool_use";
    if (message?.role === "user") return false;
  }
  return false;
}

export async function waitForLastReply(
  transcriptPath: string | undefined,
  pauseMilliseconds: number,
  attempts: number
): Promise<boolean> {
  if (!transcriptPath) return false;
  for (let i = 0; i < attempts; i++) {
    if (
      existsSync(transcriptPath) &&
      hasLastReply(readFileSync(transcriptPath, "utf8"))
    )
      return true;
    await Bun.sleep(pauseMilliseconds);
  }
  return false;
}

const inThousands = (count: number) => `${Math.round(count / 1000)}k`;
const minuteOf = (isoTime: string) => isoTime.slice(0, 16).replace("T", " ");

export function composeNudge(
  contextTokens: number,
  lastNudgeTokens: number,
  thresholdTokens: number,
  startTokens: number
): string | null {
  const isDue =
    contextTokens >= thresholdTokens &&
    (lastNudgeTokens === 0 ||
      contextTokens >= lastNudgeTokens + NUDGE_STEP_TOKENS);
  return isDue
    ? `Context is at ${inThousands(contextTokens)} tokens, up from ${inThousands(startTokens)} at the start, and every turn reads all of it again. /handoff then /clear starts the next task small.`
    : null;
}

const ledgerFolder = (userHome: string) =>
  join(userHome, ".cache/token-ledger/sessions");

function readEntry(path: string): LedgerEntry | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function readSubagentTranscripts(transcriptPath: string): string[] {
  const subagentFolder = join(
    dirname(transcriptPath),
    basename(transcriptPath, ".jsonl"),
    "subagents"
  );
  if (!existsSync(subagentFolder)) return [];
  return readdirSync(subagentFolder)
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .map((fileName) => readFileSync(join(subagentFolder, fileName), "utf8"));
}

function nudgeGrowth(): number {
  const configured = Number(process.env.TOKEN_LEDGER_NUDGE_TOKENS);
  return configured > 0 ? configured : DEFAULT_NUDGE_GROWTH_TOKENS;
}

export function recordSession(
  event: StopEvent,
  userHome: string,
  now: Date
): { systemMessage: string } | null {
  const transcriptPath = event.transcript_path;
  if (!event.session_id || !transcriptPath || !existsSync(transcriptPath))
    return null;
  const entryPath = join(ledgerFolder(userHome), `${event.session_id}.json`);
  const mainSummary = summarizeTranscript(readFileSync(transcriptPath, "utf8"));
  const thresholdTokens = mainSummary.startContextTokens + nudgeGrowth();
  const lastNudgeTokens =
    mainSummary.contextTokens < thresholdTokens
      ? 0
      : (readEntry(entryPath)?.lastNudgeTokens ?? 0);
  const nudge = composeNudge(
    mainSummary.contextTokens,
    lastNudgeTokens,
    thresholdTokens,
    mainSummary.startContextTokens
  );
  const entry: LedgerEntry = {
    session: event.session_id,
    project: basename(event.cwd ?? ""),
    updatedAt: now.toISOString(),
    startedAt: mainSummary.startedAt,
    contextTokens: mainSummary.contextTokens,
    lastNudgeTokens: nudge ? mainSummary.contextTokens : lastNudgeTokens,
    main: mainSummary.byModel,
    subagents: mergeByModel(
      readSubagentTranscripts(transcriptPath).map(
        (transcript) => summarizeTranscript(transcript).byModel
      )
    ),
    resultCharactersByTool: mainSummary.resultCharactersByTool,
  };
  mkdirSync(dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
  return {
    systemMessage: [composeSummary(entry), ...(nudge ? [nudge] : [])].join(
      "\n"
    ),
  };
}

const describeTotals = (totals: TokenTotals) =>
  `in ${inThousands(totals.input)}, cache write ${inThousands(totals.cacheWrite)}, cache read ${inThousands(totals.cacheRead)}, out ${inThousands(totals.output)}`;

const sumModels = (byModel: TotalsByModel) =>
  Object.values(byModel).reduce(addTotals, toTotals({}));

export function composeSummary(entry: LedgerEntry): string {
  const hasSubagents = Object.keys(entry.subagents).length > 0;
  return [
    `Context ${inThousands(entry.contextTokens)}.`,
    `Session: ${describeTotals(sumModels(entry.main))}.`,
    ...(hasSubagents
      ? [`Subagents: ${describeTotals(sumModels(entry.subagents))}.`]
      : []),
  ].join(" ");
}

const describeModels = (label: string, byModel: TotalsByModel) =>
  Object.entries(byModel).map(
    ([model, totals]) => `  ${label}${model}: ${describeTotals(totals)}`
  );

function describeTools(resultCharactersByTool: Record<string, number>) {
  const biggestTools = Object.entries(resultCharactersByTool)
    .sort(([, first], [, second]) => second - first)
    .slice(0, REPORTED_TOOLS)
    .map(
      ([toolName, characters]) => `${toolName} ${inThousands(characters)} chars`
    );
  return biggestTools.length
    ? [`  tool results: ${biggestTools.join(", ")}`]
    : [];
}

const CAP_REPORTED_TOOLS = 10;
const GUARDS_SHELL_TOOLS = ["Bash", "run_shell_command"];
const GUARDS_SHELL_CAP =
  "bash-trim caps at 80 lines, 400 characters a line, 4,000 characters";
const GUARDS_MCP_CAP =
  "bash-trim caps at 300 lines (off when GUARDS_MCP_TRIM=0)";
const GUARDS_READ_CAP = "read-guard caps at 150 lines (300 with a limit)";

function describeGuardCap(toolName: string): string {
  if (GUARDS_SHELL_TOOLS.includes(toolName)) return GUARDS_SHELL_CAP;
  if (toolName === "Read") return GUARDS_READ_CAP;
  if (toolName.startsWith("mcp__")) return GUARDS_MCP_CAP;
  return "no guards cap";
}

function describeToolCaps(entries: LedgerEntry[]): string[] {
  const charactersByTool: Record<string, number> = {};
  for (const entry of entries)
    for (const [toolName, characters] of Object.entries(
      entry.resultCharactersByTool ?? {}
    ))
      charactersByTool[toolName] =
        (charactersByTool[toolName] ?? 0) + characters;
  const biggestTools = Object.entries(charactersByTool)
    .sort(([, first], [, second]) => second - first)
    .slice(0, CAP_REPORTED_TOOLS);
  if (biggestTools.length === 0) return [];
  return [
    "",
    "Biggest tool results across these sessions, beside the guards caps:",
    ...biggestTools.map(
      ([toolName, characters]) =>
        `  ${toolName} ${inThousands(characters)} chars: ${describeGuardCap(toolName)}`
    ),
  ];
}

export function formatReport(entries: LedgerEntry[]): string {
  if (entries.length === 0) return "No sessions recorded yet.";
  return [
    ...entries.flatMap((entry) => [
      `${minuteOf(entry.updatedAt)}  ${entry.project}  context ${inThousands(entry.contextTokens)}  ${entry.session}`,
      ...describeModels("", entry.main),
      ...describeModels("subagents ", entry.subagents),
      ...describeTools(entry.resultCharactersByTool ?? {}),
    ]),
    ...describeToolCaps(entries),
  ].join("\n");
}

export function readNewestEntries(
  userHome: string,
  count: number
): LedgerEntry[] {
  const folder = ledgerFolder(userHome);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .map((fileName) => join(folder, fileName))
    .sort((first, second) => statSync(second).mtimeMs - statSync(first).mtimeMs)
    .slice(0, count)
    .flatMap((path) => readEntry(path) ?? []);
}

export type ReplyWordCounts = { finalWords: number; narrationWords: number };

type TranscriptEntry = {
  type?: string;
  isSidechain?: boolean;
  message?: TranscriptMessage;
};

const DEFAULT_REPLY_WORDS = 150;
const DEFAULT_NARRATION_WORDS = 40;

function parseEntry(text: string): TranscriptEntry | undefined {
  try {
    return JSON.parse(text) ?? undefined;
  } catch {
    return undefined;
  }
}

const countWords = (text: string) =>
  text.split(/\s+/).filter((word) => word.length > 0).length;

function isPromptEntry(entry: TranscriptEntry): boolean {
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  const hasText = content.some((block) => block?.type === "text");
  const hasToolResult = content.some((block) => block?.type === "tool_result");
  return hasText && !hasToolResult;
}

export function countLastReplyWords(transcript: string): ReplyWordCounts {
  const entries = transcript
    .split("\n")
    .map(parseEntry)
    .filter(
      (entry): entry is TranscriptEntry =>
        entry !== undefined && entry.isSidechain !== true
    );
  const lastPromptIndex = entries.findLastIndex(
    (entry) => entry.type === "user" && isPromptEntry(entry)
  );
  const counts: ReplyWordCounts = { finalWords: 0, narrationWords: 0 };
  let pendingWords = 0;
  for (const entry of entries.slice(lastPromptIndex + 1)) {
    const content = entry.message?.content;
    if (entry.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") {
        pendingWords += countWords(block.text);
      } else if (block?.type === "tool_use") {
        counts.narrationWords += pendingWords;
        pendingWords = 0;
      }
    }
  }
  counts.finalWords = pendingWords;
  return counts;
}

function replyNotePath(userHome: string, sessionId: string): string {
  return join(userHome, ".cache/token-ledger/notes", `${sessionId}.txt`);
}

export function recordReplyMeter(event: StopEvent, userHome: string): void {
  const transcriptPath = event.transcript_path;
  if (!event.session_id || !transcriptPath || !existsSync(transcriptPath))
    return;
  const notePath = replyNotePath(userHome, event.session_id);
  const { finalWords, narrationWords } = countLastReplyWords(
    readFileSync(transcriptPath, "utf8")
  );
  const replyBudget = Number(
    process.env.TOKEN_LEDGER_REPLY_WORDS ?? DEFAULT_REPLY_WORDS
  );
  const narrationBudget = Number(
    process.env.TOKEN_LEDGER_NARRATION_WORDS ?? DEFAULT_NARRATION_WORDS
  );
  if (finalWords <= replyBudget && narrationWords <= narrationBudget) {
    rmSync(notePath, { force: true });
    return;
  }
  mkdirSync(dirname(notePath), { recursive: true });
  writeFileSync(
    notePath,
    `Last reply: ${finalWords} words (budget ${replyBudget}), ${narrationWords} narration words between tool calls (budget ${narrationBudget}). Stay under both unless asked to explain.`
  );
}

export type ReplyNoteOutput = {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
};

export function takeReplyNote(
  sessionId: string | undefined,
  userHome: string
): ReplyNoteOutput | null {
  if (!sessionId) return null;
  const notePath = replyNotePath(userHome, sessionId);
  if (!existsSync(notePath)) return null;
  const additionalContext = readFileSync(notePath, "utf8");
  rmSync(notePath, { force: true });
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };
}

export type Fix = { appliedAt: string; title: string };

const fixesPath = (userHome: string) =>
  join(userHome, ".cache/token-ledger/fixes.jsonl");

export function recordFix(
  userHome: string,
  title: string,
  now: Date = new Date()
): void {
  const path = fixesPath(userHome);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify({ appliedAt: now.toISOString(), title })}\n`
  );
}

function parseFix(line: string): Fix | undefined {
  try {
    const fix = JSON.parse(line);
    return typeof fix?.appliedAt === "string" && typeof fix?.title === "string"
      ? fix
      : undefined;
  } catch {
    return undefined;
  }
}

export function readFixes(userHome: string): Fix[] {
  const path = fixesPath(userHome);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => parseFix(line) ?? []);
}

export type SessionGroup = {
  sessions: number;
  medianContextTokens: number;
  medianToolResultCharacters: number;
  medianTokens: number;
  cacheReadPercent: number;
  nudgedSessions: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

const sumValues = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0);

function describeGroup(entries: LedgerEntry[]): SessionGroup {
  const groupTotals = entries.reduce(
    (sum, entry) =>
      addTotals(
        sum,
        addTotals(sumModels(entry.main), sumModels(entry.subagents))
      ),
    toTotals({})
  );
  const cacheBase =
    groupTotals.input + groupTotals.cacheWrite + groupTotals.cacheRead;
  return {
    sessions: entries.length,
    medianContextTokens: median(entries.map((entry) => entry.contextTokens)),
    medianToolResultCharacters: median(
      entries.map((entry) => sumValues(entry.resultCharactersByTool ?? {}))
    ),
    medianTokens: median(
      entries.map((entry) => {
        const totals = addTotals(
          sumModels(entry.main),
          sumModels(entry.subagents)
        );
        return (
          totals.input + totals.cacheWrite + totals.cacheRead + totals.output
        );
      })
    ),
    cacheReadPercent:
      cacheBase === 0
        ? 0
        : Math.round((groupTotals.cacheRead / cacheBase) * 100),
    nudgedSessions: entries.filter((entry) => (entry.lastNudgeTokens ?? 0) > 0)
      .length,
  };
}

export function compareSessions(
  entries: LedgerEntry[],
  since: string
): { before: SessionGroup; after: SessionGroup; spanningSessions: number } {
  const updatedAfter = entries.filter((entry) => entry.updatedAt >= since);
  const after = updatedAfter.filter(
    (entry) => entry.startedAt !== undefined && entry.startedAt >= since
  );
  return {
    before: describeGroup(entries.filter((entry) => entry.updatedAt < since)),
    after: describeGroup(after),
    spanningSessions: updatedAfter.length - after.length,
  };
}

const describeVerificationGroup = (label: string, group: SessionGroup) =>
  `  ${label}: ${group.sessions} sessions, median context ${inThousands(group.medianContextTokens)}, median tool results ${inThousands(group.medianToolResultCharacters)} chars, median tokens ${inThousands(group.medianTokens)}, cache read ${group.cacheReadPercent}%, nudged ${group.nudgedSessions}`;

const TOO_EARLY_SESSIONS = 5;

function describeCheck(
  entries: LedgerEntry[],
  check: { title: string; since: string }
): string {
  const { before, after, spanningSessions } = compareSessions(
    entries,
    check.since
  );
  return [
    `Fix: ${check.title} (applied ${minuteOf(check.since)})`,
    describeVerificationGroup("before", before),
    describeVerificationGroup("after", after),
    ...(spanningSessions > 0
      ? [
          `  left out: ${spanningSessions} sessions that were already running when the fix landed`,
        ]
      : []),
    ...(after.sessions < TOO_EARLY_SESSIONS
      ? [
          `  Fewer than ${TOO_EARLY_SESSIONS} sessions after the fix: too early to judge.`,
        ]
      : []),
  ].join("\n");
}

export function formatVerification(
  entries: LedgerEntry[],
  checks: { title: string; since: string }[]
): string {
  return checks.map((check) => describeCheck(entries, check)).join("\n\n");
}
