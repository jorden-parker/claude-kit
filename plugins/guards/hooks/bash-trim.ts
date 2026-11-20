import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHELL_TOOL_NAMES,
  type HookEvent,
  type HookResult,
  type SavedOutput,
} from "./types.ts";

export const MAX_LINES = 150;
const MAX_SIGNAL_LINES = 40;
const SIGNAL = /error|fail|panic|traceback|exception|fatal|assert/i;
const SUMMARY =
  /^(?:ok|PASS|FAIL)\b|\b\d+ (?:passed|failed|skipped|total)\b|^Tests:|^Test Suites:|^=+ .* =+$/;
const MCP_TOOL = /^mcp__/;

type TrimLimits = {
  maxLines: number;
  headLines: number;
  tailLines: number;
  maxLineChars: number;
};

const SHELL_LIMITS: TrimLimits = {
  maxLines: MAX_LINES,
  headLines: 30,
  tailLines: 60,
  maxLineChars: 400,
};

const MCP_LIMITS: TrimLimits = {
  maxLines: 300,
  headLines: 200,
  tailLines: 60,
  maxLineChars: Infinity,
};

const clip = (line: string, maxLineChars: number) =>
  line.length <= maxLineChars
    ? line
    : `${line.slice(0, maxLineChars)} … [${line.length - maxLineChars} chars hidden]`;

function trimLines(
  lines: string[],
  limits: TrimLimits,
  savedPath: string
): string[] {
  if (lines.length <= limits.maxLines) return lines;
  const firstHidden = limits.headLines + 1;
  const lastHidden = lines.length - limits.tailLines;
  const middle = lines.slice(limits.headLines, -limits.tailLines);
  const signals = middle
    .filter((line) => SIGNAL.test(line) || SUMMARY.test(line))
    .slice(0, MAX_SIGNAL_LINES);
  const marker = `[bash-trim: ${middle.length - signals.length} lines hidden from lines ${firstHidden}-${lastHidden}; full output in ${savedPath}: grep it, or sed -n '${firstHidden},${lastHidden}p' it]`;
  return [
    ...lines.slice(0, limits.headLines),
    ...signals,
    marker,
    ...lines.slice(-limits.tailLines),
  ];
}

const TRIMMABLE_STREAMS = ["stdout", "stderr", "llmContent", "returnDisplay"];

const HIDDEN_COUNT = /\[bash-trim: (\d+) lines hidden/;
const hiddenIn = (text: string) => Number(HIDDEN_COUNT.exec(text)?.[1] ?? 0);

type TextTrimmer = (text: string, partName: string) => string;

function trimEachText(response: unknown, trimText: TextTrimmer): unknown {
  if (typeof response === "string") return trimText(response, "text");
  if (Array.isArray(response))
    return response.map((block, index) =>
      typeof block?.text === "string"
        ? { ...block, text: trimText(block.text, `text${index}`) }
        : block
    );
  if (!response || typeof response !== "object") return response;
  const streams = response as Record<string, unknown>;
  const trimmed: Record<string, unknown> = { ...streams };
  for (const stream of TRIMMABLE_STREAMS) {
    const text = streams[stream];
    if (typeof text === "string") trimmed[stream] = trimText(text, stream);
  }
  return trimmed;
}

function limitsFor(toolName: string): TrimLimits | null {
  if (SHELL_TOOL_NAMES.includes(toolName)) return SHELL_LIMITS;
  const isTrimmedMcpTool =
    MCP_TOOL.test(toolName) && process.env.GUARDS_MCP_TRIM !== "0";
  return isTrimmedMcpTool ? MCP_LIMITS : null;
}

const SAVED_OUTPUT_MAX_AGE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export function pruneSavedOutputs(folder: string, now = Date.now()): void {
  let fileNames: string[];
  try {
    fileNames = readdirSync(folder);
  } catch {
    return;
  }
  for (const fileName of fileNames) {
    const path = join(folder, fileName);
    try {
      const fileStats = statSync(path);
      const isExpired =
        now - fileStats.mtimeMs > SAVED_OUTPUT_MAX_AGE_MILLISECONDS;
      if (fileStats.isFile() && isExpired) rmSync(path, { force: true });
    } catch {}
  }
}

export function decide(
  event: HookEvent,
  savedOutputFolder = join(tmpdir(), "guards-output")
): HookResult {
  const response: unknown = event.tool_response;
  const limits = limitsFor(event.tool_name ?? "");
  if (!limits || !response) return null;
  const savedOutputs: SavedOutput[] = [];
  let hiddenLines = 0;
  const trimText: TextTrimmer = (text, partName) => {
    const path = join(
      savedOutputFolder,
      `${event.session_id ?? "session"}-${event.tool_use_id ?? "output"}-${partName}.txt`
    );
    const trimmedText = trimLines(text.split("\n"), limits, path)
      .map((line) => clip(line, limits.maxLineChars))
      .join("\n");
    const hiddenHere = hiddenIn(trimmedText);
    if (hiddenHere > 0) savedOutputs.push({ path, text });
    hiddenLines += hiddenHere;
    return trimmedText;
  };
  const trimmed = trimEachText(response, trimText);
  if (JSON.stringify(trimmed) === JSON.stringify(response)) return null;
  return {
    output: {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: trimmed,
      },
    },
    hiddenLines,
    savedOutputs,
  };
}
