import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideDelegation,
  decideDelegationFromTranscript,
} from "./delegate-guard.ts";
import type { HookEvent, HookResult } from "./types.ts";

const LIMIT = 40_000;

const mainEvent = (
  toolName: string,
  toolInput: Record<string, unknown>
): HookEvent => ({
  permission_mode: "default",
  tool_name: toolName,
  tool_input: toolInput,
});
const readEvent = mainEvent("Read", { file_path: "/a.ts" });
const bashEvent = (command: string) => mainEvent("Bash", { command });

const transcript = (...lines: string[]) => lines.join("\n");
const userPrompt = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, type: "user", message: { content: text } });
const toolUseLine = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) =>
  JSON.stringify({
    ...extra,
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const toolResultLine = (
  toolUseId: string,
  content: unknown,
  extra: Record<string, unknown> = {}
) =>
  JSON.stringify({
    ...extra,
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  });
const resultPair = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  size: number,
  extra: Record<string, unknown> = {}
) => [
  toolUseLine(id, name, input, extra),
  toolResultLine(id, "x".repeat(size), extra),
];
const readPair = (id: string, size: number, extra = {}) =>
  resultPair(id, "Read", { file_path: "/a.ts" }, size, extra);
const overBudget = transcript(...readPair("r1", LIMIT));

const isDenied = (result: HookResult) =>
  result !== null && result.output !== undefined;
const reasonOf = (result: HookResult) =>
  (
    result?.output as {
      hookSpecificOutput: { permissionDecisionReason: string };
    }
  ).hookSpecificOutput.permissionDecisionReason;

test("allows a Read when the transcript is empty", () => {
  expect(decideDelegation(readEvent, "")).toBeNull();
});

test("denies a Read after lookups reached the budget", () => {
  const result = decideDelegation(readEvent, overBudget);
  expect(isDenied(result)).toBe(true);
  expect(reasonOf(result)).toContain("guards:context-scout");
  expect(reasonOf(result)).toContain("Haiku");
  expect(reasonOf(result)).toContain("40000");
});

test("allows a Read one character under the budget", () => {
  const underBudget = transcript(...readPair("r1", LIMIT - 1));
  expect(decideDelegation(readEvent, underBudget)).toBeNull();
});

test("sums several lookup results toward the budget", () => {
  const split = transcript(
    ...readPair("r1", 20_000),
    ...readPair("r2", 20_000)
  );
  expect(isDenied(decideDelegation(readEvent, split))).toBe(true);
});

test("does not count results of non-lookup tools", () => {
  const others = transcript(
    ...resultPair("b1", "Bash", { command: "pnpm test" }, 50_000),
    ...resultPair("e1", "Edit", { file_path: "/a.ts" }, 50_000)
  );
  expect(decideDelegation(readEvent, others)).toBeNull();
});

test("counts a Bash lookup result and denies a pending Bash cat", () => {
  const grep = transcript(
    ...resultPair("g1", "Bash", { command: "git grep -n foo" }, LIMIT)
  );
  expect(isDenied(decideDelegation(bashEvent("cat a.ts"), grep))).toBe(true);
});

test.each([
  "pnpm test | tail -20",
  'git commit -m "fix; cat it"',
  "git status",
  "lsof -i :3000",
  "echo hi | cat",
  "git commit -m \"$(cat <<'EOF'\nfind the bug\n\ngrep for it\nEOF\n)\"",
  "cat > notes.txt <<EOF\nls\nEOF",
])("never denies the non-lookup command %s over budget", (command) => {
  expect(decideDelegation(bashEvent(command), overBudget)).toBeNull();
});

test("never denies a non-lookup tool over budget", () => {
  expect(
    decideDelegation(mainEvent("Edit", { file_path: "/a.ts" }), overBudget)
  ).toBeNull();
});

test.each([
  "cd src && cat a.ts",
  "cd src || cat a.ts",
  "cd src; rg foo",
  "FOO=1 grep foo a.ts",
  "sed -n 1,20p a.ts",
  "git log --oneline",
  "git --no-pager log -n 5",
  "git -C plugins diff --stat",
])("denies the lookup command %s over budget", (command) => {
  expect(isDenied(decideDelegation(bashEvent(command), overBudget))).toBe(true);
});

test("allows a Read after a delegation resets the budget", () => {
  const delegated = transcript(
    ...readPair("r1", LIMIT),
    toolUseLine("a1", "Agent", {
      subagent_type: "guards:context-scout",
      prompt: "find it",
    })
  );
  expect(decideDelegation(readEvent, delegated)).toBeNull();
});

test("allows a Read after a new user prompt resets the budget", () => {
  const next = transcript(
    ...readPair("r1", LIMIT),
    userPrompt("next question")
  );
  expect(decideDelegation(readEvent, next)).toBeNull();
});

test("keeps the budget after a meta user line", () => {
  const meta = transcript(
    ...readPair("r1", LIMIT),
    userPrompt("<command-meta>", { isMeta: true })
  );
  expect(isDenied(decideDelegation(readEvent, meta))).toBe(true);
});

test("keeps the budget after a tool result line", () => {
  const result = transcript(
    ...readPair("r1", LIMIT),
    toolResultLine("b1", "ok")
  );
  expect(isDenied(decideDelegation(readEvent, result))).toBe(true);
});

test("ignores sidechain lines", () => {
  const sidechain = transcript(...readPair("r1", LIMIT, { isSidechain: true }));
  expect(decideDelegation(readEvent, sidechain)).toBeNull();
});

test("allows everything inside a subagent", () => {
  expect(
    decideDelegation({ ...readEvent, agent_id: "abc" }, overBudget)
  ).toBeNull();
});

test("allows everything when permission_mode is missing", () => {
  expect(
    decideDelegation(
      { tool_name: "Read", tool_input: { file_path: "/a.ts" } },
      overBudget
    )
  ).toBeNull();
});

test("allows everything when GUARDS_DELEGATE_GUARD is 0", () => {
  process.env.GUARDS_DELEGATE_GUARD = "0";
  try {
    expect(decideDelegation(readEvent, overBudget)).toBeNull();
  } finally {
    delete process.env.GUARDS_DELEGATE_GUARD;
  }
});

test("denies an Explore agent without a model", () => {
  const event = mainEvent("Agent", {
    subagent_type: "Explore",
    prompt: "x",
  });
  expect(isDenied(decideDelegation(event, ""))).toBe(true);
});

test("denies an Explore agent on sonnet", () => {
  const event = mainEvent("Agent", {
    subagent_type: "Explore",
    model: "sonnet",
  });
  expect(isDenied(decideDelegation(event, ""))).toBe(true);
});

test("denies an Explore task on sonnet", () => {
  const event = mainEvent("Task", {
    subagent_type: "Explore",
    model: "sonnet",
  });
  expect(isDenied(decideDelegation(event, ""))).toBe(true);
});

test("allows an Explore agent on haiku", () => {
  const event = mainEvent("Agent", {
    subagent_type: "Explore",
    model: "haiku",
  });
  expect(decideDelegation(event, "")).toBeNull();
});

test("allows the context-scout agent", () => {
  const event = mainEvent("Agent", {
    subagent_type: "guards:context-scout",
  });
  expect(decideDelegation(event, "")).toBeNull();
});

test("allows other agents even over budget", () => {
  const event = mainEvent("Agent", { subagent_type: "general-purpose" });
  expect(decideDelegation(event, overBudget)).toBeNull();
});

test("allows an Explore agent inside a subagent", () => {
  const event = {
    ...mainEvent("Agent", { subagent_type: "Explore" }),
    agent_id: "abc",
  };
  expect(decideDelegation(event, "")).toBeNull();
});

test("counts tool result content given as text blocks", () => {
  const blocks = transcript(
    toolUseLine("r1", "Read", { file_path: "/a.ts" }),
    toolResultLine("r1", [{ type: "text", text: "x".repeat(LIMIT) }])
  );
  expect(isDenied(decideDelegation(readEvent, blocks))).toBe(true);
});

test("decideDelegationFromTranscript reads the transcript file and denies over budget", () => {
  const directory = mkdtempSync(join(tmpdir(), "delegate-guard-"));
  const transcriptPath = join(directory, "transcript.jsonl");
  writeFileSync(transcriptPath, overBudget);
  const result = decideDelegationFromTranscript({
    ...readEvent,
    transcript_path: transcriptPath,
  });
  expect(isDenied(result)).toBe(true);
});

test("decideDelegationFromTranscript allows when transcript_path is missing", () => {
  expect(decideDelegationFromTranscript(readEvent)).toBeNull();
});
