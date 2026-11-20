import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const DEFAULT_NUDGE_TOKENS = 150_000;
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
  resultCharactersByTool: Record<string, number>;
};

export type LedgerEntry = {
  session: string;
  project: string;
  updatedAt: string;
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

function parseMessage(text: string): TranscriptMessage | undefined {
  try {
    return JSON.parse(text).message;
  } catch {
    return undefined;
  }
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
  lastUsage: ApiUsage;
};

function recordUsage(state: SummaryState, message: TranscriptMessage): void {
  if (!message.usage || !message.id) return;
  state.usageByMessage.set(message.id, {
    model: message.model ?? "unknown",
    usage: message.usage,
  });
  state.lastUsage = message.usage;
}

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
    const message = parseMessage(text);
    if (!message) continue;
    recordUsage(state, message);
    for (const block of Array.isArray(message.content) ? message.content : []) {
      recordBlock(state, block);
    }
  }
  const lastTotals = toTotals(state.lastUsage);
  return {
    byModel: mergeByModel(
      [...state.usageByMessage.values()].map(({ model, usage }) => ({
        [model]: toTotals(usage),
      }))
    ),
    contextTokens:
      lastTotals.input + lastTotals.cacheWrite + lastTotals.cacheRead,
    resultCharactersByTool: state.resultCharactersByTool,
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

export function composeNudge(
  contextTokens: number,
  lastNudgeTokens: number,
  thresholdTokens: number
): string | null {
  const isDue =
    contextTokens >= thresholdTokens &&
    (lastNudgeTokens === 0 ||
      contextTokens >= lastNudgeTokens + NUDGE_STEP_TOKENS);
  return isDue
    ? `Context is at ${inThousands(contextTokens)} tokens, and every turn reads all of it again. /handoff then /clear starts the next task small.`
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

function nudgeThreshold(): number {
  const configured = Number(process.env.TOKEN_LEDGER_NUDGE_TOKENS);
  return configured > 0 ? configured : DEFAULT_NUDGE_TOKENS;
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
  const thresholdTokens = nudgeThreshold();
  const lastNudgeTokens =
    mainSummary.contextTokens < thresholdTokens
      ? 0
      : (readEntry(entryPath)?.lastNudgeTokens ?? 0);
  const nudge = composeNudge(
    mainSummary.contextTokens,
    lastNudgeTokens,
    thresholdTokens
  );
  const entry: LedgerEntry = {
    session: event.session_id,
    project: basename(event.cwd ?? ""),
    updatedAt: now.toISOString(),
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

export function formatReport(entries: LedgerEntry[]): string {
  if (entries.length === 0) return "No sessions recorded yet.";
  return entries
    .flatMap((entry) => [
      `${entry.updatedAt.slice(0, 16).replace("T", " ")}  ${entry.project}  context ${inThousands(entry.contextTokens)}  ${entry.session}`,
      ...describeModels("", entry.main),
      ...describeModels("subagents ", entry.subagents),
      ...describeTools(entry.resultCharactersByTool),
    ])
    .join("\n");
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
