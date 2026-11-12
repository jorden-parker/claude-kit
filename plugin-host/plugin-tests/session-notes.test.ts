import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { startPlugin, TARGET_NAMES, type TargetName } from "../testing";

const execute = promisify(execFile);
const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const TERMINAL_BROWSER = join(
  REPOSITORY_ROOT,
  "plugins/session-notes/bin/session-notes"
);
const FIRST_NOTE = "- [ ] ship the parser\n\n## Done\n- wrote the tokenizer";
const SECOND_NOTE = "## Done\n- ship the parser";

const readStore = async (storePath: string) =>
  JSON.parse(await readFile(storePath, "utf8"));

const storedNoteTexts = async (storePath: string) =>
  (await readStore(storePath)).notes?.flatMap(
    (session: { notes?: string[] }) => session.notes ?? []
  ) ?? [];

const portableCommandPath = (target: TargetName, installedFolder: string) =>
  join(
    installedFolder,
    target === "qwen" ? "commands" : "prompts",
    "notes.md"
  );

for (const target of TARGET_NAMES) {
  test(`${target}: write_note saves a note to the store, and an empty one is denied`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      const saved = await plugin.callTool("write_note", { text: FIRST_NOTE });
      expect(saved).toMatchObject({ isError: false });
      expect(saved.text).toContain("Note saved");

      const stored = await readStore(plugin.storePath);
      expect(Object.keys(stored)).toEqual(["notes"]);
      expect(stored.notes).toHaveLength(1);
      expect(stored.notes[0]).toMatchObject({
        sessionId: expect.any(String),
        cwd: expect.any(String),
        startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        notes: [FIRST_NOTE],
      });

      expect(await plugin.callTool("write_note", { text: "   " })).toEqual({
        text: "The note needs some text.",
        isError: true,
      });
      expect(await storedNoteTexts(plugin.storePath)).toEqual([FIRST_NOTE]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: amend_note replaces a note in the store, and an unknown note is denied`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      await plugin.callTool("write_note", { text: FIRST_NOTE });

      const amended = await plugin.callTool("amend_note", {
        old: FIRST_NOTE,
        text: SECOND_NOTE,
      });
      expect(amended).toMatchObject({ isError: false });
      expect(amended.text).toContain("Note amended");
      expect(await storedNoteTexts(plugin.storePath)).toEqual([SECOND_NOTE]);

      expect(
        await plugin.callTool("amend_note", { old: "no such note", text: "x" })
      ).toEqual({
        text: 'No note in this session reads "no such note".',
        isError: true,
      });
      expect(await storedNoteTexts(plugin.storePath)).toEqual([SECOND_NOTE]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: delete_note removes a note from the store, and an unknown note is denied`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      await plugin.callTool("write_note", { text: FIRST_NOTE });

      const deleted = await plugin.callTool("delete_note", { text: FIRST_NOTE });
      expect(deleted).toMatchObject({ isError: false });
      expect(deleted.text).toContain("Note deleted");
      expect(await readStore(plugin.storePath)).toEqual({ notes: [] });

      expect(
        await plugin.callTool("delete_note", { text: FIRST_NOTE })
      ).toEqual({
        text: `No note in this session reads "${FIRST_NOTE}".`,
        isError: true,
      });
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: run_note asks the model to write a note about the topic, or a summary without one`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      const withTopic = await plugin.callTool("run_note", {
        args: "the parser rewrite",
      });
      expect(withTopic.isError).toBe(false);
      expect(withTopic.text).toContain("Now carry out these instructions:");
      expect(withTopic.text).toContain("mcp__session-notes__write_note");
      expect(withTopic.text).toContain("a note about: the parser rewrite.");

      const withoutTopic = await plugin.callTool("run_note", { args: "" });
      expect(withoutTopic.isError).toBe(false);
      expect(withoutTopic.text).toContain("mcp__session-notes__write_note");
      expect(withoutTopic.text).toContain("## Left to do");
      expect(withoutTopic.text).toContain("## Done");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: the terminal browser lists the notes that the tools wrote`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      await plugin.callTool("write_note", { text: FIRST_NOTE });

      const { stdout } = await execute(TERMINAL_BROWSER, ["list"], {
        env: { ...process.env, SESSION_NOTES_STORE: plugin.storePath },
      });
      expect(stdout).toContain(" UTC · ");
      expect(stdout).toContain("  note 1 - [ ] ship the parser");
      expect(stdout).toContain("## Done");
      expect(stdout).toContain("- wrote the tokenizer");
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: /notes is a portable command that shows the terminal command and does not call run_notes`, async () => {
    const plugin = await startPlugin(target, "session-notes");
    try {
      const commandText = await readFile(
        portableCommandPath(target, plugin.installedFolder),
        "utf8"
      );
      expect(commandText).toContain("SESSION_NOTES_STORE=");
      expect(commandText).toContain("session-notes");
      expect(commandText).toContain("~/.qwen/claude-kit-store/session-notes.json");
      expect(commandText).toContain("~/.pi/agent/claude-kit-store/session-notes.json");
      expect(commandText).not.toContain("run_notes");
    } finally {
      await plugin.stop();
    }
  });
}
