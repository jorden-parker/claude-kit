import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

test("shell output stays within 80 lines with no repeated lines", () => {
  const stdoutFor = (count: number) =>
    run(
      Array.from({ length: count }, (_unused, i) => `line ${i}`).join("\n")
    ).output.hookSpecificOutput.updatedToolOutput.stdout.split("\n");
  const mid = stdoutFor(85);
  expect(mid.length).toBeLessThanOrEqual(80);
  expect(new Set(mid).size).toBe(mid.length);
  expect(stdoutFor(400).length).toBeLessThanOrEqual(80);
});

test("long output reports how many lines were hidden", () => {
  const lines = Array.from({ length: 400 }, (_unused, i) => `line ${i}`);
  expect(run(lines.join("\n")).hiddenLines).toBe(340);
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

test("an MCP result of one 50,000-character line is replaced and capped", () => {
  const fullText = `start${"x".repeat(49_992)}end`;
  const result = runMcp(fullText);
  const trimmedText: string =
    result.output.hookSpecificOutput.updatedToolOutput;
  expect(trimmedText.length).toBeLessThanOrEqual(8_500);
  expect(trimmedText.startsWith("start")).toBe(true);
  expect(trimmedText.endsWith("end")).toBe(true);
  expect(trimmedText).toContain(
    "full output in /saved/session-output-text.txt"
  );
  expect(result.savedOutputs).toEqual([
    { path: "/saved/session-output-text.txt", text: fullText },
  ]);
});

test("a Bash result of 100 lines of 300 characters is replaced and capped", () => {
  const fullText = Array.from({ length: 100 }, () => "y".repeat(300)).join(
    "\n"
  );
  const trimmedText =
    run(fullText).output.hookSpecificOutput.updatedToolOutput.stdout;
  expect(trimmedText.length).toBeLessThanOrEqual(6_500);
  expect(trimmedText).toContain("bash-trim:");
});

test("a Bash result of 15 lines of 250 characters is untouched", () => {
  const fullText = Array.from({ length: 15 }, () => "z".repeat(250)).join("\n");
  expect(run(fullText)).toBeNull();
});

test("GUARDS_MCP_TRIM=0 leaves a 50,000-character MCP line alone", () => {
  process.env.GUARDS_MCP_TRIM = "0";
  try {
    expect(runMcp("x".repeat(50_000))).toBeNull();
  } finally {
    delete process.env.GUARDS_MCP_TRIM;
  }
});

const shapes = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/tool-responses.json"), "utf8")
);
const big = (count: number) => numberedLines(count);
const trimmedBy = (toolName: string, toolResponse: unknown) =>
  (
    decide(
      { tool_name: toolName, tool_response: toolResponse },
      "/saved"
    ) as any
  )?.output.hookSpecificOutput.updatedToolOutput;

test("Grep content is trimmed and the counters are kept", () => {
  const out = trimmedBy("Grep", { ...shapes.Grep, content: big(500) });
  expect(out.content).toContain("bash-trim:");
  expect(out.numLines).toBe(shapes.Grep.numLines);
  expect(out.filenames).toEqual(shapes.Grep.filenames);
});

test("Glob with a long filename list is trimmed inside the array", () => {
  const filenames = Array.from({ length: 3 }, () => "p".repeat(9_000));
  const out = trimmedBy("Glob", { ...shapes.Glob, filenames });
  expect(out.filenames[0].length).toBeLessThan(8_600);
  expect(trimmedBy("Glob", shapes.Glob)).toBeUndefined();
});

test("WebSearch text deep inside results is trimmed", () => {
  const response = structuredClone(shapes.WebSearch);
  response.results[0].content[0].title = big(500);
  const out = trimmedBy("WebSearch", response);
  expect(out.results[0].content[0].title).toContain("bash-trim:");
  expect(out.results[0].content[1]).toEqual(
    shapes.WebSearch.results[0].content[1]
  );
});

test("WebFetch result text is trimmed", () => {
  const out = trimmedBy("WebFetch", { ...shapes.WebFetch, result: big(500) });
  expect(out.result).toContain("bash-trim:");
  expect(out.url).toBe(shapes.WebFetch.url);
});

test("the captured context7 shape is trimmed block by block", () => {
  const blocks = [
    { ...shapes["mcp__context7__resolve-library-id"][0], text: big(500) },
  ];
  const out = trimmedBy("mcp__context7__resolve-library-id", blocks);
  expect(out[0].text).toContain("bash-trim:");
});

test("Agent and Task use a 4,000-character cap, other tools 8,000", () => {
  const text = "q".repeat(6_000);
  const agent = { ...shapes.Agent, handbackReport: { text } };
  for (const name of ["Agent", "Task"])
    expect(trimmedBy(name, agent).handbackReport.text.length).toBeLessThan(
      4_500
    );
  expect(trimmedBy("Grep", { ...shapes.Grep, content: text })).toBeUndefined();
});

test("the captured Agent shape is untouched", () =>
  expect(trimmedBy("Agent", shapes.Agent)).toBeUndefined());

test("image objects, image and audio blocks and data keys are skipped", () => {
  const huge = big(500);
  const response = {
    stdout: "ok",
    isImage: true,
    note: huge,
  };
  expect(trimmedBy("Bash", response)).toBeUndefined();
  const blocks = [
    { type: "image", text: huge },
    { type: "audio", text: huge },
    { type: "text", data: huge, blob: huge, base64: huge },
  ];
  expect(trimmedBy("mcp__x__y", blocks)).toBeUndefined();
});

test("newly matched tools are trimmed and Skill, ToolSearch, Read are not", () => {
  for (const name of [
    "BashOutput",
    "TaskOutput",
    "ListMcpResourcesTool",
    "ReadMcpResourceTool",
  ])
    expect(trimmedBy(name, big(500))).toContain("bash-trim:");
  for (const name of ["Skill", "ToolSearch", "Read", "Edit"])
    expect(trimmedBy(name, big(500))).toBeUndefined();
});

test("GUARDS_MCP_TRIM=0 leaves Grep trimming on", () => {
  process.env.GUARDS_MCP_TRIM = "0";
  try {
    expect(trimmedBy("Grep", big(500))).toContain("bash-trim:");
  } finally {
    delete process.env.GUARDS_MCP_TRIM;
  }
});

test("hooks.json matches the capped tools and never the uncapped ones", () => {
  const hooks = JSON.parse(
    readFileSync(join(import.meta.dir, "hooks.json"), "utf8")
  );
  const matcher = hooks.hooks.PostToolUse[0].matcher;
  expect(matcher).toBe(
    "Bash|mcp__.*|Grep|Glob|WebFetch|WebSearch|Agent|Task|BashOutput|TaskOutput|ListMcpResourcesTool|ReadMcpResourceTool"
  );
});
