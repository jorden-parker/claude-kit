import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const WRITE_TOOL = "mcp__project-notes__write_project_note";
const LIST_TOOL = "mcp__project-notes__list_legacy_notes";
const NOTES_ROOT = "/home/tester/.claude/project-notes";
const SESSION_NOTES_STORE =
  "/home/tester/.claude/plugins/store/session-notes_claude-kit-abc.json";

const DEBUGGING_BODY = `## Why these steps
The error only shows after a token refresh, so the steps force one.

## Steps taken
1. Logged in and waited for the token to expire.

## Evidence
\`401\` on \`GET /profile\` with a fresh token.

## Findings
The refresh handler keeps the old token in memory.

## Next steps
- Clear the cached token on refresh.

## Draft Shortcut ticket
**Title:** Profile request fails after token refresh
**Type:** Bug`;

const LEGACY_STORE = JSON.stringify({
  notes: [
    {
      sessionId: "11111111-aaaa",
      cwd: "/work/claude-kit/plugins/session-notes",
      startedAt: "2026-11-16T13:14:42.314Z",
      notes: ["The login bug was a stale cookie", "Deploy moved to Monday"],
    },
  ],
});

type Recorded = {
  files: Map<string, string>;
  submittedPrompts: string[];
  commands: string[][];
};

const parentFolder = (path: string) => path.slice(0, path.lastIndexOf("/"));

const mockEngine = (
  on: On,
  seededFiles: Record<string, string> = {},
  environment: Record<string, string> = {},
  sessionRoot = "/work/claude-kit"
): Recorded => {
  const recorded: Recorded = {
    files: new Map(Object.entries(seededFiles)),
    submittedPrompts: [],
    commands: [],
  };
  on("env.get", (_, e) => ({
    value: { HOME: "/home/tester", ...environment }[e.name],
  }));
  on("session.root", () => ({ value: sessionRoot }));
  on("fs.exists", (_, e) => ({ value: recorded.files.has(e.path) }));
  on("fs.write", (_, e) => {
    recorded.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", (_, e) => ({ value: recorded.files.get(e.path) ?? "" }));
  on("fs.list", (_, e) => ({
    value: [...recorded.files.keys()]
      .filter((path) => parentFolder(path) === e.path)
      .map((path) => ({
        name: path.slice(e.path.length + 1),
        kind: "file" as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }));
  on("process.run", (_, e) => {
    recorded.commands.push([...e.argv]);
    const sourceLines = [...recorded.files.values()].flatMap(
      (text) => text.match(/^source: .*$/gm) ?? []
    );
    const outputByProgram: Record<string, string> = {
      git: "/work/claude-kit\n",
      grep: sourceLines.join("\n"),
    };
    return {
      value: {
        exitCode: 0,
        stdout: outputByProgram[e.argv[0] ?? ""] ?? "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("prompt.submit", (_, e) => {
    recorded.submittedPrompts.push(e.text);
    return { text: e.text };
  });
  on("tool.call", () => ({ result: {} }));
  return recorded;
};

const callTool = ($: Engine, tool: string, toolInput: object = {}) =>
  $.tool.call({ tool, ...toolInput } as never) as Promise<{
    result?: string;
    deny?: string;
  }>;

const loadHumanizer = ($: Engine) =>
  callTool($, "Skill", { skill: "humanizer" });

test("a note is saved under its project and category", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Store lives in ~/.claude: one file per plugin!",
    body: "Each plugin has its own store file.",
    created: "2026-11-19T10:00:00.000Z",
  });

  const notePath = `${NOTES_ROOT}/claude-kit/fact/2026-11-19-store-lives-in-claude-one-file-per-plugin.md`;
  expect(reply.result).toContain(notePath);
  expect(files.get(notePath)).toBe(`---
title: Store lives in ~/.claude: one file per plugin!
project: claude-kit
created: 2026-11-19T10:00:00.000Z
category: fact
---

Each plugin has its own store file.
`);
});

test("a note written in a worktree is filed under the main repository's name", async ($, on) => {
  const { files } = mockEngine(on, {}, {}, "/work/kit-worktree");

  await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Worktrees share notes",
    body: "One project folder per repository.",
    created: "2026-11-19",
  });

  expect([...files.keys()]).toEqual([
    `${NOTES_ROOT}/claude-kit/fact/2026-11-19-worktrees-share-notes.md`,
  ]);
});

test("a note without a date is dated today", async ($, on) => {
  const { files } = mockEngine(on);

  await callTool($, WRITE_TOOL, {
    category: "decision",
    title: "Use Go for the viewer",
    body: "It already renders session notes.",
  });

  expect([...files.keys()]).toEqual([
    expect.stringMatching(
      /\/claude-kit\/decision\/\d{4}-\d{2}-\d{2}-use-go-for-the-viewer\.md$/
    ),
  ]);
});

test("PROJECT_NOTES_DIR moves the notes folder", async ($, on) => {
  const { files } = mockEngine(on, {}, { PROJECT_NOTES_DIR: "/elsewhere" });

  await callTool($, WRITE_TOOL, {
    category: "reference",
    title: "Types file",
    body: "The API types are in claude-code.d.ts.",
    created: "2026-11-19",
  });

  expect([...files.keys()]).toEqual([
    "/elsewhere/claude-kit/reference/2026-11-19-types-file.md",
  ]);
});

test("a second note with the same title keeps both files", async ($, on) => {
  const { files } = mockEngine(on);
  const sameNote = {
    category: "finding",
    title: "Same title",
    body: "First.",
    created: "2026-11-19",
  };

  await callTool($, WRITE_TOOL, sameNote);
  await callTool($, WRITE_TOOL, { ...sameNote, body: "Second." });

  expect([...files.keys()]).toEqual([
    `${NOTES_ROOT}/claude-kit/finding/2026-11-19-same-title.md`,
    `${NOTES_ROOT}/claude-kit/finding/2026-11-19-same-title-2.md`,
  ]);
});

test("an unknown category is refused and nothing is written", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    category: "musing",
    title: "Thought",
    body: "Hmm.",
  });

  expect(reply.deny).toContain("fact, finding, decision, reference, debugging");
  expect(files.size).toBe(0);
});

test("a note without a title or body is refused", async ($, on) => {
  const { files } = mockEngine(on);

  const untitled = await callTool($, WRITE_TOOL, {
    category: "fact",
    title: " ",
    body: "Text.",
  });
  const empty = await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Title",
    body: "",
  });

  expect(untitled.deny).toContain("title");
  expect(empty.deny).toContain("body");
  expect(files.size).toBe(0);
});

test("a project name cannot leave the notes folder", async ($, on) => {
  const { files } = mockEngine(on);

  await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Escape",
    body: "Text.",
    project: "../../etc",
    created: "2026-11-19",
  });
  const dotted = await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Escape",
    body: "Text.",
    project: "..",
  });

  expect([...files.keys()]).toEqual([
    `${NOTES_ROOT}/etc/fact/2026-11-19-escape.md`,
  ]);
  expect(dotted.deny).toContain("project");
});

test("a debugging note missing sections is refused by name", async ($, on) => {
  const { files } = mockEngine(on);
  await loadHumanizer($);

  const reply = await callTool($, WRITE_TOOL, {
    category: "debugging",
    title: "Profile 401",
    body: "## Steps taken\n1. Logged in.\n\n## Evidence\nA 401.",
  });

  expect(reply.deny).toContain("## Why these steps");
  expect(reply.deny).toContain("## Findings");
  expect(reply.deny).toContain("## Next steps");
  expect(reply.deny).toContain("## Draft Shortcut ticket");
  expect(reply.deny).not.toContain("## Evidence");
  expect(files.size).toBe(0);
});

test("a complete debugging note is saved once the humanizer skill is loaded", async ($, on) => {
  const { files } = mockEngine(on);
  await loadHumanizer($);

  const reply = await callTool($, WRITE_TOOL, {
    category: "debugging",
    title: "Profile 401",
    body: DEBUGGING_BODY,
    created: "2026-11-19",
  });

  expect(reply.deny).toBeUndefined();
  expect([...files.keys()]).toEqual([
    `${NOTES_ROOT}/claude-kit/debugging/2026-11-19-profile-401.md`,
  ]);
});

test("a debugging note asks for the humanizer skill once, then saves", async ($, on) => {
  const { files } = mockEngine(on);
  const debuggingNote = {
    category: "debugging",
    title: "Profile 401",
    body: DEBUGGING_BODY,
    created: "2026-11-19",
  };

  const firstReply = await callTool($, WRITE_TOOL, debuggingNote);
  const secondReply = await callTool($, WRITE_TOOL, debuggingNote);

  expect(firstReply.deny).toContain("humanizer");
  expect(secondReply.deny).toBeUndefined();
  expect(files.size).toBe(1);
});

test("existing session notes are listed with their project and date", async ($, on) => {
  mockEngine(on, { [SESSION_NOTES_STORE]: LEGACY_STORE });

  const reply = await callTool($, LIST_TOOL);

  expect(reply.result).toContain("2 session notes");
  expect(reply.result).toContain("project: claude-kit");
  expect(reply.result).toContain("created: 2026-11-16T13:14:42.314Z");
  expect(reply.result).toContain("The login bug was a stale cookie");
  expect(reply.result).toContain("Deploy moved to Monday");
});

test("a session note filed with its source is not listed again", async ($, on) => {
  const { files } = mockEngine(on, { [SESSION_NOTES_STORE]: LEGACY_STORE });
  const listing = await callTool($, LIST_TOOL);
  const [firstSource] = [...listing.result!.matchAll(/^source: (\S+)$/gm)].map(
    (match) => match[1]
  );

  await callTool($, WRITE_TOOL, {
    category: "finding",
    title: "Login bug was a stale cookie",
    body: "The login bug was a stale cookie.",
    project: "claude-kit",
    created: "2026-11-16T13:14:42.314Z",
    source: firstSource,
  });
  const laterListing = await callTool($, LIST_TOOL);

  expect(
    files.get(
      `${NOTES_ROOT}/claude-kit/finding/2026-11-16-login-bug-was-a-stale-cookie.md`
    )
  ).toContain(`source: ${firstSource}`);
  expect(laterListing.result).toContain("1 session note");
  expect(laterListing.result).not.toContain("stale cookie");
  expect(laterListing.result).toContain("Deploy moved to Monday");
});

test("with no session notes left the listing says so", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, LIST_TOOL);

  expect(reply.result).toContain("No session notes");
});

const runCommand = async (
  $: Engine,
  on: On,
  command: string,
  commandArguments: string
) => {
  const clock = mock.clock(on);
  const recorded = mockEngine(on);
  const reply = await $.command.run({
    command,
    args: commandArguments,
  } as never);
  await clock.settle();
  return { reply, ...recorded };
};

test("/project-note asks Claude to write a note on the topic", async ($, on) => {
  const { submittedPrompts } = await runCommand(
    $,
    on,
    "project-note",
    "why the cache is stale"
  );

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toContain("why the cache is stale");
});

test("/project-notes without organise points to the claude-notes terminal command", async ($, on) => {
  const { reply, commands, submittedPrompts } = await runCommand(
    $,
    on,
    "project-notes",
    ""
  );

  expect(commands).toHaveLength(0);
  expect(reply.text).toContain("claude-notes");
  expect(submittedPrompts).toHaveLength(0);
});

test("/project-notes organise asks Claude to file the session notes", async ($, on) => {
  const { commands, submittedPrompts } = await runCommand(
    $,
    on,
    "project-notes",
    "organise"
  );

  expect(commands).toHaveLength(0);
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(LIST_TOOL);
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
});

const autocompleteAt = (text: string) => {
  const start = text.search(/\S*$/);
  return { text, cursor: text.length, token: text.slice(start), start };
};

type AutocompleteCall = {
  autocomplete: (
    input: PromptAutocompleteInput
  ) => Promise<PromptAutocompleteResult>;
};

const autocomplete = ($: Engine, text: string) =>
  ($.prompt as unknown as AutocompleteCall).autocomplete(autocompleteAt(text));

const suggestedTexts = (reply: { suggestions: readonly { text: string }[] }) =>
  reply.suggestions.map((suggestion) => suggestion.text);

test("typing the first word after /project-notes suggests organise and audit", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const emptyReply = await autocomplete($, "/project-notes ");
  const partReply = await autocomplete($, "/project-notes org");

  expect(suggestedTexts(emptyReply)).toEqual(["organise", "audit"]);
  expect(suggestedTexts(partReply)).toEqual(["organise"]);
  expect(emptyReply.suggestions[0]!.description).toContain("session notes");
});

test("later words, /project-note topics and other commands get no /project-notes suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const laterWordReply = await autocomplete($, "/project-notes organise or");
  const topicReply = await autocomplete($, "/project-note or");
  const otherReply = await autocomplete($, "/handoff or");
  const commandReply = await autocomplete($, "/project-notes");

  expect(suggestedTexts(laterWordReply)).toEqual([]);
  expect(suggestedTexts(topicReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
});

const AUDIT_TOOL = "mcp__project-notes__audit_note_folders";
const MOVE_TOOL = "mcp__project-notes__move_note_folder";
const CLAUDE_ROOT = "/home/tester/.claude";
const WORKTREE_FOLDER = "/work/claude-kit/.claude/worktrees/feature-x";

type StoreMock = { files: Map<string, string>; commands: string[][] };

const commandResult = (exitCode: number, stdout = "") => ({
  value: {
    exitCode,
    stdout,
    stderr: "",
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
});

const mockStores = (
  on: On,
  seededFiles: Record<string, string>,
  commonGitFolders: Record<string, string> = {},
  worktreeList = "",
  sessionRoot = "/work/claude-kit"
): StoreMock => {
  const recorded: StoreMock = {
    files: new Map(Object.entries(seededFiles)),
    commands: [],
  };
  on("env.get", (_, e) => ({ value: { HOME: "/home/tester" }[e.name] }));
  on("session.root", () => ({ value: sessionRoot }));
  on("fs.exists", (_, e) => ({
    value: [...recorded.files.keys()].some(
      (path) => path === e.path || path.startsWith(`${e.path}/`)
    ),
  }));
  on("fs.write", (_, e) => {
    recorded.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", (_, e) => ({ value: recorded.files.get(e.path) ?? "" }));
  on("fs.list", (_, e) => {
    const childNames = new Map<string, "file" | "dir">();
    for (const path of recorded.files.keys()) {
      if (!path.startsWith(`${e.path}/`)) continue;
      const [childName, ...deeper] = path.slice(e.path.length + 1).split("/");
      childNames.set(childName ?? "", deeper.length ? "dir" : "file");
    }
    return {
      value: [...childNames].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("process.run", (_, e) => {
    const argv = [...e.argv];
    recorded.commands.push(argv);
    if (argv[0] === "mv") {
      const [fromPath = "", toPath = ""] = argv.slice(-2);
      recorded.files.set(toPath, recorded.files.get(fromPath) ?? "");
      recorded.files.delete(fromPath);
      return commandResult(0);
    }
    if (argv[0] !== "git") return commandResult(0);
    if (argv.includes("worktree")) return commandResult(0, worktreeList);
    const commonGitFolder = commonGitFolders[argv[2] ?? ""];
    return commonGitFolder
      ? commandResult(0, `${commonGitFolder}\n`)
      : commandResult(128);
  });
  on("tool.call", () => ({ result: {} }));
  return recorded;
};

const handoffFile = (cwd: string, project: string) =>
  `---\ntitle: Resume\nproject: ${project}\ncreated: 2026-11-19T10:00:00.000Z\ncwd: ${cwd}\n---\n\nResume.\n`;

test("a note written in a deleted worktree is filed under the main repository's name", async ($, on) => {
  const { files } = mockStores(on, {}, {}, "", WORKTREE_FOLDER);

  await callTool($, WRITE_TOOL, {
    category: "fact",
    title: "Gone",
    body: "B.",
    created: "2026-11-19",
  });

  expect(files.has(`${NOTES_ROOT}/claude-kit/fact/2026-11-19-gone.md`)).toBe(
    true
  );
});

test("the audit names a worktree folder's real repository from a handoff's cwd", async ($, on) => {
  mockStores(
    on,
    {
      [`${CLAUDE_ROOT}/handoffs/feature-x/001-resume.md`]: handoffFile(
        WORKTREE_FOLDER,
        "feature-x"
      ),
      [`${CLAUDE_ROOT}/project-notes/feature-x/fact/2026-11-19-a.md`]: "A",
      [`${CLAUDE_ROOT}/project-notes/claude-kit/fact/2026-11-19-b.md`]: "B",
    },
    { "/work/claude-kit": "/work/claude-kit/.git" }
  );

  const { result } = await callTool($, AUDIT_TOOL);

  expect(result).toContain("handoffs/feature-x -> claude-kit");
  expect(result).toContain("project-notes/feature-x -> claude-kit");
  expect(result).not.toContain("project-notes/claude-kit ->");
});

test("the audit maps folders named after this repository's worktrees", async ($, on) => {
  mockStores(
    on,
    { [`${CLAUDE_ROOT}/brainstorm/other-tree/brainstorm-1.json`]: "{}" },
    { "/work/claude-kit": "/work/claude-kit/.git" },
    "worktree /work/claude-kit\nHEAD abc\n\nworktree /work/trees/other-tree\nHEAD def\n"
  );

  const { result } = await callTool($, AUDIT_TOOL);

  expect(result).toContain("brainstorm/other-tree -> claude-kit");
});

test("the audit lists folders it cannot tie to a repository", async ($, on) => {
  mockStores(on, {
    [`${CLAUDE_ROOT}/handoffs/tmp.abc/001-x.md`]: handoffFile(
      "/tmp/tmp.abc",
      "tmp.abc"
    ),
  });

  const { result } = await callTool($, AUDIT_TOOL);

  expect(result).toContain("No repository found");
  expect(result).toContain("handoffs/tmp.abc");
});

test("moving a handoff folder renumbers after the target's handoffs and rewrites the project", async ($, on) => {
  const { files } = mockStores(on, {
    [`${CLAUDE_ROOT}/handoffs/claude-kit/001-first.md`]: handoffFile(
      "/work/claude-kit",
      "claude-kit"
    ),
    [`${CLAUDE_ROOT}/handoffs/claude-kit/002-second.md`]: handoffFile(
      "/work/claude-kit",
      "claude-kit"
    ),
    [`${CLAUDE_ROOT}/handoffs/feature-x/001-resume.md`]: handoffFile(
      WORKTREE_FOLDER,
      "feature-x"
    ),
  });

  const { result } = await callTool($, MOVE_TOOL, {
    store: "handoffs",
    from: "feature-x",
    to: "claude-kit",
  });

  expect(result).toContain("Moved 1 file");
  expect(files.has(`${CLAUDE_ROOT}/handoffs/feature-x/001-resume.md`)).toBe(
    false
  );
  expect(
    files.get(`${CLAUDE_ROOT}/handoffs/claude-kit/003-resume.md`)
  ).toContain("project: claude-kit\n");
});

test("moving keeps both files when a name is taken", async ($, on) => {
  const { files } = mockStores(on, {
    [`${CLAUDE_ROOT}/small-plans/claude-kit/set/01-a.md`]:
      "project: claude-kit\n",
    [`${CLAUDE_ROOT}/small-plans/feature-x/set/01-a.md`]:
      "project: feature-x\n",
  });

  await callTool($, MOVE_TOOL, {
    store: "small-plans",
    from: "feature-x",
    to: "claude-kit",
  });

  expect(files.get(`${CLAUDE_ROOT}/small-plans/claude-kit/set/01-a-2.md`)).toBe(
    "project: claude-kit\n"
  );
});

test("a move outside the stores or between unsafe names is refused", async ($, on) => {
  mockStores(on, {});

  const unknownStore = await callTool($, MOVE_TOOL, {
    store: "etc",
    from: "a",
    to: "b",
  });
  const unsafeName = await callTool($, MOVE_TOOL, {
    store: "handoffs",
    from: "../x",
    to: "b",
  });

  expect(unknownStore.deny).toBeDefined();
  expect(unsafeName.deny).toBeDefined();
});

test("/project-notes audit asks Claude to audit the note folders", async ($, on) => {
  const { submittedPrompts } = await runCommand(
    $,
    on,
    "project-notes",
    "audit"
  );

  expect(submittedPrompts[0]).toContain(AUDIT_TOOL);
  expect(submittedPrompts[0]).toContain(MOVE_TOOL);
});
