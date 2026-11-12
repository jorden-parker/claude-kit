import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPiHookExtension,
  doesMatcherMatch,
  toClaudeToolInput,
  toTranscriptLines,
} from "./pi-hooks";

type PiEventHandler = (event: any, context: any) => any;

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");

const makePluginRoot = async (
  hooks: Record<string, unknown>,
  scripts: Record<string, string> = {}
) => {
  const pluginRoot = await mkdtemp(join(tmpdir(), "pi-hooks-plugin-"));
  await mkdir(join(pluginRoot, "hooks"), { recursive: true });
  await writeFile(
    join(pluginRoot, "hooks", "hooks.json"),
    JSON.stringify({ hooks })
  );
  for (const [scriptName, scriptBody] of Object.entries(scripts)) {
    const scriptPath = join(pluginRoot, "hooks", scriptName);
    await writeFile(scriptPath, `#!/usr/bin/env bash\n${scriptBody}\n`);
    await chmod(scriptPath, 0o755);
  }
  return pluginRoot;
};

const hookGroup = (scriptName: string, matcher?: string) => ({
  ...(matcher ? { matcher } : {}),
  hooks: [
    {
      type: "command",
      command: `"\${CLAUDE_PLUGIN_ROOT}/hooks/${scriptName}"`,
    },
  ],
});

const loadHandlers = (pluginRoot: string) => {
  const handlers = new Map<string, PiEventHandler>();
  const registeredNames: string[] = [];
  createPiHookExtension({ pluginRoot })({
    on: (eventName: string, handler: PiEventHandler) => {
      registeredNames.push(eventName);
      handlers.set(eventName, handler);
    },
  } as any);
  return { handlers, registeredNames };
};

const makeContext = (workingDirectory: string, branch: unknown[] = []) => ({
  cwd: workingDirectory,
  sessionManager: {
    getBranch: () => branch,
    getSessionId: () => "session-1",
  },
});

const toolCall = (toolName: string, input: Record<string, unknown>) => ({
  type: "tool_call",
  toolCallId: "call-1",
  toolName,
  input,
});

const toolResult = (
  toolName: string,
  input: Record<string, unknown>,
  text: string,
  isError = false
) => ({
  type: "tool_result",
  toolCallId: "call-1",
  toolName,
  input,
  content: [{ type: "text", text }],
  isError,
  details: undefined,
});

const readJsonFile = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));

test("the bridge registers only the pi events that map to Claude Code hooks", async () => {
  const pluginRoot = await makePluginRoot({
    SessionStart: [hookGroup("noop.sh")],
    PreToolUse: [hookGroup("noop.sh", "Bash")],
    PostToolUse: [hookGroup("noop.sh", "Bash")],
    Stop: [hookGroup("noop.sh")],
    SubagentStop: [hookGroup("noop.sh")],
  });
  const { registeredNames } = loadHandlers(pluginRoot);
  expect([...registeredNames].sort()).toEqual([
    "agent_before_settle",
    "before_agent_start",
    "session_start",
    "tool_call",
    "tool_result",
  ]);
});

test("tool inputs take Claude Code's shape and file paths become absolute", () => {
  expect(
    toClaudeToolInput("read", { path: "src/a.ts", offset: 3 }, "/project")
  ).toEqual({ path: "src/a.ts", offset: 3, file_path: "/project/src/a.ts" });
  expect(
    toClaudeToolInput(
      "edit",
      { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] },
      "/project"
    )
  ).toEqual({
    path: "src/a.ts",
    edits: [{ oldText: "a", newText: "b" }],
    file_path: "/project/src/a.ts",
    old_string: "a",
    new_string: "b",
  });
  expect(
    toClaudeToolInput(
      "edit",
      {
        path: "src/a.ts",
        edits: [
          { oldText: "a", newText: "b" },
          { oldText: "c", newText: "// d" },
        ],
      },
      "/project"
    )
  ).toMatchObject({ old_string: "a\nc", new_string: "b\n// d" });
  expect(
    toClaudeToolInput("write", { path: "x.md", content: "hi" }, "/project")
  ).toEqual({ path: "x.md", content: "hi", file_path: "/project/x.md" });
  expect(toClaudeToolInput("bash", { command: "ls" }, "/project")).toEqual({
    command: "ls",
  });
});

test("a matcher is a whole-name regex over Claude Code tool names", () => {
  expect(doesMatcherMatch("Edit|Write", "Write")).toBe(true);
  expect(doesMatcherMatch("Edit|Write", "Read")).toBe(false);
  expect(doesMatcherMatch("Bash", "BashOutput")).toBe(false);
  expect(doesMatcherMatch(undefined, "Bash")).toBe(true);
  expect(doesMatcherMatch("Edit|Write", undefined)).toBe(false);
});

test("the transcript holds user prompts and Claude Code tool calls, but no tool results", () => {
  const branch = [
    {
      type: "message",
      id: "u1",
      message: { role: "user", content: "fix the bug", timestamp: 1 },
    },
    {
      type: "message",
      id: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          {
            type: "toolCall",
            id: "t1",
            name: "edit",
            arguments: { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] },
          },
        ],
      },
    },
    {
      type: "message",
      id: "r1",
      message: {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "edit",
        content: [],
        isError: false,
      },
    },
    {
      type: "message",
      id: "a2",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t2", name: "bash", arguments: { command: "bun test" } },
        ],
      },
    },
    { type: "custom_message", id: "c1", customType: "x", content: "x", display: true },
  ];
  const lines = toTranscriptLines(branch, "/project").map((line) =>
    JSON.parse(line)
  );
  expect(lines).toEqual([
    { type: "user", uuid: "u1", message: { role: "user", content: "fix the bug" } },
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Edit",
            input: {
              path: "src/a.ts",
              edits: [{ oldText: "a", newText: "b" }],
              file_path: "/project/src/a.ts",
              old_string: "a",
              new_string: "b",
            },
          },
        ],
      },
    },
    {
      type: "assistant",
      uuid: "a2",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test" } },
        ],
      },
    },
  ]);
});

test("SessionStart stdout and additionalContext reach the model once, through before_agent_start", async () => {
  const pluginRoot = await makePluginRoot(
    { SessionStart: [hookGroup("rules.sh"), hookGroup("context.sh")] },
    {
      "rules.sh": `echo "Rules: no comments"`,
      "context.sh": `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Reset done"}}'`,
    }
  );
  const { handlers } = loadHandlers(pluginRoot);
  const context = makeContext(pluginRoot);
  await handlers.get("session_start")!({ type: "session_start", reason: "startup" }, context);
  const started = await handlers.get("before_agent_start")!(
    { type: "before_agent_start", prompt: "hi" },
    context
  );
  expect(started.message.content).toContain("Rules: no comments");
  expect(started.message.content).toContain("Reset done");
  expect(
    await handlers.get("before_agent_start")!({ type: "before_agent_start", prompt: "again" }, context)
  ).toBeUndefined();
});

test("a PreToolUse exit 2 blocks the call, and the hook gets Claude Code's payload", async () => {
  const pluginRoot = await makePluginRoot(
    { PreToolUse: [hookGroup("guard.sh", "Bash")] },
    {
      "guard.sh": `cat > "$CLAUDE_PLUGIN_ROOT/seen.json"\necho "Use bun test instead." >&2\nexit 2`,
    }
  );
  const project = await mkdtemp(join(tmpdir(), "pi-hooks-project-"));
  const { handlers } = loadHandlers(pluginRoot);
  const result = await handlers.get("tool_call")!(
    toolCall("bash", { command: "npm test" }),
    makeContext(project)
  );
  expect(result).toEqual({ block: true, reason: "Use bun test instead." });
  const seen = await readJsonFile(join(pluginRoot, "seen.json"));
  expect(seen).toMatchObject({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    session_id: "session-1",
    cwd: project,
    tool_use_id: "call-1",
  });
  expect(seen.transcript_path).toEqual(expect.any(String));
});

test("hooks run with CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR set", async () => {
  const pluginRoot = await makePluginRoot(
    { PreToolUse: [hookGroup("env.sh", "Bash")] },
    { "env.sh": `printf '%s' "$CLAUDE_PROJECT_DIR" > "$CLAUDE_PLUGIN_ROOT/project-dir.txt"` }
  );
  const project = await mkdtemp(join(tmpdir(), "pi-hooks-project-"));
  const { handlers } = loadHandlers(pluginRoot);
  await handlers.get("tool_call")!(toolCall("bash", { command: "ls" }), makeContext(project));
  expect(await readFile(join(pluginRoot, "project-dir.txt"), "utf8")).toBe(project);
});

test("a hook whose matcher does not match the tool is not run", async () => {
  const pluginRoot = await makePluginRoot(
    { PreToolUse: [hookGroup("guard.sh", "Edit|Write")] },
    { "guard.sh": `echo ran > "$CLAUDE_PLUGIN_ROOT/ran.txt"\nexit 2` }
  );
  const { handlers } = loadHandlers(pluginRoot);
  const result = await handlers.get("tool_call")!(
    toolCall("bash", { command: "ls" }),
    makeContext(pluginRoot)
  );
  expect(result).toBeUndefined();
  expect(existsSync(join(pluginRoot, "ran.txt"))).toBe(false);
});

test("a PreToolUse permissionDecision of deny blocks the call with its reason", async () => {
  const pluginRoot = await makePluginRoot(
    { PreToolUse: [hookGroup("deny.sh", "Bash")] },
    {
      "deny.sh": `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Not here."}}'`,
    }
  );
  const { handlers } = loadHandlers(pluginRoot);
  expect(
    await handlers.get("tool_call")!(toolCall("bash", { command: "ls" }), makeContext(pluginRoot))
  ).toEqual({ block: true, reason: "Not here." });
});

test("PreToolUse additionalContext is appended to that call's result", async () => {
  const pluginRoot = await makePluginRoot(
    { PreToolUse: [hookGroup("reminder.sh", "Edit|Write")] },
    {
      "reminder.sh": `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"TDD reminder: write a failing test."}}'`,
    }
  );
  const { handlers } = loadHandlers(pluginRoot);
  const context = makeContext(pluginRoot);
  expect(
    await handlers.get("tool_call")!(toolCall("edit", { path: "src/a.ts", edits: [] }), context)
  ).toBeUndefined();
  expect(
    await handlers.get("tool_result")!(
      toolResult("edit", { path: "src/a.ts", edits: [] }, "Edited"),
      context
    )
  ).toEqual({
    content: [
      { type: "text", text: "Edited" },
      { type: "text", text: "TDD reminder: write a failing test." },
    ],
  });
});

test("PostToolUse updatedToolOutput replaces a bash result's text", async () => {
  const pluginRoot = await makePluginRoot(
    { PostToolUse: [hookGroup("trim.sh", "Bash")] },
    {
      "trim.sh": `echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{"stdout":"short","stderr":""}}}'`,
    }
  );
  const { handlers } = loadHandlers(pluginRoot);
  expect(
    await handlers.get("tool_result")!(
      toolResult("bash", { command: "seq 1000" }, "long output"),
      makeContext(pluginRoot)
    )
  ).toEqual({ content: [{ type: "text", text: "short" }] });
});

test("a PostToolUse exit 2 feeds its reason back with the result", async () => {
  const pluginRoot = await makePluginRoot(
    { PostToolUse: [hookGroup("feedback.sh", "Bash")] },
    { "feedback.sh": `echo "Fix the lint errors first." >&2\nexit 2` }
  );
  const { handlers } = loadHandlers(pluginRoot);
  expect(
    await handlers.get("tool_result")!(
      toolResult("bash", { command: "ls" }, "ran"),
      makeContext(pluginRoot)
    )
  ).toEqual({
    content: [
      { type: "text", text: "ran" },
      { type: "text", text: "Fix the lint errors first." },
    ],
  });
});

test("the bash result reaches PostToolUse with exit_code from pi's failure text", async () => {
  const pluginRoot = await makePluginRoot(
    { PostToolUse: [hookGroup("record.sh", "Bash")] },
    { "record.sh": `cat > "$CLAUDE_PLUGIN_ROOT/post.json"` }
  );
  const { handlers } = loadHandlers(pluginRoot);
  await handlers.get("tool_result")!(
    toolResult("bash", { command: "bun test" }, "1 fail\nCommand exited with code 1", true),
    makeContext(pluginRoot)
  );
  const seen = await readJsonFile(join(pluginRoot, "post.json"));
  expect(seen.tool_response).toEqual({
    stdout: "1 fail\nCommand exited with code 1",
    stderr: "",
    exit_code: 1,
    interrupted: false,
  });
});

test("a Stop exit 2 asks pi for one more turn, and the follow-up carries stop_hook_active", async () => {
  const pluginRoot = await makePluginRoot(
    { Stop: [hookGroup("gate.sh")] },
    {
      "gate.sh": `input=$(cat)\ncase "$input" in *'"stop_hook_active":true'*) exit 0 ;; esac\necho "Run the tests before finishing." >&2\nexit 2`,
    }
  );
  const { handlers } = loadHandlers(pluginRoot);
  const context = makeContext(pluginRoot);
  const settle = { type: "agent_before_settle", outcome: "completed", entries: [], continue: false };
  expect(await handlers.get("agent_before_settle")!(settle, context)).toEqual({
    continue: true,
    entries: [
      {
        type: "custom_message",
        customType: "claude-kit-stop-hook",
        content: "Run the tests before finishing.",
        display: true,
      },
    ],
  });
  expect(await handlers.get("agent_before_settle")!(settle, context)).toBeUndefined();
});

test("an aborted run does not run Stop hooks", async () => {
  const pluginRoot = await makePluginRoot(
    { Stop: [hookGroup("gate.sh")] },
    { "gate.sh": `echo ran > "$CLAUDE_PLUGIN_ROOT/ran.txt"\nexit 2` }
  );
  const { handlers } = loadHandlers(pluginRoot);
  expect(
    await handlers.get("agent_before_settle")!(
      { type: "agent_before_settle", outcome: "aborted", entries: [], continue: false },
      makeContext(pluginRoot)
    )
  ).toBeUndefined();
  expect(existsSync(join(pluginRoot, "ran.txt"))).toBe(false);
});

test("hooks read a Claude Code-shaped transcript of the current branch", async () => {
  const pluginRoot = await makePluginRoot(
    { Stop: [hookGroup("transcript.sh")] },
    {
      "transcript.sh": `path=$(sed -E 's/.*"transcript_path":"([^"]*)".*/\\1/')\ncp "$path" "$CLAUDE_PLUGIN_ROOT/transcript.jsonl"`,
    }
  );
  const project = await mkdtemp(join(tmpdir(), "pi-hooks-project-"));
  const branch = [
    { type: "message", id: "u1", message: { role: "user", content: "fix it" } },
    {
      type: "message",
      id: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "t1", name: "edit", arguments: { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] } },
        ],
      },
    },
  ];
  const { handlers } = loadHandlers(pluginRoot);
  await handlers.get("agent_before_settle")!(
    { type: "agent_before_settle", outcome: "completed", entries: [], continue: false },
    makeContext(project, branch)
  );
  const transcript = await readFile(join(pluginRoot, "transcript.jsonl"), "utf8");
  expect(transcript.trim().split("\n")).toEqual(
    toTranscriptLines(branch, project)
  );
});

test("the real guards bash-guard hook denies an unbounded find through the bridge", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "pi-hooks-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const { handlers } = loadHandlers(join(REPOSITORY_ROOT, "plugins", "guards"));
    expect(
      await handlers.get("tool_call")!(
        toolCall("bash", { command: "find . -name '*.ts'" }),
        makeContext(fakeHome)
      )
    ).toEqual({
      block: true,
      reason: "Unbounded find. Add -maxdepth N or | head -50.",
    });
  } finally {
    process.env.HOME = previousHome;
  }
});

test("the real guards bash-trim hook shortens a long bash result through the bridge", async () => {
  const fakeHome = await mkdtemp(join(tmpdir(), "pi-hooks-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const { handlers } = loadHandlers(join(REPOSITORY_ROOT, "plugins", "guards"));
    const longOutput = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join("\n");
    const result = await handlers.get("tool_result")!(
      toolResult("bash", { command: "seq 300" }, longOutput),
      makeContext(fakeHome)
    );
    expect(result.content[0].text).toContain("[bash-trim: ");
  } finally {
    process.env.HOME = previousHome;
  }
});
