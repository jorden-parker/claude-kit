import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const WRITE_TOOL = "mcp__small-plans__write_small_plan";
const STATUS_TOOL = "mcp__small-plans__set_small_plan_status";
const PLANS_FOLDER = "/home/tester/.claude/small-plans";
const PROJECT_FOLDER = `${PLANS_FOLDER}/claude-kit`;
const HANDOFFS_FOLDER = "/home/tester/.claude/handoffs/claude-kit";
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

type Recorded = {
  files: Map<string, string>;
  submittedPrompts: string[];
  commands: string[][];
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
  };
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
  on("process.run", (_, e) => {
    recorded.commands.push([...e.argv]);
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
  $.tool.call({ tool, ...toolInput } as never) as Promise<{
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
  return { reply, ...recorded };
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

test("/small-plans <work> asks for a check that proves the plan's behaviour works", async ($, on) => {
  const { submittedPrompts } = await runCommand(
    $,
    on,
    "Add a dark mode toggle!"
  );

  expect(submittedPrompts[0]).toContain(
    "proves the behaviour the plan delivers works"
  );
  expect(submittedPrompts[0]).toContain(
    "A build, type-check, lint or format command alone is refused"
  );
  expect(submittedPrompts[0]).toContain(
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

test("/small-plans <work> plans that work with no handoff", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand(
    $,
    on,
    "Add a dark mode toggle!"
  );

  const setPattern = `${NEW_SET_STAMP}-add-a-dark-mode-toggle`;
  expect(reply.text).toMatch(new RegExp(setPattern));
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("Add a dark mode toggle!");
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toMatch(new RegExp(`set "${setPattern}"`));
  expect(submittedPrompts[0]).not.toContain("handoff");
});

test("/small-plans alone plans the work this conversation leaves", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "", {
    [NEWER_HANDOFF]: "a handoff that is not asked for",
  });

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("this conversation");
  expect(submittedPrompts[0]).toMatch(
    new RegExp(`set "${NEW_SET_STAMP}-plans"`)
  );
  expect(submittedPrompts[0]).not.toContain(NEWER_HANDOFF);
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
  const askedQuestions = answerAskUserQuestion(on, "#1 · Add the viewer");
  const { reply, submittedPrompts } = await runCommand($, on, "handoff", {
    [OLDER_HANDOFF]: "older",
    [NEWER_HANDOFF]: "newer",
  });

  const setPattern = `${NEW_SET_STAMP}-handoff-001-add-the-viewer`;
  expect(askedLabels(askedQuestions)).toEqual([
    "#2 · Fix login",
    "#1 · Add the viewer",
  ]);
  expect(reply.text).toMatch(new RegExp(setPattern));
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(OLDER_HANDOFF);
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toMatch(new RegExp(`set "${setPattern}"`));
  expect(submittedPrompts[0]).not.toContain("already has plans");
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

type AskedQuestion = { questions: { options: { label: string }[] }[] };

const answerAskUserQuestion = (on: On, ...chosenLabels: string[]) => {
  const askedQuestions: AskedQuestion[] = [];
  const remainingLabels = [...chosenLabels];
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
    "Handoff 002 fix login · Nov 18, 09:00"
  );
  const { submittedPrompts } = await runCommand($, on, "build", {
    [HANDOFF_SET_PLAN]: "older, from a handoff",
    [STANDALONE_SET_PLAN]: "newer, planned on its own",
  });

  expect(askedLabels(askedQuestions)).toEqual([
    "Add a dark mode toggle · Nov 19, 10:00",
    "Handoff 002 fix login · Nov 18, 09:00",
  ]);
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${HANDOFF_SET}`);
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

test("/small-plans build has the session review each plan and send fixes to a new implementer", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain("review the work yourself");
  expect(submittedPrompts[0]).toContain("git diff");
  expect(submittedPrompts[0]).toContain(
    "new small-plans:small-plan-implementer"
  );
  expect(submittedPrompts[0]).toContain("3 fix rounds");
  expect(submittedPrompts[0]).not.toContain("small-plan-reviewer");
});

test("/small-plans build has a failing guard fixed by a subagent instead of blocking the plan", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain("project's lint command");
  expect(submittedPrompts[0]).toContain("fallow audit");
  expect(submittedPrompts[0]).toContain(
    "start a general-purpose agent in the worktree to fix every reported failure, including pre-existing ones and ones in files the plan does not name"
  );
  expect(submittedPrompts[0]).toContain(
    "a failing guard never sets a plan to blocked"
  );
  expect(submittedPrompts[0]).toContain(
    "unless it fixes a lint, fallow, code style or test failure a check or hook reported"
  );
});

test("/small-plans build commits and pushes each approved plan with a one-line subject", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "When the review passes, commit and push that work"
  );
  expect(submittedPrompts[0]).toContain("one short conventional subject line");
  expect(submittedPrompts[0]).toContain(
    "no body and no Co-Authored-By or other attribution line"
  );
  expect(submittedPrompts[0]).toContain(
    "Never commit or push work the review has not approved"
  );
});

test("/small-plans build commits and pushes leftover uncommitted and unpushed work at the end", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "commit and push the leftover work too"
  );
  expect(submittedPrompts[0]).toContain("@{u}..");
  expect(submittedPrompts[0]).toContain(
    "including ones from before this build, into logical commits, one per concern"
  );
  expect(submittedPrompts[0]).toContain("so no commit is left unpushed");
});

test("/small-plans build builds each plan in its own worktree on a branch named by the repository's rules", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [STANDALONE_SET_PLAN]: "status: pending",
  });

  expect(submittedPrompts[0]).toContain(
    "Each plan is built in its own git worktree, on its own branch"
  );
  expect(submittedPrompts[0]).toContain(
    "as a work repository does, follow it exactly"
  );
  expect(submittedPrompts[0]).toContain("name the branch `<type>/<plan slug>`");
  expect(submittedPrompts[0]).toContain(
    "put the worktree beside the main worktree, as a sibling folder"
  );
  expect(submittedPrompts[0]).toContain("Never put it inside the repository");
  expect(submittedPrompts[0]).toContain("then a line `Worktree: <path>`");
  expect(submittedPrompts[0]).toContain("git push -u origin <branch>");
});

const SET_FOLDER = `${PROJECT_FOLDER}/${STANDALONE_SET}`;
const THREE_PLAN_SET = {
  [`${SET_FOLDER}/01-add-the-toggle.md`]: "status: done",
  [`${SET_FOLDER}/02-store-the-choice.md`]: "status: pending",
  [`${SET_FOLDER}/03-test-the-toggle.md`]: "status: blocked",
};

test("/small-plans build asks for the whole set or one plan that is not done", async ($, on) => {
  const askedQuestions = answerAskUserQuestion(on, "Whole set");
  const { submittedPrompts } = await runCommand($, on, "build", THREE_PLAN_SET);

  expect(askedLabels(askedQuestions)).toEqual([
    "Whole set",
    "2 · Store the choice",
    "3 · Test the toggle",
  ]);
  expect(submittedPrompts[0]).toContain(`Build the plans in ${SET_FOLDER}.`);
});

test("/small-plans build builds only the plan picked", async ($, on) => {
  answerAskUserQuestion(on, "3 · Test the toggle");
  const { submittedPrompts } = await runCommand($, on, "build", THREE_PLAN_SET);

  expect(submittedPrompts[0]).toContain(
    `Build only the plan at ${SET_FOLDER}/03-test-the-toggle.md.`
  );
  expect(submittedPrompts[0]).not.toContain("02-store-the-choice");
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

  expect(suggestedTexts(reply)).toEqual(["handoff", "build"]);
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
  const askedQuestions = answerAskUserQuestion(on, "3 · Test the toggle");
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

test("a small-plans picker is drawn inside a padded, rounded frame", async ($) => {
  const drawing = await mountQuestion($, SET_QUESTION);
  const frame = await drawing.find({ key: "small-plans-frame" });

  expect(frame?.props).toMatchObject({
    borderStyle: "round",
    paddingX: 2,
    marginX: 1,
  });
});

test("another plugin's question gets no small-plans frame", async ($) => {
  const drawing = await mountQuestion($, "Which database should we use?");

  expect(await drawing.find({ key: "small-plans-frame" })).toBeUndefined();
});
