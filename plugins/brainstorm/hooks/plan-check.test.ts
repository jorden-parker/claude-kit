import { expect, test } from "claude-code/testing";
import { checkPlan, type PlanFiles } from "./plan-check";

const PLAN_RUN_FOLDER = "/repo/.claude/brainstorm/plans/plan-2026-11-11-1200";
const PROJECT_ROOT = "/repo";

const createPlanFiles = (textByPath: Record<string, string>): PlanFiles => ({
  read: async (path) => textByPath[path],
  list: async (folder) => {
    const folderPrefix = `${folder}/`;
    const childNames = Object.keys(textByPath)
      .filter((path) => path.startsWith(folderPrefix))
      .map((path) => path.slice(folderPrefix.length).split("/")[0] ?? "");
    return [...new Set(childNames)];
  },
});

const buildIndexText = (planRows: string[]) =>
  [
    "# Plans: Test run",
    "",
    "- Ideas: #1 Test idea",
    "- Written against: abc1234 on main",
    "",
    "## Plans",
    "",
    "| Order | Plan | Status | Kind | Depends on | Ideas |",
    "| ----- | ---- | ------ | ---- | ---------- | ----- |",
    ...planRows,
    "",
    "## Dropped",
    "",
    "None",
    "",
  ].join("\n");

const buildPlanText = (stepLinkLines: string[] = []) =>
  [
    "# Plan: Alpha change",
    "",
    "- Status: pending",
    "- Ideas: #1 Test idea",
    "- Kind: change",
    "- Depends on: none",
    "",
    "## Goal",
    "",
    "Make the alpha thing work.",
    "",
    "## Context",
    "",
    "- Language: TypeScript. Test command: `pnpm test`.",
    "",
    "## Steps",
    "",
    ...stepLinkLines,
    "",
    "## Done criteria",
    "",
    "- `pnpm test`: expect exit 0",
    "",
    "## Out of scope",
    "",
    "Nothing else.",
    "",
  ].join("\n");

const ALPHA_PLAN_PATH = `${PLAN_RUN_FOLDER}/01-alpha/plan.md`;
const BETA_PLAN_PATH = `${PLAN_RUN_FOLDER}/02-beta/plan.md`;
const ALPHA_INDEX_LINE =
  "| 1 | [Alpha change](01-alpha/plan.md) | pending | change | none | #1 |";

test("a plan folder on disk but not listed in index.md is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText(),
      [BETA_PLAN_PATH]: buildPlanText(),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual(["02-beta: plan folder is not listed in index.md"]);
});

test("a plan.md without a Context section is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText().replace("## Context", "## Background"),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual(["01-alpha/plan.md: missing ## Context section"]);
});

test("a step link in plan.md to a missing step file is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText([
        "- [ ] [step-01](step-01.md): Add the first thing",
      ]),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([
    "01-alpha/plan.md: step link step-01.md points to a missing file",
  ]);
});

test("a step file on disk that plan.md does not list is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText(),
      [`${PLAN_RUN_FOLDER}/01-alpha/step-01.md`]: "# Step 01: Add the first thing",
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([
    "01-alpha/step-01.md: step file is not listed in plan.md",
  ]);
});

const ALPHA_STEP_PATH = `${PLAN_RUN_FOLDER}/01-alpha/step-01.md`;
const STEP_LINK_LINE = "- [ ] [step-01](step-01.md): Add the alpha module";

const VALID_STEP_TEXT = [
  "# Step 01: Add the alpha module",
  "",
  "- Plan: 01-alpha",
  "- Kind: code",
  "- Depends on: none",
  "",
  "## Context",
  "",
  "- Language: TypeScript. Test command: `pnpm test`.",
  "",
  "## Edits",
  "",
  "### Edit 1",
  "",
  "- File: `src/alpha.ts`",
  "- Action: create",
  "",
  "Contents:",
  "",
  "```ts",
  "export const ALPHA_VALUE = 1;",
  "```",
  "",
  "## Check",
  "",
  "- Run: `pnpm test hooks/alpha.test.ts`",
  "- Expect: exit 0, output contains `ALPHA_VALUE`",
  "",
].join("\n");

const runCheckWithStep = (stepText: string, projectFiles: Record<string, string> = {}) =>
  checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText([STEP_LINK_LINE]),
      [ALPHA_STEP_PATH]: stepText,
      ...projectFiles,
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

test("a step file without a title line is reported", async () => {
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace("# Step 01: Add the alpha module", "Add the alpha module"),
  );

  expect(problems).toEqual(["01-alpha/step-01.md: missing title line"]);
});

test("a step file without a Kind is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("- Kind: code\n", ""));

  expect(problems).toEqual(["01-alpha/step-01.md: missing Kind"]);
});

test("a step file with an unknown Kind is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("- Kind: code", "- Kind: banana"));

  expect(problems).toEqual(["01-alpha/step-01.md: Kind must be test, code, docs or spike"]);
});

test("a step file without a Context section is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("## Context", "## Background"));

  expect(problems).toEqual(["01-alpha/step-01.md: missing ## Context section"]);
});

test("a step file without a Check section is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("## Check", "## Verify"));

  expect(problems).toEqual(["01-alpha/step-01.md: missing ## Check section"]);
});

test("a Check section whose Run is not backticked is reported", async () => {
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace("- Run: `pnpm test hooks/alpha.test.ts`", "- Run: pnpm test hooks/alpha.test.ts"),
  );

  expect(problems).toEqual(["01-alpha/step-01.md: ## Check needs a backticked Run"]);
});

test("a Check section without an Expect is reported", async () => {
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace("- Expect: exit 0, output contains `ALPHA_VALUE`", "- Result: exit 0"),
  );

  expect(problems).toEqual(["01-alpha/step-01.md: ## Check has no Expect"]);
});

test("a non-spike step without an Edits section is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("## Edits", "## Changes"));

  expect(problems).toEqual(["01-alpha/step-01.md: non-spike step has no ## Edits section"]);
});

test("an edit without a File is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("- File: `src/alpha.ts`\n", ""));

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 has no File"]);
});

test("an edit without an Action is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("- Action: create\n", ""));

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 has no Action (replace or create)"]);
});

test("a replace edit without a Find block is reported", async () => {
  const replaceEditText = VALID_STEP_TEXT.replace("- Action: create", "- Action: replace").replace(
    "Contents:",
    "Replace:",
  );
  const problems = await runCheckWithStep(replaceEditText, {
    [`${PROJECT_ROOT}/src/alpha.ts`]: "export const ALPHA_VALUE = 0;\n",
  });

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 is replace but has no Find block"]);
});

test("a replace edit without a Replace block is reported", async () => {
  const replaceEditText = VALID_STEP_TEXT.replace("- Action: create", "- Action: replace").replace(
    "Contents:",
    "Find:",
  );
  const problems = await runCheckWithStep(replaceEditText, {
    [`${PROJECT_ROOT}/src/alpha.ts`]: "export const ALPHA_VALUE = 0;\n",
  });

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 is replace but has no Replace block"]);
});

test("a create edit without a Contents block is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT.replace("Contents:", "Notes:"));

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 is create but has no Contents block"]);
});

const buildReplaceEditStep = (findText: string, replaceText: string) =>
  VALID_STEP_TEXT.replace("- Action: create", "- Action: replace").replace(
    "Contents:\n\n```ts\nexport const ALPHA_VALUE = 1;\n```",
    ["Find:", "", "```ts", findText, "```", "", "Replace:", "", "```ts", replaceText, "```"].join(
      "\n",
    ),
  );

test("a replace edit whose file does not exist is reported", async () => {
  const problems = await runCheckWithStep(
    buildReplaceEditStep("export const ALPHA_VALUE = 1;", "export const ALPHA_VALUE = 2;"),
  );

  expect(problems).toEqual([
    "01-alpha/step-01.md: Edit 1 replaces src/alpha.ts, which does not exist",
  ]);
});

test("a replace edit whose Find text is not in the file is reported", async () => {
  const problems = await runCheckWithStep(
    buildReplaceEditStep("export const ALPHA_VALUE = 1;", "export const ALPHA_VALUE = 2;"),
    { [`${PROJECT_ROOT}/src/alpha.ts`]: "export const ALPHA_VALUE = 0;\n" },
  );

  expect(problems).toEqual([
    "01-alpha/step-01.md: Edit 1 Find text appears 0 times in src/alpha.ts, expected exactly once",
  ]);
});

test("a create edit whose file already exists is reported", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT, {
    [`${PROJECT_ROOT}/src/alpha.ts`]: "export const ALPHA_VALUE = 0;\n",
  });

  expect(problems).toEqual(["01-alpha/step-01.md: Edit 1 creates src/alpha.ts, which already exists"]);
});

const SECOND_STEP_PATH = `${PLAN_RUN_FOLDER}/01-alpha/step-02.md`;
const SECOND_STEP_LINK_LINE = "- [ ] [step-02](step-02.md): Create the alpha module again";

const runCheckWithTwoSteps = (
  firstStepText: string,
  secondStepText: string,
  projectFiles: Record<string, string> = {},
) =>
  checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText([STEP_LINK_LINE, SECOND_STEP_LINK_LINE]),
      [ALPHA_STEP_PATH]: firstStepText,
      [SECOND_STEP_PATH]: secondStepText,
      ...projectFiles,
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

test("a create edit of a file an earlier step created is reported", async () => {
  const problems = await runCheckWithTwoSteps(VALID_STEP_TEXT, VALID_STEP_TEXT);

  expect(problems).toEqual([
    "01-alpha/step-02.md: Edit 1 creates src/alpha.ts, which already exists",
  ]);
});

test("a Find in a later step matches only the text an earlier step produced", async () => {
  const replaceSecondStepText = buildReplaceEditStep(
    "export const ALPHA_VALUE = 1;",
    "export const ALPHA_VALUE = 2;",
  );
  const problems = await runCheckWithTwoSteps(VALID_STEP_TEXT, replaceSecondStepText);

  expect(problems).toEqual([]);
});

test("a step whose Contents block exceeds 60 lines is reported", async () => {
  const sixtyOneContentLines = Array.from(
    { length: 61 },
    (unusedElement, lineIndex) => `export const ALPHA_LINE_${lineIndex} = ${lineIndex};`,
  ).join("\n");
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace("export const ALPHA_VALUE = 1;", sixtyOneContentLines),
  );

  expect(problems).toEqual([
    "01-alpha/step-01.md: Replace and Contents blocks total 61 lines, limit is 60",
  ]);
});

test("a banned phrase outside code fences is reported", async () => {
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace(
      "- Language: TypeScript. Test command: `pnpm test`.",
      "- Language: TypeScript. Consider the edge cases.",
    ),
  );

  expect(problems).toEqual([
    '01-alpha/step-01.md: contains banned phrase "consider" outside code fences',
  ]);
});

test("a banned phrase in plan.md outside code fences is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText([STEP_LINK_LINE]).replace(
        "Make the alpha thing work.",
        "Make the alpha thing work, as needed.",
      ),
      [ALPHA_STEP_PATH]: VALID_STEP_TEXT,
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([
    '01-alpha/plan.md: contains banned phrase "as needed" outside code fences',
  ]);
});

test("a banned phrase inside a code fence is allowed", async () => {
  const problems = await runCheckWithStep(
    VALID_STEP_TEXT.replace(
      "export const ALPHA_VALUE = 1;",
      "export const ALPHA_NOTE = 'consider TODO etc.';\nexport const ALPHA_VALUE = 1;",
    ),
  );

  expect(problems).toEqual([]);
});

test("a plan folder checked on its own reports the missing index", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [ALPHA_PLAN_PATH]: buildPlanText(),
    }),
    `${PLAN_RUN_FOLDER}/01-alpha`,
    PROJECT_ROOT,
  );

  expect(problems).toEqual(["index.md: missing"]);
});

const checkAlphaPlan = (indexRow: string, planText: string) =>
  checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([indexRow]),
      [ALPHA_PLAN_PATH]: planText,
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

test("a plan.md without a Status line is reported", async () => {
  const problems = await checkAlphaPlan(
    ALPHA_INDEX_LINE,
    buildPlanText().replace("- Status: pending\n", ""),
  );

  expect(problems).toEqual([
    "01-alpha/plan.md: Status must be pending, in-progress, done or blocked",
  ]);
});

test("a plan.md with an unknown status is reported", async () => {
  const problems = await checkAlphaPlan(
    ALPHA_INDEX_LINE,
    buildPlanText().replace("- Status: pending", "- Status: finished"),
  );

  expect(problems).toEqual([
    "01-alpha/plan.md: Status must be pending, in-progress, done or blocked",
  ]);
});

test("an index row whose status differs from its plan.md is reported", async () => {
  const problems = await checkAlphaPlan(
    ALPHA_INDEX_LINE,
    buildPlanText().replace("- Status: pending", "- Status: done"),
  );

  expect(problems).toEqual([
    'index.md: 01-alpha is "pending", but 01-alpha/plan.md says "done"',
  ]);
});

test("an index row and plan.md that agree on a later status are clean", async () => {
  const problems = await checkAlphaPlan(
    ALPHA_INDEX_LINE.replace("| pending |", "| blocked |"),
    buildPlanText().replace("- Status: pending", "- Status: blocked"),
  );

  expect(problems).toEqual([]);
});

test("an unlisted plan folder has its plan.md checked too", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText(),
      [BETA_PLAN_PATH]: buildPlanText().replace("## Context", "## Background"),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([
    "02-beta: plan folder is not listed in index.md",
    "02-beta/plan.md: missing ## Context section",
  ]);
});

test("a banned phrase in index.md outside code fences is reported", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]).replace(
        "None",
        "Consider none.",
      ),
      [ALPHA_PLAN_PATH]: buildPlanText(),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([
    'index.md: contains banned phrase "consider" outside code fences',
  ]);
});

test("a clean run returns no problems", async () => {
  const problems = await runCheckWithStep(VALID_STEP_TEXT);

  expect(problems).toEqual([]);
});

test("a spike step needs no Edits section", async () => {
  const spikeStepText = [
    "# Step 01: Answer the alpha question",
    "",
    "- Plan: 01-alpha",
    "- Kind: spike",
    "- Depends on: none",
    "",
    "## Context",
    "",
    "- Language: TypeScript.",
    "",
    "## Questions",
    "",
    "1. Does the alpha value need to change?",
    "",
    "## Check",
    "",
    "- Run: `test -s .claude/brainstorm/plans/plan-2026-11-11-1200/01-alpha/findings.md`",
    "- Expect: exit 0",
    "",
  ].join("\n");
  const problems = await runCheckWithStep(spikeStepText);

  expect(problems).toEqual([]);
});

test("a folder with no index.md reports the missing index", async () => {
  const problems = await checkPlan(
    createPlanFiles({}),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual(["index.md: missing"]);
});

test("an index row whose plan folder has no plan.md is reported in index.md", async () => {
  const indexPath = `${PLAN_RUN_FOLDER}/index.md`;
  const problems = await checkPlan(
    createPlanFiles({
      [indexPath]: buildIndexText([ALPHA_INDEX_LINE]),
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual(["index.md: 01-alpha has no plan.md"]);
});

test("a ticked step is already built, so its edits are not checked against the files", async () => {
  const problems = await checkPlan(
    createPlanFiles({
      [`${PLAN_RUN_FOLDER}/index.md`]: buildIndexText([ALPHA_INDEX_LINE]),
      [ALPHA_PLAN_PATH]: buildPlanText([STEP_LINK_LINE.replace("- [ ]", "- [x]")]),
      [ALPHA_STEP_PATH]: buildReplaceEditStep(
        "export const ALPHA_VALUE = 1;",
        "export const ALPHA_VALUE = 2;",
      ),
      [`${PROJECT_ROOT}/src/alpha.ts`]: "export const ALPHA_VALUE = 2;\n",
    }),
    PLAN_RUN_FOLDER,
    PROJECT_ROOT,
  );

  expect(problems).toEqual([]);
});
