import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "./read-guard.ts";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "rg-"));
const big = join(fixtureDirectory, "big.txt");
const small = join(fixtureDirectory, "small.txt");
writeFileSync(big, "x\n".repeat(301));
writeFileSync(small, "x\n".repeat(300));

const cappedRead = (toolInput: Record<string, unknown>, toolName = "Read") =>
  (decide({ tool_name: toolName, tool_input: toolInput }) as any).output
    .hookSpecificOutput;

test("caps a big file without limit at 300 lines instead of denying", () => {
  const decision = cappedRead({ file_path: big });
  expect(decision.updatedInput).toEqual({ file_path: big, limit: 300 });
  expect(decision.permissionDecision).toBeUndefined();
  expect(decision.additionalContext).toContain("has 301 lines");
  expect(decision.additionalContext).toContain("from line 1");
});
test("allows a big file with limit 300", () =>
  expect(decide({ tool_input: { file_path: big, limit: 300 } })).toBeNull());
test("caps limit 301 and keeps the offset", () => {
  const decision = cappedRead({ file_path: big, offset: 20, limit: 301 });
  expect(decision.updatedInput).toEqual({
    file_path: big,
    offset: 20,
    limit: 300,
  });
  expect(decision.additionalContext).toContain("from line 20");
});
test("allows a 300-line file", () =>
  expect(decide({ tool_input: { file_path: small } })).toBeNull());
test("allows a missing file", () =>
  expect(
    decide({ tool_input: { file_path: join(fixtureDirectory, "no") } })
  ).toBeNull());
test("the cap message never points at the denied Grep tool", () =>
  expect(
    JSON.stringify(decide({ tool_input: { file_path: big } }))
  ).not.toMatch(/Glob|Grep/));

const wide = join(fixtureDirectory, "wide.json");
const binary = join(fixtureDirectory, "blob.bin");
writeFileSync(wide, "x".repeat(6_000_000));
writeFileSync(binary, Buffer.alloc(6_000_000));

test("denies a few-line file over the byte limit", () =>
  expect(JSON.stringify(decide({ tool_input: { file_path: wide } }))).toContain(
    "is 6 MB"
  ));
test("allows the over-limit text file with a limit", () =>
  expect(decide({ tool_input: { file_path: wide, limit: 100 } })).toBeNull());
test("allows a large binary file", () =>
  expect(decide({ tool_input: { file_path: binary } })).toBeNull());

test("Qwen Code's read tool is denied, since only Claude Code applies a rewritten input", () => {
  const decision = cappedRead({ file_path: big }, "read_file");
  expect(decision.permissionDecision).toBe("deny");
  expect(decision.permissionDecisionReason).toContain("has 301 lines");
});

test("under a hook bridge a big file is denied", () => {
  process.env.CLAUDE_KIT_HOOK_BRIDGE = "1";
  try {
    expect(cappedRead({ file_path: big }).permissionDecision).toBe("deny");
  } finally {
    delete process.env.CLAUDE_KIT_HOOK_BRIDGE;
  }
});
