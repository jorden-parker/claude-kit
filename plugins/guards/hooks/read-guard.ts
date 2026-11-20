import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import {
  canRewriteInput,
  deny,
  rewriteInput,
  type HookEvent,
  type HookResult,
} from "./types.ts";

const MAX_LINES = 300;
const MAX_BYTES = 5_000_000;
const BINARY_PROBE_BYTES = 8192;

function isBinary(path: string): boolean {
  const descriptor = openSync(path, "r");
  try {
    const probe = Buffer.alloc(BINARY_PROBE_BYTES);
    return probe
      .subarray(0, readSync(descriptor, probe, 0, BINARY_PROBE_BYTES, 0))
      .includes(0);
  } finally {
    closeSync(descriptor);
  }
}

function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") || !text ? 1 : 0);
}

type Oversize = { megabytes?: number; lines?: number };

function oversize(path: string): Oversize {
  if (!path || !existsSync(path)) return {};
  try {
    if (isBinary(path)) return {};
    const bytes = statSync(path).size;
    if (bytes > MAX_BYTES) return { megabytes: Math.round(bytes / 1_000_000) };
    const lines = lineCount(path);
    return lines > MAX_LINES ? { lines } : {};
  } catch {
    return {};
  }
}

export function decide(event: HookEvent): HookResult {
  const input = event.tool_input ?? {};
  const limit = input.limit;
  if (Number.isInteger(limit) && limit > 0 && limit <= MAX_LINES) return null;
  const { megabytes, lines } = oversize(input.file_path ?? "");
  if (!megabytes && !lines) return null;
  if (megabytes || !canRewriteInput(event))
    return deny(
      `${input.file_path} ${megabytes ? `is ${megabytes} MB` : `has ${lines} lines`}. git grep -n for the lines you need first, then Read again with offset and limit (limit ${MAX_LINES} or less).`
    );
  return rewriteInput(
    { ...input, limit: MAX_LINES },
    `${input.file_path} has ${lines} lines; read-guard capped this Read at ${MAX_LINES} lines from line ${input.offset ?? 1}. Read again with offset for the rest, or git grep -n for the lines you need.`
  );
}
