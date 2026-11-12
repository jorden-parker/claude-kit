import type { EngineInterface, Register } from "claude-code";

type SessionNote = {
  sessionId: string;
  cwd: string;
  startedAt: string;
  notes?: string[];
};

const NOTES_KEY = "notes";
const NOTES_PANE = "session-notes";
const PANE_TITLE = "Session notes";
const MAX_SESSIONS = 100;
const MAX_ENTRIES_PER_LIST = 100;
const WRITE_NOTE_TOOL_NAME = "write_note";
const QUALIFIED_WRITE_NOTE_TOOL_NAME = `mcp__session-notes__${WRITE_NOTE_TOOL_NAME}`;
const WRITE_NOTE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description:
        "The note in short Markdown: what is left to do first, then what was done. Outcomes only, never tool calls or commands.",
    },
  },
  required: ["text"],
};
const AMEND_NOTE_TOOL_NAME = "amend_note";
const QUALIFIED_AMEND_NOTE_TOOL_NAME = `mcp__session-notes__${AMEND_NOTE_TOOL_NAME}`;
const AMEND_NOTE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    old: {
      type: "string",
      description: "The exact text of the note to change, as you wrote it.",
    },
    text: { type: "string", description: "The new note, in plain words." },
  },
  required: ["old", "text"],
};
const DELETE_NOTE_TOOL_NAME = "delete_note";
const QUALIFIED_DELETE_NOTE_TOOL_NAME = `mcp__session-notes__${DELETE_NOTE_TOOL_NAME}`;
const DELETE_NOTE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    text: {
      type: "string",
      description: "The exact text of the note to delete, as you wrote it.",
    },
  },
  required: ["text"],
};
const SESSION_SUMMARY_TOPIC = `a short summary of this session, in exactly this Markdown shape:

## Left to do
- [ ] each unfinished task, open question, blocker or follow-up, most important first (write "- Nothing" when all is done)

## Done
- each result of the session: what changed, what was decided and why`;
const NOTE_WRITING_RULES =
  "Lead with anything still to do. Write outcomes in plain words, one idea per bullet, kept short. Leave out tool calls, commands, file reads, logs, code and step-by-step narration.";

const readNotes = async (engine: EngineInterface): Promise<SessionNote[]> => {
  const storedNotes = await engine.store.get(NOTES_KEY);
  return Array.isArray(storedNotes) ? (storedNotes as SessionNote[]) : [];
};

const hasNotes = (session: SessionNote) => (session.notes ?? []).length > 0;

const appendEntries = (existing: string[], additions: string[] = []) =>
  [
    ...existing,
    ...additions.filter((entry) => !existing.includes(entry)),
  ].slice(-MAX_ENTRIES_PER_LIST);

let pendingWrite: Promise<void> = Promise.resolve();

const addToSessionNote = (engine: EngineInterface, noteText: string) => {
  pendingWrite = pendingWrite
    .then(async () => {
      const sessionId = await engine.session.id();
      const notes = await readNotes(engine);
      const currentNote = notes.find(
        (note) => note.sessionId === sessionId
      ) ?? {
        sessionId,
        cwd: await engine.session.cwd(),
        startedAt: new Date().toISOString(),
      };
      const otherNotes = notes.filter(
        (note) => note.sessionId !== sessionId && hasNotes(note)
      );
      await engine.store.set(
        NOTES_KEY,
        [
          {
            ...currentNote,
            notes: appendEntries(currentNote.notes ?? [], [noteText]),
          },
          ...otherNotes,
        ].slice(0, MAX_SESSIONS)
      );
      engine.ui.invalidate("ui.render");
    })
    .catch(() => undefined);
  return pendingWrite;
};

const replaceSessionNote = (
  engine: EngineInterface,
  oldText: string,
  replacementNotes: string[]
) => {
  const amendment = pendingWrite
    .then(async () => {
      const sessionId = await engine.session.id();
      const notes = await readNotes(engine);
      const currentNote = notes.find((note) => note.sessionId === sessionId);
      const sessionNotes = currentNote?.notes ?? [];
      if (!sessionNotes.includes(oldText)) return false;
      const amendedNotes = sessionNotes.flatMap((noteText) =>
        noteText === oldText ? replacementNotes : [noteText]
      );
      await engine.store.set(
        NOTES_KEY,
        notes
          .map((note) =>
            note === currentNote ? { ...note, notes: amendedNotes } : note
          )
          .filter(hasNotes)
      );
      engine.ui.invalidate("ui.render");
      return true;
    })
    .catch(() => false);
  pendingWrite = amendment.then(() => undefined);
  return amendment;
};

const buildNoteInstruction = (topic: string) =>
  `Call the ${QUALIFIED_WRITE_NOTE_TOOL_NAME} tool once with ${topic}

Write it from what happened in this conversation. ${NOTE_WRITING_RULES} Reply with one line saying the note is saved.`;

const askClaudeToWriteNote = (engine: EngineInterface, topic: string) => {
  const instruction = buildNoteInstruction(topic);
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

const trimText = (requestedText: unknown) =>
  typeof requestedText === "string" ? requestedText.trim() : "";

const writeNote = async (engine: EngineInterface, requestedText: unknown) => {
  const noteText = trimText(requestedText);
  if (!noteText) return { deny: "The note needs some text." };
  await addToSessionNote(engine, noteText);
  await openNotesPane(engine);
  return { result: "Note saved and the notes pane opened." };
};

const amendNote = async (
  engine: EngineInterface,
  requestedOldText: unknown,
  requestedText: unknown
) => {
  const oldText = trimText(requestedOldText);
  const noteText = trimText(requestedText);
  if (!noteText) return { deny: "The note needs some text." };
  const isAmended = await replaceSessionNote(engine, oldText, [noteText]);
  if (!isAmended)
    return { deny: `No note in this session reads "${oldText}".` };
  await openNotesPane(engine);
  return { result: "Note amended and the notes pane opened." };
};

const deleteNote = async (engine: EngineInterface, requestedText: unknown) => {
  const noteText = trimText(requestedText);
  const isDeleted = await replaceSessionNote(engine, noteText, []);
  if (!isDeleted)
    return { deny: `No note in this session reads "${noteText}".` };
  await openNotesPane(engine);
  return { result: "Note deleted and the notes pane opened." };
};

const formatNoteLine = (line: string) => {
  const heading =
    line.match(/^#{1,6}\s+(.*)$/) ?? line.match(/^\*\*(.+?)\*\*:?$/);
  if (heading) return { isHeading: true, text: heading[1]!.trim() };
  const bullet = line.match(/^(\s*)[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/);
  if (!bullet) return { isHeading: false, text: line.trim() };
  const [, indent, checkbox, bulletText] = bullet;
  const marker = checkbox === undefined ? "•" : checkbox === " " ? "○" : "✓";
  return { isHeading: false, text: `${indent}${marker} ${bulletText}` };
};

const formatStartTime = (startedAt: string) =>
  `${startedAt.slice(0, 10)} ${startedAt.slice(11, 16)} UTC`;

const openNotesPane = (engine: EngineInterface) =>
  engine.ui.open({ id: NOTES_PANE, title: PANE_TITLE });

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "notes",
      description: "Show the notes kept for each session in a pane",
    });
    await $.command.register({
      name: "note",
      description:
        "Have Claude note a summary of the session and what is left, or what you name after /note",
    });
    await $.tool.register({
      name: WRITE_NOTE_TOOL_NAME,
      description:
        "Writes a note to this session's notes and opens the notes pane. Call it when the user asks you to note, jot down or remember something for this session. Put what is left to do first, then what was done, as short Markdown bullets under ## headings. Never include tool calls, commands, file reads or other session transcript.",
      inputSchema: WRITE_NOTE_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: AMEND_NOTE_TOOL_NAME,
      description:
        "Replaces one of this session's notes with new text and opens the notes pane. Call it when the user asks you to amend, correct or update a note you already wrote.",
      inputSchema: AMEND_NOTE_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: DELETE_NOTE_TOOL_NAME,
      description:
        "Deletes one of this session's notes and opens the notes pane. Call it when the user asks you to delete or remove a note you already wrote.",
      inputSchema: DELETE_NOTE_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.process
      .run(["bash", `${$.plugin.root}/hooks/link-session-notes.sh`])
      .catch(() => undefined);
    return next(e);
  });

  on("command.run", { command: "notes" }, async ($) => {
    await openNotesPane($);
    return { text: "Session notes pane opened." };
  });

  on("command.run", { command: "note" }, async ($, e) => {
    const requestedTopic = e.args.trim();
    askClaudeToWriteNote(
      $,
      requestedTopic
        ? `a note about: ${requestedTopic}.`
        : SESSION_SUMMARY_TOPIC
    );
    return { text: "Writing a session note…" };
  });

  on("tool.call", async ($, e, next) => {
    const toolInput = e as unknown as Record<string, unknown>;
    if (e.tool === (QUALIFIED_WRITE_NOTE_TOOL_NAME as string))
      return writeNote($, toolInput.text);
    if (e.tool === (QUALIFIED_AMEND_NOTE_TOOL_NAME as string))
      return amendNote($, toolInput.old, toolInput.text);
    if (e.tool === (QUALIFIED_DELETE_NOTE_TOOL_NAME as string))
      return deleteNote($, toolInput.text);
    return next(e);
  });

  on(
    "ui.render",
    { component: "Pane", requestId: NOTES_PANE },
    async ($, e) => {
      const { Box, Text } = $.ui.resolve(e);
      const notedSessions = (await readNotes($)).filter(hasNotes);
      if (notedSessions.length === 0)
        return (
          <Text dimColor>
            No notes yet. Ask Claude to note something, or run /note.
          </Text>
        );

      return (
        <Box flexDirection="column">
          {notedSessions.map((session) => (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="magenta">
                {`${formatStartTime(session.startedAt)} · ${session.cwd}`}
              </Text>
              {(session.notes ?? []).map((noteText) => (
                <Box flexDirection="column" marginTop={1}>
                  {noteText
                    .split("\n")
                    .map(formatNoteLine)
                    .map((line) =>
                      line.isHeading ? (
                        <Text bold color="cyan">
                          {line.text}
                        </Text>
                      ) : (
                        <Text>{`  ${line.text}`}</Text>
                      )
                    )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      );
    }
  );
};
