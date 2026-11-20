import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, pruneSavedOutputs } from "./bash-trim.ts";

const EIGHT_DAYS_MILLISECONDS = 8 * 24 * 60 * 60 * 1000;

test("pruneSavedOutputs deletes saved outputs older than seven days", () => {
  const folder = mkdtempSync(join(tmpdir(), "guards-prune-"));
  const oldOutputPath = join(folder, "old-output.txt");
  const freshOutputPath = join(folder, "fresh-output.txt");
  writeFileSync(oldOutputPath, "old");
  writeFileSync(freshOutputPath, "fresh");
  const eightDaysAgo = new Date(Date.now() - EIGHT_DAYS_MILLISECONDS);
  utimesSync(oldOutputPath, eightDaysAgo, eightDaysAgo);
  pruneSavedOutputs(folder);
  expect(existsSync(oldOutputPath)).toBe(false);
  expect(existsSync(freshOutputPath)).toBe(true);
});

test("pruneSavedOutputs ignores a missing folder", () => {
  const missingFolder = join(tmpdir(), "guards-prune-missing-folder");
  expect(() => pruneSavedOutputs(missingFolder)).not.toThrow();
});

const run = (stdout: string) =>
  decide({
    tool_name: "Bash",
    tool_response: { stdout, stderr: "", interrupted: false, isImage: false },
  }) as any;

test("short output untouched", () => expect(run("a\nb")).toBeNull());

test("long output keeps head, tail, errors and Bash shape", () => {
  const lines = Array.from({ length: 400 }, (_unused, i) =>
    i === 200 ? "boom error here" : `line ${i}`
  );
  const trimmedOutput = run(lines.join("\n")).output.hookSpecificOutput
    .updatedToolOutput;
  expect(Object.keys(trimmedOutput)).toEqual([
    "stdout",
    "stderr",
    "interrupted",
    "isImage",
  ]);
  expect(trimmedOutput.stdout).toContain("line 0");
  expect(trimmedOutput.stdout).toContain("line 399");
  expect(trimmedOutput.stdout).toContain("boom error here");
  expect(trimmedOutput.stdout).toContain("bash-trim:");
  expect(trimmedOutput.stdout).not.toContain("line 100\n");
});

test("long output reports how many lines were hidden", () => {
  const lines = Array.from({ length: 400 }, (_unused, i) => `line ${i}`);
  expect(run(lines.join("\n")).hiddenLines).toBe(310);
});

test("long lines are clipped", () => {
  const trimmedOutput = run("x".repeat(1000)).output.hookSpecificOutput
    .updatedToolOutput;
  expect(trimmedOutput.stdout).toContain("600 chars hidden");
});

test("trimText stays internal to the hook", async () => {
  expect(Object.keys(await import("./bash-trim.ts"))).not.toContain("trimText");
});

const runQwen = (output: string) =>
  decide({
    tool_name: "run_shell_command",
    tool_input: { command: "pytest" },
    tool_response: { llmContent: output, returnDisplay: output },
  }) as any;

test("Qwen Code shell output is trimmed in llmContent and returnDisplay", () => {
  const lines = Array.from({ length: 400 }, (_unused, i) => `line ${i}`);
  const trimmedOutput = runQwen(lines.join("\n")).output.hookSpecificOutput
    .updatedToolOutput;
  expect(trimmedOutput.llmContent).toContain("bash-trim:");
  expect(trimmedOutput.llmContent).toContain("line 399");
  expect(trimmedOutput.returnDisplay).toContain("bash-trim:");
});

test("Qwen Code short shell output untouched", () =>
  expect(runQwen("a\nb")).toBeNull());

const numberedLines = (count: number) =>
  Array.from({ length: count }, (_unused, i) => `line ${i}`).join("\n");

test("the marker names a file that holds the full output", () => {
  const fullOutput = numberedLines(400);
  const result = decide(
    {
      tool_name: "Bash",
      session_id: "session-1",
      tool_use_id: "toolu_9",
      tool_response: { stdout: fullOutput, stderr: "" },
    },
    "/saved"
  ) as any;
  expect(result.savedOutputs).toEqual([
    { path: "/saved/session-1-toolu_9-stdout.txt", text: fullOutput },
  ]);
  expect(result.output.hookSpecificOutput.updatedToolOutput.stdout).toContain(
    "full output in /saved/session-1-toolu_9-stdout.txt"
  );
});

const runMcp = (toolResponse: unknown) =>
  decide(
    { tool_name: "mcp__context7__query-docs", tool_response: toolResponse },
    "/saved"
  ) as any;

test("an MCP text result over 300 lines keeps its head and tail", () => {
  const result = runMcp(numberedLines(500));
  const trimmedText = result.output.hookSpecificOutput.updatedToolOutput;
  expect(trimmedText).toContain("line 0\n");
  expect(trimmedText).toContain("line 199\n");
  expect(trimmedText).toContain("line 499");
  expect(trimmedText).not.toContain("line 250\n");
  expect(trimmedText).toContain("full output in /saved/");
  expect(result.hiddenLines).toBe(240);
});

test("an MCP result of text blocks is trimmed block by block and keeps other blocks", () => {
  const imageBlock = { type: "image", data: "abc" };
  const result = runMcp([
    { type: "text", text: numberedLines(500) },
    imageBlock,
    { type: "text", text: "short" },
  ]);
  const blocks = result.output.hookSpecificOutput.updatedToolOutput;
  expect(blocks[0].text).toContain("bash-trim:");
  expect(blocks[1]).toEqual(imageBlock);
  expect(blocks[2]).toEqual({ type: "text", text: "short" });
});

test("an MCP result of 300 lines is untouched", () =>
  expect(runMcp(numberedLines(300))).toBeNull());

test("a long MCP line is not clipped, since it may be JSON", () =>
  expect(runMcp("x".repeat(5000))).toBeNull());

test("GUARDS_MCP_TRIM=0 leaves MCP results alone", () => {
  process.env.GUARDS_MCP_TRIM = "0";
  try {
    expect(runMcp(numberedLines(500))).toBeNull();
  } finally {
    delete process.env.GUARDS_MCP_TRIM;
  }
});

test("other tools are untouched", () =>
  expect(
    decide({ tool_name: "Read", tool_response: numberedLines(500) })
  ).toBeNull());
