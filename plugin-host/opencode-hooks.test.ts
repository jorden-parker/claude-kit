import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOpenCodeHookPlugin,
  toClaudeToolCalls,
  toTranscriptLines,
} from "./opencode-hooks";
import { makeHookPluginRoot } from "./testing";

type HookEvent = Record<string, any>;
type HookRegistrations = Record<string, (event: HookEvent) => Promise<void>>;

const SESSION_ID = "ses_main";
const BROKEN_SESSION_ID = "ses_broken";
const RECORD_INPUT = 'cat > "$CLAUDE_PLUGIN_ROOT/input.json"';

const failLookup = (sessionID: string): never => {
  throw new Error(`No session ${sessionID}`);
};

const composeCommandHook = (scriptName: string) => ({
  hooks: [
    { type: "command", command: `"\${CLAUDE_PLUGIN_ROOT}/hooks/${scriptName}"` },
  ],
});

const startBridge = async (
  hooks: Record<string, unknown>,
  scripts: Record<string, string>,
  storedMessages: unknown[] = []
) => {
  const pluginRoot = await makeHookPluginRoot(hooks, scripts);
  const projectFolder = await mkdtemp(join(tmpdir(), "opencode-project-"));
  const toolHooks: HookRegistrations = {};
  const sessionHooks: HookRegistrations = {};
  const syntheticInputs: HookEvent[] = [];
  const plugin = createOpenCodeHookPlugin({ pluginName: "sample", pluginRoot });
  await plugin.setup({
    tool: {
      hook: async (hookName, runHook) => {
        toolHooks[hookName] = runHook;
      },
    },
    session: {
      hook: async (hookName, runHook) => {
        sessionHooks[hookName] = runHook;
      },
      get: async ({ sessionID }) => ({
        id: sessionID === BROKEN_SESSION_ID ? failLookup(sessionID) : sessionID,
        location: { directory: projectFolder },
        ...(sessionID === SESSION_ID ? {} : { parentID: SESSION_ID }),
      }),
      context: async () => storedMessages,
      synthetic: async (input) => {
        syntheticInputs.push(input);
      },
    },
  });
  const readRecordedInput = async () =>
    JSON.parse(await readFile(join(pluginRoot, "input.json"), "utf8"));
  return {
    plugin,
    projectFolder,
    toolHooks,
    sessionHooks,
    syntheticInputs,
    readRecordedInput,
  };
};

const composeToolEvent = (tool: string, input: unknown, extra: HookEvent = {}) => ({
  tool,
  sessionID: SESSION_ID,
  id: "call_1",
  input,
  ...extra,
});

test("the plugin has an id of its own and a setup function, the shape OpenCode loads", () => {
  const plugin = createOpenCodeHookPlugin({ pluginName: "tdd", pluginRoot: "/none" });

  expect(plugin.id).toBe("claude-kit-tdd-hooks");
  expect(typeof plugin.setup).toBe("function");
});

test("OpenCode tool calls take Claude Code's names and input fields", () => {
  expect(toClaudeToolCalls("shell", { command: "ls" }, "/work")).toEqual([
    { name: "Bash", input: { command: "ls" } },
  ]);
  expect(toClaudeToolCalls("read", { path: "notes.md", limit: 5 }, "/work")).toEqual([
    { name: "Read", input: { path: "notes.md", limit: 5, file_path: "/work/notes.md" } },
  ]);
  expect(
    toClaudeToolCalls(
      "edit",
      { path: "/abs/main.ts", oldString: "one", newString: "two", replaceAll: true },
      "/work"
    )[0]
  ).toMatchObject({
    name: "Edit",
    input: {
      file_path: "/abs/main.ts",
      old_string: "one",
      new_string: "two",
      replace_all: true,
    },
  });
  expect(
    toClaudeToolCalls("write", { path: "new.ts", content: "text" }, "/work")[0]
  ).toMatchObject({ name: "Write", input: { file_path: "/work/new.ts", content: "text" } });
  expect(
    toClaudeToolCalls("subagent", { agent: "context-scout", prompt: "Find it" }, "/work")[0]
  ).toMatchObject({ name: "Agent", input: { subagent_type: "context-scout" } });
  expect(toClaudeToolCalls("sample_render", { title: "Kept" }, "/work")).toEqual([
    { name: "sample_render", input: { title: "Kept" } },
  ]);
});

test("a patch becomes one Write per added file and one Edit per updated file", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Add File: src/added.ts",
    "+export const added = 1;",
    "+export const more = 2;",
    "*** Update File: src/changed.ts",
    "*** Move to: src/renamed.ts",
    "@@ context",
    "-const before = 1;",
    "+const after = 2;",
    " untouched",
    "*** Delete File: src/gone.ts",
    "*** End Patch",
  ].join("\n");

  expect(toClaudeToolCalls("patch", { patchText }, "/work")).toEqual([
    {
      name: "Write",
      input: {
        file_path: "/work/src/added.ts",
        content: "export const added = 1;\nexport const more = 2;",
      },
    },
    {
      name: "Edit",
      input: {
        file_path: "/work/src/changed.ts",
        old_string: "const before = 1;",
        new_string: "const after = 2;",
      },
    },
  ]);
});

test("the transcript holds user prompts and tool calls in Claude Code's shape", () => {
  const transcriptLines = toTranscriptLines(
    [
      { id: "msg_1", type: "user", text: "Fix the bug" },
      { id: "msg_2", type: "synthetic", text: "A stop hook spoke" },
      {
        id: "msg_3",
        type: "assistant",
        content: [
          { type: "text", text: "On it" },
          { type: "tool", id: "call_1", name: "shell", state: { input: { command: "ls" } } },
          { type: "tool", id: "call_2", name: "edit", state: { input: "{streaming" } },
        ],
      },
      { id: "msg_4", type: "assistant", content: [{ type: "text", text: "Done" }] },
    ],
    "/work"
  ).map((line) => JSON.parse(line));

  expect(transcriptLines).toEqual([
    { type: "user", uuid: "msg_1", message: { role: "user", content: "Fix the bug" } },
    {
      type: "assistant",
      uuid: "msg_3",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
  ]);
});

test("a PreToolUse hook gets Claude Code's input and its exit 2 blocks the call", async () => {
  const bridge = await startBridge(
    { PreToolUse: [{ matcher: "Bash", ...composeCommandHook("deny.sh") }] },
    { "deny.sh": `${RECORD_INPUT}; echo "No shell here" >&2; exit 2` },
    [{ id: "msg_1", type: "user", text: "Run it" }]
  );

  await expect(
    bridge.toolHooks["execute.before"]!(composeToolEvent("shell", { command: "ls" }))
  ).rejects.toThrow("No shell here");

  const recordedInput = await bridge.readRecordedInput();
  expect(recordedInput).toMatchObject({
    session_id: SESSION_ID,
    cwd: bridge.projectFolder,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_use_id: "call_1",
  });
  expect(recordedInput.transcript_path).toEndWith("transcript.jsonl");
});

test("a PreToolUse hook with another matcher lets the call through", async () => {
  const bridge = await startBridge(
    { PreToolUse: [{ matcher: "Edit|Write", ...composeCommandHook("deny.sh") }] },
    { "deny.sh": "exit 2" }
  );

  await bridge.toolHooks["execute.before"]!(composeToolEvent("shell", { command: "ls" }));
});

test("a mistake inside the bridge never blocks a tool call", async () => {
  const bridge = await startBridge(
    { PreToolUse: [{ matcher: "Bash", ...composeCommandHook("deny.sh") }] },
    { "deny.sh": "exit 2" }
  );

  await bridge.toolHooks["execute.before"]!({
    tool: "shell",
    sessionID: BROKEN_SESSION_ID,
    id: "call_1",
    input: { command: "ls" },
  });
});

test("PreToolUse advice and PostToolUse feedback are added to the tool's result", async () => {
  const bridge = await startBridge(
    {
      PreToolUse: [{ matcher: "Edit", ...composeCommandHook("advise.sh") }],
      PostToolUse: [{ matcher: "Edit", ...composeCommandHook("feedback.sh") }],
    },
    {
      "advise.sh": `echo '{"hookSpecificOutput":{"additionalContext":"Write a test first"}}'`,
      "feedback.sh": `${RECORD_INPUT}; echo "Remove the comment" >&2; exit 2`,
    }
  );
  const editInput = { path: "main.ts", oldString: "one", newString: "two" };
  const finishedCall = composeToolEvent("edit", editInput, {
    status: "completed",
    result: { content: [{ type: "text", text: "Edited" }] },
  });

  await bridge.toolHooks["execute.before"]!(composeToolEvent("edit", editInput));
  await bridge.toolHooks["execute.after"]!(finishedCall);

  expect(finishedCall.result.content).toEqual([
    { type: "text", text: "Edited" },
    { type: "text", text: "Remove the comment" },
    { type: "text", text: "Write a test first" },
  ]);
  expect(await bridge.readRecordedInput()).toMatchObject({
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(bridge.projectFolder, "main.ts"), new_string: "two" },
    tool_response: { text: "Edited", is_error: false },
  });
});

test("a shell result carries its exit code, and a hook can replace the output", async () => {
  const bridge = await startBridge(
    { PostToolUse: [{ matcher: "Bash", ...composeCommandHook("trim.sh") }] },
    {
      "trim.sh": `${RECORD_INPUT}; echo '{"hookSpecificOutput":{"updatedToolOutput":{"stdout":"trimmed","stderr":""}}}'`,
    }
  );
  const finishedCall = composeToolEvent("shell", { command: "pnpm test" }, {
    status: "completed",
    result: {
      output: { exitCode: 1 },
      content: [{ type: "text", text: "long output" }],
      metadata: { timeout: true },
    },
  });

  await bridge.toolHooks["execute.after"]!(finishedCall);

  expect(finishedCall.result.content).toEqual([{ type: "text", text: "trimmed" }]);
  expect((await bridge.readRecordedInput()).tool_response).toEqual({
    stdout: "long output",
    stderr: "",
    exit_code: 1,
    interrupted: true,
  });
});

test("a result with no content parts keeps its output when feedback is added", async () => {
  const bridge = await startBridge(
    { PostToolUse: [{ ...composeCommandHook("feedback.sh") }] },
    { "feedback.sh": `echo "Check this" >&2; exit 2` }
  );
  const finishedCall = composeToolEvent("sample_render", {}, {
    status: "completed",
    result: { output: { saved: true } },
  });

  await bridge.toolHooks["execute.after"]!(finishedCall);

  expect(finishedCall.result.content).toEqual([
    { type: "text", text: '{"saved":true}' },
    { type: "text", text: "Check this" },
  ]);
});

test("SessionStart output is added to the system prompt of every model call, and runs once", async () => {
  const bridge = await startBridge(
    { SessionStart: [composeCommandHook("rules.sh")] },
    { "rules.sh": `echo run >> "$CLAUDE_PLUGIN_ROOT/runs.log"; echo "Follow the rules"` }
  );
  const firstCall = { sessionID: SESSION_ID, system: [] as unknown[] };
  const secondCall = { sessionID: SESSION_ID, system: [] as unknown[] };
  const subagentCall = { sessionID: "ses_child", system: [] as unknown[] };

  await bridge.sessionHooks.context!(firstCall);
  await bridge.sessionHooks.context!(secondCall);
  await bridge.sessionHooks.context!(subagentCall);

  expect(firstCall.system).toEqual([{ type: "text", text: "Follow the rules" }]);
  expect(secondCall.system).toEqual(firstCall.system);
  expect(subagentCall.system).toEqual([]);
});

test("a Stop hook that blocks sends its reason as input, and the next stop is marked active", async () => {
  const bridge = await startBridge(
    { Stop: [composeCommandHook("gate.sh")] },
    {
      "gate.sh": `input="$(cat)"; case "$input" in *'"stop_hook_active":true'*) exit 0 ;; esac; echo "Tests fail" >&2; exit 2`,
    }
  );
  const idleEvent = { sessionID: SESSION_ID, background: [] };

  await bridge.sessionHooks["experimental.idle"]!(idleEvent);
  await bridge.sessionHooks["experimental.idle"]!(idleEvent);
  await bridge.sessionHooks["experimental.idle"]!(idleEvent);

  expect(bridge.syntheticInputs).toEqual([
    { sessionID: SESSION_ID, text: "Tests fail" },
    { sessionID: SESSION_ID, text: "Tests fail" },
  ]);
});

test("Stop hooks wait for a running subagent and never run for a subagent's own session", async () => {
  const bridge = await startBridge(
    { Stop: [composeCommandHook("gate.sh")] },
    { "gate.sh": `echo "Tests fail" >&2; exit 2` }
  );

  await bridge.sessionHooks["experimental.idle"]!({
    sessionID: SESSION_ID,
    background: [{ kind: "subagent", sessionID: SESSION_ID }],
  });
  await bridge.sessionHooks["experimental.idle"]!({
    sessionID: "ses_child",
    background: [],
  });

  expect(bridge.syntheticInputs).toEqual([]);
});

test("the tool hooks still register when OpenCode no longer has the idle hook", async () => {
  const pluginRoot = await makeHookPluginRoot({}, {});
  const registeredNames: string[] = [];

  await createOpenCodeHookPlugin({ pluginName: "sample", pluginRoot }).setup({
    tool: {
      hook: async (hookName) => {
        registeredNames.push(hookName);
      },
    },
    session: {
      hook: async (hookName) => {
        if (hookName === "experimental.idle") throw new Error("Unknown hook");
        registeredNames.push(hookName);
      },
      get: async () => ({}),
      context: async () => [],
      synthetic: async () => {},
    },
  });

  expect(registeredNames).toEqual(["execute.before", "execute.after", "context"]);
});
