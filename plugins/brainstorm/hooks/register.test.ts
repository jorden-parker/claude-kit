import type { On } from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const RENDER_TOOL = "mcp__brainstorm__render_brainstorm";
const CHECK_TOOL = "mcp__brainstorm__check_brainstorm_plan";
const STATUS_TOOL = "mcp__brainstorm__set_brainstorm_plan_status";
const BRAINSTORM_FOLDER = "/repo/.claude/brainstorm";
const PLANS_FOLDER = `${BRAINSTORM_FOLDER}/plans`;
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

  expect(ranCommands).toEqual(["brainstorm"]);
  expect(tools).toEqual([
    { name: "render_brainstorm", isDeferred: false },
    { name: "check_brainstorm_plan", isDeferred: false },
    { name: "set_brainstorm_plan_status", isDeferred: false },
  ]);
});

test("the command's argument hint names the focus and the plan and build modes", async ($, on) => {
  const argumentHintByCommand: Record<string, string | undefined> = {};
  on("command.register", (_, e) => {
    argumentHintByCommand[e.name] = e.argumentHint;
    return { value: { command: e.name } };
  });
  on("tool.register", (_, e) => ({
    value: { tool: `mcp__brainstorm__${e.name}` },
  }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(argumentHintByCommand["brainstorm"]).toBe(
    "[focus] | plan <picks> | build [runs]"
  );
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
  expect(html).toContain("/brainstorm plan ");
  expect(html).not.toContain("/brainstorm-plan");
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

const joinLines = (...lines: string[]) => lines.join("\n");

const listImmediateEntries = (
  fileTexts: Record<string, string>,
  folder: string
) => {
  const folderPrefix = `${folder}/`;
  const kindByEntryName = new Map<string, "file" | "dir">();
  for (const filePath of Object.keys(fileTexts)) {
    if (!filePath.startsWith(folderPrefix)) continue;
    const pathSegments = filePath.slice(folderPrefix.length).split("/");
    const entryName = pathSegments[0] ?? "";
    kindByEntryName.set(entryName, pathSegments.length > 1 ? "dir" : "file");
  }
  return [...kindByEntryName].map(([name, kind]) => ({
    name,
    kind,
    size: 1,
    mtimeMs: 1,
    isLink: false,
  }));
};

const mockFileTree = (on: On, fileTexts: Record<string, string>) => {
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.read", (_, e) => {
    const fileText = fileTexts[e.path];
    if (fileText === undefined) return { deny: `ENOENT: ${e.path}` };
    return { value: fileText };
  });
  on("fs.list", (_, e) => {
    const entries = listImmediateEntries(fileTexts, e.path);
    if (!entries.length) return { deny: `ENOENT: ${e.path}` };
    return { value: entries };
  });
};

const mockSavedBrainstorm = (on: On) =>
  mockFileTree(on, {
    [`${BRAINSTORM_FOLDER}/.gitignore`]: "*\n",
    [`${BRAINSTORM_FOLDER}/brainstorm-2026-11-08-1500.html`]: "",
    [`${BRAINSTORM_FOLDER}/brainstorm-2026-11-08-1500.json`]:
      JSON.stringify(SAVED_BRAINSTORM),
    [`${BRAINSTORM_FOLDER}/brainstorm-2026-11-01-0900.json`]: JSON.stringify({
      ...SAVED_BRAINSTORM,
      ideas: [],
    }),
  });

test("brainstorm plan submits a planning turn for the picked ideas from the newest brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan 2"));
  await clock.settle();

  expect(reply.text).toContain("Replay mode for bug reports");
  expect(submittedPrompts).toHaveLength(1);
  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).toContain("Sketch the event log format");
  expect(instructions).not.toContain("Stop logging the API token");
  expect(instructions).toContain(`${PLANS_FOLDER}/plan-2026-11-09-1200`);
  expect(instructions).not.toContain("plan-2026-11-09-1200.md");
  expect(instructions).toContain("/brainstorm build");
});

test("the planning acknowledgement names the run folder it writes", async ($, on) => {
  const { clock } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan 2"));
  await clock.settle();

  expect(reply.text).toContain(`${PLANS_FOLDER}/plan-2026-11-09-1200`);
});

test("brainstorm plan takes several numbers separated by commas or spaces", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan 1, 2"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Stop logging the API token");
  expect(instructions).toContain("Replay mode for bug reports");
});

test("brainstorm plan all plans every idea in the newest brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan all"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Stop logging the API token");
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).toContain("The user picked ideas #1 and #2");
});

test("brainstorm plan with a category name plans that category's ideas", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan creative"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Replay mode for bug reports");
  expect(instructions).not.toContain("Stop logging the API token");
});

test("brainstorm plan takes a range of numbers", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan 1-2"));
  await clock.settle();

  expect(submittedPrompts[0]).toContain("The user picked ideas #1 and #2");
});

test("brainstorm plan refuses a word that is not a number, range, category or all", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan 1 bogus"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("bogus");
});

test("brainstorm plan with no numbers explains all and category picks", async ($, on) => {
  const { clock } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan"));
  await clock.settle();

  expect(reply.text).toContain("/brainstorm plan all");
  expect(reply.text).toContain("/brainstorm plan security");
});

test("brainstorm plan tells the planner which ideas the user picked and not to cut them", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan 1 2"));
  await clock.settle();

  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("The user picked ideas #1 and #2");
  expect(instructions).toContain("Do not ask the user to narrow");
});

const planningInstructions = async ($: Engine, on: On) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  await $.command.run(buildBrainstormCommand("plan 1 2"));
  await clock.settle();
  return submittedPrompts[0] ?? "";
};

test("the planning prompt forbids implementing and asks for every picked idea to be planned", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("Do not implement anything.");
  expect(instructions).toContain("Plan every picked idea.");
});

test("the planning prompt says one subagent builds each plan and that no one can ask questions", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain(
    "one small-model subagent builds each plan, working through its step files one at a time"
  );
  expect(instructions).not.toContain("each step file goes alone");
  expect(instructions).toContain("it cannot ask questions");
  expect(instructions).toContain("a strong model reviews");
});

test("the planning prompt sends the planner to the CLAUDE.md files and edit-blocking hooks", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("~/.claude/CLAUDE.md");
  expect(instructions).toContain(".claude/settings");
  expect(instructions).toContain("~/.claude/settings.json");
  expect(instructions).toContain("edit-blocking hook");
  expect(instructions).toContain("TDD red-first");
  expect(instructions).toContain("reply BLOCKED");
});

test("the planning prompt splits ideas into plan folders and makes spikes of large and moonshot ideas", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("one plan folder per idea");
  expect(instructions).toContain("same code");
  expect(instructions).toContain("Depends on");
  expect(instructions).toContain("Kind: spike");
  expect(instructions).toContain("category is moonshot");
  expect(instructions).toContain("findings.md");
  expect(instructions).toContain("re-planning");
});

test("the planning prompt asks only about material choices and lists dropped ideas", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("AskUserQuestion");
  expect(instructions).toContain("changes the plan materially");
  expect(instructions).toContain("Dropped");
});

test("the planning prompt sets the step rules: size, find and replace, checks and banned phrases", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("at most 60 changed lines");
  expect(instructions).toContain("aim under 40");
  expect(instructions).toContain("Action: replace");
  expect(instructions).toContain("Near line");
  expect(instructions).toContain("Surrounding");
  expect(instructions).toContain("exactly once");
  expect(instructions).toContain("exit non-zero, output contains");
  expect(instructions).toContain("as appropriate");
});

test("the planning prompt runs the checker and the step-reader clarity pass", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("mcp__brainstorm__check_brainstorm_plan");
  expect(instructions).toContain("brainstorm:step-reader");
  expect(instructions).toContain(
    "For every plan folder, call the Agent tool once"
  );
  expect(instructions).not.toContain("For every step file, call the Agent");
  expect(instructions).toContain("QUESTIONS");
  expect(instructions).toContain("at most two rounds");
  expect(instructions).toContain("Run /brainstorm build to implement it.");
  expect(instructions).not.toContain("numberRanges");
});

test("the planning prompt carries the index, plan and step templates", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain("# Plans: <short title>");
  expect(instructions).toContain("# Plan: <title>");
  expect(instructions).toContain("# Step 01: <imperative title>");
  expect(instructions).toContain("## Done criteria");
});

test("the planning prompt gives every plan a pending status in its own file and in the index", async ($, on) => {
  const instructions = await planningInstructions($, on);

  expect(instructions).toContain(
    "| Order | Plan | Status | Kind | Depends on | Ideas |"
  );
  expect(instructions).toContain(
    "| 1 | [<title>](01-<slug>/plan.md) | pending |"
  );
  expect(instructions).toContain("- Status: pending");
  expect(instructions).toContain("pending, in-progress, done or blocked");
  expect(instructions).toContain("the same status");
});

test("brainstorm plan with no numbers lists the ideas and submits nothing", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("1. Stop logging the API token");
  expect(reply.text).toContain("2. Replay mode for bug reports");
});

test("brainstorm plan refuses a number the brainstorm does not have", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(buildBrainstormCommand("plan 2 9"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("9");
  expect(reply.text).toContain("1 to 2");
});

test("brainstorm plan without a saved brainstorm points at /brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockFileTree(on, {});

  const reply = await $.command.run(buildBrainstormCommand("plan 1"));
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("/brainstorm");
});

test("brainstorm build hands the build to the build-plans skill and does not repeat its flow", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  const reply = await $.command.run(buildBrainstormCommand("build"));
  await clock.settle();

  expect(reply.text).toContain("Building");
  expect(submittedPrompts).toHaveLength(1);
  const instructions = submittedPrompts[0] ?? "";
  expect(instructions).toContain("Skill tool");
  expect(instructions).toContain("brainstorm:build-plans");
  expect(instructions).toContain("follow it exactly");
  expect(instructions).toContain("Do not commit anything.");
  expect(instructions).not.toContain("brainstorm:step-implementer");
  expect(instructions).not.toContain("brainstorm:plan-reviewer");
  expect(instructions).not.toContain("<focus>");
});

test("brainstorm build with no run named asks for the newest run", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  const reply = await $.command.run(buildBrainstormCommand("build"));
  await clock.settle();

  expect(reply.text).toContain("the newest run");
  expect(submittedPrompts[0]).toContain("the newest run");
  expect(submittedPrompts[0]).not.toContain("<runs>");
});

test("brainstorm build passes the named runs to the skill as the user wrote them", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  const reply = await $.command.run(
    buildBrainstormCommand("build plan-2026-11-08-1500 plans/002-cache")
  );
  await clock.settle();

  expect(reply.text).toContain("plan-2026-11-08-1500 plans/002-cache");
  expect(submittedPrompts[0]).toContain(
    "<runs>\nplan-2026-11-08-1500 plans/002-cache\n</runs>"
  );
});

test("brainstorm build leaves finding the runs to the skill and lists no folder", async ($, on) => {
  const { clock } = recordSubmittedPrompts(on);
  const listedFolders: string[] = [];
  on("session.cwd", () => ({ value: "/repo" }));
  on("fs.list", (_, e) => {
    listedFolders.push(e.path);
    return { deny: `ENOENT: ${e.path}` };
  });

  await $.command.run(buildBrainstormCommand("build all"));
  await clock.settle();

  expect(listedFolders).toEqual([]);
});

test("a focus that names plan or build after its first word is still a brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  await $.command.run(buildBrainstormCommand("the build plan"));
  await clock.settle();

  expect(submittedPrompts[0]).toContain("<focus>\nthe build plan\n</focus>");
});

test("a focus whose first word only starts with plan or build is still a brainstorm", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  await $.command.run(buildBrainstormCommand("planning docs"));
  await $.command.run(buildBrainstormCommand("builds that time out"));
  await clock.settle();

  expect(submittedPrompts[0]).toContain("<focus>\nplanning docs\n</focus>");
  expect(submittedPrompts[1]).toContain(
    "<focus>\nbuilds that time out\n</focus>"
  );
});

test("brainstorm plan with words that are not picks says how to brainstorm on them instead", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);
  mockSavedBrainstorm(on);

  const reply = await $.command.run(
    buildBrainstormCommand("plan pricing page")
  );
  await clock.settle();

  expect(submittedPrompts).toEqual([]);
  expect(reply.text).toContain("pricing, page");
  expect(reply.text).toContain("as a focus");
});

const CLEAN_RUN_FOLDER = `${PLANS_FOLDER}/plan-2026-11-09-1200`;

const CLEAN_INDEX = joinLines(
  "# Plans: Replay mode",
  "",
  "- Ideas: #2 Replay mode for bug reports",
  "- Written against: abc1234 on main",
  "",
  "## Plans",
  "",
  "| Order | Plan | Status | Kind | Depends on | Ideas |",
  "| ----- | ---- | ------ | ---- | ---------- | ----- |",
  "| 1 | [Add the replay test](01-replay/plan.md) | pending | change | none | #2 |",
  "",
  "## Dropped",
  "",
  "None."
);

const CLEAN_PLAN = joinLines(
  "# Plan: Add the replay test",
  "",
  "- Status: pending",
  "- Ideas: #2 Replay mode for bug reports",
  "- Kind: change",
  "- Depends on: none",
  "",
  "## Goal",
  "",
  "Bug reports can carry a replay.",
  "",
  "## Context",
  "",
  "- TypeScript. Test command: `pnpm test`.",
  "",
  "## Steps",
  "",
  "- [ ] [step-01](step-01.md): Add the replay test",
  "",
  "## Done criteria",
  "",
  "- `pnpm test`: expect exit 0",
  "",
  "## Out of scope",
  "",
  "Everything else."
);

const CLEAN_STEP = joinLines(
  "# Step 01: Add the replay test",
  "",
  "- Plan: 01-replay",
  "- Kind: test",
  "- Depends on: none",
  "",
  "## Context",
  "",
  "- TypeScript. Test command: `pnpm test`.",
  "",
  "## Edits",
  "",
  "### Edit 1",
  "",
  "- File: `src/replay.test.ts`",
  "- Action: create",
  "",
  "Contents:",
  "",
  "```ts",
  "export {};",
  "```",
  "",
  "## Check",
  "",
  "- Run: `pnpm test src/replay.test.ts`",
  "- Expect: exit non-zero, output contains `replay`"
);

const CLEAN_RUN_FILES: Record<string, string> = {
  [`${CLEAN_RUN_FOLDER}/index.md`]: CLEAN_INDEX,
  [`${CLEAN_RUN_FOLDER}/01-replay/plan.md`]: CLEAN_PLAN,
  [`${CLEAN_RUN_FOLDER}/01-replay/step-01.md`]: CLEAN_STEP,
};

const checkBrainstormPlan = ($: Engine, path: string) =>
  $.tool.call({ tool: CHECK_TOOL, path } as never);

test("the check tool answers OK for a clean run folder", async ($, on) => {
  mockFileTree(on, CLEAN_RUN_FILES);

  const reply = await checkBrainstormPlan($, CLEAN_RUN_FOLDER);

  expect(reply.result).toBe("OK");
});

test("the check tool resolves a relative path against the session folder", async ($, on) => {
  mockFileTree(on, CLEAN_RUN_FILES);

  const reply = await checkBrainstormPlan(
    $,
    ".claude/brainstorm/plans/plan-2026-11-09-1200"
  );

  expect(reply.result).toBe("OK");
});

test("the check tool returns each problem on its own line as a result, not a denial", async ($, on) => {
  mockFileTree(on, {
    ...CLEAN_RUN_FILES,
    [`${CLEAN_RUN_FOLDER}/02-extra/plan.md`]: "",
  });

  const reply = await checkBrainstormPlan($, CLEAN_RUN_FOLDER);

  expect(reply.deny).toBeUndefined();
  expect(String(reply.result)).toContain(
    "02-extra: plan folder is not listed in index.md"
  );
});

test("the check tool reports a folder with no index.md as missing", async ($, on) => {
  mockFileTree(on, {});

  const reply = await checkBrainstormPlan($, CLEAN_RUN_FOLDER);

  expect(reply.result).toBe("index.md: missing");
});

const recordFileWrites = (on: On) => {
  const writes: FileWrite[] = [];
  on("fs.write", (_, e) => {
    writes.push({ path: e.path, text: e.text });
    return { value: undefined };
  });
  return writes;
};

const setBrainstormPlanStatus = ($: Engine, path: string, status: string) =>
  $.tool.call({ tool: STATUS_TOOL, path, status } as never);

test("the status tool writes the new status to the plan file and the index", async ($, on) => {
  mockFileTree(on, CLEAN_RUN_FILES);
  const writes = recordFileWrites(on);

  const reply = await setBrainstormPlanStatus(
    $,
    `${CLEAN_RUN_FOLDER}/01-replay`,
    "in-progress"
  );

  expect(reply.result).toBe("01-replay: in-progress");
  expect(writes).toEqual([
    {
      path: `${CLEAN_RUN_FOLDER}/01-replay/plan.md`,
      text: CLEAN_PLAN.replace("- Status: pending", "- Status: in-progress"),
    },
    {
      path: `${CLEAN_RUN_FOLDER}/index.md`,
      text: CLEAN_INDEX.replace("| pending |", "| in-progress |"),
    },
  ]);
});

test("the status tool resolves a relative plan folder against the session folder", async ($, on) => {
  mockFileTree(on, CLEAN_RUN_FILES);
  const writes = recordFileWrites(on);

  const reply = await setBrainstormPlanStatus(
    $,
    ".claude/brainstorm/plans/plan-2026-11-09-1200/01-replay",
    "done"
  );

  expect(reply.result).toBe("01-replay: done");
  expect(writes.map((write) => write.path)).toEqual([
    `${CLEAN_RUN_FOLDER}/01-replay/plan.md`,
    `${CLEAN_RUN_FOLDER}/index.md`,
  ]);
});

test("a run the status tool has updated still passes the checker", async ($, on) => {
  const fileTexts = { ...CLEAN_RUN_FILES };
  mockFileTree(on, fileTexts);
  on("fs.write", (_, e) => {
    fileTexts[e.path] = e.text;
    return { value: undefined };
  });

  await setBrainstormPlanStatus($, `${CLEAN_RUN_FOLDER}/01-replay`, "blocked");
  const reply = await checkBrainstormPlan($, CLEAN_RUN_FOLDER);

  expect(reply.result).toBe("OK");
});

test("the status tool denies a status that is not one of the four and writes nothing", async ($, on) => {
  mockFileTree(on, CLEAN_RUN_FILES);
  const writes = recordFileWrites(on);

  const reply = await setBrainstormPlanStatus(
    $,
    `${CLEAN_RUN_FOLDER}/01-replay`,
    "finished"
  );

  expect(reply.deny).toBe(
    "Status must be pending, in-progress, done or blocked"
  );
  expect(writes).toEqual([]);
});

test("the status tool denies a plan folder the index does not list", async ($, on) => {
  mockFileTree(on, {
    ...CLEAN_RUN_FILES,
    [`${CLEAN_RUN_FOLDER}/02-extra/plan.md`]: CLEAN_PLAN,
  });
  const writes = recordFileWrites(on);

  const reply = await setBrainstormPlanStatus(
    $,
    `${CLEAN_RUN_FOLDER}/02-extra`,
    "done"
  );

  expect(reply.deny).toBe(
    `${CLEAN_RUN_FOLDER}/index.md: has no row for 02-extra`
  );
  expect(writes).toEqual([]);
});
