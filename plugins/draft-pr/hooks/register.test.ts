import type { On } from "claude-code";
import { expect, test, type Engine } from "claude-code/testing";

const PR_TOOL = "mcp__draft-pr__render_pr_draft";
const REVIEW_TOOL = "mcp__draft-pr__render_pr_review_draft";
const DRAFT_FOLDER = "/repo/.claude/draft-pr";
const NOVEMBER_ELEVENTH_NOON = Date.UTC(2026, 10, 11, 12, 0, 0);
const BRIDGE_URL = "http://127.0.0.1:4810/0123456789abcdef0123456789abcdef/";
const TEMPLATE_PATH = "/repo/.github/pull_request_template.md";
const TEMPLATE_TEXT = "## Summary\n\n## Test plan\n\n- [ ] Tests added\n";

const PR_INPUT = {
  title: "Reject expired tokens",
  body: "## Summary\n\nTokens past their expiry are refused.\n\n## Test plan\n\n- [x] Tests added\n",
  base: "main",
};

const PR_DIFF = [
  "diff --git a/src/auth.ts b/src/auth.ts",
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -10,3 +10,4 @@",
  " const token = readToken();",
  "+console.log(token);",
  " if (!token) return;",
  " return token;",
].join("\n");

const PR_VIEW = {
  number: 42,
  title: "Reject expired tokens",
  url: "https://github.com/acme/notes/pull/42",
  headRefOid: "abc123",
  headRefName: "token-expiry",
  baseRefName: "main",
  author: { login: "octocat" },
};

const REVIEW_INPUT = {
  number: 42,
  summary: "Close. One thing before merging.",
  comments: [
    {
      path: "src/auth.ts",
      line: 11,
      label: "issue",
      decorations: ["blocking"],
      subject: "The token is logged.",
      discussion: "Drop the log line.",
    },
    { label: "praise", subject: "Clear commit history." },
  ],
};

type CommandResult = { exitCode: number; stdout: string };
type FileWrite = { path: string; text: string };

const SUCCEEDED: CommandResult = { exitCode: 0, stdout: "" };
const FAILED: CommandResult = { exitCode: 1, stdout: "" };

const DEFAULT_COMMAND_RESULTS: Record<string, CommandResult> = {
  "git rev-parse": { exitCode: 0, stdout: "token-expiry\n" },
  "gh repo": { exitCode: 0, stdout: "acme/notes\n" },
  "gh pr view token-expiry": FAILED,
  "gh pr view 42": { exitCode: 0, stdout: JSON.stringify(PR_VIEW) },
  "gh pr diff": { exitCode: 0, stdout: PR_DIFF },
  node: { exitCode: 0, stdout: `${JSON.stringify({ url: BRIDGE_URL })}\n` },
  open: SUCCEEDED,
};

const findCommandResult = (
  commandResults: Record<string, CommandResult>,
  argv: readonly string[]
) => {
  const commandLine = argv.join(" ");
  const matchingKey = Object.keys(commandResults)
    .filter((commandStart) => commandLine.startsWith(commandStart))
    .sort((first, second) => second.length - first.length)[0];
  return matchingKey === undefined ? FAILED : commandResults[matchingKey];
};

const listChildEntries = (filePaths: string[], folder: string) => {
  const childNames = filePaths
    .filter((filePath) => filePath.startsWith(`${folder}/`))
    .map((filePath) => filePath.slice(folder.length + 1).split("/")[0] ?? "");
  return [...new Set(childNames)].map((name) => ({
    name,
    kind: "file" as const,
    size: 0,
    mtimeMs: 0,
    isLink: false,
  }));
};

const mockEngine = (
  on: On,
  commandOverrides: Record<string, CommandResult> = {},
  fileTexts: Record<string, string> = { [TEMPLATE_PATH]: TEMPLATE_TEXT }
) => {
  const writes: FileWrite[] = [];
  const ranCommands: string[][] = [];
  const commandResults = { ...DEFAULT_COMMAND_RESULTS, ...commandOverrides };
  on("session.cwd", () => ({ value: "/repo" }));
  on("clock.now", () => ({ value: NOVEMBER_ELEVENTH_NOON }));
  on("fs.write", (_, e) => {
    writes.push({ path: e.path, text: e.text });
    return { value: undefined };
  });
  on("fs.read", (_, e) => {
    const fileText = fileTexts[e.path];
    return fileText === undefined
      ? { deny: `ENOENT: ${e.path}` }
      : { value: fileText };
  });
  on("fs.list", (_, e) => ({
    value: listChildEntries(Object.keys(fileTexts), e.path ?? ""),
  }));
  on("process.run", (_, e) => {
    ranCommands.push([...e.argv]);
    const commandResult = findCommandResult(commandResults, e.argv);
    return {
      value: {
        exitCode: commandResult?.exitCode ?? 1,
        stdout: commandResult?.stdout ?? "",
        stderr: commandResult?.exitCode === 0 ? "" : "command failed",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { writes, ranCommands };
};

const findWrite = (writes: FileWrite[], extension: string) =>
  writes.find((write) => write.path.endsWith(extension));

const readSavedDraft = (writes: FileWrite[]) =>
  JSON.parse(findWrite(writes, ".json")?.text ?? "null") as Record<
    string,
    unknown
  >;

const callTool = ($: Engine, tool: string, input: object) =>
  $.tool.call({ tool, ...input } as never);

test("session start registers both render tools and no command, since the engine serves each skill as a command", async ($, on) => {
  const commandNames: string[] = [];
  const tools: { name: string; isDeferred?: unknown }[] = [];
  on("command.register", (_, e) => {
    commandNames.push(e.name);
    return { value: { command: e.name } };
  });
  on("tool.register", (_, e) => {
    tools.push({ name: e.name, isDeferred: e.isDeferred });
    return { value: { tool: `mcp__draft-pr__${e.name}` } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(commandNames).toEqual([]);
  expect(tools).toEqual([
    { name: "render_pr_draft", isDeferred: false },
    { name: "render_pr_review_draft", isDeferred: false },
  ]);
});

test("the PR tool saves the draft, starts the post bridge and opens its page", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, PR_TOOL, PR_INPUT);

  const draftPath = `${DRAFT_FOLDER}/pr-2026-11-11-120000.json`;
  expect(writes.map((write) => write.path)).toEqual([
    `${DRAFT_FOLDER}/.gitignore`,
    draftPath,
    `${DRAFT_FOLDER}/pr-2026-11-11-120000.html`,
  ]);
  expect(readSavedDraft(writes)).toEqual({
    kind: "pr",
    draftId: "pr-2026-11-11-120000",
    cwd: "/repo",
    repository: "acme/notes",
    base: "main",
    head: "token-expiry",
    title: PR_INPUT.title,
    body: PR_INPUT.body,
    isDraft: false,
    existingNumber: null,
    existingUrl: "",
    templatePath: ".github/pull_request_template.md",
    templateHeadings: ["## Summary", "## Test plan"],
  });
  expect(findWrite(writes, ".html")?.text).toContain('id="post-draft"');
  const launchCommand = ranCommands.find((argv) => argv[0] === "node");
  expect(launchCommand?.[1]).toMatch(/\/server\/draft-server\.mjs$/);
  expect(launchCommand?.[2]).toBe(draftPath);
  expect(ranCommands.at(-1)).toEqual(["open", BRIDGE_URL]);
  expect(reply.result).toBe("Opened the PR draft in the browser.");
});

test("the PR tool posts nothing and repeats none of the draft in its result", async ($, on) => {
  const { ranCommands } = mockEngine(on);

  const reply = await callTool($, PR_TOOL, PR_INPUT);

  const changingCommands = ranCommands.filter((argv) =>
    ["push", "create", "edit", "api"].some((word) => argv.includes(word))
  );
  expect(changingCommands).toEqual([]);
  expect(reply.result).not.toContain(PR_INPUT.title);
  expect(reply.result).not.toContain("Tokens past their expiry");
});

test("without node the PR page opens as a file", async ($, on) => {
  const { ranCommands } = mockEngine(on, { node: FAILED });

  const reply = await callTool($, PR_TOOL, PR_INPUT);

  expect(ranCommands.at(-1)).toEqual([
    "open",
    `${DRAFT_FOLDER}/pr-2026-11-11-120000.html`,
  ]);
  expect(reply.result).toBe("Opened the PR draft in the browser.");
});

test("when no browser opens, the result says where the page is", async ($, on) => {
  mockEngine(on, { open: FAILED });

  const reply = await callTool($, PR_TOOL, PR_INPUT);

  expect(reply.result).toBe(
    `Could not open the browser. The PR draft is at ${BRIDGE_URL}`
  );
});

test("a body that drops template headings is denied, naming them", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, PR_TOOL, {
    ...PR_INPUT,
    body: "## Summary\n\nTokens past their expiry are refused.",
  });

  expect(reply.deny).toContain(".github/pull_request_template.md");
  expect(reply.deny).toContain('heading "## Test plan"');
  expect(reply.deny).toContain('checklist item "Tests added"');
  expect(writes).toEqual([]);
});

test("a project without a template gets the default layout", async ($, on) => {
  const { writes } = mockEngine(on, {}, {});

  const missingReply = await callTool($, PR_TOOL, PR_INPUT);
  const reply = await callTool($, PR_TOOL, {
    ...PR_INPUT,
    body: "## Summary\n\nDone.\n\n## Changes\n\n- One\n\n## Testing\n\nRan it.",
  });

  expect(missingReply.deny).toContain('heading "## Changes"');
  expect(reply.result).toBe("Opened the PR draft in the browser.");
  expect(readSavedDraft(writes).templatePath).toBe("");
  expect(readSavedDraft(writes).templateHeadings).toEqual([
    "## Summary",
    "## Changes",
    "## Testing",
  ]);
});

test("a project with several templates needs the one the PR follows", async ($, on) => {
  const templateTexts = {
    "/repo/.github/PULL_REQUEST_TEMPLATE/bugfix.md": "## Bug\n",
    "/repo/.github/PULL_REQUEST_TEMPLATE/feature.md":
      "## Summary\n\n## Test plan\n",
  };
  const { writes } = mockEngine(on, {}, templateTexts);

  const undecidedReply = await callTool($, PR_TOOL, PR_INPUT);
  const reply = await callTool($, PR_TOOL, {
    ...PR_INPUT,
    templatePath: ".github/PULL_REQUEST_TEMPLATE/feature.md",
  });

  expect(undecidedReply.deny).toContain(
    ".github/PULL_REQUEST_TEMPLATE/bugfix.md, .github/PULL_REQUEST_TEMPLATE/feature.md"
  );
  expect(reply.result).toBe("Opened the PR draft in the browser.");
  expect(readSavedDraft(writes).templatePath).toBe(
    ".github/PULL_REQUEST_TEMPLATE/feature.md"
  );
});

test("a branch with an open PR is drafted as an update of it", async ($, on) => {
  const { writes } = mockEngine(on, {
    "gh pr view token-expiry": {
      exitCode: 0,
      stdout: JSON.stringify({
        number: 7,
        url: "https://github.com/acme/notes/pull/7",
        state: "OPEN",
      }),
    },
  });

  await callTool($, PR_TOOL, PR_INPUT);

  expect(readSavedDraft(writes).existingNumber).toBe(7);
  expect(readSavedDraft(writes).existingUrl).toBe(
    "https://github.com/acme/notes/pull/7"
  );
  expect(findWrite(writes, ".html")?.text).toContain("Update #7 on GitHub");
});

test("a PR draft without a title, body or base is denied", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, PR_TOOL, { ...PR_INPUT, title: " " });

  expect(reply.deny).toContain("title, a body and a base");
});

test("the review tool saves the draft with each comment's place and opens its page", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, REVIEW_TOOL, REVIEW_INPUT);

  const savedDraft = readSavedDraft(writes);
  const draftPath = `${DRAFT_FOLDER}/review-42-2026-11-11-120000.json`;
  expect(findWrite(writes, ".json")?.path).toBe(draftPath);
  expect(savedDraft).toMatchObject({
    kind: "review",
    draftId: "review-42-2026-11-11-120000",
    cwd: "/repo",
    repository: "acme/notes",
    host: "github.com",
    number: 42,
    title: "Reject expired tokens",
    author: "octocat",
    headSha: "abc123",
    summary: "Close. One thing before merging.",
    event: "COMMENT",
  });
  expect(savedDraft.comments).toEqual([
    {
      path: "src/auth.ts",
      side: "RIGHT",
      line: 11,
      startLine: null,
      label: "issue",
      decorations: ["blocking"],
      subject: "The token is logged.",
      discussion: "Drop the log line.",
      context: [
        {
          marker: " ",
          leftNumber: 10,
          rightNumber: 10,
          hunkIndex: 0,
          text: "const token = readToken();",
        },
        {
          marker: "+",
          rightNumber: 11,
          hunkIndex: 0,
          text: "console.log(token);",
        },
      ],
    },
    {
      path: "",
      side: "RIGHT",
      line: null,
      startLine: null,
      label: "praise",
      decorations: [],
      subject: "Clear commit history.",
      discussion: "",
      context: [],
    },
  ]);
  expect(findWrite(writes, ".html")?.text).toContain(
    'data-action="copy-comment"'
  );
  expect(ranCommands.find((argv) => argv[0] === "node")?.[2]).toBe(draftPath);
  expect(ranCommands.at(-1)).toEqual(["open", BRIDGE_URL]);
  expect(reply.result).toBe("Opened the review draft in the browser.");
});

test("a range that starts and ends on one line is a comment on that line", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, REVIEW_TOOL, {
    number: 42,
    comments: [
      {
        path: "src/auth.ts",
        line: 11,
        startLine: 11,
        label: "issue",
        subject: "The token is logged.",
      },
    ],
  });

  expect(reply.deny).toBeUndefined();
  const savedComments = readSavedDraft(writes).comments as {
    line: number;
    startLine: number | null;
  }[];
  expect(savedComments[0]?.line).toBe(11);
  expect(savedComments[0]?.startLine).toBeNull();
});

test("the review tool posts nothing and repeats no comment in its result", async ($, on) => {
  const { ranCommands } = mockEngine(on);

  const reply = await callTool($, REVIEW_TOOL, REVIEW_INPUT);

  expect(ranCommands.filter((argv) => argv.includes("api"))).toEqual([]);
  expect(reply.result).not.toContain("The token is logged");
  expect(reply.result).not.toContain("Close.");
});

test("comments that are not Conventional Comments, or off the diff, are denied one by one", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, REVIEW_TOOL, {
    number: 42,
    event: "MERGE",
    comments: [
      { path: "src/auth.ts", line: 11, label: "bug", subject: "Logged." },
      { path: "src/auth.ts", line: 90, label: "issue", subject: "Far away." },
      { path: "src/auth.ts", label: "note", subject: "No line." },
    ],
  });

  expect(reply.deny).toContain('comments[0]: label "bug" is not one of');
  expect(reply.deny).toContain(
    "comments[1]: src/auth.ts line 90 (RIGHT) is not in the diff of the PR"
  );
  expect(reply.deny).toContain("comments[2]: a comment on a file needs a line");
  expect(reply.deny).toContain(
    "event must be COMMENT, APPROVE, REQUEST_CHANGES or PENDING"
  );
  expect(writes).toEqual([]);
});

test("a review with nothing in it is denied unless it approves", async ($, on) => {
  mockEngine(on);

  const emptyReply = await callTool($, REVIEW_TOOL, {
    number: 42,
    comments: [],
  });
  const approvalReply = await callTool($, REVIEW_TOOL, {
    number: 42,
    event: "APPROVE",
    comments: [],
  });

  expect(emptyReply.deny).toContain("no summary and no comments");
  expect(approvalReply.result).toBe("Opened the review draft in the browser.");
});

test("a PR that gh cannot read is denied with gh's error", async ($, on) => {
  mockEngine(on, { "gh pr view 42": FAILED });

  const reply = await callTool($, REVIEW_TOOL, REVIEW_INPUT);

  expect(reply.deny).toContain("Could not read PR #42");
  expect(reply.deny).toContain("command failed");
});
