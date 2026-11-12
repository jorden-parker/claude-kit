import type { On, PromptComposeInput, PromptSubmitInput } from "claude-code";
import { expect, test } from "claude-code/testing";

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
  storedEntries: Record<string, unknown> = {}
) => {
  const store = new Map(Object.entries(storedEntries));
  on("store.get", (_, e) => ({ value: store.get(e.key) }));
  on("store.set", (_, e) => {
    store.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: sessionId }));
  on("session.cwd", () => ({ value: "/repo" }));
  on("prompt.submit", (_, e) => ({ text: e.text }));
  on("tool.call", () => ({ result: {} }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  return store;
};

test("prompts, edited files and commands are noted in the store", async ($, on) => {
  const store = mockEngine(on, "session-a");

  await $.prompt.submit(submitted("fix the login bug"));
  await $.tool.call({
    tool: "Edit",
    file_path: "/repo/login.ts",
    old_string: "a",
    new_string: "b",
  });
  await $.tool.call({
    tool: "Write",
    file_path: "/repo/login.ts",
    content: "",
  });
  await $.tool.call({ tool: "Bash", command: "pnpm test" });
  await $.tool.call({ tool: "Read", file_path: "/repo/other.ts" });

  const [note] = store.get("notes") as Array<Record<string, unknown>>;
  expect(note?.sessionId).toBe("session-a");
  expect(note?.cwd).toBe("/repo");
  expect(note?.prompts).toEqual(["fix the login bug"]);
  expect(note?.files).toEqual(["/repo/login.ts"]);
  expect(note?.commands).toEqual(["pnpm test"]);
});

test("each session gets its own note, newest first", async ($, on) => {
  const store = mockEngine(on, "session-b", {
    notes: [
      {
        sessionId: "session-a",
        cwd: "/old",
        startedAt: "2026-11-01T10:00:00.000Z",
        prompts: ["old prompt"],
        files: [],
        commands: [],
      },
    ],
  });

  await $.prompt.submit(submitted("new prompt"));

  const notes = store.get("notes") as Array<Record<string, unknown>>;
  expect(notes.map((note) => note.sessionId)).toEqual([
    "session-b",
    "session-a",
  ]);
});

test("notes never reach the system prompt", async ($, on) => {
  mockEngine(on, "session-a");
  on("prompt.compose", () => ({ sections: [] }));

  await $.prompt.submit(submitted("secret plan"));
  const composed = await $.prompt.compose({} as PromptComposeInput);

  expect(JSON.stringify(composed)).not.toContain("secret plan");
});

test("the pane shows saved notes", async ($, on) => {
  mockEngine(on, "session-a", {
    notes: [
      {
        sessionId: "session-a",
        cwd: "/repo",
        startedAt: "2026-11-12T09:30:00.000Z",
        prompts: ["fix the login bug"],
        files: ["/repo/login.ts"],
        commands: ["pnpm test"],
      },
    ],
  });

  const mountedPane = await $.ui.mount(NOTES_PANE);

  expect(
    (await mountedPane.find({ type: "Text", text: /\/repo$/ }))?.text
  ).toBe("2026-11-12 09:30 UTC  /repo");
  expect(
    (await mountedPane.find({ type: "Text", text: /login bug/ }))?.text
  ).toBe("  > fix the login bug");
  expect(
    (await mountedPane.find({ type: "Text", text: /login\.ts/ }))?.text
  ).toBe("  edited /repo/login.ts");
  expect((await mountedPane.find({ type: "Text", text: /pnpm/ }))?.text).toBe(
    "  $ pnpm test"
  );
  await mountedPane.unmount();
});

test("the pane says when there are no notes", async ($, on) => {
  mockEngine(on, "session-a");

  const mountedPane = await $.ui.mount(NOTES_PANE);

  expect((await mountedPane.find({ type: "Text" }))?.text).toBe(
    "No session notes yet."
  );
  await mountedPane.unmount();
});
