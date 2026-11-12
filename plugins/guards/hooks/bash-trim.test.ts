import { expect, test } from "bun:test";
import { decide } from "./bash-trim.ts";

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
