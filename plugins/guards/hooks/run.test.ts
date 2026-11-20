import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deny } from "./types.ts";
import { hookLogPath, logLine } from "./run.ts";

const now = new Date("2026-01-02T03:04:05.000Z");

test("logLine is null when the hook produced no result", () => {
  expect(logLine("bash-guard", {}, null, now)).toBeNull();
});

test("logLine records a deny result as one JSON line", () => {
  const event = { hook_event_name: "PreToolUse", tool_name: "Bash" };
  const line = logLine("bash-guard", event, deny("no"), now) as string;
  expect(line).not.toContain("\n");
  const parsed = JSON.parse(line);
  expect(parsed).toMatchObject({
    time: "2026-01-02T03:04:05.000Z",
    hook: "bash-guard",
    event: "PreToolUse",
    tool: "Bash",
  });
  expect(parsed).toMatchObject({ decision: "deny", reason: "no" });
});

test("logLine leaves out bash-trim's trimmed output", () => {
  const result = {
    output: {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: "secret stdout",
      },
    },
  };
  const line = logLine(
    "bash-trim",
    { tool_name: "Bash" },
    result,
    now
  ) as string;
  expect(line).not.toContain("secret stdout");
  expect(line.length).toBeLessThan(200);
});

test("logLine keeps exit code and stderr", () => {
  const parsed = JSON.parse(
    logLine("edit-check", {}, { exitCode: 2, stderr: "bad" }, now) as string
  );
  expect(parsed).toMatchObject({ exitCode: 2, stderr: "bad" });
});

test("hookLogPath lives under the guards cache", () => {
  expect(hookLogPath("/u")).toBe("/u/.cache/guards/hooks.log");
});

test("a crashing hook exits 0 and logs the crash", () => {
  const userHome = mkdtempSync(join(tmpdir(), "crash-"));
  const event = {
    hook_event_name: "Stop",
    transcript_path: join(userHome, "missing.jsonl"),
  };
  const result = Bun.spawnSync(
    ["bun", join(import.meta.dir, "run.ts"), "browser-check"],
    {
      stdin: Buffer.from(JSON.stringify(event)),
      env: { ...process.env, HOME: userHome },
    }
  );
  expect(result.exitCode).toBe(0);
  const logged = JSON.parse(readFileSync(hookLogPath(userHome), "utf8").trim());
  expect(logged).toMatchObject({ hook: "browser-check", event: "Stop" });
  expect(logged.crashed).toContain("missing.jsonl");
});

test("logLine records the session and the lines bash-trim hid", () => {
  const event = { tool_name: "Bash", session_id: "session-1" };
  const parsed = JSON.parse(
    logLine("bash-trim", event, { hiddenLines: 42 }, now) as string
  );
  expect(parsed).toMatchObject({ session: "session-1", hiddenLines: 42 });
});

test("bash-trim saves the full output where its marker says", () => {
  const temporaryFolder = mkdtempSync(join(tmpdir(), "spill-"));
  const fullOutput = Array.from(
    { length: 400 },
    (_unused, i) => `line ${i}`
  ).join("\n");
  const event = {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    session_id: "session-1",
    tool_use_id: "toolu_1",
    tool_response: { stdout: fullOutput, stderr: "" },
  };
  const result = Bun.spawnSync(
    ["bun", join(import.meta.dir, "run.ts"), "bash-trim"],
    {
      stdin: Buffer.from(JSON.stringify(event)),
      env: { ...process.env, HOME: temporaryFolder, TMPDIR: temporaryFolder },
    }
  );
  const trimmedOutput: string = JSON.parse(result.stdout.toString())
    .hookSpecificOutput.updatedToolOutput.stdout;
  const savedPath = /full output in (\S+):/.exec(trimmedOutput)?.[1] ?? "";
  expect(readFileSync(savedPath, "utf8")).toBe(fullOutput);
});

test("bash-trim deletes saved outputs older than seven days", () => {
  const temporaryFolder = mkdtempSync(join(tmpdir(), "spill-"));
  const oldOutputPath = join(temporaryFolder, "guards-output", "old.txt");
  mkdirSync(dirname(oldOutputPath), { recursive: true });
  writeFileSync(oldOutputPath, "old");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(oldOutputPath, eightDaysAgo, eightDaysAgo);
  const fullOutput = Array.from(
    { length: 400 },
    (_unused, i) => `line ${i}`
  ).join("\n");
  const event = {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    session_id: "session-1",
    tool_use_id: "toolu_2",
    tool_response: { stdout: fullOutput, stderr: "" },
  };
  Bun.spawnSync(["bun", join(import.meta.dir, "run.ts"), "bash-trim"], {
    stdin: Buffer.from(JSON.stringify(event)),
    env: { ...process.env, HOME: temporaryFolder, TMPDIR: temporaryFolder },
  });
  expect(existsSync(oldOutputPath)).toBe(false);
});
