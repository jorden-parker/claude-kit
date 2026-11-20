import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideFromReply, decideFromTranscript } from "./self-check.ts";

const assistantText = (...texts: string[]) =>
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: texts.map((text) => ({ type: "text", text })),
    },
  });
const assistantTool = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", name, input }],
    },
  });
const userText = JSON.stringify({
  type: "user",
  message: { role: "user", content: "fix it" },
});
const stop = { hook_event_name: "Stop" };
const blocks = (lines: string[]) =>
  decideFromReply(stop, lines.join("\n"))?.exitCode === 2;

afterEach(() => {
  delete process.env.GUARDS_SELF_CHECK;
});

test("blocks a reply that asks the user to run tests", () =>
  expect(
    blocks([assistantText("Next: run `bun test` and paste the first failure.")])
  ).toBe(true));

test("passes a reply that reports a check result", () =>
  expect(blocks([assistantText("Tests pass: 12 of 12.")])).toBe(false));

test("passes a reply that gives the user a ! command for a login", () =>
  expect(
    blocks([assistantText("Next: run `! gcloud auth login` to sign in.")])
  ).toBe(false));

test("passes when stop_hook_active is true", () =>
  expect(
    decideFromReply(
      { ...stop, stop_hook_active: true },
      assistantText("Next: run `bun test` and paste the first failure.")
    )
  ).toBeNull());

test("passes when GUARDS_SELF_CHECK is 0", () => {
  process.env.GUARDS_SELF_CHECK = "0";
  expect(
    blocks([assistantText("Next: run `bun test` and paste the first failure.")])
  ).toBe(false);
});

test("an earlier reply asking to run tests does not block a plain last reply", () =>
  expect(
    blocks([
      assistantText("Next: run `bun test` and paste the first failure."),
      userText,
      assistantText("Tests pass: 12 of 12."),
    ])
  ).toBe(false));

test("skips a later tool-only line and reads the last reply with text", () =>
  expect(
    blocks([
      assistantText("Tests pass: 12 of 12."),
      assistantTool("Bash", { command: "bun test" }),
    ])
  ).toBe(false));

test("names the rule in the reason", () =>
  expect(
    decideFromReply(
      stop,
      assistantText("Next: run `bun test` and paste the first failure.")
    )?.stderr
  ).toContain("Run it yourself, or send it to guards:worker"));

test("ignores unparseable transcript lines", () =>
  expect(
    blocks([
      "not json",
      assistantText("Next: run `bun test` and paste the first failure."),
    ])
  ).toBe(true));

test("decideFromTranscript reads the last reply from a transcript file", () => {
  const transcriptPath = join(
    mkdtempSync(join(tmpdir(), "sc-")),
    "session.jsonl"
  );
  writeFileSync(
    transcriptPath,
    [assistantText("Next: run `bun test` and paste the first failure.")].join(
      "\n"
    )
  );
  expect(
    decideFromTranscript({ ...stop, transcript_path: transcriptPath })?.exitCode
  ).toBe(2);
});
