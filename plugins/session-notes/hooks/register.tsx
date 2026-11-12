import type { EngineInterface, Register } from "claude-code";

type SessionNote = {
  sessionId: string;
  cwd: string;
  startedAt: string;
  prompts: string[];
  files: string[];
  commands: string[];
  notes?: string[];
};

type NoteAddition = Partial<
  Pick<SessionNote, "prompts" | "files" | "commands" | "notes">
>;

const NOTES_KEY = "notes";
const NOTES_PANE = "session-notes";
const PANE_TITLE = "Session notes";
const MAX_SESSIONS = 100;
const MAX_ENTRIES_PER_LIST = 100;
const MAX_ENTRY_LENGTH = 500;
const WRITE_NOTE_TOOL_NAME = "write_note";
const QUALIFIED_WRITE_NOTE_TOOL_NAME = `mcp__session-notes__${WRITE_NOTE_TOOL_NAME}`;
const WRITE_NOTE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The note, in plain words." },
  },
  required: ["text"],
};
const SESSION_SUMMARY_TOPIC =
  "a short summary of this session: what was done, what was decided, and what is left to do";
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const readNotes = async (engine: EngineInterface): Promise<SessionNote[]> => {
  const storedNotes = await engine.store.get(NOTES_KEY);
  return Array.isArray(storedNotes) ? (storedNotes as SessionNote[]) : [];
};

const appendEntries = (existing: string[], additions: string[] = []) =>
  [
    ...existing,
    ...additions
      .map((entry) => entry.slice(0, MAX_ENTRY_LENGTH))
      .filter((entry) => !existing.includes(entry)),
  ].slice(-MAX_ENTRIES_PER_LIST);

const mergeIntoNote = (note: SessionNote, addition: NoteAddition) => ({
  ...note,
  prompts: appendEntries(note.prompts, addition.prompts),
  files: appendEntries(note.files, addition.files),
  commands: appendEntries(note.commands, addition.commands),
  notes: appendEntries(note.notes ?? [], addition.notes),
});

let pendingWrite: Promise<void> = Promise.resolve();

const addToSessionNote = (engine: EngineInterface, addition: NoteAddition) => {
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
        prompts: [],
        files: [],
        commands: [],
      };
      const otherNotes = notes.filter((note) => note.sessionId !== sessionId);
      await engine.store.set(
        NOTES_KEY,
        [mergeIntoNote(currentNote, addition), ...otherNotes].slice(
          0,
          MAX_SESSIONS
        )
      );
      engine.ui.invalidate("ui.render");
    })
    .catch(() => undefined);
  return pendingWrite;
};

const describeNoteToolCall = (
  tool: string,
  toolInput: Record<string, unknown>
) => {
  if (FILE_EDIT_TOOLS.has(tool)) {
    const filePath = toolInput.file_path ?? toolInput.notebook_path;
    return typeof filePath === "string" ? { files: [filePath] } : undefined;
  }
  if (tool === "Bash" && typeof toolInput.command === "string") {
    return { commands: [toolInput.command] };
  }
  return undefined;
};

const noteInstructions = new Set<string>();

const buildNoteInstruction = (topic: string) =>
  `Call the ${QUALIFIED_WRITE_NOTE_TOOL_NAME} tool once with ${topic}. Write it in plain words, as short bullets, from what happened in this conversation. Reply with one line saying the note is saved.`;

const askClaudeToWriteNote = (engine: EngineInterface, topic: string) => {
  const instruction = buildNoteInstruction(topic);
  noteInstructions.add(instruction);
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

const writeNote = async (engine: EngineInterface, requestedText: unknown) => {
  const noteText =
    typeof requestedText === "string" ? requestedText.trim() : "";
  if (!noteText) return { deny: "The note needs some text." };
  await addToSessionNote(engine, { notes: [noteText] });
  await openNotesPane(engine);
  return { result: "Note saved and the notes pane opened." };
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
        "Writes a note to this session's notes and opens the notes pane. Call it when the user asks you to note, jot down or remember something for this session.",
      inputSchema: WRITE_NOTE_TOOL_SCHEMA,
      isDeferred: false,
    });
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
      requestedTopic ? `a note about: ${requestedTopic}` : SESSION_SUMMARY_TOPIC
    );
    return { text: "Writing a session note…" };
  });

  on("prompt.submit", async ($, e, next) => {
    const isNoteInstruction = noteInstructions.delete(e.text);
    const isUserPrompt =
      !e.command && !isNoteInstruction && e.text.trim() !== "";
    if (isUserPrompt) await addToSessionNote($, { prompts: [e.text.trim()] });
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    const toolInput = e as unknown as Record<string, unknown>;
    if (e.tool === (QUALIFIED_WRITE_NOTE_TOOL_NAME as string))
      return writeNote($, toolInput.text);
    const addition = describeNoteToolCall(e.tool, toolInput);
    if (addition) await addToSessionNote($, addition);
    return next(e);
  });

  on(
    "ui.render",
    { component: "Pane", requestId: NOTES_PANE },
    async ($, e) => {
      const { Box, Text } = $.ui.resolve(e);
      const notes = await readNotes($);
      if (notes.length === 0)
        return <Text dimColor>No session notes yet.</Text>;

      return (
        <Box flexDirection="column">
          {notes.map((note) => (
            <Box flexDirection="column" marginBottom={1}>
              <Text
                bold
              >{`${formatStartTime(note.startedAt)}  ${note.cwd}`}</Text>
              {note.prompts.map((prompt) => (
                <Text>{`  > ${prompt}`}</Text>
              ))}
              {(note.notes ?? []).map((noteText) => (
                <Text>{`  note ${noteText}`}</Text>
              ))}
              {note.files.map((filePath) => (
                <Text dimColor>{`  edited ${filePath}`}</Text>
              ))}
              {note.commands.map((command) => (
                <Text dimColor>{`  $ ${command}`}</Text>
              ))}
            </Box>
          ))}
        </Box>
      );
    }
  );
};
