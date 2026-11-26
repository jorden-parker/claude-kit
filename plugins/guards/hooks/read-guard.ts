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

const DEFAULT_LINES = 150;
const MAX_LIMIT_LINES = 300;
const LONG_LINE_MIN_BYTES = 20_000;
const LONG_LINE_MAX_NEWLINES = 20;
const MAX_BYTES = 5_000_000;
const BINARY_PROBE_BYTES = 8192;

function probe(path: string): { binary: boolean; longLines: boolean } {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(BINARY_PROBE_BYTES);
    const head = buffer.subarray(
      0,
      readSync(descriptor, buffer, 0, BINARY_PROBE_BYTES, 0)
    );
    const newlines = head.filter((byte) => byte === 10).length;
    return {
      binary: head.includes(0),
      longLines:
        statSync(path).size > LONG_LINE_MIN_BYTES &&
        newlines < LONG_LINE_MAX_NEWLINES,
    };
  } finally {
    closeSync(descriptor);
  }
}

function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  return text.split("\n").length - (text.endsWith("\n") || !text ? 1 : 0);
}

type Oversize = { megabytes?: number; lines?: number; longLines?: boolean };

function oversize(path: string, hasLimit: boolean): Oversize {
  if (!path || !existsSync(path)) return {};
  try {
    const { binary, longLines } = probe(path);
    if (binary) return {};
    if (longLines) return { longLines };
    if (hasLimit) return {};
    const bytes = statSync(path).size;
    if (bytes > MAX_BYTES) return { megabytes: Math.round(bytes / 1_000_000) };
    const lines = lineCount(path);
    return lines > DEFAULT_LINES ? { lines } : {};
  } catch {
    return {};
  }
}

export function decide(event: HookEvent): HookResult {
  const input = event.tool_input ?? {};
  const limit = input.limit;
  const hasLimit =
    Number.isInteger(limit) && limit > 0 && limit <= MAX_LIMIT_LINES;
  const { megabytes, lines, longLines } = oversize(
    input.file_path ?? "",
    hasLimit
  );
  if (longLines)
    return deny(
      `${input.file_path} has very long lines (likely minified). Read it in slices with Bash: head -c 3600 FILE | fold -w 200, then tail -c +3601 FILE | head -c 3600 | fold -w 200 for the next slice, or grep -o for the part you need.`
    );
  if (!megabytes && !lines) return null;
  if (megabytes || !canRewriteInput(event))
    return deny(
      `${input.file_path} ${megabytes ? `is ${megabytes} MB` : `has ${lines} lines`}. git grep -n for the lines you need first, then Read again with offset and limit (limit ${MAX_LIMIT_LINES} or less).`
    );
  return rewriteInput(
    { ...input, limit: DEFAULT_LINES },
    `${input.file_path} has ${lines} lines; read-guard capped this Read at ${DEFAULT_LINES} lines from line ${input.offset ?? 1}. Read again with offset for the rest, or git grep -n for the lines you need.`
  );
}
