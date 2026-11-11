import type { On } from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const RENDER_TOOL = "mcp__brainstorm__render_brainstorm";
const BRAINSTORM_FOLDER = "/repo/.claude/brainstorm";
const NOVEMBER_NINTH_NOON = Date.UTC(2026, 10, 9, 12, 0, 0);

const buildBrainstormCommand = (args: string) => ({
  command: "brainstorm",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

const SECURITY_IDEA = {
  title: "Stop logging the API token",
  category: "security",
  priority: "now",
  effort: "small",
  why: "auth.ts prints the bearer token on every request.",
  nextStep: "Delete the console.log in auth.ts line 42.",
  files: ["src/auth.ts"],
};

const CREATIVE_IDEA = {
  title: "Replay mode for bug reports",
  category: "creative",
  priority: "later",
  effort: "large",
  why: "Users could attach a replayable session instead of a screenshot.",
  nextStep: "Sketch the event log format in a spike branch.",
};

const VALID_INPUT = {
  project: "acme-cli",
  summary: "A CLI that syncs notes to the cloud.",
  ideas: [CREATIVE_IDEA, SECURITY_IDEA],
};

type FileWrite = { path: string; text: string };

const mockEngine = (on: On, openExitCodes: Record<string, number> = {}) => {
  const writes: FileWrite[] = [];
  const ranCommands: string[][] = [];
  on("session.cwd", () => ({ value: "/repo" }));
  on("clock.now", () => ({ value: NOVEMBER_NINTH_NOON }));
  on("fs.write", (_, e) => {
    writes.push({ path: e.path, text: e.text });
    return { value: undefined };
  });
  on("process.run", (_, e) => {
    ranCommands.push([...e.argv]);
    const exitCode = openExitCodes[e.argv[0] ?? ""] ?? 0;
    return {
      value: {
        exitCode,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { writes, ranCommands };
};

const findPage = (writes: FileWrite[]) =>
  writes.find((write) => write.path.endsWith(".html"));

const renderBrainstorm = ($: Engine, input: unknown) =>
  $.tool.call({ tool: RENDER_TOOL, ...(input as object) } as never);

test("session start registers the command and the render tool", async ($, on) => {
  const ranCommands: string[] = [];
  const tools: { name: string; isDeferred?: unknown }[] = [];
  on("command.register", (_, e) => {
    ranCommands.push(e.name);
    return { value: { command: e.name } };
  });
  on("tool.register", (_, e) => {
    tools.push({ name: e.name, isDeferred: e.isDeferred });
    return { value: { tool: `mcp__brainstorm__${e.name}` } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(ranCommands).toEqual([
    "brainstorm",
    "brainstorm-plan",
    "brainstorm-build",
  ]);
  expect(tools).toEqual([{ name: "render_brainstorm", isDeferred: false }]);
});

const recordSubmittedPrompts = (on: On) => {
  const clock = mock.clock(on, { now: NOVEMBER_NINTH_NOON });
  const submittedPrompts: string[] = [];
  on("prompt.submit", (_, e) => {
    submittedPrompts.push(e.text);
    return { text: e.text };
  });
  return { clock, submittedPrompts };
};

test("the command submits the brainstorm instructions as a model turn", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  const reply = await $.command.run(buildBrainstormCommand(""));
  await clock.settle();

  expect(reply.text).toContain("Brainstorming");
  expect(submittedPrompts).toHaveLength(1);
  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain(RENDER_TOOL);
  expect(instructions).toContain("security");
  expect(instructions).toContain("must-have");
  expect(instructions).toContain("creative");
  expect(instructions).not.toContain("<focus>");
});

test("the command passes its arguments on as the focus", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  await $.command.run(buildBrainstormCommand("the onboarding flow"));
  await clock.settle();

  expect(submittedPrompts[0]).toContain(
    "<focus>\nthe onboarding flow\n</focus>"
  );
});

test("the render tool writes a self-contained page and opens it", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await renderBrainstorm($, VALID_INPUT);

  const page = findPage(writes);
  const expectedPath = `${BRAINSTORM_FOLDER}/brainstorm-2026-11-09-1200.html`;
  expect(page?.path).toBe(expectedPath);
  expect(ranCommands).toEqual([["open", expectedPath]]);
  expect(reply.result).toBe(`Opened ${expectedPath} in the browser.`);

  const html = page?.text ?? "";
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("acme-cli");
  expect(html).toContain("Stop logging the API token");
  expect(html).toContain("Delete the console.log in auth.ts line 42.");
  expect(html).toContain("Replay mode for bug reports");
  expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']?https?:/i);
});

test("the start-here section leads with the most urgent ideas", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  const html = findPage(writes)?.text ?? "";
  const startHereHtml = html.slice(html.indexOf('id="start-here"'));
  expect(startHereHtml.indexOf("Stop logging the API token")).toBeGreaterThan(
    -1
  );
  expect(startHereHtml.indexOf("Stop logging the API token")).toBeLessThan(
    startHereHtml.indexOf("Replay mode for bug reports") === -1
      ? Number.MAX_SAFE_INTEGER
      : startHereHtml.indexOf("Replay mode for bug reports")
  );
});

test("text from the model is escaped in the page", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, {
    ...VALID_INPUT,
    ideas: [{ ...SECURITY_IDEA, title: '<img src=x onerror="alert(1)">' }],
  });

  const html = findPage(writes)?.text ?? "";
  expect(html).not.toContain('<img src=x onerror="alert(1)">');
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("the brainstorm folder keeps its pages out of git", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  expect(writes).toContainEqual({
    path: `${BRAINSTORM_FOLDER}/.gitignore`,
    text: "*\n",
  });
});

test("the page opens with xdg-open where open is missing", async ($, on) => {
  const { ranCommands } = mockEngine(on, { open: 127 });

  const reply = await renderBrainstorm($, VALID_INPUT);

  const expectedPath = `${BRAINSTORM_FOLDER}/brainstorm-2026-11-09-1200.html`;
  expect(ranCommands).toEqual([
    ["open", expectedPath],
    ["xdg-open", expectedPath],
  ]);
  expect(typeof reply.result).toBe("string");
  expect(reply.result).toContain("Opened");
});

test("a page no opener can show is still reported by path", async ($, on) => {
  const { ranCommands } = mockEngine(on, { open: 1, "xdg-open": 1, cmd: 1 });

  const reply = await renderBrainstorm($, VALID_INPUT);

  expect(ranCommands).toHaveLength(3);
  expect(typeof reply.result).toBe("string");
  const resultText = String(reply.result);
  expect(resultText).toContain("Could not open the browser");
  expect(resultText).toContain("brainstorm-2026-11-09-1200.html");
});

test("a brainstorm with no ideas is refused without writing", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await renderBrainstorm($, { ...VALID_INPUT, ideas: [] });

  expect(reply.deny).toContain("at least one idea");
  expect(writes).toEqual([]);
});

test("a page that cannot be written is refused with the reason", async ($, on) => {
  on("session.cwd", () => ({ value: "/repo" }));
  on("clock.now", () => ({ value: NOVEMBER_NINTH_NOON }));
  on("fs.write", () => ({ deny: "EACCES: permission denied" }));

  const reply = await renderBrainstorm($, VALID_INPUT);

  expect(reply.deny).toContain("Could not write the brainstorm page");
  expect(reply.deny).toContain("EACCES");
});

test("the render tool saves the ideas as numbered data beside the page", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  const ideasWrite = writes.find((write) => write.path.endsWith(".json"));
  expect(ideasWrite?.path).toBe(
    `${BRAINSTORM_FOLDER}/brainstorm-2026-11-09-1200.json`
  );
  const savedIdeasFile = JSON.parse(ideasWrite?.text ?? "{}");
  expect(savedIdeasFile.project).toBe("acme-cli");
  expect(
    savedIdeasFile.ideas.map((idea: { number: number; title: string }) => [
      idea.number,
      idea.title,
    ])
  ).toEqual([
    [1, "Stop logging the API token"],
    [2, "Replay mode for bug reports"],
  ]);
});

test("the page numbers each idea and offers a plan picker", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  const html = findPage(writes)?.text ?? "";
  expect(html).toContain('data-plan="1"');
  expect(html).toContain('data-plan="2"');
  expect(html).toContain("#1");
  expect(html).toContain("/brainstorm-plan");
});

test("the page offers select-all, select-the-filtered-category and clear for planning", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  const html = findPage(writes)?.text ?? "";
  expect(html).toContain('data-select="all"');
  expect(html).toContain('data-select="filtered"');
  expect(html).toContain('data-select="none"');
});

test("the page offers to mark the selected ideas done and to reset progress", async ($, on) => {
  const { writes } = mockEngine(on);

  await renderBrainstorm($, VALID_INPUT);

  const html = findPage(writes)?.text ?? "";
  expect(html).toContain('id="mark-picked-done"');
  expect(html).toContain('id="reset-done"');
});

const SAVED_BRAINSTORM = {
  project: "acme-cli",
  summary: "A CLI that syncs notes to the cloud.",
  ideas: [
    { ...SECURITY_IDEA, number: 1 },
    { ...CREATIVE_IDEA, files: [], number: 2 },
  ],
};

const buildCommandRun = (command: string, args: string) => ({
  ...buildBrainstormCommand(args),
  command,
});

type FolderListing = Record<string, string[]>;

const mockFiles = (
  on: On,
  folderListing: FolderListing,
  fileTexts: Record<string, string>
) => {
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.list", (_, e) => {
    const fileNames = folderListing[e.path];
    if (!fileNames) return { deny: `ENOENT: ${e.path}` };
    return {
      value: fileNames.map((name) => ({
        name,
        kind: "file" as const,
        size: 1,
        mtimeMs: 1,
        isLink: false,
      })),
    };
  });
  on("fs.read", (_, e) => {
    const fileText = fileTexts[e.path];
    if (fileText === undefined) return { deny: `ENOENT: ${e.path}` };
    return { value: fileText };
  });
};

const mockSavedBrainstorm = (on: On) =>
  mockFiles(
    on,
    {
      [BRAINSTORM_FOLDER]: [
        ".gitignore",
        "brainstorm-2026-11-01-0900.json",
        "brainstorm-2026-11-08-1500.html",
        "brainstorm-2026-11-08-1500.json",
      ],
    },
    {
      [`${BRAINSTORM_FOLDER}/brainstorm-2026-11-08-1500.json`]:
        JSON.stringify(SAVED_BRAINSTORM),
      [`${BRAINSTORM_FOLDER}/brainstorm-2026-11-01-0900.json`]: JSON.stringify({
        ...SAVED_BRAINSTORM,
        ideas: [],
      }),
    }
  );

test("brainstorm-plan submits a planning turn for the picked ideas from the newest brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildCommandRun("brainstorm-plan", "2"));
  await clock.settle();

  expect(reply.text).toContain("Replay mode for bug reports");
  expect(submittedPrompts).toHaveLength(1);
  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).toContain("Sketch the event log format");
  expect(instructions).not.toContain("Stop logging the API token");
  expect(instructions).toContain(
    `${BRAINSTORM_FOLDER}/plans/plan-2026-11-09-1200.md`
  );
  expect(instructions).toContain("/brainstorm-build");
});

test("brainstorm-plan takes several numbers separated by commas or spaces", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildCommandRun("brainstorm-plan", "1, 2"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Stop logging the API token");
  expect(instructions).toContain("Replay mode for bug reports");
});

test("brainstorm-plan all plans every idea in the newest brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildCommandRun("brainstorm-plan", "all"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Stop logging the API token");
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).toContain("The user picked ideas #1 and #2");
});

test("brainstorm-plan with a category name plans that category's ideas", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildCommandRun("brainstorm-plan", "creative"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).not.toContain("Stop logging the API token");
});

test("brainstorm-plan takes a range of numbers", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildCommandRun("brainstorm-plan", "1-2"));
  await clock.settle();

  expect(submittedPrompts[0]).toContain("The user picked ideas #1 and #2");
});

test("brainstorm-plan refuses a word that is not a number, range, category or all", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(
    buildCommandRun("brainstorm-plan", "1 bogus")
  );
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("bogus");
});

test("brainstorm-plan with no numbers explains all and category picks", async ($, on) => {
  const { clock } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildCommandRun("brainstorm-plan", ""));
  await clock.settle();

  expect(reply.text).toContain("/brainstorm-plan all");
  expect(reply.text).toContain("/brainstorm-plan security");
});

test("brainstorm-plan tells the planner which ideas the user picked and not to cut them", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildCommandRun("brainstorm-plan", "1 2"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("The user picked ideas #1 and #2");
  expect(instructions).toContain("Do not ask the user to narrow");
});

test("brainstorm-plan with no numbers lists the ideas and submits nothing", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildCommandRun("brainstorm-plan", ""));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("1. Stop logging the API token");
  expect(reply.text).toContain("2. Replay mode for bug reports");
});

test("brainstorm-plan refuses a number the brainstorm does not have", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildCommandRun("brainstorm-plan", "2 9"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("9");
  expect(reply.text).toContain("1 to 2");
});

test("brainstorm-plan without a saved brainstorm points at /brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  const reply = await $.command.run(buildCommandRun("brainstorm-plan", "1"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("/brainstorm");
});

const PLANS_FOLDER = `${BRAINSTORM_FOLDER}/plans`;

test("brainstorm-build runs the newest plan with cheap implementers and a strong reviewer", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(
    on,
    {
      [PLANS_FOLDER]: ["plan-2026-11-01-0900.md", "plan-2026-11-08-1500.md"],
    },
    {}
  );

  const reply = await $.command.run(buildCommandRun("brainstorm-build", ""));
  await clock.settle();

  const planPath = `${PLANS_FOLDER}/plan-2026-11-08-1500.md`;
  expect(reply.text).toContain(planPath);
  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain(planPath);
  expect(instructions).toContain("brainstorm:step-implementer");
  expect(instructions).toContain("brainstorm:plan-reviewer");
});

test("brainstorm-build runs the plan it is given", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  await $.command.run(
    buildCommandRun("brainstorm-build", "plans/002-cache.md")
  );
  await clock.settle();

  expect(submittedPrompts[0]).toContain("/repo/plans/002-cache.md");
});

test("brainstorm-build without a plan points at /brainstorm-plan", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  const reply = await $.command.run(buildCommandRun("brainstorm-build", ""));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("/brainstorm-plan");
});

test("brainstorm-build finds a bare plan file name in the plans folder", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  await $.command.run(
    buildCommandRun("brainstorm-build", "plan-2026-11-08-1500.md")
  );
  await clock.settle();

  expect(submittedPrompts[0]).toContain(
    `${PLANS_FOLDER}/plan-2026-11-08-1500.md`
  );
});

test("brainstorm-build runs several plans in the order given", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  await $.command.run(
    buildCommandRun(
      "brainstorm-build",
      "plan-2026-11-08-1500.md plans/002-cache.md"
    )
  );
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  const firstPlan = `${PLANS_FOLDER}/plan-2026-11-08-1500.md`;
  const secondPlan = "/repo/plans/002-cache.md";
  expect(instructions).toContain(firstPlan);
  expect(instructions).toContain(secondPlan);
  expect(instructions.indexOf(firstPlan)).toBeLessThan(
    instructions.indexOf(secondPlan)
  );
});

test("brainstorm-build does not stop on changes an earlier plan in the run made", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(on, {}, {});

  await $.command.run(
    buildCommandRun("brainstorm-build", "plan-one.md plan-two.md")
  );
  await clock.settle();

  expect(submittedPrompts[0]).toContain(
    "uncommitted changes that this run did not make"
  );
});

test("brainstorm-build all runs every plan, oldest first", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFiles(
    on,
    {
      [PLANS_FOLDER]: [
        "plan-2026-11-08-1500.md",
        "notes.txt",
        "plan-2026-11-01-0900.md",
      ],
    },
    {}
  );

  await $.command.run(buildCommandRun("brainstorm-build", "all"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  const olderPlan = `${PLANS_FOLDER}/plan-2026-11-01-0900.md`;
  const newerPlan = `${PLANS_FOLDER}/plan-2026-11-08-1500.md`;
  expect(instructions).toContain(olderPlan);
  expect(instructions).toContain(newerPlan);
  expect(instructions).not.toContain("notes.txt");
  expect(instructions.indexOf(olderPlan)).toBeLessThan(
    instructions.indexOf(newerPlan)
  );
});
