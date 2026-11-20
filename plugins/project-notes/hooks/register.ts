import type { EngineInterface, Register } from "claude-code";
import {
  auditNoteFolders,
  moveNoteFolder,
  NOTE_STORES,
  QUALIFIED_MOVE_TOOL_NAME,
  resolveRepositoryFolder,
  toProjectName,
} from "./note-folders";

type LegacySession = {
  sessionId: string;
  cwd: string;
  startedAt: string;
  notes?: string[];
};

type LegacyNote = {
  source: string;
  folder: string;
  created: string;
  text: string;
};

const CATEGORIES = ["fact", "finding", "decision", "reference", "debugging"];
const DEBUGGING_CATEGORY = "debugging";
const DEBUGGING_SECTIONS = [
  "Why these steps",
  "Steps taken",
  "Evidence",
  "Findings",
  "Next steps",
  "Draft Shortcut ticket",
];
const SOURCE_FIELD = "source: ";
const SOURCE_LINE_PATTERN = `^${SOURCE_FIELD}`;
const LEGACY_BATCH_SIZE = 10;
const MAX_SLUG_LENGTH = 60;
const NOTES_COMMAND_PREFIX = "/project-notes ";
const SUBCOMMAND_SUGGESTIONS = [
  {
    text: "organise",
    description: "File the existing session notes as project notes",
  },
  {
    text: "audit",
    description:
      "Move notes, handoffs, plans and brainstorms saved under a worktree's name to the repository's name",
  },
];
const AUDIT_TOOL_NAME = "audit_note_folders";
const QUALIFIED_AUDIT_TOOL_NAME = `mcp__project-notes__${AUDIT_TOOL_NAME}`;
const MOVE_TOOL_NAME = "move_note_folder";
const STORE_NAMES = NOTE_STORES.map((store) => store.name);
const AUDIT_INSTRUCTION = `Call ${QUALIFIED_AUDIT_TOOL_NAME}. Show the user its report. For each misplaced folder, call ${QUALIFIED_MOVE_TOOL_NAME} with its store, from and to. For each folder with no repository found, ask the user which repository it belongs to, or whether to leave it, and move it only on their answer. Reply with one line per move made.`;
const WRITE_TOOL_NAME = "write_project_note";
const QUALIFIED_WRITE_TOOL_NAME = `mcp__project-notes__${WRITE_TOOL_NAME}`;
const LIST_LEGACY_TOOL_NAME = "list_legacy_notes";
const QUALIFIED_LIST_LEGACY_TOOL_NAME = `mcp__project-notes__${LIST_LEGACY_TOOL_NAME}`;
const DEBUGGING_RULES = `The rest applies to a ${DEBUGGING_CATEGORY} note only, never to the other categories. Load the humanizer skill with the Skill tool first and write the prose by its rules. Its body must hold these "## " headings, in this order: ${DEBUGGING_SECTIONS.join(", ")}. "Why these steps" says why those steps were chosen to reproduce the issue; "Steps taken" gives every step in detail, with the commands and inputs used; "Evidence" quotes the logs, output and file:line that back the findings; "Draft Shortcut ticket" holds a title, type, description, steps to reproduce, expected and actual result, and acceptance criteria. The ticket is a draft inside the note only: never create it on Shortcut and never call a Shortcut tool.`;
const WRITE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: CATEGORIES,
      description:
        "fact: something true about the project. finding: something learned or observed during work. decision: a choice made and why. reference: where something lives (a file, URL, dashboard or command). debugging: the investigation of a bug or error.",
    },
    title: { type: "string", description: "A short title, under 10 words." },
    body: { type: "string", description: "The note, in Markdown." },
    project: {
      type: "string",
      description:
        "Only when the note belongs to another project than this session's: that project's folder name.",
    },
    created: {
      type: "string",
      description:
        "Only when filing an older note: the ISO date it was first written.",
    },
    source: {
      type: "string",
      description: `Only when filing a note that ${LIST_LEGACY_TOOL_NAME} listed: its source id.`,
    },
  },
  required: ["category", "title", "body"],
};
const ORGANISE_INSTRUCTION = `Call ${QUALIFIED_LIST_LEGACY_TOOL_NAME} to get the session notes not yet filed as project notes. File each one with a single ${QUALIFIED_WRITE_TOOL_NAME} call: pass its source, project and created exactly as listed, the category that fits best, a short title, and the note's content as the body, reworded only as far as it needs to stand alone.

Use ${DEBUGGING_CATEGORY} only for a note that records a bug or error investigation. Give it all six sections from what the note says and write "Not recorded." under a section the note says nothing about. Never invent steps or evidence.

Call ${QUALIFIED_LIST_LEGACY_TOOL_NAME} again until it says none are left, then reply with a count of notes per project and category.`;

let isHumanizerLoaded = false;
let hasAskedForHumanizer = false;

const trimText = (requestedText: unknown) =>
  typeof requestedText === "string" ? requestedText.trim() : "";

const toSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, "");

const findRepositoryFolder = async (engine: EngineInterface) =>
  resolveRepositoryFolder(engine, await engine.session.root());

const toCreatedTime = (requestedCreated: string) => {
  const createdTime = new Date(requestedCreated || Date.now());
  return (
    Number.isNaN(createdTime.getTime()) ? new Date() : createdTime
  ).toISOString();
};

const readHomeFolder = async (engine: EngineInterface) =>
  (await engine.env.get("HOME")) ?? "";

const resolveNotesRoot = async (engine: EngineInterface) =>
  (await engine.env.get("PROJECT_NOTES_DIR")) ??
  `${await readHomeFolder(engine)}/.claude/project-notes`;

const findFreeNotePath = async (engine: EngineInterface, basePath: string) => {
  let notePath = `${basePath}.md`;
  for (let copyNumber = 2; await engine.fs.exists(notePath); copyNumber++)
    notePath = `${basePath}-${copyNumber}.md`;
  return notePath;
};

const listMissingSections = (body: string) =>
  DEBUGGING_SECTIONS.filter(
    (section) => !new RegExp(`^##\\s+${section}\\s*$`, "im").test(body)
  );

const readFiledSources = async (engine: EngineInterface) => {
  const sourceLines = await engine.process
    .run([
      "grep",
      "-rhs",
      "--include=*.md",
      SOURCE_LINE_PATTERN,
      await resolveNotesRoot(engine),
    ])
    .then((outcome) => outcome.stdout)
    .catch(() => "");
  return sourceLines
    .split("\n")
    .map((line) => line.slice(SOURCE_FIELD.length).trim());
};

const refuseDebuggingNote = (body: string) => {
  const missingSections = listMissingSections(body);
  if (missingSections.length > 0)
    return `A ${DEBUGGING_CATEGORY} note needs every section. Missing: ${missingSections
      .map((section) => `## ${section}`)
      .join(
        ", "
      )}. Add each as a heading with its content and call this tool again.`;
  if (isHumanizerLoaded || hasAskedForHumanizer) return undefined;
  hasAskedForHumanizer = true;
  return 'Load the humanizer skill first (Skill tool, skill "humanizer"), rewrite the note\'s prose by its rules, then call this tool again. If no humanizer skill is installed, call this tool again unchanged.';
};

const writeProjectNote = async (
  engine: EngineInterface,
  toolInput: Record<string, unknown>
) => {
  const category = trimText(toolInput.category);
  const title = trimText(toolInput.title).replace(/\s+/g, " ");
  const body = trimText(toolInput.body);
  const source = trimText(toolInput.source);
  const projectName = toProjectName(
    trimText(toolInput.project) || (await findRepositoryFolder(engine))
  );
  if (!CATEGORIES.includes(category))
    return { deny: `The category must be one of: ${CATEGORIES.join(", ")}.` };
  if (!toSlug(title))
    return { deny: "The note needs a title with letters or digits." };
  if (!body) return { deny: "The note needs a body." };
  if (!projectName)
    return { deny: "The project name needs letters or digits." };
  const refusal =
    category === DEBUGGING_CATEGORY ? refuseDebuggingNote(body) : undefined;
  if (refusal) return { deny: refusal };

  const created = toCreatedTime(trimText(toolInput.created));
  const notePath = await findFreeNotePath(
    engine,
    `${await resolveNotesRoot(engine)}/${projectName}/${category}/${created.slice(0, 10)}-${toSlug(title)}`
  );
  const frontMatter = [
    `title: ${title}`,
    `project: ${projectName}`,
    `created: ${created}`,
    `category: ${category}`,
    ...(source ? [`${SOURCE_FIELD}${source}`] : []),
  ].join("\n");
  await engine.fs.write(notePath, `---\n${frontMatter}\n---\n\n${body}\n`);
  return { result: `Note saved to ${notePath}` };
};

const hashText = (text: string) =>
  [...text]
    .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7)
    .toString(36);

const readLegacySessions = async (engine: EngineInterface) => {
  const configFolder =
    (await engine.env.get("CLAUDE_CONFIG_DIR")) ??
    `${await readHomeFolder(engine)}/.claude`;
  const storeFolder = `${configFolder}/plugins/store`;
  const storeEntries = await engine.fs.list(storeFolder).catch(() => []);
  const storeTexts = await Promise.all(
    storeEntries
      .filter((entry) => /^session-notes_.*\.json$/.test(entry.name))
      .map((entry) => engine.fs.read(`${storeFolder}/${entry.name}`))
  );
  return storeTexts.flatMap((storeText) => {
    try {
      const sessions = JSON.parse(String(storeText)).notes;
      return Array.isArray(sessions) ? (sessions as LegacySession[]) : [];
    } catch {
      return [];
    }
  });
};

const listUnfiledNotes = async (engine: EngineInterface) => {
  const filedSources = await readFiledSources(engine);
  return (await readLegacySessions(engine))
    .flatMap((session) =>
      (session.notes ?? []).map((text): LegacyNote => ({
        source: `${String(session.sessionId).slice(0, 8)}-${hashText(text)}`,
        folder: String(session.cwd),
        created: String(session.startedAt),
        text,
      }))
    )
    .filter((note) => !filedSources.includes(note.source));
};

const resolveLegacyProject = async (
  engine: EngineInterface,
  folder: string
) => {
  return (
    toProjectName(await resolveRepositoryFolder(engine, folder)) || "unknown"
  );
};

const listLegacyNotes = async (engine: EngineInterface) => {
  const unfiledNotes = await listUnfiledNotes(engine);
  if (unfiledNotes.length === 0)
    return { result: "No session notes are left to file." };
  const shownNotes = unfiledNotes.slice(0, LEGACY_BATCH_SIZE);
  const describedNotes = await Promise.all(
    shownNotes.map(
      async (note) =>
        `---\nsource: ${note.source}\nproject: ${await resolveLegacyProject(engine, note.folder)}\ncreated: ${note.created}\n\n${note.text}`
    )
  );
  const countLine =
    unfiledNotes.length === 1
      ? "1 session note is not filed yet."
      : `${unfiledNotes.length} session notes are not filed yet, ${shownNotes.length} shown.`;
  return {
    result: `${countLine} File each with ${QUALIFIED_WRITE_TOOL_NAME}, passing its source, project and created.\n\n${describedNotes.join("\n\n")}`,
  };
};

const askClaude = (engine: EngineInterface, instruction: string) => {
  engine.clock.after(0, () => void engine.prompt.submit({ text: instruction }));
};

const VIEWER_HINT =
  "Run claude-notes in a terminal to browse every project note. /project-notes organise files existing session notes as project notes. /project-notes audit moves notes saved under a worktree's name to the repository's name.";

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "project-note",
      description:
        "Have Claude write a categorised project note about what you name, or about what this session learned",
      argumentHint: "[topic]",
    });
    await $.command.register({
      name: "project-notes",
      description:
        "/project-notes organise files existing session notes as project notes; /project-notes audit moves notes saved under a worktree's name to the repository's name",
      argumentHint: "organise | audit",
    });
    await $.tool.register({
      name: WRITE_TOOL_NAME,
      description: `Saves one note about a project as a Markdown file under ~/.claude/project-notes/<project>/<category>/. Call it when the user asks for a project note, or when the work turned up something a later session on this project should know. One note per separate thing. ${DEBUGGING_RULES}`,
      inputSchema: WRITE_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: LIST_LEGACY_TOOL_NAME,
      description: `Lists the session notes (from the session-notes plugin) not yet filed as project notes, ${LEGACY_BATCH_SIZE} at a time, each with a source id, project and date. Call it when the user asks to organise or migrate existing notes, then file each with ${WRITE_TOOL_NAME}.`,
      inputSchema: { type: "object", properties: {} },
      isDeferred: false,
    });
    await $.tool.register({
      name: AUDIT_TOOL_NAME,
      description: `Audits the saved ${STORE_NAMES.join(", ")} folders under ~/.claude and reports each project folder named after a worktree or other folder instead of its git repository, with the repository it belongs to, plus folders it cannot tie to a repository. Changes nothing. Call it when the user asks to audit, check or tidy where notes, handoffs, plans or brainstorms are saved.`,
      inputSchema: { type: "object", properties: {} },
      isDeferred: false,
    });
    await $.tool.register({
      name: MOVE_TOOL_NAME,
      description: `Moves every file of one project folder in a store into another project folder of the same store, keeping both files when a name is taken, renumbering moved handoffs after the target's newest, and rewriting each Markdown file's project: line. Call it for each misplaced folder ${AUDIT_TOOL_NAME} reports, or one the user names.`,
      inputSchema: {
        type: "object",
        properties: {
          store: { type: "string", enum: STORE_NAMES },
          from: {
            type: "string",
            description: "The misplaced project folder's name.",
          },
          to: {
            type: "string",
            description: "The repository's name to move it under.",
          },
        },
        required: ["store", "from", "to"],
      },
      isDeferred: false,
    });
    return next(e);
  });

  on("command.run", { command: "project-note" }, async ($, e) => {
    const requestedTopic = e.args.trim();
    askClaude(
      $,
      `Call the ${QUALIFIED_WRITE_TOOL_NAME} tool with a project note about: ${
        requestedTopic ||
        "what this session learned that a later session on this project should know, one call per separate thing"
      }. Write it from what happened in this conversation and pick the category that fits. Reply with one line naming each saved file.`
    );
    return { text: "Writing a project note…" };
  });

  on("command.run", { command: "project-notes" }, async ($, e) => {
    if (/^audit$/i.test(e.args.trim())) {
      askClaude($, AUDIT_INSTRUCTION);
      return {
        text: "Auditing where notes, handoffs, plans and brainstorms are saved…",
      };
    }
    if (!/^organi[sz]e$/i.test(e.args.trim())) return { text: VIEWER_HINT };
    askClaude($, ORGANISE_INSTRUCTION);
    return { text: "Filing the existing session notes as project notes…" };
  });

  on("tool.call", async ($, e, next) => {
    const toolInput = e as unknown as Record<string, unknown>;
    if (e.tool === (QUALIFIED_WRITE_TOOL_NAME as string))
      return writeProjectNote($, toolInput);
    if (e.tool === (QUALIFIED_LIST_LEGACY_TOOL_NAME as string))
      return listLegacyNotes($);
    if (e.tool === (QUALIFIED_AUDIT_TOOL_NAME as string))
      return { result: await auditNoteFolders($) };
    if (e.tool === (QUALIFIED_MOVE_TOOL_NAME as string))
      return moveNoteFolder($, toolInput);
    if (e.tool === "Skill" && /humanizer/i.test(String(toolInput.skill)))
      isHumanizerLoaded = true;
    return next(e);
  });

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstArgument =
      e.text.startsWith(NOTES_COMMAND_PREFIX) &&
      e.start === NOTES_COMMAND_PREFIX.length;
    if (!isFirstArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingSubcommands = SUBCOMMAND_SUGGESTIONS.filter((subcommand) =>
      subcommand.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingSubcommands] };
  });
};
