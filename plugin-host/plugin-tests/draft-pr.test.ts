import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startPlugin, TARGET_NAMES, type TargetName } from "../testing";

const runFile = promisify(execFile);
const PLUGIN_NAME = "draft-pr";
const PR_TOOL = "render_pr_draft";
const REVIEW_TOOL = "render_pr_review_draft";
const DRAFT_FOLDER_PATH = [".claude", "draft-pr"];
const REAL_NODE = Bun.which("node") ?? "node";
const BRIDGE_URL = "http://127.0.0.1:4810/0123456789abcdef0123456789abcdef/";
const TEMPLATE_PATH = ".github/pull_request_template.md";
const TEMPLATE_TEXT = "## Summary\n\n## Test plan\n\n- [ ] Tests added\n";

const PR_DIFF = [
  "diff --git a/src/auth.ts b/src/auth.ts",
  "--- a/src/auth.ts",
  "+++ b/src/auth.ts",
  "@@ -10,3 +10,4 @@",
  " const token = readToken();",
  "+console.log(token);",
  " if (!token) return;",
  " return token;",
  "",
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

const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

const GH_BODY = [
  `printf '%s\\n' "gh $*" >> "$FAKE_COMMAND_LOG"`,
  `case "$1 $2" in`,
  `  "repo view") printf '%s\\n' acme/notes ;;`,
  `  "pr diff") printf '%s\\n' ${shellQuote(PR_DIFF)} ;;`,
  `  "pr view")`,
  `    if [ "$3" = "42" ] || [ "$3" = "--json" ]; then printf '%s\\n' ${shellQuote(JSON.stringify(PR_VIEW))}; else exit 1; fi ;;`,
  `  *) exit 1 ;;`,
  `esac`,
].join("\n");

const NODE_BODY = [
  `if [ "$(basename "$1")" = "draft-server.mjs" ]; then`,
  `  printf '%s\\n' "bridge $(basename "$1") $2" >> "$FAKE_COMMAND_LOG"`,
  `  printf '%s\\n' ${shellQuote(JSON.stringify({ url: BRIDGE_URL, pid: 1 }))}`,
  `  exit 0`,
  `fi`,
  `exec ${shellQuote(REAL_NODE)} "$@"`,
].join("\n");

const createGitRepository = async () => {
  const repositoryFolder = await mkdtemp(join(tmpdir(), "draft-pr-repo-"));
  const git = (gitArguments: string[]) =>
    runFile("git", gitArguments, { cwd: repositoryFolder });
  await git(["init", "-q", "-b", "token-expiry"]);
  await mkdir(join(repositoryFolder, ".github"), { recursive: true });
  await mkdir(join(repositoryFolder, "src"), { recursive: true });
  await writeFile(join(repositoryFolder, TEMPLATE_PATH), TEMPLATE_TEXT);
  await writeFile(
    join(repositoryFolder, "src", "auth.ts"),
    "const token = readToken();\nif (!token) return;\nreturn token;\n"
  );
  await git(["add", "."]);
  await git([
    "-c",
    "user.name=Draft Test",
    "-c",
    "user.email=draft-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "-m",
    "Start",
  ]);
  return repositoryFolder;
};

const startDraftPlugin = async (
  target: TargetName,
  repositoryFolder: string
) =>
  startPlugin(target, PLUGIN_NAME, {
    workingDirectory: repositoryFolder,
    fakeCommands: { gh: GH_BODY, node: NODE_BODY },
  });

const listDraftFileNames = async (repositoryFolder: string) => {
  const draftFolder = join(repositoryFolder, ...DRAFT_FOLDER_PATH);
  return existsSync(draftFolder) ? (await readdir(draftFolder)).sort() : [];
};

const findDraftName = (draftFileNames: string[], prefix: string) => {
  const draftName = draftFileNames.find(
    (fileName) => fileName.startsWith(prefix) && fileName.endsWith(".json")
  );
  if (!draftName) throw new Error(`no ${prefix} draft was written`);
  return draftName.slice(0, -".json".length);
};

const readDraft = async (repositoryFolder: string, draftName: string) =>
  JSON.parse(
    await readFile(
      join(repositoryFolder, ...DRAFT_FOLDER_PATH, `${draftName}.json`),
      "utf8"
    )
  );

const listBrowserLaunches = async (readCommandLog: () => Promise<string[]>) =>
  (await readCommandLog()).filter((line) => /^(open|bridge) /.test(line));

const readGhCommandLines = async (readCommandLog: () => Promise<string[]>) =>
  (await readCommandLog()).filter((line) => line.startsWith("gh "));

const PR_BODY = "## Summary\n\nTokens past their expiry are refused.\n\n## Test plan\n\n- [x] Tests added\n";

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

for (const target of TARGET_NAMES) {
  test(`${target}: render_pr_draft writes the draft folder and opens the bridge page`, async () => {
    const repositoryFolder = await createGitRepository();
    const plugin = await startDraftPlugin(target, repositoryFolder);
    try {
      const outcome = await plugin.callTool(PR_TOOL, {
        title: "Reject expired tokens",
        body: PR_BODY,
        base: "main",
        isDraft: true,
      });
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Opened the PR draft in the browser.");

      const draftFileNames = await listDraftFileNames(repositoryFolder);
      const draftName = findDraftName(draftFileNames, "pr-");
      expect(draftFileNames).toEqual(
        [".gitignore", `${draftName}.html`, `${draftName}.json`].sort()
      );
      expect(
        await readFile(
          join(repositoryFolder, ...DRAFT_FOLDER_PATH, ".gitignore"),
          "utf8"
        )
      ).toBe("*\n");
      expect(await readDraft(repositoryFolder, draftName)).toMatchObject({
        kind: "pr",
        cwd: await realpath(repositoryFolder),
        repository: "acme/notes",
        head: "token-expiry",
        base: "main",
        title: "Reject expired tokens",
        isDraft: true,
        existingNumber: null,
        templatePath: TEMPLATE_PATH,
        templateHeadings: ["## Summary", "## Test plan"],
      });
      expect(
        await readFile(
          join(repositoryFolder, ...DRAFT_FOLDER_PATH, `${draftName}.html`),
          "utf8"
        )
      ).toContain("Reject expired tokens");

      const commandLog = await plugin.readCommandLog();
      const draftPathOnDisk = join(
        await realpath(repositoryFolder),
        ...DRAFT_FOLDER_PATH,
        `${draftName}.json`
      );
      expect(commandLog).toContain(`bridge draft-server.mjs ${draftPathOnDisk}`);
      expect(commandLog).toContain(`open ${BRIDGE_URL}`);
      expect(
        commandLog.filter((line) => /^gh (api|pr create|pr edit|pr review)/.test(line))
      ).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_pr_draft denies a body that drops the template and writes nothing`, async () => {
    const repositoryFolder = await createGitRepository();
    const plugin = await startDraftPlugin(target, repositoryFolder);
    try {
      const outcome = await plugin.callTool(PR_TOOL, {
        title: "Reject expired tokens",
        body: "## Summary\n\nTokens past their expiry are refused.\n",
        base: "main",
      });
      expect(outcome).toMatchObject({ isError: true });
      expect(outcome.text).toContain('Missing: heading "## Test plan"');
      expect(existsSync(join(repositoryFolder, ...DRAFT_FOLDER_PATH))).toBe(false);
      expect(await listBrowserLaunches(plugin.readCommandLog)).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_pr_review_draft writes the review draft and opens the bridge page`, async () => {
    const repositoryFolder = await createGitRepository();
    const plugin = await startDraftPlugin(target, repositoryFolder);
    try {
      const outcome = await plugin.callTool(REVIEW_TOOL, REVIEW_INPUT);
      expect(outcome).toMatchObject({ isError: false });
      expect(outcome.text).toContain("Opened the review draft in the browser.");

      const draftFileNames = await listDraftFileNames(repositoryFolder);
      const draftName = findDraftName(draftFileNames, "review-42-");
      expect(draftFileNames).toEqual(
        [".gitignore", `${draftName}.html`, `${draftName}.json`].sort()
      );
      const draft = await readDraft(repositoryFolder, draftName);
      expect(draft).toMatchObject({
        kind: "review",
        number: 42,
        repository: "acme/notes",
        headSha: "abc123",
        summary: "Close. One thing before merging.",
        event: "COMMENT",
      });
      expect(draft.comments).toHaveLength(2);
      expect(draft.comments[0]).toMatchObject({
        label: "issue",
        decorations: ["blocking"],
        path: "src/auth.ts",
        line: 11,
        side: "RIGHT",
      });
      expect(draft.comments[1]).toMatchObject({ label: "praise", path: "" });

      const commandLog = await plugin.readCommandLog();
      expect(commandLog).toContain(`open ${BRIDGE_URL}`);
      expect(await readGhCommandLines(plugin.readCommandLog)).toEqual(
        expect.arrayContaining(["gh pr view 42 --json number,title,url,headRefOid,headRefName,baseRefName,author", "gh pr diff 42"])
      );
      expect(
        commandLog.filter((line) => /^gh (api|pr create|pr edit|pr review)/.test(line))
      ).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_pr_review_draft denies a comment off the diff and a comment that is not a Conventional Comment`, async () => {
    const repositoryFolder = await createGitRepository();
    const plugin = await startDraftPlugin(target, repositoryFolder);
    try {
      const outcome = await plugin.callTool(REVIEW_TOOL, {
        number: 42,
        comments: [
          { path: "src/auth.ts", line: 99, label: "issue", subject: "Off the diff." },
          { path: "src/auth.ts", line: 11, label: "bogus", subject: "Not a label." },
        ],
      });
      expect(outcome).toMatchObject({ isError: true });
      expect(outcome.text).toContain(
        "comments[0]: src/auth.ts line 99 (RIGHT) is not in the diff of the PR"
      );
      expect(outcome.text).toContain('comments[1]: label "bogus" is not one of');
      expect(existsSync(join(repositoryFolder, ...DRAFT_FOLDER_PATH))).toBe(false);
      expect(await listBrowserLaunches(plugin.readCommandLog)).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: both tools are exposed and both skills name them`, async () => {
    const repositoryFolder = await createGitRepository();
    const plugin = await startDraftPlugin(target, repositoryFolder);
    try {
      const toolNames = (await plugin.listToolNames()).map((name) =>
        name.startsWith("mcp__") ? name : `mcp__${PLUGIN_NAME}__${name}`
      );
      expect(toolNames.sort()).toEqual(
        [`mcp__${PLUGIN_NAME}__${PR_TOOL}`, `mcp__${PLUGIN_NAME}__${REVIEW_TOOL}`].sort()
      );
      for (const skillName of ["draft-pr", "draft-pr-review"]) {
        const skillText = await readFile(
          join(plugin.installedFolder, "skills", skillName, "SKILL.md"),
          "utf8"
        );
        const mentionedToolNames = [
          ...new Set(skillText.match(/mcp__draft-pr__\w+/g) ?? []),
        ];
        expect(mentionedToolNames.length).toBeGreaterThan(0);
        for (const mentionedToolName of mentionedToolNames) {
          expect(toolNames).toContain(mentionedToolName);
        }
      }
    } finally {
      await plugin.stop();
    }
  });
}
