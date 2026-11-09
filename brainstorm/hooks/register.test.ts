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

  expect(ranCommands).toEqual(["brainstorm"]);
  expect(tools).toEqual([{ name: "render_brainstorm", isDeferred: false }]);
});

const recordSubmittedPrompts = (on: On) => {
  const clock = mock.clock(on);
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
