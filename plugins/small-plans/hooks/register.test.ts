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
- Expect: every test passes.

## Review
- \`refreshToken\` clears \`cachedToken\` before it requests a new token.
- No file other than \`src/auth.ts\` and \`src/auth.test.ts\` changed.`;

const VALID_PLAN = {
  set: HANDOFF_SET,
  order: 1,
  title: "Clear the cached token",
  kind: "fix",
  body: PLAN_BODY,
};

type Recorded = {
  files: Map<string, string>;
  submittedPrompts: string[];
  commands: string[][];
};

const mockEngine = (
  on: On,
  seededFiles: Record<string, string> = {}
): Recorded => {
  const recorded: Recorded = {
    files: new Map(Object.entries(seededFiles)),
    submittedPrompts: [],
    commands: [],
  };
  on("env.get", (_, e) => ({
    value: { HOME: "/home/tester" }[e.name],
  }));
  on("session.root", () => ({ value: "/work/claude-kit" }));
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
    return {
      value: {
        exitCode: 0,
        stdout: e.argv[0] === "git" ? "/work/claude-kit/.git\n" : "",
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

test("/small-plans handoff splits the newest handoff of the project", async ($, on) => {
  const { reply, submittedPrompts } = await runCommand($, on, "handoff", {
    [OLDER_HANDOFF]: "older",
    [NEWER_HANDOFF]: "newer",
  });

  const setPattern = `${NEW_SET_STAMP}-handoff-002-fix-login`;
  expect(reply.text).toMatch(new RegExp(setPattern));
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(NEWER_HANDOFF);
  expect(submittedPrompts[0]).toContain(WRITE_TOOL);
  expect(submittedPrompts[0]).toMatch(new RegExp(`set "${setPattern}"`));
  expect(submittedPrompts[0]).not.toContain("already has plans");
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

  expect(reply.text).toContain("/handoff save");
  expect(submittedPrompts).toHaveLength(0);
});

test("/small-plans build runs the newest set, which needs no handoff", async ($, on) => {
  const { submittedPrompts } = await runCommand($, on, "build", {
    [HANDOFF_SET_PLAN]: "older, from a handoff",
    [STANDALONE_SET_PLAN]: "newer, planned on its own",
  });

  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain(`${PROJECT_FOLDER}/${STANDALONE_SET}`);
  expect(submittedPrompts[0]).toContain("small-plans:small-plan-implementer");
  expect(submittedPrompts[0]).toContain("small-plans:small-plan-reviewer");
  expect(submittedPrompts[0]).toContain(STATUS_TOOL);
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
