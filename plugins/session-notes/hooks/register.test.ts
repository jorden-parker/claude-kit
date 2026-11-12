import type { On, PromptComposeInput, PromptSubmitInput } from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const WRITE_NOTE_TOOL = "mcp__session-notes__write_note";
const AMEND_NOTE_TOOL = "mcp__session-notes__amend_note";
const DELETE_NOTE_TOOL = "mcp__session-notes__delete_note";

const submitted = (text: string) => ({ text }) as PromptSubmitInput;

const NOTES_PANE = {
  plugin: "session-notes",
  component: "Pane",
  requestId: "session-notes",
  surface: "terminal",
  props: {
    title: "Session notes",
    isFocused: false,
    bodyColumns: 80,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

const mockEngine = (
  on: On,
  sessionId: string,
  storedEntries: Record<string, unknown> = {},
  recorded: { openedPanes: string[]; submittedPrompts: string[] } = {
    openedPanes: [],
    submittedPrompts: [],
  }
) => {
  const store = new Map(Object.entries(storedEntries));
  on("store.get", (_, e) => ({ value: store.get(e.key) }));
  on("store.set", (_, e) => {
    store.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: sessionId }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("prompt.submit", (_, e) => {
    recorded.submittedPrompts.push(e.text);
    return { text: e.text };
  });
  on("tool.call", () => ({ result: {} }));
  on("ui.open", (_, e) => {
    recorded.openedPanes.push(e.id);
    return { value: { isPlaced: true } };
  });
  return store;
};

test("prompts and tool use are never noted", async ($, on) => {
  const store = mockEngine(on, "session-a");

  await $.prompt.submit(submitted("fix the login bug"));
  await $.tool.call({
    tool: "Edit",
    file_path: "/repo/login.ts",
    old_string: "a",
    new_string: "b",
  });
  await $.tool.call({ tool: "Bash", command: "pnpm test" });

  expect(store.get("notes")).toBeUndefined();
});

test("each session gets its own note, newest first", async ($, on) => {
  const store = mockEngine(on, "session-b", {
    notes: [
      {
        sessionId: "session-a",
        cwd: "/old",
        startedAt: "2026-11-01T10:00:00.000Z",
        notes: ["Old note"],
      },
    ],
  });

  await $.tool.call({ tool: WRITE_NOTE_TOOL, text: "New note" } as never);

  const notes = store.get("notes") as Array<Record<string, unknown>>;
  expect(notes.map((note) => note.sessionId)).toEqual([
    "session-b",
    "session-a",
  ]);
  expect(notes[0]).toEqual({
    sessionId: "session-b",
    cwd: "/repo",
    startedAt: expect.any(String),
    notes: ["New note"],
  });
});

test("notes never reach the system prompt", async ($, on) => {
  mockEngine(on, "session-a");
  on("prompt.compose", () => ({ sections: [] }));

  await $.tool.call({ tool: WRITE_NOTE_TOOL, text: "secret plan" } as never);
  const composed = await $.prompt.compose({} as PromptComposeInput);

  expect(JSON.stringify(composed)).not.toContain("secret plan");
});

test("a long note keeps its lines and up to 2000 characters", async ($, on) => {
  const store = mockEngine(on, "session-a");
  const longNote = `## Left to do\n- [ ] ${"a".repeat(2100)}`;

  await $.tool.call({ tool: WRITE_NOTE_TOOL, text: longNote } as never);

  const [note] = store.get("notes") as Array<{ notes: string[] }>;
  expect(note?.notes[0]).toBe(longNote.slice(0, 2000));
});

test("the pane shows formatted notes and no session data", async ($, on) => {
  mockEngine(on, "session-a", {
    notes: [
      {
        sessionId: "session-a",
        cwd: "/repo",
        startedAt: "2026-11-12T09:30:00.000Z",
        prompts: ["fix the login bug"],
        files: ["/repo/login.ts"],
        commands: ["pnpm test"],
        notes: [
          "## Left to do\n- [ ] Ship the fix\n## Done\n- Found the stale cookie\n- [x] Wrote the test",
        ],
      },
      {
        sessionId: "session-old",
        cwd: "/old",
        startedAt: "2026-11-01T10:00:00.000Z",
        prompts: ["old prompt"],
        files: [],
        commands: [],
      },
    ],
  });

  const mountedPane = await $.ui.mount(NOTES_PANE);
  const findText = async (text: RegExp) =>
    (await mountedPane.find({ type: "Text", text }))?.text;

  expect(await findText(/\/repo$/)).toBe("2026-11-12 09:30 UTC · /repo");
  expect(await findText(/Left to do/)).toBe("Left to do");
  expect(await findText(/Ship/)).toBe("  ○ Ship the fix");
  expect(await findText(/stale cookie/)).toBe("  • Found the stale cookie");
  expect(await findText(/Wrote/)).toBe("  ✓ Wrote the test");
  expect(await findText(/login|pnpm|old/)).toBeUndefined();
  await mountedPane.unmount();
});

test("the pane says when there are no notes", async ($, on) => {
  mockEngine(on, "session-a");

  const mountedPane = await $.ui.mount(NOTES_PANE);

  expect((await mountedPane.find({ type: "Text" }))?.text).toBe(
    "No notes yet. Ask Claude to note something, or run /note."
  );
  await mountedPane.unmount();
});

test("Claude writes a note with the tool, and the pane opens", async ($, on) => {
  const recorded = { openedPanes: [] as string[], submittedPrompts: [] };
  const store = mockEngine(
    on,
    "session-a",
    {
      notes: [
        {
          sessionId: "session-a",
          cwd: "/repo",
          startedAt: "2026-11-12T09:30:00.000Z",
        },
      ],
    },
    recorded
  );

  const outcome = await $.tool.call({
    tool: WRITE_NOTE_TOOL,
    text: "Login bug was a stale session cookie",
  } as never);

  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.notes).toEqual(["Login bug was a stale session cookie"]);
  expect(recorded.openedPanes).toEqual(["session-notes"]);
  expect(outcome).toEqual({ result: "Note saved and the notes pane opened." });

  const mountedPane = await $.ui.mount(NOTES_PANE);
  expect((await mountedPane.find({ type: "Text", text: /stale/ }))?.text).toBe(
    "  Login bug was a stale session cookie"
  );
  await mountedPane.unmount();
});

test("an empty note is refused", async ($, on) => {
  mockEngine(on, "session-a");

  const outcome = await $.tool.call({
    tool: WRITE_NOTE_TOOL,
    text: " ",
  } as never);

  expect(outcome).toEqual({ deny: "The note needs some text." });
});

const sessionWithNote = (noteText: string) => ({
  notes: [
    {
      sessionId: "session-a",
      cwd: "/repo",
      startedAt: "2026-11-12T09:30:00.000Z",
      notes: [noteText, "Deploy is on Friday"],
    },
  ],
});

test("amend_note replaces an existing note", async ($, on) => {
  const recorded = { openedPanes: [] as string[], submittedPrompts: [] };
  const store = mockEngine(
    on,
    "session-a",
    sessionWithNote("Login bug was a stale cookie"),
    recorded
  );

  const outcome = await $.tool.call({
    tool: AMEND_NOTE_TOOL,
    old: "Login bug was a stale cookie",
    text: "Login bug was a stale session cookie",
  } as never);

  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.notes).toEqual([
    "Login bug was a stale session cookie",
    "Deploy is on Friday",
  ]);
  expect(recorded.openedPanes).toEqual(["session-notes"]);
  expect(outcome).toEqual({
    result: "Note amended and the notes pane opened.",
  });
});

test("amend_note refuses a note that does not exist", async ($, on) => {
  const store = mockEngine(on, "session-a", sessionWithNote("Real note"));

  const outcome = await $.tool.call({
    tool: AMEND_NOTE_TOOL,
    old: "Missing note",
    text: "New text",
  } as never);

  expect(outcome).toEqual({
    deny: 'No note in this session reads "Missing note".',
  });
  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.notes).toEqual(["Real note", "Deploy is on Friday"]);
});

test("amend_note refuses when the session has no notes yet", async ($, on) => {
  const store = mockEngine(on, "session-a");

  const outcome = await $.tool.call({
    tool: AMEND_NOTE_TOOL,
    old: "Anything",
    text: "New text",
  } as never);

  expect(outcome).toEqual({
    deny: 'No note in this session reads "Anything".',
  });
  expect(store.get("notes")).toBeUndefined();
});

test("amend_note refuses empty replacement text", async ($, on) => {
  mockEngine(on, "session-a", sessionWithNote("Real note"));

  const outcome = await $.tool.call({
    tool: AMEND_NOTE_TOOL,
    old: "Real note",
    text: " ",
  } as never);

  expect(outcome).toEqual({ deny: "The note needs some text." });
});

test("delete_note removes an existing note", async ($, on) => {
  const recorded = { openedPanes: [] as string[], submittedPrompts: [] };
  const store = mockEngine(
    on,
    "session-a",
    sessionWithNote("Login bug was a stale cookie"),
    recorded
  );

  const outcome = await $.tool.call({
    tool: DELETE_NOTE_TOOL,
    text: "Login bug was a stale cookie",
  } as never);

  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.notes).toEqual(["Deploy is on Friday"]);
  expect(recorded.openedPanes).toEqual(["session-notes"]);
  expect(outcome).toEqual({
    result: "Note deleted and the notes pane opened.",
  });
});

test("delete_note refuses a note that does not exist", async ($, on) => {
  const store = mockEngine(on, "session-a", sessionWithNote("Real note"));

  const outcome = await $.tool.call({
    tool: DELETE_NOTE_TOOL,
    text: "Missing note",
  } as never);

  expect(outcome).toEqual({
    deny: 'No note in this session reads "Missing note".',
  });
  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.notes).toEqual(["Real note", "Deploy is on Friday"]);
});

test("session start links the session-notes shell command", async ($, on) => {
  mockEngine(on, "session-a");
  const ranCommands: string[][] = [];
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("tool.register", (_, e) => ({
    value: { tool: `mcp__session-notes__${e.name}` },
  }));
  on("process.run", (_, e) => {
    ranCommands.push([...e.argv]);
    return { value: { exitCode: 0, stdout: "", stderr: "" } } as never;
  });

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(ranCommands).toHaveLength(1);
  expect(ranCommands[0]?.[0]).toBe("bash");
  expect(ranCommands[0]?.[1]).toEndWith("/hooks/link-session-notes.sh");
});

const runNoteCommand = async ($: Engine, on: On, commandArguments: string) => {
  const clock = mock.clock(on);
  const recorded = { openedPanes: [], submittedPrompts: [] as string[] };
  const store = mockEngine(on, "session-a", {}, recorded);
  const reply = await $.command.run({
    command: "note",
    args: commandArguments,
  } as never);
  await clock.settle();
  return { reply, store, submittedPrompts: recorded.submittedPrompts };
};

test("/note asks Claude to note a summary and what is left", async ($, on) => {
  const { reply, submittedPrompts } = await runNoteCommand($, on, "");

  expect(reply.text).toBe("Writing a session note…");
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(WRITE_NOTE_TOOL);
  expect(submittedPrompts[0]).toContain("summary of this session");
  expect(submittedPrompts[0]).toContain("## Left to do");
  expect(submittedPrompts[0]).toContain("## Done");
  expect(submittedPrompts[0]!.indexOf("## Left to do")).toBeLessThan(
    submittedPrompts[0]!.indexOf("## Done")
  );
  expect(submittedPrompts[0]).toContain("Leave out tool calls");
});

test("/note with arguments asks Claude to note that instead", async ($, on) => {
  const { submittedPrompts } = await runNoteCommand(
    $,
    on,
    "the open questions"
  );

  expect(submittedPrompts[0]).toContain(WRITE_NOTE_TOOL);
  expect(submittedPrompts[0]).toContain("the open questions");
  expect(submittedPrompts[0]).not.toContain("summary of this session");
  expect(submittedPrompts[0]).toContain("Leave out tool calls");
});

test("the /note instructions are not noted as a prompt", async ($, on) => {
  const { store } = await runNoteCommand($, on, "");

  expect(store.get("notes")).toBeUndefined();
});
