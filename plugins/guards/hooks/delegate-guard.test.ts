import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideDelegation,
  decideDelegationFromTranscript,
} from "./delegate-guard.ts";
import type { HookEvent, HookResult } from "./types.ts";

const LIMIT = 20_000;
const SCOUT_PROMPT_LIMIT = 1_500;

const mainEvent = (
  toolName: string,
  toolInput: Record<string, unknown>
): HookEvent => ({
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

const specificOf = (result: HookResult) =>
  (
    result?.output as
      { hookSpecificOutput: Record<string, string | undefined> } | undefined
  )?.hookSpecificOutput;
const isDenied = (result: HookResult) =>
  specificOf(result)?.permissionDecision === "deny";
const WARNING_LINE = 10_000;
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
  expect(reasonOf(result)).toContain("20000");
});

test("allows a Read one character under the budget", () => {
  const underBudget = transcript(...readPair("r1", LIMIT - 1));
  expect(isDenied(decideDelegation(readEvent, underBudget))).toBe(false);
});

test("warns, without denying, once lookups reach three quarters of the budget", () => {
  const nearBudget = transcript(...readPair("r1", WARNING_LINE));
  const result = decideDelegation(readEvent, nearBudget);
  expect(isDenied(result)).toBe(false);
  expect(specificOf(result)?.additionalContext).toContain("10000 of 20000");
  expect(specificOf(result)?.additionalContext).toContain(
    "guards:context-scout"
  );
});

test("stays silent one character under the warning line", () => {
  const farFromBudget = transcript(...readPair("r1", WARNING_LINE - 1));
  expect(decideDelegation(readEvent, farFromBudget)).toBeNull();
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
    decideDelegation(mainEvent("TodoWrite", { todos: [] }), overBudget)
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

test("allows a Read after a delegation to any agent on haiku", () => {
  const delegated = transcript(
    ...readPair("r1", LIMIT),
    toolUseLine("a1", "Agent", { subagent_type: "Explore", model: "haiku" })
  );
  expect(decideDelegation(readEvent, delegated)).toBeNull();
});

test.each([
  { subagent_type: "general-purpose" },
  { subagent_type: "general-purpose", model: "sonnet" },
  {},
])("keeps the budget after a delegation that is not on Haiku: %j", (input) => {
  const delegated = transcript(
    ...readPair("r1", LIMIT),
    toolUseLine("a1", "Agent", input)
  );
  expect(isDenied(decideDelegation(readEvent, delegated))).toBe(true);
});

test("keeps the budget after a new user prompt, since the context keeps the earlier reads", () => {
  const next = transcript(
    ...readPair("r1", LIMIT),
    userPrompt("next question")
  );
  expect(isDenied(decideDelegation(readEvent, next))).toBe(true);
});

test("adds up lookups across user prompts", () => {
  const acrossPrompts = transcript(
    ...readPair("r1", 20_000),
    userPrompt("next question"),
    ...readPair("r2", 20_000)
  );
  expect(isDenied(decideDelegation(readEvent, acrossPrompts))).toBe(true);
});

test("does not count image blocks in a tool result", () => {
  const screenshot = transcript(
    toolUseLine("r1", "Read", { file_path: "/shot.png" }),
    toolResultLine("r1", [
      { type: "image", source: { data: "x".repeat(LIMIT * 2) } },
    ])
  );
  expect(decideDelegation(readEvent, screenshot)).toBeNull();
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

test("denies over budget when the event carries no permission_mode", () => {
  expect(
    isDenied(
      decideDelegation(
        { tool_name: "Read", tool_input: { file_path: "/a.ts" } },
        overBudget
      )
    )
  ).toBe(true);
});

test("allows everything when GUARDS_DELEGATE_GUARD is 0", () => {
  process.env.GUARDS_DELEGATE_GUARD = "0";
  try {
    expect(decideDelegation(readEvent, overBudget)).toBeNull();
  } finally {
    delete process.env.GUARDS_DELEGATE_GUARD;
  }
});

test("allows everything when launched by claude-lite", () => {
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:11434";
  try {
    expect(decideDelegation(readEvent, overBudget)).toBeNull();
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
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

test("denies an Explore agent even on haiku and names the scout", () => {
  const event = mainEvent("Agent", {
    subagent_type: "Explore",
    model: "haiku",
  });
  const result = decideDelegation(event, "");
  expect(isDenied(result)).toBe(true);
  expect(reasonOf(result)).toContain("guards:context-scout");
});

test.each([
  { subagent_type: "general-purpose" },
  { subagent_type: "claude" },
  { prompt: "no agent type" },
])("denies a general agent that names no model: %j", (input) => {
  const result = decideDelegation(mainEvent("Agent", input), "");
  expect(isDenied(result)).toBe(true);
  expect(reasonOf(result)).toContain('"haiku"');
});

test.each(["haiku", "sonnet", "opus"])(
  "allows a general agent that names the model %s",
  (model) => {
    const event = mainEvent("Agent", {
      subagent_type: "general-purpose",
      model,
    });
    expect(decideDelegation(event, "")).toBeNull();
  }
);

test("allows a scout prompt at the length limit", () => {
  const event = mainEvent("Agent", {
    subagent_type: "guards:context-scout",
    prompt: "x".repeat(SCOUT_PROMPT_LIMIT),
  });
  expect(decideDelegation(event, "")).toBeNull();
});

test("denies a scout prompt over the length limit", () => {
  const event = mainEvent("Agent", {
    subagent_type: "guards:context-scout",
    prompt: "x".repeat(SCOUT_PROMPT_LIMIT + 1),
  });
  const result = decideDelegation(event, "");
  expect(isDenied(result)).toBe(true);
  expect(reasonOf(result)).toContain("1500");
});

test("allows the context-scout agent", () => {
  const event = mainEvent("Agent", {
    subagent_type: "guards:context-scout",
  });
  expect(decideDelegation(event, "")).toBeNull();
});

test("allows a plugin agent that names no model, even over budget", () => {
  const event = mainEvent("Agent", {
    subagent_type: "small-plans:small-plan-implementer",
  });
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

test.each(["Edit", "Write", "MultiEdit", "NotebookEdit"])(
  "denies %s of a project file in the main session",
  (toolName) => {
    const result = decideDelegation(
      mainEvent(toolName, { file_path: "/repo/src/a.ts" }),
      ""
    );
    expect(result?.output).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(JSON.stringify(result)).toContain("guards:worker");
  }
);

test.each([
  join(homedir(), ".claude/projects/x/memory/note.md"),
  join(tmpdir(), "scratch/plan.md"),
  "/private/tmp/claude-501/scratchpad/page.html",
  "/tmp/notes.md",
])("allows an edit of the orchestration file %s", (filePath) => {
  expect(
    decideDelegation(mainEvent("Write", { file_path: filePath }), "")
  ).toBeNull();
});

test("lets a subagent edit project files", () => {
  expect(
    decideDelegation(
      { ...mainEvent("Edit", { file_path: "/repo/src/a.ts" }), agent_id: "a1" },
      ""
    )
  ).toBeNull();
});
