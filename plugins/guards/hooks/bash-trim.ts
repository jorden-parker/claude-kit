import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHELL_TOOL_NAMES,
  type HookEvent,
  type HookResult,
  type SavedOutput,
} from "./types.ts";

const SIGNAL = /error|fail|panic|traceback|exception|fatal|assert/i;
const SUMMARY =
  /^(?:ok|PASS|FAIL)\b|\b\d+ (?:passed|failed|skipped|total)\b|^Tests:|^Test Suites:|^=+ .* =+$/;
const MCP_TOOL = /^mcp__/;

type TrimLimits = {
  maxLines: number;
  headLines: number;
  tailLines: number;
  maxLineChars: number;
  maxCharacters: number;
  maxSignalLines: number;
};

const SHELL_LIMITS: TrimLimits = {
  maxLines: 80,
  headLines: 20,
  tailLines: 40,
  maxLineChars: 400,
  maxCharacters: 4_000,
  maxSignalLines: 19,
};

const MCP_LIMITS: TrimLimits = {
  maxLines: 300,
  headLines: 200,
  tailLines: 60,
  maxLineChars: Infinity,
  maxCharacters: 8_000,
  maxSignalLines: 40,
};

export const capCharacters = (
  text: string,
  maxCharacters: number,
  savedPath: string
): string => {
  if (text.length <= maxCharacters) return text;
  const markerFor = (omitted: number) =>
    `[bash-trim: ${omitted} characters hidden from the middle; full output in ${savedPath}: grep it]`;
  const kept = Math.max(0, maxCharacters - markerFor(text.length).length - 2);
  const headCharacters = Math.floor(kept / 2);
  const tailCharacters = kept - headCharacters;
  const marker = markerFor(text.length - kept);
  return `${text.slice(0, headCharacters)}\n${marker}\n${text.slice(text.length - tailCharacters)}`;
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
    .slice(0, limits.maxSignalLines);
  const marker = `[bash-trim: ${middle.length - signals.length} lines hidden from lines ${firstHidden}-${lastHidden}; full output in ${savedPath}: grep it, or sed -n '${firstHidden},${lastHidden}p' it]`;
  return [
    ...lines.slice(0, limits.headLines),
    ...signals,
    marker,
    ...lines.slice(-limits.tailLines),
  ];
}

const HIDDEN_COUNT = /\[bash-trim: (\d+) lines hidden/;
const hiddenIn = (text: string) => Number(HIDDEN_COUNT.exec(text)?.[1] ?? 0);

type TextTrimmer = (text: string, partName: string) => string;

const SKIPPED_KEYS = ["data", "blob", "base64"];
const SKIPPED_BLOCK_TYPES = ["image", "audio"];

function isSkipped(value: Record<string, unknown>): boolean {
  return (
    value.isImage === true || SKIPPED_BLOCK_TYPES.includes(value.type as string)
  );
}

function trimEachText(
  value: unknown,
  trimText: TextTrimmer,
  path: string[] = []
): unknown {
  if (typeof value === "string")
    return trimText(value, path.join("-") || "text");
  if (Array.isArray(value))
    return value.map((item, index) =>
      trimEachText(item, trimText, [...path, String(index)])
    );
  if (!value || typeof value !== "object" || isSkipped(value as any))
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SKIPPED_KEYS.includes(key)
        ? item
        : trimEachText(item, trimText, [...path, key]),
    ])
  );
}

const AGENT_TOOL_NAMES = ["Agent", "Task"];
const OTHER_TRIMMED_TOOL_NAMES = [
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "BashOutput",
  "TaskOutput",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
];

function limitsFor(toolName: string): TrimLimits | null {
  if (SHELL_TOOL_NAMES.includes(toolName)) return SHELL_LIMITS;
  if (AGENT_TOOL_NAMES.includes(toolName))
    return { ...MCP_LIMITS, maxCharacters: 4_000 };
  if (OTHER_TRIMMED_TOOL_NAMES.includes(toolName)) return MCP_LIMITS;
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
    const lineTrimmed = trimLines(text.split("\n"), limits, path)
      .map((line) => clip(line, limits.maxLineChars))
      .join("\n");
    const hiddenHere = hiddenIn(lineTrimmed);
    const trimmedText = capCharacters(lineTrimmed, limits.maxCharacters, path);
    if (trimmedText !== text) savedOutputs.push({ path, text });
    hiddenLines += hiddenHere;
    return trimmedText;
  };
  const trimmed = trimEachText(response, trimText);
  if (savedOutputs.length === 0) return null;
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
