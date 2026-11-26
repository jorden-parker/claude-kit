import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const WRITE_TOOL = "mcp__small-plans__write_small_plan";
const STATUS_TOOL = "mcp__small-plans__set_small_plan_status";
const START_TOOL = "mcp__small-plans__start_small_plan";
const CHECK_TOOL = "mcp__small-plans__check_small_plan";
const LIST_TOOL = "mcp__small-plans__list_small_plans";
const RENAME_TOOL = "mcp__small-plans__rename_small_plan_set";
const FINISH_TOOL = "mcp__small-plans__finish_small_plan";
const UPDATE_TOOL = "mcp__small-plans__update_small_plan";
const PLANS_FOLDER = "/home/tester/.local/share/small-plans";
const PROJECT_FOLDER = `${PLANS_FOLDER}/claude-kit`;
const HANDOFFS_FOLDER = "/home/tester/.local/share/handoffs/claude-kit";
const OLDER_HANDOFF = `${HANDOFFS_FOLDER}/001-add-the-viewer.md`;
const NEWER_HANDOFF = `${HANDOFFS_FOLDER}/002-fix-login.md`;
const HANDOFF_SET = "2026-11-18-0900-handoff-002-fix-login";
const STANDALONE_SET = "2026-11-19-1000-add-a-dark-mode-toggle";
const HANDOFF_SET_PLAN = `${PROJECT_FOLDER}/${HANDOFF_SET}/01-clear-the-cached-token.md`;
const STANDALONE_SET_PLAN = `${PROJECT_FOLDER}/${STANDALONE_SET}/01-add-the-toggle.md`;
const NEW_SET_STAMP = String.raw`\d{4}-\d{2}-\d{2}-\d{4}`;

const PLAN_BODY = `## Goal
The profile request works after a token refresh.

## Context
- \`src/auth.ts\`: \`refreshToken\` keeps the old token in \`cachedToken\`.

## Steps
1. In \`src/auth.ts\`, set \`cachedToken = undefined\` as the first line of \`refreshToken\`.
2. In \`src/auth.test.ts\`, add a test named "a refresh clears the cached token".

## Check
- Run: \`pnpm test auth\`
- Expect: the test "a refresh clears the cached token" passes, and no test fails.

## Review
- \`refreshToken\` clears \`cachedToken\` before it requests a new token.
- No file other than \`src/auth.ts\` and \`src/auth.test.ts\` changed.`;

const VALID_PLAN = {
  set: HANDOFF_SET,
  order: 1,
  title: "Clear the cached token",
  kind: "fix",
  body: PLAN_BODY,
  depends_on: [] as number[],
};

type ProcessRun = { argv: string[]; cwd?: string };

type Recorded = {
  files: Map<string, string>;
  submittedPrompts: string[];
  commands: string[][];
  runs: ProcessRun[];
};

const moveFolder = (files: Map<string, string>, from: string, to: string) => {
  if (files.has(from)) {
    files.set(to, files.get(from) ?? "");
    files.delete(from);
  }
  for (const [path, text] of [...files]) {
    if (!path.startsWith(`${from}/`)) continue;
    files.delete(path);
    files.set(`${to}${path.slice(from.length)}`, text);
  }
};

const mockFiles = (
  on: On,
  recorded: Recorded,
  sessionRoot = "/work/claude-kit"
) => {
  on("env.get", (_, e) => ({
    value: { HOME: "/home/tester" }[e.name],
  }));
  on("session.root", () => ({ value: sessionRoot }));
  on("fs.exists", (_, e) => ({ value: recorded.files.has(e.path) }));
  on("fs.write", (_, e) => {
    recorded.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", (_, e) => ({ value: recorded.files.get(e.path) ?? "" }));
  on("fs.list", (_, e) => {
    const childNames = [...recorded.files.keys()]
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => path.slice(e.path.length + 1).split("/")[0] ?? "");
    return {
      value: [...new Set(childNames)].map((name) => ({
        name,
        kind: name.endsWith(".md") ? ("file" as const) : ("dir" as const),
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
};

const mockEngine = (
  on: On,
  seededFiles: Record<string, string> = {},
  commonGitFolder = "/work/claude-kit/.git\n",
  sessionRoot = "/work/claude-kit"
): Recorded => {
  const recorded: Recorded = {
    files: new Map(Object.entries(seededFiles)),
    submittedPrompts: [],
    commands: [],
    runs: [],
  };
  mockFiles(on, recorded, sessionRoot);
  on("process.run", (_, e) => {
    recorded.commands.push([...e.argv]);
    recorded.runs.push({ argv: [...e.argv], cwd: e.init?.cwd });
    if (e.argv[0] === "mv")
      moveFolder(recorded.files, e.argv[1] ?? "", e.argv[2] ?? "");
    const isFailedGit = e.argv[0] === "git" && !commonGitFolder;
    return {
      value: {
        exitCode: isFailedGit ? 128 : 0,
        stdout: e.argv[0] === "git" ? commonGitFolder : "",
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
  $.tool.run({ tool, ...toolInput } as never) as Promise<{
    result?: string;
    deny?: string;
  }>;

const runCommand = async (
  $: Engine,
  on: On,
  commandArguments: string,
  seededFiles: Record<string, string> = {}
) => {
  const clock = mock.clock(on);
  const recorded = mockEngine(on, seededFiles);
  const reply = await $.command.run({
    command: "small-plans",
    args: commandArguments,
  } as never);
  await clock.settle();
  return { reply, clock, ...recorded };
};

test("a plan is saved under its project and set", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    order: 2,
    depends_on: [1],
  });

  const planPath = `${PROJECT_FOLDER}/${HANDOFF_SET}/02-clear-the-cached-token.md`;
  expect(reply.result).toContain(planPath);
  const [frontMatter, body] = files.get(planPath)!.split("\n---\n\n");
  expect(frontMatter).toMatch(
    new RegExp(
      `^---\ntitle: Clear the cached token\nproject: claude-kit\ncreated: \\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z\nset: ${HANDOFF_SET}\norder: 2\nkind: fix\nstatus: pending\ndepends_on: 1$`
    )
  );
  expect(body).toBe(`${PLAN_BODY}\n`);
});

test("a new set gets its date and time from the tool", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "dark-mode-toggle",
    order: 1,
    depends_on: [],
  });

  expect(reply.result).toMatch(
    new RegExp(`${PROJECT_FOLDER}/${NEW_SET_STAMP}-dark-mode-toggle/01-`)
  );
});

const currentStamp = () =>
  new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");

test("a later plan with the same short name joins the set already saved", async ($, on) => {
  const savedSetFolder = `${PROJECT_FOLDER}/${currentStamp()}-dark-mode-toggle`;
  const { files } = mockEngine(on, {
    [`${savedSetFolder}/01-first.md`]: "saved",
  });

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "dark-mode-toggle",
    order: 2,
    depends_on: [1],
  });

  expect(reply.result).toContain(
    `${savedSetFolder}/02-clear-the-cached-token.md`
  );
  const setFolders = new Set(
    [...files.keys()]
      .filter((path) => path.startsWith(`${PROJECT_FOLDER}/`))
      .map((path) => path.slice(PROJECT_FOLDER.length + 1).split("/")[0])
  );
  expect([...setFolders]).toEqual([`${currentStamp()}-dark-mode-toggle`]);
});

test("a short name starts a new set when the saved set of that name is old", async ($, on) => {
  const oldSetFolder = `${PROJECT_FOLDER}/2026-11-19-1542-fix-login`;
  const { files } = mockEngine(on, {
    [`${oldSetFolder}/01-first.md`]: "first",
    [`${oldSetFolder}/02-second.md`]: "second",
  });

  const firstReply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "fix-login",
    order: 1,
    depends_on: [],
  });
  const secondReply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "fix-login",
    order: 2,
    depends_on: [1],
  });

  const newSetFolder = `${PROJECT_FOLDER}/${currentStamp()}-fix-login`;
  expect(firstReply.result).toContain(
    `${newSetFolder}/01-clear-the-cached-token.md`
  );
  expect(secondReply.result).toContain(
    `${newSetFolder}/02-clear-the-cached-token.md`
  );
  expect(files.get(`${oldSetFolder}/01-first.md`)).toBe("first");
  expect(files.get(`${oldSetFolder}/02-second.md`)).toBe("second");
});

test("a new stamped set name that names the request is refused", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "2026-11-26-1105-plan-this",
    order: 1,
    depends_on: [],
  });

  expect(reply.deny).toContain("names the request");
  expect(
    [...files.keys()].filter((path) => path.startsWith(PROJECT_FOLDER))
  ).toEqual([]);
});

test("a new handoff set name keeps its stamp and is saved", async ($, on) => {
  const handoffSetName = "2026-11-19-1542-handoff-007-fix-login";
  mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: handoffSetName,
    order: 1,
    depends_on: [],
  });

  expect(reply.result).toContain(
    `${PROJECT_FOLDER}/${handoffSetName}/01-clear-the-cached-token.md`
  );
});

test("a set named after the request is refused", async ($, on) => {
  const { files } = mockEngine(on);

  for (const set of ["plan-this", "plans", "the-work", "next-steps"]) {
    const reply = await callTool($, WRITE_TOOL, {
      ...VALID_PLAN,
      set,
      order: 1,
      depends_on: [],
    });
    expect(reply.deny).toContain("names the request");
  }
  expect(
    [...files.keys()].filter((path) => path.startsWith(PROJECT_FOLDER))
  ).toEqual([]);
});

test("a saved set with a refused name still takes plans", async ($, on) => {
  const savedSetFolder = `${PROJECT_FOLDER}/2026-11-19-1542-plan-this`;
  mockEngine(on, { [`${savedSetFolder}/01-first.md`]: "saved" });

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "2026-11-19-1542-plan-this",
    order: 2,
    depends_on: [1],
  });

  expect(reply.result).toContain(
    `${savedSetFolder}/02-clear-the-cached-token.md`
  );
});

test("with no SMALL_PLANS_DIR a plan is saved under the local share folder", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, { ...VALID_PLAN, order: 1 });

  const planPath = `/home/tester/.local/share/small-plans/claude-kit/${HANDOFF_SET}/01-clear-the-cached-token.md`;
  expect(reply.result).toContain(planPath);
  expect(files.has(planPath)).toBe(true);
});

test("a plan that a small model could not follow is refused with every problem", async ($, on) => {
  const { files } = mockEngine(on);
  const manySteps = Array.from(
    { length: 7 },
    (_, stepIndex) => `${stepIndex + 1}. Edit \`src/auth.ts\`.`
  ).join("\n");

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    set: "../elsewhere",
    kind: "epic",
    body: `## Goal\nFix login.\n\n## Context\nUpdate the callers as needed.\n\n## Steps\n${manySteps}\n\n## Check\nRun the tests.`,
  });

  expect(reply.deny).toContain("set must be");
  expect(reply.deny).toContain("kind");
  expect(reply.deny).toContain("## Review");
  expect(reply.deny).toContain("7 steps");
  expect(reply.deny).toContain('"as needed"');
  expect(reply.deny).toContain("command in backticks");
  expect(files.size).toBe(0);
});

test("a check that only builds, type-checks or lints is refused", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    body: PLAN_BODY.replace("pnpm test auth", "pnpm lint"),
  });

  expect(reply.deny).toContain("must run what the plan delivers");
  expect(files.size).toBe(0);
});

test("a check without an Expect line is refused", async ($, on) => {
  const { files } = mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    body: PLAN_BODY.replace(/- Expect:[^\n]*/, ""),
  });

  expect(reply.deny).toContain('"- Expect:"');
  expect(files.size).toBe(0);
});

test("the write tool's description asks for a check that proves the plan's behaviour works", async ($, on) => {
  let writeToolDescription = "";
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("tool.register", (_, e) => {
    if (e.name === "write_small_plan") writeToolDescription = e.description;
    return { value: { tool: e.name } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(writeToolDescription).toContain(
    "proves the behaviour the plan delivers works"
  );
  expect(writeToolDescription).toContain(
    "A build, type-check, lint or format command alone is refused"
  );
  expect(writeToolDescription).toContain(
    "the exact output that counts as passing"
  );
});

test("a banned phrase inside a code fence is allowed", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    body: `${PLAN_BODY}\n\n\`\`\`\n// TODO stays in the quoted code\n\`\`\``,
  });

  expect(reply.deny).toBeUndefined();
});

test("a plan never replaces a saved plan of the same order", async ($, on) => {
  const { files } = mockEngine(on, { [HANDOFF_SET_PLAN]: "saved earlier" });

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    title: "Another title",
  });

  expect(reply.deny).toContain(HANDOFF_SET_PLAN);
  expect(reply.deny).toContain("For separate work pass a different set name.");
  expect(files.get(HANDOFF_SET_PLAN)).toBe("saved earlier");
  expect(files.size).toBe(1);
});

test("a plan may only depend on earlier plans", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    order: 2,
    depends_on: [2, 3],
  });

  expect(reply.deny).toContain("depends_on");
});

test("a status change rewrites only the status line", async ($, on) => {
  const { files } = mockEngine(on, {
    [HANDOFF_SET_PLAN]:
      "---\ntitle: Clear\nstatus: pending\n---\n\nstatus: body\n",
  });

  const reply = await callTool($, STATUS_TOOL, {
    path: HANDOFF_SET_PLAN,
    status: "done",
  });

  expect(reply.result).toContain("done");
  expect(files.get(HANDOFF_SET_PLAN)).toBe(
    "---\ntitle: Clear\nstatus: done\n---\n\nstatus: body\n"
  );
});

const HANDOFF_SET_INDEX = `${PROJECT_FOLDER}/${HANDOFF_SET}/index.md`;

test("a plan must declare depends_on, even when it needs no other plan", async ($, on) => {
  const { depends_on: _, ...planWithoutDependencies } = {
    ...VALID_PLAN,
    depends_on: [],
  };
  mockEngine(on);

  const refused = await callTool($, WRITE_TOOL, planWithoutDependencies);
  const saved = await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    depends_on: [],
  });

  expect(refused.deny).toContain("depends_on");
  expect(saved.result).toContain("Plan saved");
});

test("saving a plan rewrites the set's index with every plan in build order", async ($, on) => {
  const { files } = mockEngine(on);

  await callTool($, WRITE_TOOL, { ...VALID_PLAN, depends_on: [] });
  await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    order: 2,
    title: "Retry the profile request",
    kind: "feature",
    depends_on: [1],
  });

  expect(files.get(HANDOFF_SET_INDEX)).toContain(
    [
      "| Order | Plan | Kind | Status | Depends on |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | [Clear the cached token](01-clear-the-cached-token.md) | fix | pending | none |",
      "| 2 | [Retry the profile request](02-retry-the-profile-request.md) | feature | pending | 1 |",
    ].join("\n")
  );
});

test("a status change rewrites the plan's row in the set's index", async ($, on) => {
  const { files } = mockEngine(on);
  await callTool($, WRITE_TOOL, { ...VALID_PLAN, depends_on: [] });

  await callTool($, STATUS_TOOL, {
    path: HANDOFF_SET_PLAN,
    status: "in-progress",
  });
  expect(files.get(HANDOFF_SET_INDEX)).toContain(
    "| fix | in-progress | none |"
  );

  await callTool($, STATUS_TOOL, { path: HANDOFF_SET_PLAN, status: "done" });
  expect(files.get(HANDOFF_SET_INDEX)).toContain("| fix | done | none |");
});

test("an edit to a plan file rewrites the set's index", async ($, on) => {
  const { files } = mockEngine(on, {
    [HANDOFF_SET_PLAN]:
      "---\ntitle: Clear the stale token\norder: 1\nkind: fix\nstatus: pending\n---\n\nbody\n",
  });

  await $.tool.call({ tool: "Edit", file_path: HANDOFF_SET_PLAN } as never);

  expect(files.get(HANDOFF_SET_INDEX)).toContain(
    "| 1 | [Clear the stale token](01-clear-the-cached-token.md) | fix | pending | none |"
  );
});

test("an edit outside a plan set writes no index", async ($, on) => {
  const { files } = mockEngine(on);

  await $.tool.call({
    tool: "Write",
    file_path: "/work/claude-kit/notes.md",
  } as never);

  expect([...files.keys()].some((path) => path.endsWith("index.md"))).toBe(
    false
  );
});

test("a status change is refused outside the plans folder and for an unknown status", async ($, on) => {
  const strayPath = "/work/claude-kit/README.md";
  const { files } = mockEngine(on, {
    [strayPath]: "status: pending\n",
    [HANDOFF_SET_PLAN]: "---\nstatus: pending\n---\n",
  });

  const strayReply = await callTool($, STATUS_TOOL, {
    path: strayPath,
    status: "done",
  });
  const climbingReply = await callTool($, STATUS_TOOL, {
    path: `${PLANS_FOLDER}/../../../../work/claude-kit/README.md`,
    status: "done",
  });
  const statusReply = await callTool($, STATUS_TOOL, {
    path: HANDOFF_SET_PLAN,
    status: "finished",
  });

  expect(strayReply.deny).toContain(PLANS_FOLDER);
  expect(climbingReply.deny).toContain(PLANS_FOLDER);
  expect(statusReply.deny).toContain("pending, in-progress, done, blocked");
  expect(files.get(strayPath)).toBe("status: pending\n");
});

const SECOND_PLAN = `${PROJECT_FOLDER}/${HANDOFF_SET}/02-clear-the-cached-token.md`;
const SECOND_PLAN_TEXT = `---\ntitle: Clear the cached token\nproject: claude-kit\ncreated: 2026-11-18T09:00:00.000Z\nset: ${HANDOFF_SET}\norder: 2\nkind: fix\nstatus: pending\n---\n\n${PLAN_BODY}\n`;

test("an update retitles a plan, renames its file and keeps its body, status and created", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    title: "Refresh the profile token",
  });

  const renamedPath = `${PROJECT_FOLDER}/${HANDOFF_SET}/02-refresh-the-profile-token.md`;
  expect(reply.result).toBe(
    `Plan updated at ${renamedPath}. The set's index is updated.`
  );
  expect(files.has(SECOND_PLAN)).toBe(false);
  expect(files.get(renamedPath)).toBe(
    SECOND_PLAN_TEXT.replace(
      "title: Clear the cached token",
      "title: Refresh the profile token"
    )
  );
  expect(files.get(HANDOFF_SET_INDEX)).toContain(
    "| 2 | [Refresh the profile token](02-refresh-the-profile-token.md) | fix | pending | none |"
  );
});

test("an update changes only the body it is given", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });
  const newBody = PLAN_BODY.replace(
    "The profile request works after a token refresh.",
    "The profile request works after a token refresh and a retry."
  );

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    body: newBody,
  });

  expect(reply.deny).toBeUndefined();
  expect(files.get(SECOND_PLAN)).toBe(
    SECOND_PLAN_TEXT.replace(`${PLAN_BODY}\n`, `${newBody}\n`)
  );
});

test("an update with a body that lacks a heading is refused and changes nothing", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    body: PLAN_BODY.replace("## Review", "## Notes"),
  });

  expect(reply.deny).toContain("The plan was not updated");
  expect(reply.deny).toContain('The body lacks "## Review".');
  expect(files.get(SECOND_PLAN)).toBe(SECOND_PLAN_TEXT);
});

test("an update with depends_on [] removes the dependency line", async ($, on) => {
  const planWithDependency = SECOND_PLAN_TEXT.replace(
    "status: pending\n",
    "status: pending\ndepends_on: 1\n"
  );
  const { files } = mockEngine(on, { [SECOND_PLAN]: planWithDependency });

  await callTool($, UPDATE_TOOL, { path: SECOND_PLAN, depends_on: [] });

  expect(files.get(SECOND_PLAN)).toBe(SECOND_PLAN_TEXT);
});

test("an update with depends_on [1] adds the line after the status line", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    depends_on: [1],
  });

  expect(reply.deny).toBeUndefined();
  expect(files.get(SECOND_PLAN)).toBe(
    SECOND_PLAN_TEXT.replace(
      "status: pending\n",
      "status: pending\ndepends_on: 1\n"
    )
  );
});

test("an update with depends_on naming a later order is refused", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    depends_on: [2, 3],
  });

  expect(reply.deny).toContain(
    "depends_on may only name the orders of earlier plans."
  );
  expect(files.get(SECOND_PLAN)).toBe(SECOND_PLAN_TEXT);
});

test("an update of an in-progress plan is refused", async ($, on) => {
  const { files } = mockEngine(on, {
    [SECOND_PLAN]: SECOND_PLAN_TEXT.replace(
      "status: pending",
      "status: in-progress"
    ),
  });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    title: "Refresh the profile token",
  });

  expect(reply.deny).toBe(
    `Plan ${SECOND_PLAN} is in-progress: a build is using it. Update it when the build ends.`
  );
  expect(files.has(SECOND_PLAN)).toBe(true);
});

test("an update outside the plans folder is refused", async ($, on) => {
  const strayPath = "/work/claude-kit/README.md";
  const { files } = mockEngine(on, { [strayPath]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, {
    path: strayPath,
    title: "Refresh the profile token",
  });

  expect(reply.deny).toContain(PLANS_FOLDER);
  expect(files.get(strayPath)).toBe(SECOND_PLAN_TEXT);
});

test("an update with no field to change is refused", async ($, on) => {
  const { files } = mockEngine(on, { [SECOND_PLAN]: SECOND_PLAN_TEXT });

  const reply = await callTool($, UPDATE_TOOL, { path: SECOND_PLAN });

  expect(reply.deny).toBe(
    "Give at least one of title, kind, body or depends_on."
  );
  expect(files.get(SECOND_PLAN)).toBe(SECOND_PLAN_TEXT);
});

test("an update that retitles a plan onto an existing file name is refused", async ($, on) => {
  const takenPath = `${PROJECT_FOLDER}/${HANDOFF_SET}/02-refresh-the-profile-token.md`;
  const { files } = mockEngine(on, {
    [SECOND_PLAN]: SECOND_PLAN_TEXT,
    [takenPath]: "taken",
  });

  const reply = await callTool($, UPDATE_TOOL, {
    path: SECOND_PLAN,
    title: "Refresh the profile token",
  });

  expect(reply.deny).toContain(`${takenPath} already exists`);
  expect(files.get(SECOND_PLAN)).toBe(SECOND_PLAN_TEXT);
  expect(files.get(takenPath)).toBe("taken");
});

test("/small-plans <work> plans that work with no handoff", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand(
    $,
    on,
    "Add a dark mode toggle!"
  );

  expect(reply.text).toContain("Planning the work as small plans");
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("Add a dark mode toggle!");
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toContain("a name you choose for this work");
  expect(submittedPrompts[0]).toContain(
    'Set "project" from the work being planned (the files, services and repositories it names), not from the working directory'
  );
  expect(submittedPrompts[0]).not.toContain("handoff");
  expect(submittedPrompts[0]).toContain(`Load ${WRITE_TOOL} before`);
  expect(submittedPrompts[0]).not.toContain("- Goal: one sentence");
  expect(submittedPrompts[0]).toContain("run /clear first");
});

test("/small-plans alone plans the work this conversation leaves", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "", {
    [NEWER_HANDOFF]: "a handoff that is not asked for",
  });

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("this conversation");
  expect(submittedPrompts[0]).not.toMatch(new RegExp(`${NEW_SET_STAMP}-plans`));
  expect(submittedPrompts[0]).not.toContain(NEWER_HANDOFF);
});

test("/small-plans plan this names the set after the work, not the request's words", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "plan this");

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).not.toContain("plan-this");
  expect(submittedPrompts[0]).toContain("dark-mode-toggle");
});

test("/small-plans <work> that starts with a command word is still planned as work", async ($, on) => {
  const { commands, submittedPrompts } = await runCommand(
    $,
    on,
    "build a login page with tests"
  );

  expect(commands.filter(([program]) => program === "bash")).toHaveLength(0);
  expect(submittedPrompts[0]).toContain("build a login page with tests");
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
});

test("/small-plans handoff lists the handoffs newest first and splits the one picked", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, "#1 · Add the Viewer");
  const { reply, submittedPrompts } = await runCommand($, on, "handoff", {
    [OLDER_HANDOFF]: "older",
    [NEWER_HANDOFF]: "newer",
  });

  const setPattern = `${NEW_SET_STAMP}-handoff-001-add-the-viewer`;
  expect(askedLabels(askedQuestions)).toEqual([
    "#2 · Fix Login",
    "#1 · Add the Viewer",
  ]);
  expect(reply.text).toMatch(new RegExp(setPattern));
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(OLDER_HANDOFF);
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toMatch(new RegExp(`set "${setPattern}"`));
  expect(submittedPrompts[0]).not.toContain("already has plans");
});

test("with no HANDOFFS_DIR handoffs are read from the local share folder", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  await runCommand($, on, "handoff", {
    [OLDER_HANDOFF]: "older",
    [NEWER_HANDOFF]: "newer",
  });

  expect(askedLabels(askedQuestions)).toEqual([
    "#2 · Fix Login",
    "#1 · Add the Viewer",
  ]);
});

test("/small-plans handoff splits nothing when the list is dismissed", async ($, on) => {
  answerAskUserQuestion(on);
  const { reply, submittedPrompts } = await runCommand($, on, "handoff", {
    [OLDER_HANDOFF]: "older",
    [NEWER_HANDOFF]: "newer",
  });

  expect(submittedPrompts).toHaveLength(0);
  expect(reply.text).toContain("/small-plans handoff <id>");
});

test("/small-plans handoff <id> points to /handoff list when no handoff has that id", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand($, on, "handoff 7", {
    [NEWER_HANDOFF]: "newer",
  });

  expect(reply.text).toBe(
    "No handoff #7 for claude-kit. Run /handoff list to see its handoffs."
  );
  expect(submittedPrompts).toHaveLength(0);
});

test("/small-plans handoff <id> splits that handoff with the extra context", async ($, on) => {
  const { submittedPrompts } = await runCommand(
    $,
    on,
    "handoff 1 leave the tests for later",
    { [OLDER_HANDOFF]: "older", [NEWER_HANDOFF]: "newer" }
  );

  expect(submittedPrompts[0]).toContain(OLDER_HANDOFF);
  expect(submittedPrompts[0]).toContain("leave the tests for later");
});

test("/small-plans handoff adds to the set its handoff already has", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "handoff", {
    [NEWER_HANDOFF]: "newer",
    [HANDOFF_SET_PLAN]: "saved earlier",
  });

  expect(submittedPrompts[0]).toContain("already has plans");
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${HANDOFF_SET}`);
  expect(submittedPrompts[0]).toContain(`set "${HANDOFF_SET}"`);
});

test("/small-plans handoff says so when the project has no handoff", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand($, on, "handoff");

  expect(reply.text).toContain("No handoffs for claude-kit yet.");
  expect(reply.text).toContain("/handoff save");
  expect(submittedPrompts).toHaveLength(0);
});

type PaneOpening = {
  id: string;
  title: string;
  focus?: boolean;
  closeOnEscape?: boolean;
};

const trackPane = (on: On, isPlaced: boolean) => {
  const openings: PaneOpening[] = [];
  const closings: string[] = [];
  on("ui.open", (_, e) => {
    openings.push(e as unknown as PaneOpening);
    return {
      value: isPlaced
        ? { isPlaced: true as const }
        : { isPlaced: false as const, reason: "no-surface" as const },
    };
  });
  on("ui.close", () => {
    closings.push("close");
    return { value: undefined };
  });
  on("ui.toast", () => ({ value: undefined }));
  return { openings, closings };
};

type AskedQuestion = { questions: { options: { label: string }[] }[] };

const answerAskUserQuestion = (on: On, ...chosenLabels: string[]) => {
  const askedQuestions: AskedQuestion[] = [];
  const remainingLabels = [...chosenLabels];
  trackPane(on, false);
  on("tool.call", { tool: "AskUserQuestion" }, (_, e) => {
    const askedQuestion = e as unknown as AskedQuestion & {
      questions: { question: string }[];
    };
    askedQuestions.push(askedQuestion);
    const chosenLabel = remainingLabels.shift();
    if (chosenLabel === undefined) return { deny: "dismissed" };
    const question = askedQuestion.questions[0]?.question ?? "";
    return {
      result: { ...askedQuestion, answers: { [question]: chosenLabel } },
    } as never;
  });
  return askedQuestions;
};

const askedLabels = (askedQuestions: AskedQuestion[]) =>
  askedQuestions.flatMap(({ questions }) =>
    questions.flatMap(({ options }) => options.map(({ label }) => label))
  );

test("/small-plans build lists the sets newest first and builds the one picked", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(
    on,
    "Handoff 002 Fix Login · Nov 18, 09:00"
  );
  const { submittedPrompts } = await runCommand($, on, "build", {
    [HANDOFF_SET_PLAN]: "older, from a handoff",
    [STANDALONE_SET_PLAN]: "newer, planned on its own",
  });

  expect(askedLabels(askedQuestions)).toEqual([
    "Add a Dark Mode Toggle · Nov 19, 10:00",
    "Handoff 002 Fix Login · Nov 18, 09:00",
  ]);
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${HANDOFF_SET}`);
});

test("/small-plans build labels a set in title case, keeping acronyms and small words", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  await runCommand($, on, "build", {
    [`${PROJECT_FOLDER}/2026-11-20-1100-ai-meal-suggestion-disclosure/01-add-the-toggle.md`]:
      "plan",
    [STANDALONE_SET_PLAN]: "older",
  });

  expect(askedLabels(askedQuestions)).toEqual([
    "AI Meal Suggestion Disclosure · Nov 20, 11:00",
    "Add a Dark Mode Toggle · Nov 19, 10:00",
  ]);
});

test("/small-plans build builds nothing when the list is dismissed", async ($, on) => {
  answerAskUserQuestion(on);
  const { reply, submittedPrompts } = await runCommand($, on, "build", {
    [HANDOFF_SET_PLAN]: "older, from a handoff",
    [STANDALONE_SET_PLAN]: "newer, planned on its own",
  });

  expect(submittedPrompts).toHaveLength(0);
  expect(reply.text).toContain(STANDALONE_SET);
});

test("/small-plans build runs the only set without asking", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, HANDOFF_SET);
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "planned on its own",
  });

  expect(askedQuestions).toHaveLength(0);
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${STANDALONE_SET}`);
  expect(submittedPrompts[0]).toContain("small-plans:small-plan-implementer");
  expect(submittedPrompts[0]).toContain(STATUS_TOOL);
});

test("/small-plans build has a reviewer agent review each plan and send fixes to a new implementer", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "Start the small-plans:small-plan-reviewer agent with the two lines"
  );
  expect(submittedPrompts[0]).toContain(
    "start a new small-plans:small-plan-implementer agent with the two lines, then a line `Fix: <findings path>`, and go again from step 3"
  );
  expect(submittedPrompts[0]).toContain("at most 3 fix rounds");
  expect(submittedPrompts[0]).toContain(
    "find the root cause: for this step only, read the plan and its report or findings file"
  );
  expect(submittedPrompts[0]).toContain(
    "only when the fix needs something only the user can give"
  );
  expect(submittedPrompts[0]).toContain(
    "Keep going while each attempt changes the failure"
  );
  expect(submittedPrompts[0]).not.toContain("general-purpose");
});

test("/small-plans build names the start, check and finish tools, the reviewer and the branch convention file", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain("small-plans:small-plan-reviewer");
  expect(submittedPrompts[0]).toContain(
    `${PROJECT_FOLDER}/branch-convention.md`
  );
  expect(submittedPrompts[0]).toContain(START_TOOL);
  expect(submittedPrompts[0]).toContain(CHECK_TOOL);
  expect(submittedPrompts[0]).toContain(FINISH_TOOL);
  expect(submittedPrompts[0]).not.toContain("small-plan-checker");
  expect(submittedPrompts[0]).not.toContain("small_plan_worktree");
  expect(submittedPrompts[0]).not.toContain("general-purpose");
});

test("/small-plans build lists the plans not done with their status and depends_on", async ($, on) => {
  answerAskUserQuestion(on, "Whole set");
  const { submittedPrompts } = await runCommand($, on, "build", {
    ...THREE_PLAN_SET,
    [`${SET_FOLDER}/03-test-the-toggle.md`]: "status: blocked\ndepends_on: 2",
  });

  expect(submittedPrompts[0]).toContain(
    "Plans not done (file, title, kind, status, depends on, check command):"
  );
  expect(submittedPrompts[0]).toContain(
    "| pending | depends on none | check: none"
  );
  expect(submittedPrompts[0]).toContain(
    "| blocked | depends on 2 | check: none"
  );
  expect(submittedPrompts[0]).not.toContain("01-add-the-toggle.md |");
});

test("/small-plans build has the check tool run the check, lint, fallow and tests, and a subagent fix a failing guard", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    `call ${CHECK_TOOL} with the plan's path, the worktree and the plan's check command as listed above. It runs the plan's check, lint, fallow and the tests`
  );
  expect(submittedPrompts[0]).toContain(
    "When Lint, Fallow or Tests is FAIL, start a new small-plans:small-plan-implementer agent with the two lines, then a line `Fix: <report path>`"
  );
  expect(submittedPrompts[0]).toContain(`and call ${CHECK_TOOL} again`);
  expect(submittedPrompts[0]).toContain("at most 3 such rounds");
  expect(submittedPrompts[0]).toContain(
    "a failing guard does not count as a fix round"
  );
  expect(submittedPrompts[0]).not.toContain("general-purpose");
});

test("/small-plans build finishes each plan with the finish tool, only after the review passes", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    `On PASS, call ${FINISH_TOOL} with the plan's path, the worktree and one short conventional commit subject`
  );
  expect(submittedPrompts[0]).toContain(
    "It commits everything changed in the worktree with that subject alone, pushes the branch, removes the worktree, which keeps the branch, and marks the plan done."
  );
  expect(submittedPrompts[0]).toContain(
    "Never call it before the reviewer answers PASS."
  );
});

test("/small-plans build asks before committing leftover work in the checkout where it started", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "run `git status --short` in the checkout where the build started"
  );
  expect(submittedPrompts[0]).toContain(
    "ask the user with AskUserQuestion whether to commit and push them"
  );
  expect(submittedPrompts[0]).toContain(
    "never a file that holds a secret such as `.env`"
  );
});

test("/small-plans build builds each plan in its own worktree on a branch named by the repository's rules", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "Each plan is built in its own git worktree, on its own branch:"
  );
  expect(submittedPrompts[0]).toContain(
    'follow the convention it states. Otherwise start an Explore agent with model "haiku"'
  );
  expect(submittedPrompts[0]).toContain("name the branch `<type>/<plan slug>`");
  expect(submittedPrompts[0]).toContain(
    `Call ${START_TOOL} with the plan's path, a folder inside the repository, the branch and the base`
  );
  expect(submittedPrompts[0]).toContain("then a line `Worktree: <path>`");
  expect(submittedPrompts[0]).toContain("bug for a fix");
});

type GitAnswer = { match: string; exitCode?: number; stdout?: string };

const mockGit = (
  on: On,
  answers: GitAnswer[],
  seededFiles: Record<string, string> = {},
  { rejectShellWith }: { rejectShellWith?: Error } = {}
) => {
  const recorded: Recorded = {
    files: new Map(Object.entries(seededFiles)),
    submittedPrompts: [],
    commands: [],
    runs: [],
  };
  mockFiles(on, recorded);
  on("process.run", (_, e) => {
    recorded.commands.push([...e.argv]);
    recorded.runs.push({ argv: [...e.argv], cwd: e.init?.cwd });
    if (rejectShellWith && e.argv[0] === "sh")
      return { deny: rejectShellWith.message };
    const answer = answers.find(({ match }) => e.argv.includes(match));
    return {
      value: {
        exitCode: answer?.exitCode ?? 0,
        stdout: answer?.stdout ?? "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return recorded;
};

const REPOSITORY = "/work/claude-kit";
const WORKTREE = "/work/add-the-toggle";
const BRANCH = "feat/add-the-toggle";

test("start_small_plan adds a worktree beside the repository on a new branch and marks the plan in-progress", async ($, on) => {
  const { files, commands } = mockGit(
    on,
    [{ match: "--show-toplevel", stdout: REPOSITORY }],
    { [STANDALONE_SET_PLAN]: "status: pending" }
  );

  const reply = await callTool($, START_TOOL, {
    path: STANDALONE_SET_PLAN,
    repository: REPOSITORY,
    branch: BRANCH,
    base: "main",
  });

  expect(commands).toContainEqual([
    "git",
    "-C",
    REPOSITORY,
    "worktree",
    "add",
    "-b",
    BRANCH,
    WORKTREE,
    "main",
  ]);
  expect(files.get(STANDALONE_SET_PLAN)).toContain("status: in-progress");
  expect(reply.result).toBe(`Worktree: ${WORKTREE}`);
});

test("start_small_plan reuses the worktree already on the branch and adds none", async ($, on) => {
  const { commands } = mockGit(
    on,
    [
      { match: "--show-toplevel", stdout: REPOSITORY },
      {
        match: "--porcelain",
        stdout: `worktree ${REPOSITORY}\nHEAD abc\nbranch refs/heads/main\n\nworktree /work/earlier\nHEAD def\nbranch refs/heads/${BRANCH}`,
      },
    ],
    { [STANDALONE_SET_PLAN]: "status: pending" }
  );

  const reply = await callTool($, START_TOOL, {
    path: STANDALONE_SET_PLAN,
    repository: REPOSITORY,
    branch: BRANCH,
    base: "main",
  });

  expect(reply.result).toBe("Worktree: /work/earlier");
  expect(
    commands.some((argv) => argv.includes("worktree") && argv.includes("add"))
  ).toBe(false);
});

test("start_small_plan checks out an existing branch that has no worktree without -b", async ($, on) => {
  const { commands } = mockGit(
    on,
    [
      { match: "--show-toplevel", stdout: REPOSITORY },
      { match: "--verify", stdout: "abc123" },
    ],
    { [STANDALONE_SET_PLAN]: "status: pending" }
  );

  await callTool($, START_TOOL, {
    path: STANDALONE_SET_PLAN,
    repository: REPOSITORY,
    branch: BRANCH,
    base: "main",
  });

  expect(commands).toContainEqual([
    "git",
    "-C",
    REPOSITORY,
    "worktree",
    "add",
    WORKTREE,
    BRANCH,
  ]);
});

test("start_small_plan refuses a branch that starts with a dash and runs no git", async ($, on) => {
  const { commands } = mockGit(on, [], {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  const reply = await callTool($, START_TOOL, {
    path: STANDALONE_SET_PLAN,
    repository: REPOSITORY,
    branch: "-f",
    base: "main",
  });

  expect(reply.deny).toBe("branch and base must be branch names.");
  expect(commands).toEqual([]);
});

test("start_small_plan refuses a plan path outside the plans folder", async ($, on) => {
  mockGit(on, []);

  const reply = await callTool($, START_TOOL, {
    path: "/home/tester/notes/01-add-the-toggle.md",
    repository: REPOSITORY,
    branch: BRANCH,
    base: "main",
  });

  expect(reply.deny).toContain(PLANS_FOLDER);
});

const FINISH_SEED = { [STANDALONE_SET_PLAN]: "status: in-progress" };
const FINISH_GIT: GitAnswer[] = [
  { match: "--abbrev-ref", stdout: BRANCH },
  { match: "--git-common-dir", stdout: `${REPOSITORY}/.git` },
  { match: "--git-dir", stdout: `${REPOSITORY}/.git/worktrees/add-the-toggle` },
];
const FINISH_INPUT = {
  path: STANDALONE_SET_PLAN,
  worktree: WORKTREE,
  subject: "feat: add the toggle",
};

test("finish_small_plan commits, pushes, removes the worktree and marks the plan done, in that order", async ($, on) => {
  const { files, commands } = mockGit(
    on,
    [{ match: "--porcelain", stdout: " M src/toggle.ts" }, ...FINISH_GIT],
    FINISH_SEED
  );

  const reply = await callTool($, FINISH_TOOL, FINISH_INPUT);

  expect(commands.slice(-4)).toEqual([
    ["git", "-C", WORKTREE, "add", "-A"],
    ["git", "-C", WORKTREE, "commit", "-m", "feat: add the toggle"],
    ["git", "-C", WORKTREE, "push", "-u", "origin", BRANCH],
    ["git", `--git-dir=${REPOSITORY}/.git`, "worktree", "remove", WORKTREE],
  ]);
  expect(files.get(STANDALONE_SET_PLAN)).toContain("status: done");
  expect(reply.result).toBe(
    `Plan marked done: ${BRANCH} is committed and pushed, and the worktree is removed.`
  );
});

test("finish_small_plan skips add and commit when the worktree is clean", async ($, on) => {
  const { commands } = mockGit(on, FINISH_GIT, FINISH_SEED);

  await callTool($, FINISH_TOOL, FINISH_INPUT);

  expect(
    commands.some((argv) => argv.includes("add") || argv.includes("commit"))
  ).toBe(false);
  expect(commands).toContainEqual([
    "git",
    "-C",
    WORKTREE,
    "push",
    "-u",
    "origin",
    BRANCH,
  ]);
});

test("finish_small_plan keeps the worktree when the push fails, and still marks the plan done", async ($, on) => {
  const { files, commands } = mockGit(
    on,
    [
      { match: "push", exitCode: 1 },
      { match: "--porcelain", stdout: " M src/toggle.ts" },
      ...FINISH_GIT,
    ],
    FINISH_SEED
  );

  const reply = await callTool($, FINISH_TOOL, FINISH_INPUT);

  expect(commands.some((argv) => argv.includes("remove"))).toBe(false);
  expect(files.get(STANDALONE_SET_PLAN)).toContain("status: done");
  expect(reply.result).toContain("git push failed");
  expect(reply.result).toContain(WORKTREE);
});

test("finish_small_plan refuses the main checkout and commits nothing", async ($, on) => {
  const { commands } = mockGit(
    on,
    [
      { match: "--git-dir", stdout: `${REPOSITORY}/.git` },
      { match: "--porcelain", stdout: " M src/toggle.ts" },
      ...FINISH_GIT,
    ],
    FINISH_SEED
  );

  const reply = await callTool($, FINISH_TOOL, FINISH_INPUT);

  expect(reply.deny).toBe(`${WORKTREE} is not a plan worktree on a branch.`);
  expect(commands.some((argv) => argv.includes("commit"))).toBe(false);
});

test("finish_small_plan refuses a subject with a newline and runs no git", async ($, on) => {
  const { commands } = mockGit(on, FINISH_GIT, FINISH_SEED);

  const reply = await callTool($, FINISH_TOOL, {
    ...FINISH_INPUT,
    subject: "feat: add the toggle\n\nlong body",
  });

  expect(reply.deny).toBe("subject must be one line.");
  expect(commands).toEqual([]);
});

const SET_FOLDER = `${PROJECT_FOLDER}/${STANDALONE_SET}`;
const THREE_PLAN_SET = {
  [`${SET_FOLDER}/01-add-the-toggle.md`]: "status: done",
  [`${SET_FOLDER}/02-store-the-choice.md`]:
    "title: Store the choice\nkind: feature\nstatus: pending",
  [`${SET_FOLDER}/03-test-the-toggle.md`]: "status: blocked",
};

test("/small-plans build asks for the whole set or one plan that is not done", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, "Whole set");
  const { submittedPrompts } = await runCommand($, on, "build", THREE_PLAN_SET);

  expect(askedLabels(askedQuestions)).toEqual([
    "2 · Store the Choice",
    "3 · Test the Toggle",
    "Whole set",
  ]);
  expect(submittedPrompts[0]).toContain(
    `Build the plans in ${SET_FOLDER}, in the order listed below.`
  );
});

test("/small-plans build lists a plan's check command in backticks", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: `title: Add the toggle\nkind: feature\nstatus: pending\n${PLAN_BODY}`,
  });

  expect(submittedPrompts[0]).toContain(
    "| pending | depends on none | check: `pnpm test auth`"
  );
});

test("/small-plans build builds only the plan picked", async ($, on) => {
  answerAskUserQuestion(on, "3 · Test the Toggle");
  const { submittedPrompts } = await runCommand($, on, "build", THREE_PLAN_SET);

  expect(submittedPrompts[0]).toContain(
    `Build only the plan at ${SET_FOLDER}/03-test-the-toggle.md.`
  );
  expect(submittedPrompts[0]).toContain(
    "- 02-store-the-choice.md | Store the choice | feature | pending | depends on none | check: none"
  );
});

test("/small-plans build builds nothing when the plan list is dismissed", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand(
    $,
    on,
    "build",
    THREE_PLAN_SET
  );

  expect(submittedPrompts).toHaveLength(0);
  expect(reply.text).toContain("02-store-the-choice");
});

test("/small-plans build <set> <order> builds that plan without asking", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  const { submittedPrompts } = await runCommand(
    $,
    on,
    "build dark-mode 2",
    THREE_PLAN_SET
  );

  expect(askedQuestions).toHaveLength(0);
  expect(submittedPrompts[0]).toContain(
    `Build only the plan at ${SET_FOLDER}/02-store-the-choice.md.`
  );
});

test("/small-plans build says so when every plan of the set is done", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: done",
  });

  expect(reply.text).toContain("Every plan");
  expect(submittedPrompts).toHaveLength(0);
});

test("/small-plans build writes the index of a set that has none", async ($, on) => {
  const { files } = await runCommand($, on, `build ${HANDOFF_SET}`, {
    [HANDOFF_SET_PLAN]:
      "---\ntitle: Clear the cached token\norder: 1\nkind: fix\nstatus: pending\n---\n\nbody\n",
  });

  expect(files.get(HANDOFF_SET_INDEX)).toContain(
    "| 1 | [Clear the cached token](01-clear-the-cached-token.md) | fix | pending | none |"
  );
});

test("/small-plans build lists no set whose plans are all done", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, HANDOFF_SET);
  const { submittedPrompts } = await runCommand($, on, "build", {
    [HANDOFF_SET_PLAN]: "status: pending",
    [`${PROJECT_FOLDER}/2026-11-17-0800-old-work/01-done.md`]: "status: done",
    [STANDALONE_SET_PLAN]: "status: done",
  });

  expect(askedQuestions).toHaveLength(0);
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${HANDOFF_SET}`);
});

test("/small-plans build <name> runs the set whose name holds it", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build fix-login", {
    [HANDOFF_SET_PLAN]: "older, from a handoff",
    [STANDALONE_SET_PLAN]: "newer, planned on its own",
  });

  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${HANDOFF_SET}`);
});

test("/small-plans build says so when no set matches", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand($, on, "build absent", {
    [STANDALONE_SET_PLAN]: "newer",
  });

  expect(reply.text).toContain("No plans");
  expect(submittedPrompts).toHaveLength(0);
});

const RENAMED_SET = "2026-11-18-0900-handoff-002-repair-the-login-refresh";
const RENAMED_SET_FOLDER = `${PROJECT_FOLDER}/${RENAMED_SET}`;
const FIX_LOGIN_PLAN_TEXT = `---\ntitle: Clear the cached token\nproject: claude-kit\nset: ${HANDOFF_SET}\norder: 1\nkind: fix\nstatus: pending\n---\n\nbody\n`;

test("/small-plans rename gives a set a new name that keeps its timestamp and handoff id", async ($, on) => {
  const { reply, files } = await runCommand(
    $,
    on,
    "rename fix-login Repair the login refresh",
    { [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT }
  );

  expect(reply.text).toContain(`${HANDOFF_SET} -> ${RENAMED_SET}`);
  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${PROJECT_FOLDER}/${HANDOFF_SET}/`)
    )
  ).toBe(false);
  expect(files.get(`${RENAMED_SET_FOLDER}/01-clear-the-cached-token.md`)).toBe(
    FIX_LOGIN_PLAN_TEXT.replace(`set: ${HANDOFF_SET}`, `set: ${RENAMED_SET}`)
  );
  expect(files.get(`${RENAMED_SET_FOLDER}/index.md`)).toContain(
    `# Plans: ${RENAMED_SET}`
  );
});

test("/small-plans rename refuses a name another set of the project already has", async ($, on) => {
  const { reply, files } = await runCommand(
    $,
    on,
    "rename fix-login Repair the login refresh",
    {
      [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT,
      [`${RENAMED_SET_FOLDER}/01-other.md`]: "saved elsewhere",
    }
  );

  expect(reply.text).toContain(`${RENAMED_SET} already exists`);
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("/small-plans rename lists every set its name matches and renames none", async ($, on) => {
  const { reply, files } = await runCommand($, on, "rename 2026-11 Anything", {
    [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT,
    [STANDALONE_SET_PLAN]: "saved",
  });

  expect(reply.text).toContain(HANDOFF_SET);
  expect(reply.text).toContain(STANDALONE_SET);
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("/small-plans rename with no words submits one prompt to Claude and renames nothing", async ($, on) => {
  const { reply, files, submittedPrompts } = await runCommand($, on, "rename", {
    [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT,
  });

  expect(reply.text).toBe("Renaming a set of small plans…");
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("rename_small_plan_set");
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("/small-plans rename with only a set submits one prompt naming that set and renames nothing", async ($, on) => {
  const { reply, files, submittedPrompts } = await runCommand(
    $,
    on,
    "rename fix-login",
    { [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT }
  );

  expect(reply.text).toBe("Renaming a set of small plans…");
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("rename_small_plan_set");
  expect(submittedPrompts[0]).toContain(
    `The user typed "fix-login": if a saved set's name holds it, that is the set to rename; if none does, it is the new name for the set this conversation made or talks about.`
  );
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("the rename tool renames a set and returns the result", async ($, on) => {
  const { files } = mockEngine(on, { [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT });

  const outcome = await callTool($, RENAME_TOOL, {
    set: "fix-login",
    name: "Repair the login refresh",
  });

  expect(outcome.result).toBe(`Renamed set ${HANDOFF_SET} -> ${RENAMED_SET}.`);
  expect(outcome.deny).toBeUndefined();
  expect(files.get(`${RENAMED_SET_FOLDER}/01-clear-the-cached-token.md`)).toBe(
    FIX_LOGIN_PLAN_TEXT.replace(`set: ${HANDOFF_SET}`, `set: ${RENAMED_SET}`)
  );
});

test("the rename tool denies a name that names the request and renames nothing", async ($, on) => {
  const { files } = mockEngine(on, { [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT });

  const outcome = await callTool($, RENAME_TOOL, {
    set: "fix-login",
    name: "plan-this",
  });

  expect(outcome.deny).toBe(
    'The name "plan-this" names the request, not the work. Name what the plans deliver in 2 to 5 words, such as dark-mode-toggle.'
  );
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("the rename tool denies a set text that several sets hold and lists them", async ($, on) => {
  const { files } = mockEngine(on, {
    [HANDOFF_SET_PLAN]: FIX_LOGIN_PLAN_TEXT,
    [STANDALONE_SET_PLAN]: "saved",
  });

  const outcome = await callTool($, RENAME_TOOL, {
    set: "2026-11",
    name: "Repair the login refresh",
  });

  expect(outcome.deny).toContain(HANDOFF_SET);
  expect(outcome.deny).toContain(STANDALONE_SET);
  expect(files.get(HANDOFF_SET_PLAN)).toBe(FIX_LOGIN_PLAN_TEXT);
});

test("the list tool shows the newest sets with their index and folder", async ($, on) => {
  mockEngine(on, {
    [`${PROJECT_FOLDER}/${HANDOFF_SET}/index.md`]: "handoff index",
    [`${PROJECT_FOLDER}/${STANDALONE_SET}/index.md`]: "standalone index",
  });

  const outcome = await callTool($, LIST_TOOL);

  expect(outcome.result).toBe(
    [
      `Set ${STANDALONE_SET} (${PROJECT_FOLDER}/${STANDALONE_SET})\nstandalone index`,
      `Set ${HANDOFF_SET} (${PROJECT_FOLDER}/${HANDOFF_SET})\nhandoff index`,
    ].join("\n\n")
  );
});

test("the list tool shows only the sets whose name holds the given text", async ($, on) => {
  mockEngine(on, {
    [`${PROJECT_FOLDER}/${HANDOFF_SET}/index.md`]: "handoff index",
    [`${PROJECT_FOLDER}/${STANDALONE_SET}/index.md`]: "standalone index",
  });

  const outcome = await callTool($, LIST_TOOL, { set: "fix-login" });

  expect(outcome.result).toContain(`Set ${HANDOFF_SET} (`);
  expect(outcome.result).not.toContain(STANDALONE_SET);
});

test("the list tool names the older sets it leaves out after the five newest", async ($, on) => {
  const seededFiles = Object.fromEntries(
    ["01", "02", "03", "04", "05", "06"].map((order) => [
      `${PROJECT_FOLDER}/2026-11-${order}-0900-set-${order}/index.md`,
      `index ${order}`,
    ])
  );
  mockEngine(on, seededFiles);

  const outcome = await callTool($, LIST_TOOL);

  expect(outcome.result).not.toContain("Set 2026-11-01-0900-set-01 (");
  expect(outcome.result).toContain("\nOlder sets: 2026-11-01-0900-set-01");
});

test("the list tool says when no set is saved, or none holds the given text", async ($, on) => {
  mockEngine(on);

  const everySet = await callTool($, LIST_TOOL);
  const namedSet = await callTool($, LIST_TOOL, { set: "nothing-like-this" });

  expect(everySet.result).toBe(
    `No small plans are saved in ${PROJECT_FOLDER}.`
  );
  expect(namedSet.result).toBe(
    `No saved set holds "nothing-like-this" in ${PROJECT_FOLDER}.`
  );
});

test("/small-plans rename is refused while a build of that set runs", async ($, on) => {
  const clock = mock.clock(on);
  const recorded = mockEngine(on, THREE_PLAN_SET);
  await $.command.run({
    command: "small-plans",
    args: "build dark-mode 2",
  } as never);
  await clock.settle();
  await callTool($, STATUS_TOOL, {
    path: BOARD_SET_PLAN,
    status: "in-progress",
  });
  const reply = await $.command.run({
    command: "small-plans",
    args: "rename dark-mode Dark mode switch",
  } as never);
  await clock.settle();

  expect(reply.text).toContain("is running");
  expect(recorded.files.has(BOARD_SET_PLAN)).toBe(true);
  expect(recorded.commands.some(([program]) => program === "mv")).toBe(false);
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

test("typing the first word after /small-plans suggests every action", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/small-plans ");

  expect(suggestedTexts(reply)).toEqual([
    "handoff",
    "build",
    "board",
    "rename",
  ]);
  expect(reply.suggestions[0]!.description).toContain("saved handoff");
});

test("a partly typed /small-plans action narrows the suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const reply = await autocomplete($, "/small-plans bu");

  expect(suggestedTexts(reply)).toEqual(["build"]);
});

test("later words, other words and other commands get no /small-plans suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const laterWordReply = await autocomplete($, "/small-plans add a bu");
  const workReply = await autocomplete($, "/small-plans da");
  const otherReply = await autocomplete($, "/handoff op");
  const commandReply = await autocomplete($, "/small-plans");

  expect(suggestedTexts(laterWordReply)).toEqual([]);
  expect(suggestedTexts(workReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
  expect(suggestedTexts(commandReply)).toEqual([]);
});

test("a plan written in a deleted worktree is saved under the main repository's name", async ($, on) => {
  const { files } = mockEngine(
    on,
    {},
    "",
    "/work/claude-kit/.claude/worktrees/feature-x"
  );

  await callTool($, WRITE_TOOL, { ...VALID_PLAN, order: 1 });

  expect(
    [...files.keys()].some((path) => path.startsWith(`${PROJECT_FOLDER}/`))
  ).toBe(true);
});

test("a plan for a folder in another repository's worktree is saved under that repository's name", async ($, on) => {
  const { files } = mockEngine(on, {}, "");

  await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    order: 1,
    project: "/work/notes-app/.claude/worktrees/fix-login",
  });

  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${PROJECT_FOLDER.replace("claude-kit", "notes-app")}/`)
    )
  ).toBe(true);
});

test("a plan for a plain topic name is saved under that name with no repository", async ($, on) => {
  const { files } = mockEngine(on, {}, "");

  await callTool($, WRITE_TOOL, {
    ...VALID_PLAN,
    order: 1,
    project: "research",
  });

  expect(
    [...files.keys()].some((path) =>
      path.startsWith(`${PLANS_FOLDER}/research/`)
    )
  ).toBe(true);
});

test("list_small_plans lists a plain topic name", async ($, on) => {
  mockEngine(
    on,
    { [`${PLANS_FOLDER}/research/${HANDOFF_SET}/index.md`]: "topic index" },
    ""
  );

  const outcome = await callTool($, LIST_TOOL, { project: "research" });

  expect(outcome.result).toBe(
    `Set ${HANDOFF_SET} (${PLANS_FOLDER}/research/${HANDOFF_SET})\ntopic index`
  );
});

const SET_QUESTION = "🧺 Which plan set shall we build?";

const mountQuestion = ($: Engine, question: string) =>
  $.ui.mount({
    plugin: "small-plans",
    component: "AskUserQuestion",
    surface: "terminal",
    props: {
      tool: "AskUserQuestion",
      questions: [
        {
          question,
          header: "Plan set",
          multiSelect: false,
          options: [
            { label: "Add a dark mode toggle" },
            { label: "Fix login" },
          ],
        },
      ],
    },
  } as never);

test("the small-plans pickers ask in a friendly voice", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, "3 · Test the Toggle");
  await runCommand($, on, "build", {
    ...THREE_PLAN_SET,
    [HANDOFF_SET_PLAN]: "status: pending",
  });

  expect(
    askedQuestions.map(
      (asked) =>
        (asked as unknown as { questions: { question: string }[] }).questions[0]
          ?.question
    )
  ).toEqual([SET_QUESTION]);
});

test("a small-plans picker opens under the shared heading with a pride stripe and no side frame", async ($) => {
  const drawing = await mountQuestion($, SET_QUESTION);

  expect(
    await drawing.find({ type: "Text", text: "🧩 Small plans" })
  ).toBeDefined();
  expect(await drawing.findAll({ type: "Text", text: /^━━$/ })).toHaveLength(6);
  expect(await drawing.find({ key: "small-plans-frame" })).toBeUndefined();
});

test("a small-plans picker gets a blank row above and below, and no side padding that would wrap the dialog's divider", async ($) => {
  const drawing = await mountQuestion($, SET_QUESTION);
  const picker = await drawing.find({ key: "small-plans-picker" });

  expect(picker?.props).toMatchObject({ paddingY: 1 });
  expect(picker?.props).not.toHaveProperty("paddingX");
});

test("the small-plans picker heading is semibold rather than the deprecated bold", async ($) => {
  const drawing = await mountQuestion($, SET_QUESTION);
  const heading = await drawing.find({ type: "Text", text: "🧩 Small plans" });

  expect(heading?.props).toMatchObject({ weight: "semibold" });
  expect(heading?.props).not.toHaveProperty("bold");
});

test("another plugin's question gets no small-plans heading", async ($) => {
  const drawing = await mountQuestion($, "Which database should we use?");

  expect(
    await drawing.find({ type: "Text", text: "🧩 Small plans" })
  ).toBeUndefined();
});

test("every tool is registered behind ToolSearch", async ($, on) => {
  const deferredFlags: unknown[] = [];
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("tool.register", (_, e) => {
    deferredFlags.push(e.isDeferred);
    return { value: { tool: e.name } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(deferredFlags.length).toBeGreaterThan(0);
  expect(deferredFlags.every((flag) => flag === true)).toBe(true);
});

const BOARD_SET_PLAN = `${SET_FOLDER}/02-store-the-choice.md`;

const mountBand = ($: Engine, bodyColumns = 90, hasSurvey = false) =>
  $.ui.mount({
    plugin: "small-plans",
    component: "AbovePrompt",
    surface: "terminal",
    props: {
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  } as never);

const startBoardedBuild = async ($: Engine, on: On) => {
  await runCommand($, on, "build dark-mode 2", THREE_PLAN_SET);
  await callTool($, STATUS_TOOL, {
    path: BOARD_SET_PLAN,
    status: "in-progress",
  });
};

test("no build board shows before a build starts", async ($, on) => {
  mockEngine(on, THREE_PLAN_SET);
  const drawing = await mountBand($);

  expect(
    await drawing.find({ type: "Text", text: "🧩 Small plans" })
  ).toBeUndefined();
});

test("a build board lists each plan under its status pill, failing first, with counts", async ($, on) => {
  await startBoardedBuild($, on);
  const drawing = await mountBand($);

  expect(
    await drawing.find({ type: "Text", text: "🧩 Small plans" })
  ).toBeDefined();
  expect(await drawing.find({ type: "Text", text: "✗ Failing" })).toBeDefined();
  const pills = await drawing.findAll({
    type: "Text",
    text: /^ (FAIL|RUN|PASS|WAIT) +$/,
  });
  expect(pills.map((pill) => pill.props.backgroundColor)).toEqual([
    "error",
    "warning",
    "success",
  ]);
  expect(await drawing.find({ type: "Text", text: "✗ 1" })).toBeDefined();
  expect(await drawing.find({ type: "Text", text: "● 1" })).toBeDefined();
  expect(await drawing.find({ type: "Text", text: "✓ 1" })).toBeDefined();
  expect(await drawing.find({ key: "hide" })).toBeDefined();
});

test("a build board says Done once no plan runs or waits and none failed", async ($, on) => {
  await runCommand($, on, "build dark-mode 2", {
    [`${SET_FOLDER}/01-add-the-toggle.md`]: "status: done",
    [BOARD_SET_PLAN]: "status: pending",
  });
  await callTool($, STATUS_TOOL, { path: BOARD_SET_PLAN, status: "done" });
  const drawing = await mountBand($);

  expect(await drawing.find({ type: "Text", text: "✓ Done" })).toBeDefined();
});

test("the build board hides on h and stays hidden", async ($, on) => {
  await startBoardedBuild($, on);
  const drawing = await mountBand($);
  await drawing.press({ key: "hide" });

  expect(
    await (await mountBand($)).find({ type: "Text", text: "🧩 Small plans" })
  ).toBeUndefined();
});

test("hiding the build board says how to show it again", async ($, on) => {
  const toasts: string[] = [];
  on("ui.toast", (_, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  await startBoardedBuild($, on);
  await (await mountBand($)).press({ key: "hide" });

  expect(toasts).toEqual([expect.stringContaining("/small-plans board")]);
});

test("/small-plans board shows a hidden build board again", async ($, on) => {
  await startBoardedBuild($, on);
  await (await mountBand($)).press({ key: "hide" });

  const reply = await $.command.run({
    command: "small-plans",
    args: "board",
  } as never);

  expect(reply).toEqual({});
  expect(
    await (await mountBand($)).find({ type: "Text", text: "🧩 Small plans" })
  ).toBeDefined();
});

test("/small-plans board before any build says there is no board to show", async ($, on) => {
  mockEngine(on, THREE_PLAN_SET);

  const reply = await $.command.run({
    command: "small-plans",
    args: "board",
  } as never);

  expect(reply).toMatchObject({
    text: expect.stringContaining("No build board"),
  });
  expect(
    await (await mountBand($)).find({ type: "Text", text: "🧩 Small plans" })
  ).toBeUndefined();
});

test("a survey keeps the band instead of the build board", async ($, on) => {
  await startBoardedBuild($, on);
  const drawing = await mountBand($, 90, true);

  expect(
    await drawing.find({ type: "Text", text: "🧩 Small plans" })
  ).toBeUndefined();
});

test("a narrow build board drops the elapsed time under 40 columns", async ($, on) => {
  await startBoardedBuild($, on);

  expect(
    await (await mountBand($, 90)).find({ type: "Text", text: "0s" })
  ).toBeDefined();
  expect(
    await (await mountBand($, 40)).find({ type: "Text", text: "0s" })
  ).toBeUndefined();
});

test("the build board keeps one row above it and none below, so stacked band rows space evenly", async ($, on) => {
  await startBoardedBuild($, on);
  const drawing = await mountBand($);

  const board = await drawing.find({ key: "small-plans-board" });
  expect(board?.props).toMatchObject({ marginTop: 1 });
  expect(board?.props).not.toHaveProperty("paddingBottom");
});

const FALLOW_SHELL =
  "command -v fallow >/dev/null || exit 127; fallow audit --format compact";
const CHECK_REPORT = STANDALONE_SET_PLAN.replace(/\.md$/, ".check.txt");
const checkGit = (changedFiles: string): GitAnswer[] => [
  { match: "--is-inside-work-tree", stdout: "true" },
  { match: "--name-only", stdout: changedFiles },
];
const CHECK_SEED = { [STANDALONE_SET_PLAN]: PLAN_BODY };
const CHECK_COMMAND = "pnpm test auth";
const runCheck = ($: Engine) =>
  callTool($, CHECK_TOOL, {
    path: STANDALONE_SET_PLAN,
    worktree: WORKTREE,
    command: CHECK_COMMAND,
  });

test("check_small_plan refuses a command that differs from the plan's check command and runs nothing", async ($, on) => {
  const { runs } = mockGit(on, checkGit("src/auth.ts"), CHECK_SEED);

  const reply = await callTool($, CHECK_TOOL, {
    path: STANDALONE_SET_PLAN,
    worktree: WORKTREE,
    command: "rm -rf /",
  });

  expect(reply.deny).toBe(
    `command must be the plan's check command, exactly: ${CHECK_COMMAND}`
  );
  expect(runs.filter((run) => run.argv[0] === "sh")).toEqual([]);
});

test("check_small_plan denies without a report when Claude Code refuses the check command as not allowed", async ($, on) => {
  const { files } = mockGit(on, checkGit("src/auth.ts"), CHECK_SEED, {
    rejectShellWith: new Error(
      "$.process.run: this repeats a Bash call that is not allowed; serve an allowed call"
    ),
  });

  const reply = await runCheck($);

  expect(reply.deny).toContain("refused");
  expect(reply.deny).toContain("Retrying is refused");
  expect(reply.deny).not.toContain("earlier in this session");
  expect(files.has(CHECK_REPORT)).toBe(false);
});

test("check_small_plan is answered at tool.run with the check report", async ($, on) => {
  const { runs } = mockGit(on, checkGit("src/auth.ts"), CHECK_SEED);

  const reply = await runCheck($);

  expect(reply.result).toContain("Check: exit 0");
  expect(runs.filter((run) => run.argv[0] === "sh")).toHaveLength(1);
});

test("check_small_plan refuses a call with no command and runs nothing", async ($, on) => {
  const { runs } = mockGit(on, checkGit("src/auth.ts"), CHECK_SEED);

  const reply = await callTool($, CHECK_TOOL, {
    path: STANDALONE_SET_PLAN,
    worktree: WORKTREE,
  });

  expect(reply.deny).toBe(
    `command must be the plan's check command, exactly: ${CHECK_COMMAND}`
  );
  expect(runs.filter((run) => run.argv[0] === "sh")).toEqual([]);
});

test("check_small_plan runs the plan's check in the worktree and saves a report beside the plan", async ($, on) => {
  const { files, runs } = mockGit(
    on,
    [
      ...checkGit("src/auth.ts"),
      { match: "pnpm test auth", stdout: "auth passed" },
    ],
    { ...CHECK_SEED, [`${WORKTREE}/package.json`]: '{"name":"app"}' }
  );

  const reply = await runCheck($);

  expect(runs).toContainEqual({
    argv: ["sh", "-c", "pnpm test auth"],
    cwd: WORKTREE,
  });
  expect(files.get(CHECK_REPORT)).toContain(
    "Check: exit 0\n$ pnpm test auth\nauth passed"
  );
  expect(reply.result).toBe(
    [
      "Check: exit 0",
      "Files: 1 changed, 0 not in plan",
      "Lint: none (no command found)",
      "Fallow: PASS",
      "Tests: none (no command found)",
      `Report: ${CHECK_REPORT}`,
    ].join("\n")
  );
});

test("check_small_plan runs the package scripts with the runner the lock file names and keeps the output of a failing lint", async ($, on) => {
  const { files, runs } = mockGit(
    on,
    [
      ...checkGit("src/auth.ts"),
      { match: "pnpm test auth", stdout: "auth passed" },
      {
        match: "pnpm run lint",
        exitCode: 1,
        stdout: "src/auth.ts: unused variable",
      },
    ],
    {
      ...CHECK_SEED,
      [`${WORKTREE}/package.json`]:
        '{"scripts":{"lint":"eslint .","test":"vitest"}}',
      [`${WORKTREE}/pnpm-lock.yaml`]: "lockfileVersion: 9",
    }
  );

  const reply = await runCheck($);

  expect(runs).toContainEqual({
    argv: ["sh", "-c", "pnpm run lint"],
    cwd: WORKTREE,
  });
  expect(runs).toContainEqual({
    argv: ["sh", "-c", "pnpm run test"],
    cwd: WORKTREE,
  });
  expect(reply.result).toContain("Lint: FAIL");
  expect(reply.result).toContain("Tests: PASS");
  expect(files.get(CHECK_REPORT)).toContain("src/auth.ts: unused variable");
});

test("check_small_plan takes the lint and test commands from .claude settings over the package scripts", async ($, on) => {
  const { runs } = mockGit(
    on,
    [...checkGit("src/auth.ts"), { match: "pnpm test auth" }],
    {
      ...CHECK_SEED,
      [`${WORKTREE}/package.json`]:
        '{"scripts":{"lint":"eslint .","test":"vitest"}}',
      [`${WORKTREE}/pnpm-lock.yaml`]: "lockfileVersion: 9",
      [`${WORKTREE}/.claude/quality.json`]: '{"lintCommand":"biome check ."}',
      [`${WORKTREE}/.claude/tdd.json`]: '{"testCommand":"vitest run"}',
    }
  );

  await runCheck($);

  expect(runs).toContainEqual({
    argv: ["sh", "-c", "biome check ."],
    cwd: WORKTREE,
  });
  expect(runs).toContainEqual({
    argv: ["sh", "-c", "vitest run"],
    cwd: WORKTREE,
  });
  expect(runs.map((run) => run.argv[2])).not.toContain("pnpm run lint");
  expect(runs.map((run) => run.argv[2])).not.toContain("pnpm run test");
});

test("check_small_plan reports Lint, Fallow and Tests as none when the project names no command", async ($, on) => {
  mockGit(
    on,
    [...checkGit("src/auth.ts"), { match: "pnpm test auth" }],
    CHECK_SEED
  );

  const reply = await runCheck($);

  expect(reply.result).toContain("Lint: none (no command found)");
  expect(reply.result).toContain("Fallow: none (no command found)");
  expect(reply.result).toContain("Tests: none (no command found)");
});

test("check_small_plan lists a changed file the plan does not name as not in plan", async ($, on) => {
  const { files } = mockGit(
    on,
    [...checkGit("src/auth.ts\nsrc/extra.ts"), { match: "pnpm test auth" }],
    CHECK_SEED
  );

  const reply = await runCheck($);

  expect(files.get(CHECK_REPORT)).toContain("src/extra.ts (not in plan)");
  expect(reply.result).toContain("Files: 2 changed, 1 not in plan");
});

test("check_small_plan runs the guards in the folder of the nearest package.json of a changed file", async ($, on) => {
  const { runs } = mockGit(
    on,
    [...checkGit("packages/app/src/index.ts"), { match: "pnpm test auth" }],
    {
      ...CHECK_SEED,
      [`${WORKTREE}/packages/app/package.json`]: '{"name":"app"}',
    }
  );

  await runCheck($);

  expect(runs).toContainEqual({
    argv: ["sh", "-c", FALLOW_SHELL],
    cwd: `${WORKTREE}/packages/app`,
  });
});

test("check_small_plan reports Fallow as none when fallow is not installed", async ($, on) => {
  mockGit(
    on,
    [
      ...checkGit("src/auth.ts"),
      { match: "pnpm test auth" },
      { match: FALLOW_SHELL, exitCode: 127 },
    ],
    { ...CHECK_SEED, [`${WORKTREE}/package.json`]: '{"name":"app"}' }
  );

  const reply = await runCheck($);

  expect(reply.result).toContain("Fallow: none (no command found)");
});

test("check_small_plan refuses a plan path outside the plans folder and runs nothing", async ($, on) => {
  const { runs } = mockGit(on, []);

  const reply = await callTool($, CHECK_TOOL, {
    path: "/home/tester/notes/01-add-the-toggle.md",
    worktree: WORKTREE,
    command: CHECK_COMMAND,
  });

  expect(reply.deny).toContain(PLANS_FOLDER);
  expect(runs).toEqual([]);
});

const REVIEWER = "small-plans:small-plan-reviewer";
const REVIEW_FINDINGS = STANDALONE_SET_PLAN.replace(/\.md$/, ".review.txt");
const mockReviewerReports = (on: On) =>
  on("agent.report", (_, e) => ({ text: e.text }));
const deliverReport = ($: Engine, subagentType: string, text: string) =>
  $.agent.report({
    agentId: "reviewer-1",
    subagentType,
    status: "completed",
    text,
  } as never) as Promise<{ text?: string }>;

test("a reviewer's FAIL is saved beside the plan and the parent gets the findings path", async ($, on) => {
  mockReviewerReports(on);
  const { files } = mockEngine(on, { [STANDALONE_SET_PLAN]: PLAN_BODY });
  const text = `Plan: ${STANDALONE_SET_PLAN}\n\n- refreshToken clears cachedToken: false\nFAIL\n1. src/auth.ts does not clear the cache.`;

  const reply = await deliverReport($, REVIEWER, text);

  expect(files.get(REVIEW_FINDINGS)).toBe(text);
  expect(reply.text).toBe(`FAIL\nFindings: ${REVIEW_FINDINGS}`);
});

test("a reviewer's PASS is delivered as PASS and saves no file", async ($, on) => {
  mockReviewerReports(on);
  const { files } = mockEngine(on, { [STANDALONE_SET_PLAN]: PLAN_BODY });

  const reply = await deliverReport(
    $,
    REVIEWER,
    `Plan: ${STANDALONE_SET_PLAN}\n\n- refreshToken clears cachedToken: true\nPASS`
  );

  expect(reply.text).toBe("PASS");
  expect(files.has(REVIEW_FINDINGS)).toBe(false);
});

test("a reviewer report without a Plan line is delivered unchanged", async ($, on) => {
  mockReviewerReports(on);
  const { files } = mockEngine(on, { [STANDALONE_SET_PLAN]: PLAN_BODY });
  const text = "FAIL\n1. src/auth.ts does not clear the cache.";

  const reply = await deliverReport($, REVIEWER, text);

  expect(reply.text).toBe(text);
  expect(files.has(REVIEW_FINDINGS)).toBe(false);
});

test("a report from another subagent type is delivered unchanged", async ($, on) => {
  mockReviewerReports(on);
  const { files } = mockEngine(on, { [STANDALONE_SET_PLAN]: PLAN_BODY });
  const text = `Plan: ${STANDALONE_SET_PLAN}\n\nFAIL\n1. something`;

  const reply = await deliverReport($, "Explore", text);

  expect(reply.text).toBe(text);
  expect(files.has(REVIEW_FINDINGS)).toBe(false);
});

const SIX_PLAN_SET = Object.fromEntries(
  ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map(
    (word, index) => [
      `${SET_FOLDER}/0${index + 1}-${word}.md`,
      "status: pending",
    ]
  )
);

const PICKER_PANE_ID = "small-plans-picker-pane";

const mountPicker = ($: Engine) =>
  $.ui.mount({
    plugin: "small-plans",
    component: "Pane",
    requestId: PICKER_PANE_ID,
    surface: "terminal",
    props: {},
  } as never);

const pickerRows = async ($: Engine) => {
  const drawing = await mountPicker($);
  const keys = (await drawing.findAll({ type: "Button" })).map(
    (button) => button.key
  );
  await drawing.unmount();
  return keys;
};

const SIX_SET_PLANS = [
  "1 · Alpha",
  "2 · Bravo",
  "3 · Charlie",
  "4 · Delta",
  "5 · Echo",
  "6 · Foxtrot",
];

test("/small-plans build opens a focused pane to pick from", async ($, on) => {
  const { openings } = trackPane(on, true);
  const { reply } = await runCommand($, on, "build", SIX_PLAN_SET);

  expect(openings).toHaveLength(1);
  expect(openings[0]?.focus).toBe(true);
  expect(openings[0]?.closeOnEscape).toBe(true);
  expect(openings[0]?.title).toBeTruthy();
  expect((reply as { text: string }).text).toContain("pane");
});

test("/small-plans build lists every plan in the pane, Whole set last", async ($, on) => {
  trackPane(on, true);
  await runCommand($, on, "build", SIX_PLAN_SET);
  const drawing = await mountPicker($);
  const labels = (await drawing.findAll({ type: "Button" })).map(
    (button) => button.text
  );

  expect(labels).toEqual([...SIX_SET_PLANS, "Whole set"]);
});

test("pressing a plan row closes the pane and builds that plan", async ($, on) => {
  const { closings } = trackPane(on, true);
  const { submittedPrompts, clock } = await runCommand(
    $,
    on,
    "build",
    SIX_PLAN_SET
  );
  const drawing = await mountPicker($);

  await drawing.press({ key: "pick-05-echo" });
  await clock.settle();

  expect(closings).toEqual(["close"]);
  expect(submittedPrompts[0]).toContain(
    `Build only the plan at ${SET_FOLDER}/05-echo.md.`
  );
});

test("pressing Whole set in the pane builds the whole set", async ($, on) => {
  trackPane(on, true);
  const { submittedPrompts, clock } = await runCommand(
    $,
    on,
    "build",
    SIX_PLAN_SET
  );
  const drawing = await mountPicker($);

  await drawing.press({ key: "pick-Whole set" });
  await clock.settle();

  expect(submittedPrompts[0]).not.toContain("Build only the plan");
  expect(submittedPrompts[0]).toContain(SET_FOLDER);
});

const FIVE_SETS = Object.fromEntries(
  [21, 22, 23, 24, 25].map((day) => [
    `${PROJECT_FOLDER}/2026-11-${day}-1000-set-${day}/01-alpha.md`,
    "status: pending",
  ])
);

test("/small-plans build lists every set in the pane, newest first, and picking one opens its plans", async ($, on) => {
  const { openings } = trackPane(on, true);
  const { clock } = await runCommand($, on, "build", {
    ...FIVE_SETS,
    [`${PROJECT_FOLDER}/2026-11-24-1000-set-24/02-bravo.md`]: "status: pending",
  });

  const drawing = await mountPicker($);
  const setKeys = (await drawing.findAll({ type: "Button" })).map(
    (button) => button.key
  );
  expect(setKeys).toEqual(
    [25, 24, 23, 22, 21].map((day) => `pick-2026-11-${day}-1000-set-${day}`)
  );
  await drawing.press({ key: "pick-2026-11-24-1000-set-24" });
  await clock.settle();
  await drawing.unmount();

  expect(openings).toHaveLength(2);
  expect(await pickerRows($)).toEqual([
    "pick-01-alpha",
    "pick-02-bravo",
    "pick-Whole set",
  ]);
});

test("/small-plans build pages the plan picker with Whole set last when no pane opens", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, "4 more…", "5 · Echo");
  const { submittedPrompts } = await runCommand($, on, "build", SIX_PLAN_SET);

  expect(askedLabels([askedQuestions[0] as AskedQuestion])).toEqual([
    "1 · Alpha",
    "2 · Bravo",
    "3 · Charlie",
    "4 more…",
  ]);
  expect(askedLabels([askedQuestions[1] as AskedQuestion])).toEqual([
    "4 · Delta",
    "5 · Echo",
    "6 · Foxtrot",
    "Whole set",
  ]);
  expect(submittedPrompts[0]).toContain(
    `Build only the plan at ${SET_FOLDER}/05-echo.md.`
  );
});

test("/small-plans build pages the set picker so no set is dropped when no pane opens", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  await runCommand($, on, "build", FIVE_SETS);

  expect(askedLabels(askedQuestions)).toEqual([
    "Set 25 · Nov 25, 10:00",
    "Set 24 · Nov 24, 10:00",
    "Set 23 · Nov 23, 10:00",
    "2 more…",
  ]);
});

test("/small-plans build lists plans in numeric order", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  await runCommand($, on, "build", {
    [`${SET_FOLDER}/10-tenth-thing.md`]: "status: pending",
    [`${SET_FOLDER}/2-second-thing.md`]: "status: pending",
  });

  expect(askedLabels(askedQuestions)).toEqual([
    "2 · Second Thing",
    "10 · Tenth Thing",
    "Whole set",
  ]);
});

test("/small-plans build restores apostrophes lost in slugs", async ($, on) => {
  const planAsk = answerAskUserQuestion(on);
  await runCommand($, on, "build", {
    [`${PROJECT_FOLDER}/2026-11-20-1100-don-t-hide-the-ai-s-reason/01-show-the-ai-s-reason.md`]:
      "status: pending",
    [`${PROJECT_FOLDER}/2026-11-20-1100-don-t-hide-the-ai-s-reason/02-other.md`]:
      "status: pending",
  });

  expect(askedLabels(planAsk)).toContain("1 · Show the AI's Reason");
});

test("/small-plans build labels a set with apostrophes restored", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on);
  await runCommand($, on, "build", {
    [`${PROJECT_FOLDER}/2026-11-20-1100-don-t-hide-the-ai-s-reason/01-a.md`]:
      "status: pending",
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(askedLabels(askedQuestions)).toContain(
    "Don't Hide the AI's Reason · Nov 20, 11:00"
  );
});
