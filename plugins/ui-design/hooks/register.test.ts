import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
} from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

const THEME_TOOL = "mcp__ui-design__save_design_theme";
const DESIGN_TOOL = "mcp__ui-design__render_design";
const AUDIT_TOOL = "mcp__ui-design__render_design_audit";
const DESIGN_FOLDER = "/repo/.claude/ui-design";
const THEME_PATH = `${DESIGN_FOLDER}/theme.json`;
const DESIGN_PAGE_PATH = `${DESIGN_FOLDER}/design-2026-11-12-120000.html`;
const AUDIT_PAGE_PATH = `${DESIGN_FOLDER}/audit-2026-11-12-120000.html`;
const NOVEMBER_TWELFTH_NOON = Date.UTC(2026, 10, 12, 12, 0, 0);

const THEME_INPUT = {
  tokens: [
    {
      name: "primary",
      kind: "color",
      value: "#2563eb",
      source: "src/app/globals.css:2",
    },
    {
      name: "font-sans",
      kind: "font",
      value: "Inter, sans-serif",
      source: "./src/app/globals.css:3",
    },
  ],
  stack: {
    framework: "Next.js",
    styling: "Tailwind v4",
    darkMode: "class",
    iconSet: "lucide",
  },
  components: [
    { name: "Button", path: "src/ui/button.tsx", variants: ["primary"] },
  ],
  inconsistencies: ["Two button heights"],
};

const SAVED_THEME = {
  ...THEME_INPUT,
  tokens: THEME_INPUT.tokens.map((token) => ({ ...token, isInferred: false })),
};

const PROJECT_FILES: Record<string, string> = {
  "/repo/src/app/globals.css":
    ":root{\n--primary: #2563EB;\n--font-sans: Inter, sans-serif;\n}",
  "/repo/src/ui/filter-bar.tsx": "export const FilterBar = () => null;",
  "/repo/src/search/result-filter.tsx":
    "export const ResultFilter = () => null;",
  "/repo/src/ui/button.tsx":
    'const buttonStyle = { color: "#2563eb", background: "#f0f" };',
  [THEME_PATH]: JSON.stringify(SAVED_THEME),
};

const FIRST_VARIANT = {
  name: "Single card",
  rationale: "One centered card.",
  html: '<main class="page" style="color: var(--primary)">Order #123</main>',
  css: ".page{font-family:var(--font-sans)}",
  kept: ["Every field"],
  changed: ["The sidebar is gone"],
};

const DESIGN_INPUT = {
  project: "acme-notes",
  mode: "redesign",
  subject: "src/app/settings/page.tsx",
  variants: [FIRST_VARIANT, { ...FIRST_VARIANT, name: "Two columns" }],
};

const AUDIT_INPUT = {
  project: "acme-notes",
  files: ["src/ui/button.tsx", "src/app/globals.css"],
  findings: [
    {
      category: "typography",
      severity: "warning",
      title: "Three heading sizes",
      detail: "Page titles use 24px, 28px and 32px.",
      fix: "Pick one size for page titles.",
      file: "src/ui/button.tsx",
      line: 1,
    },
  ],
};

type FileWrite = { path: string; text: string };

type EngineSetup = {
  fileTexts?: Record<string, string>;
  failingOpeners?: string[];
  isReadOnly?: boolean;
};

const EVERY_OPENER = ["open", "xdg-open", "cmd"];

const mockEngine = (
  on: On,
  {
    fileTexts = PROJECT_FILES,
    failingOpeners = [],
    isReadOnly = false,
  }: EngineSetup = {}
) => {
  const writes: FileWrite[] = [];
  const ranCommands: string[][] = [];
  const clock = { milliseconds: NOVEMBER_TWELFTH_NOON };
  on("session.cwd", () => ({ value: "/repo" }));
  on("clock.now", () => ({ value: clock.milliseconds }));
  on("fs.write", (_, e) => {
    if (isReadOnly) return { deny: "EACCES: permission denied" };
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
    value: Object.keys(fileTexts)
      .filter(
        (filePath) =>
          filePath.startsWith(`${e.path}/`) &&
          !filePath.slice(e.path.length + 1).includes("/")
      )
      .map((filePath) => ({
        name: filePath.slice(e.path.length + 1),
        kind: "file" as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }));
  on("process.run", (_, e) => {
    ranCommands.push([...e.argv]);
    return {
      value: {
        exitCode: failingOpeners.includes(e.argv[0] ?? "") ? 1 : 0,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { writes, ranCommands, clock };
};

const withoutFile = (missingPath: string) =>
  Object.fromEntries(
    Object.entries(PROJECT_FILES).filter(
      ([filePath]) => filePath !== missingPath
    )
  );

const callTool = ($: Engine, tool: string, input: object) =>
  $.tool.call({ tool, ...input } as never);

const readSavedJson = (writes: FileWrite[], fileEnding: string) =>
  JSON.parse(
    writes.find((write) => write.path.endsWith(fileEnding))?.text ?? "null"
  ) as Record<string, unknown>;

const buildDesignCommand = (args: string) => ({
  command: "ui-design",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: false, columns: 80 },
});

const recordSubmittedPrompts = (on: On) => {
  const clock = mock.clock(on, { now: NOVEMBER_TWELFTH_NOON });
  const submittedPrompts: string[] = [];
  on("prompt.submit", (_, e) => {
    submittedPrompts.push(e.text);
    return { text: e.text };
  });
  return { clock, submittedPrompts };
};

test("/ui-design runs the ui-design skill with its arguments", async ($, on) => {
  const { clock, submittedPrompts } = recordSubmittedPrompts(on);

  const reply = await $.command.run(buildDesignCommand("new a pricing page"));
  await clock.settle();

  expect(reply.text).toContain("ui-design");
  expect(submittedPrompts).toHaveLength(1);
  expect(submittedPrompts[0]).toContain("ui-design:ui-design");
  expect(submittedPrompts[0]).toContain("new a pricing page");
});

const readPage = (writes: FileWrite[]) =>
  writes.find((write) => write.path.endsWith(".html"))?.text ?? "";

test("session start registers the bare /ui-design command and the three tools", async ($, on) => {
  const commandNames: string[] = [];
  const tools: { name: string; isDeferred?: unknown }[] = [];
  on("command.register", (_, e) => {
    commandNames.push(e.name);
    return { value: { command: e.name } };
  });
  on("tool.register", (_, e) => {
    tools.push({ name: e.name, isDeferred: e.isDeferred });
    return { value: { tool: `mcp__ui-design__${e.name}` } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));

  await $.session.start({
    cwd: "/repo",
    surface: "terminal",
    isInteractive: true,
  });

  expect(commandNames).toEqual(["ui-design"]);
  expect(tools).toEqual([
    { name: "save_design_theme", isDeferred: false },
    { name: "render_design", isDeferred: false },
    { name: "render_design_audit", isDeferred: false },
  ]);
});

test("the theme tool saves the theme and opens nothing", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, THEME_TOOL, THEME_INPUT);

  expect(writes.map((write) => write.path)).toEqual([
    `${DESIGN_FOLDER}/.gitignore`,
    THEME_PATH,
  ]);
  expect(writes[0]?.text).toBe("*\n");
  expect(readSavedJson(writes, "theme.json")).toEqual(SAVED_THEME);
  expect(ranCommands).toEqual([]);
  expect(reply.result).toBe(`Saved 2 tokens to ${THEME_PATH}.`);
});

test("the theme tool refuses a theme without tokens", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, THEME_TOOL, { ...THEME_INPUT, tokens: [] });

  expect(reply.deny).toBe("The theme needs at least one token.");
  expect(writes).toEqual([]);
});

test("the theme tool lists every broken token, one per line, and saves nothing", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, THEME_TOOL, {
    ...THEME_INPUT,
    tokens: [
      { name: "ring", kind: "colour", value: "#2563eb", source: "a.css" },
      {
        name: "ghost",
        kind: "color",
        value: "#abcdef",
        source: "src/app/missing.css:4",
      },
      {
        name: "invented",
        kind: "color",
        value: "#123456",
        source: "src/app/globals.css:9",
      },
      {
        name: "brand",
        kind: "color",
        value: "#2563eb",
        source: "src/app/globals.css:2",
      },
      {
        name: "font-sans",
        kind: "font",
        value: "Helvetica",
        source: "src/app/globals.css:3",
      },
    ],
  });

  expect(reply.deny).toBe(
    [
      'Token "ring": kind "colour" is not one of color, font, text-size, space, radius, shadow.',
      'Token "ring": source "a.css" must be path:line, such as src/app/globals.css:12.',
      'Token "ghost": src/app/missing.css does not exist.',
      'Token "invented": neither its name nor its value appears in src/app/globals.css.',
    ].join("\n")
  );
  expect(writes).toEqual([]);
});

test("the design tool saves the design with the theme, writes the page and opens it", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, DESIGN_TOOL, DESIGN_INPUT);

  expect(writes.map((write) => write.path)).toEqual([
    `${DESIGN_FOLDER}/.gitignore`,
    `${DESIGN_FOLDER}/design-2026-11-12-120000.json`,
    DESIGN_PAGE_PATH,
  ]);
  expect(readSavedJson(writes, ".json")).toEqual({
    project: "acme-notes",
    mode: "redesign",
    subject: "src/app/settings/page.tsx",
    theme: SAVED_THEME,
    variants: [
      { ...FIRST_VARIANT, newTokens: [], restyledTokens: [] },
      {
        ...FIRST_VARIANT,
        name: "Two columns",
        newTokens: [],
        restyledTokens: [],
      },
    ],
  });
  expect(readPage(writes)).toContain('<p class="eyebrow">Redesign</p>');
  expect(readPage(writes)).toContain("--primary:#2563eb");
  expect(readPage(writes)).toContain("<h3>Changed</h3>");
  expect(ranCommands).toEqual([["open", DESIGN_PAGE_PATH]]);
  expect(reply.result).toBe(`Opened ${DESIGN_PAGE_PATH} in the browser.`);
});

test("two renders in the same minute are saved under different names", async ($, on) => {
  const { writes, clock } = mockEngine(on);

  await callTool($, DESIGN_TOOL, DESIGN_INPUT);
  clock.milliseconds += 1000;
  await callTool($, DESIGN_TOOL, DESIGN_INPUT);

  const pagePaths = writes
    .map((write) => write.path)
    .filter((writePath) => writePath.endsWith(".html"));
  expect(pagePaths).toEqual([
    DESIGN_PAGE_PATH,
    `${DESIGN_FOLDER}/design-2026-11-12-120001.html`,
  ]);
});

test("the design tool tries each opener, and says where the page is when none works", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on, {
    failingOpeners: EVERY_OPENER,
  });

  const reply = await callTool($, DESIGN_TOOL, DESIGN_INPUT);

  expect(ranCommands.map((argv) => argv[0])).toEqual(EVERY_OPENER);
  expect(readPage(writes)).toContain("<iframe");
  expect(reply.result).toBe(
    `Could not open the browser. The page is saved at ${DESIGN_PAGE_PATH}.`
  );
});

test("the design tool asks for a saved theme first", async ($, on) => {
  const { writes } = mockEngine(on, {
    fileTexts: withoutFile(THEME_PATH),
  });

  const reply = await callTool($, DESIGN_TOOL, DESIGN_INPUT);

  expect(reply.deny).toBe(
    `No saved theme at ${THEME_PATH}. Call save_design_theme first.`
  );
  expect(writes).toEqual([]);
});

test("the design tool wants one to four variants and a known mode", async ($, on) => {
  mockEngine(on);

  const emptyReply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    mode: "refresh",
    variants: [],
  });
  const crowdedReply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    variants: Array.from({ length: 5 }, () => FIRST_VARIANT),
  });

  expect(emptyReply.deny).toBe(
    [
      'mode "refresh" is not one of redesign, new.',
      "The design needs one to four variants, and has 0.",
    ].join("\n")
  );
  expect(crowdedReply.deny).toBe(
    "The design needs one to four variants, and has 5."
  );
});

test("the design tool lists every off-theme literal and every broken variant, and writes nothing", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);
  const proposedToken = { name: "accent", kind: "color", value: "#e8f0ff" };

  const reply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    variants: [
      {
        ...FIRST_VARIANT,
        css: ".page{color:#FFF;background:rgb(0 0 0);font-family:Georgia}",
        changed: [],
      },
      {
        ...FIRST_VARIANT,
        html: "<main style=\"color:#111; font-family: 'Arial'\">Body</main>",
        newTokens: [
          proposedToken,
          proposedToken,
          proposedToken,
          { ...proposedToken, kind: "colour" },
        ],
      },
      { ...FIRST_VARIANT, name: "", html: "" },
    ],
  });

  expect(reply.deny).toBe(
    [
      "Variant A: a redesign lists at least one thing under changed.",
      "Variant A: raw color #FFF in its css. Use var(--token).",
      "Variant A: raw color rgb(0 0 0) in its css. Use var(--token).",
      "Variant A: raw font Georgia in its css. Use var(--token).",
      "Variant B: at most three newTokens, and it has 4.",
      'Variant B: Token "accent": kind "colour" is not one of color, font, text-size, space, radius, shadow.',
      "Variant B: raw color #111 in its html style attributes. Use var(--token).",
      "Variant B: raw font 'Arial' in its html style attributes. Use var(--token).",
      "Variant C: needs a name and html.",
    ].join("\n")
  );
  expect(writes).toEqual([]);
  expect(ranCommands).toEqual([]);
});

test("a new design needs no changed list, and proposed tokens may hold raw values", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    mode: "new",
    subject: "A pricing page",
    variants: [
      {
        name: "Three plans",
        rationale: "One card per plan.",
        html: "<main>Plans</main>",
        css: "main{background:var(--accent)}",
        newTokens: [{ name: "accent", kind: "color", value: "#e8f0ff" }],
      },
    ],
  });

  expect(reply.result).toBe(`Opened ${DESIGN_PAGE_PATH} in the browser.`);
  expect(readPage(writes)).toContain("--accent:#e8f0ff");
  expect(readPage(writes)).toContain('<p class="eyebrow">New design</p>');
});

test("a variant can restyle the theme's colors and fonts, and gets their kind from the theme", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    variants: [
      {
        ...FIRST_VARIANT,
        restyledTokens: [
          { name: "primary", value: "#0f766e" },
          { name: "font-sans", value: "Georgia, serif" },
        ],
      },
    ],
  });

  expect(reply.result).toBe(`Opened ${DESIGN_PAGE_PATH} in the browser.`);
  expect(readPage(writes)).toContain("--primary:#0f766e");
  expect(readPage(writes)).toContain("--font-sans:Georgia, serif");
});

test("a variant can restyle only colors and fonts the theme already has", async ($, on) => {
  mockEngine(on);

  const reply = await callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    variants: [
      {
        ...FIRST_VARIANT,
        restyledTokens: [
          { name: "brand", value: "#0f766e" },
          { name: "primary", value: "" },
        ],
      },
    ],
  });

  expect(reply.deny).toBe(
    [
      'Variant A: restyled token "brand" is not a color or font in the theme. A value the theme lacks goes in newTokens.',
      'Variant A: restyled token "primary" needs a value.',
    ].join("\n")
  );
});

test("a failed write is reported as a refusal", async ($, on) => {
  mockEngine(on, { isReadOnly: true });

  const themeReply = await callTool($, THEME_TOOL, THEME_INPUT);
  const designReply = await callTool($, DESIGN_TOOL, DESIGN_INPUT);
  const auditReply = await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(themeReply.deny).toContain("Could not save the theme: ");
  expect(themeReply.deny).toContain("EACCES");
  expect(designReply.deny).toContain("Could not write the design: ");
  expect(auditReply.deny).toContain("Could not write the audit: ");
});

test("the audit tool adds its own findings to the model's, numbers them, writes the page and opens it", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(writes.map((write) => write.path)).toEqual([
    `${DESIGN_FOLDER}/.gitignore`,
    `${DESIGN_FOLDER}/audit-2026-11-12-120000.json`,
    AUDIT_PAGE_PATH,
  ]);
  const savedAudit = readSavedJson(writes, ".json");
  expect(savedAudit.project).toBe("acme-notes");
  expect(savedAudit.files).toEqual(AUDIT_INPUT.files);
  expect(savedAudit.theme).toEqual(SAVED_THEME);
  expect(savedAudit.findings).toEqual([
    {
      number: 1,
      category: "hardcoded",
      severity: "error",
      title: "Hardcoded color #2563eb",
      detail: "It has the same value as the primary token.",
      fix: "Use the primary token (--primary).",
      file: "src/ui/button.tsx",
      lines: [1],
      value: "#2563eb",
    },
    {
      number: 2,
      category: "hardcoded",
      severity: "warning",
      title: "Hardcoded color #f0f",
      detail: "No color token has this value.",
      fix: "Add a color token for it, or use the nearest existing one.",
      file: "src/ui/button.tsx",
      lines: [1],
      value: "#f0f",
    },
    {
      number: 3,
      category: "typography",
      severity: "warning",
      title: "Three heading sizes",
      detail: "Page titles use 24px, 28px and 32px.",
      fix: "Pick one size for page titles.",
      file: "src/ui/button.tsx",
      lines: [1],
    },
  ]);
  expect(readPage(writes)).toContain(
    "<title>Design audit · acme-notes</title>"
  );
  expect(readPage(writes)).toContain("Three heading sizes");
  expect(ranCommands).toEqual([["open", AUDIT_PAGE_PATH]]);
  expect(reply.result).toBe(
    `Opened ${AUDIT_PAGE_PATH} in the browser. 3 findings: 2 hardcoded, 1 typography.`
  );
});

test("the audit tool says where the page is when no browser opens", async ($, on) => {
  mockEngine(on, { failingOpeners: EVERY_OPENER });

  const reply = await callTool($, AUDIT_TOOL, { ...AUDIT_INPUT, findings: [] });

  expect(reply.result).toBe(
    `Could not open the browser. The page is saved at ${AUDIT_PAGE_PATH}. 2 findings: 2 hardcoded.`
  );
});

test("the audit tool asks for a saved theme first", async ($, on) => {
  const { writes } = mockEngine(on, {
    fileTexts: withoutFile(THEME_PATH),
  });

  const reply = await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(reply.deny).toBe(
    `No saved theme at ${THEME_PATH}. Call save_design_theme first.`
  );
  expect(writes).toEqual([]);
});

test("the audit tool lists every broken finding and missing file, and writes nothing", async ($, on) => {
  const { writes, ranCommands } = mockEngine(on);

  const reply = await callTool($, AUDIT_TOOL, {
    project: "acme-notes",
    files: ["src/ui/button.tsx", "src/ui/gone.tsx"],
    findings: [
      { category: "colour", severity: "fatal", title: "Odd", fix: "Fix it." },
      { category: "theme", severity: "note", title: " ", fix: "" },
      {
        category: "components",
        severity: "note",
        title: "Two buttons",
        fix: "Merge them.",
        file: "src/ui/other-button.tsx",
      },
    ],
  });

  expect(reply.deny).toBe(
    [
      'Finding 1: category "colour" is not one of hardcoded, typography, components, theme, accessibility.',
      'Finding 1: severity "fatal" is not one of error, warning, note.',
      "Finding 2: needs a title and a fix.",
      "Finding 3: src/ui/other-button.tsx does not exist.",
      "src/ui/gone.tsx does not exist.",
    ].join("\n")
  );
  expect(writes).toEqual([]);
  expect(ranCommands).toEqual([]);
});

const PREVIOUS_AUDIT_NAME = "audit-2026-11-11-093000.json";
const PREVIOUS_AUDIT_PATH = `${DESIGN_FOLDER}/${PREVIOUS_AUDIT_NAME}`;
const PREVIOUS_FINDINGS = [
  {
    category: "hardcoded",
    title: "Hardcoded color #2563eb",
    file: "src/ui/button.tsx",
    number: 1,
    lines: [1],
  },
  {
    category: "typography",
    title: "Three heading sizes",
    file: "src/ui/button.tsx",
    number: 2,
    lines: [1],
  },
  {
    category: "theme",
    title: "Old warning",
    file: "src/app/globals.css",
    number: 3,
    lines: [],
  },
];

test("the audit tool says what is fixed and what is new since the last audit, on the page and in the saved json", async ($, on) => {
  const { writes } = mockEngine(on, {
    fileTexts: {
      ...PROJECT_FILES,
      [PREVIOUS_AUDIT_PATH]: JSON.stringify({ findings: PREVIOUS_FINDINGS }),
    },
  });

  const reply = await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(reply.result).toBe(
    `Opened ${AUDIT_PAGE_PATH} in the browser. 3 findings: 2 hardcoded, 1 typography. Since the last audit: 1 fixed, 1 new.`
  );
  expect(readSavedJson(writes, ".json").progress).toEqual({
    previousAudit: PREVIOUS_AUDIT_NAME,
    fixed: 1,
    new: 1,
  });
  expect(readPage(writes)).toContain("Since the last audit: 1 fixed, 1 new.");
});

test("an earlier audit that cannot be read is skipped, and the audit still renders", async ($, on) => {
  const { writes } = mockEngine(on, {
    fileTexts: { ...PROJECT_FILES, [PREVIOUS_AUDIT_PATH]: "{ not json" },
  });

  const reply = await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(reply.result).toBe(
    `Opened ${AUDIT_PAGE_PATH} in the browser. 3 findings: 2 hardcoded, 1 typography.`
  );
  expect(readSavedJson(writes, ".json")).not.toHaveProperty("progress");
  expect(readPage(writes)).not.toContain("Since the last audit");
});

const FILTER_GROUP = {
  purpose: "Filtering and selecting results",
  components: [
    {
      name: "ResultFilter",
      path: "src/search/result-filter.tsx",
      usedIn: 2,
      notes: "A dropdown, no keyboard support.",
    },
    {
      name: "FilterBar",
      path: "src/ui/filter-bar.tsx",
      usedIn: 12,
      notes: "Chips with a clear-all action.",
    },
  ],
  discrepancies: [
    { aspect: "look", detail: "Chips in one, a dropdown in the other." },
  ],
  recommended: "FilterBar",
  reasoning: "It is used six times as often.",
};

test("the audit tool saves the component groups, numbers them before the findings and counts them", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, AUDIT_TOOL, {
    ...AUDIT_INPUT,
    componentGroups: [
      FILTER_GROUP,
      { ...FILTER_GROUP, purpose: "Narrowing a list" },
    ],
  });

  const savedAudit = readSavedJson(writes, ".json");
  expect(savedAudit.componentGroups).toEqual([
    { ...FILTER_GROUP, number: 1 },
    { ...FILTER_GROUP, purpose: "Narrowing a list", number: 2 },
  ]);
  expect(
    (savedAudit.findings as { number: number }[]).map(
      (finding) => finding.number
    )
  ).toEqual([3, 4, 5]);
  expect(readPage(writes)).toContain("Same-purpose components · 2");
  expect(readPage(writes)).toContain(
    '<strong>FilterBar</strong><span class="pill recommended">Recommended</span>'
  );
  expect(reply.result).toBe(
    `Opened ${AUDIT_PAGE_PATH} in the browser. 3 findings: 2 hardcoded, 1 typography. 2 component groups.`
  );
});

test("the audit tool saves an empty list of groups when none are passed", async ($, on) => {
  const { writes } = mockEngine(on);

  await callTool($, AUDIT_TOOL, AUDIT_INPUT);

  expect(readSavedJson(writes, ".json").componentGroups).toEqual([]);
  expect(readPage(writes)).not.toContain("Same-purpose components");
});

test("the audit tool lists every broken group after the broken findings, and writes nothing", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await callTool($, AUDIT_TOOL, {
    ...AUDIT_INPUT,
    findings: [{ category: "theme", severity: "note", title: "", fix: "" }],
    componentGroups: [
      {
        ...FILTER_GROUP,
        reasoning: "",
        components: [
          FILTER_GROUP.components[0],
          { name: "Ghost", path: "src/ui/ghost.tsx", usedIn: 0, notes: "" },
        ],
        discrepancies: [{ aspect: "style", detail: "" }],
      },
      { ...FILTER_GROUP, components: [FILTER_GROUP.components[1]] },
    ],
  });

  expect(reply.deny).toBe(
    [
      "Finding 1: needs a title and a fix.",
      "Group 1: needs a purpose and a reasoning.",
      'Group 1: component "Ghost": path "src/ui/ghost.tsx" does not exist.',
      'Group 1: aspect "style" is not one of look, behavior, implementation.',
      "Group 1: discrepancy 1 needs a detail.",
      'Group 1: recommended "FilterBar" is not the name of one of its components.',
      "Group 2: needs at least two components, and has 1.",
    ].join("\n")
  );
  expect(writes).toEqual([]);
});

const renderVariantHtml = ($: Engine, html: string) =>
  callTool($, DESIGN_TOOL, {
    ...DESIGN_INPUT,
    variants: [FIRST_VARIANT, { ...FIRST_VARIANT, html }],
  });

test("the design tool refuses a style element inside a variant's html", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await renderVariantHtml(
    $,
    '<STYLE media="screen">main{color:var(--primary)}</STYLE><main>Body</main>'
  );

  expect(reply.deny).toBe(
    "Variant B: a <style> element in its html. Styles belong in css."
  );
  expect(writes).toEqual([]);
});

test("the design tool refuses raw colors in SVG presentation attributes", async ($, on) => {
  const { writes } = mockEngine(on);

  const reply = await renderVariantHtml(
    $,
    [
      '<svg color="#111"><rect fill="#2563eb" stroke=\'rgb(0 0 0)\'/>',
      '<stop stop-color="#FFF"/><feFlood flood-color="hsl(0 0% 0%)"/></svg>',
    ].join("")
  );

  expect(reply.deny).toBe(
    [
      "Variant B: raw color #111 in its html color attributes. Use var(--token).",
      "Variant B: raw color #2563eb in its html color attributes. Use var(--token).",
      "Variant B: raw color rgb(0 0 0) in its html color attributes. Use var(--token).",
      "Variant B: raw color #FFF in its html color attributes. Use var(--token).",
      "Variant B: raw color hsl(0 0% 0%) in its html color attributes. Use var(--token).",
    ].join("\n")
  );
  expect(writes).toEqual([]);
});

test("the design tool accepts SVG colors that go through the theme", async ($, on) => {
  mockEngine(on);

  const reply = await renderVariantHtml(
    $,
    '<svg><path fill="currentColor" stroke="var(--primary)" stop-color="none"/></svg>'
  );

  expect(reply.result).toBe(`Opened ${DESIGN_PAGE_PATH} in the browser.`);
});

test("the design tool does not read visible text as markup", async ($, on) => {
  mockEngine(on);

  const reply = await renderVariantHtml(
    $,
    '<main><h1>Order #1234</h1><p>Set fill="#fff" or style="color:#000" on the icon.</p><p>Ref #abc &lt;style&gt;</p></main>'
  );

  expect(reply.result).toBe(`Opened ${DESIGN_PAGE_PATH} in the browser.`);
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

test("the first word after /ui-design suggests the matching modes", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const allReply = await autocomplete($, "/ui-design ");
  const auditReply = await autocomplete($, "/ui-design au");

  expect(suggestedTexts(allReply)).toEqual([
    "new",
    "redesign",
    "audit",
    "apply",
    "fix",
  ]);
  expect(suggestedTexts(auditReply)).toEqual(["audit"]);
  expect(auditReply.suggestions[0]!.description).toContain("consistency");
});

test("the menu form /ui-design:ui-design suggests the same modes", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const menuReply = await autocomplete($, "/ui-design:ui-design ");
  const auditReply = await autocomplete($, "/ui-design:ui-design au");

  expect(suggestedTexts(menuReply)).toEqual([
    "new",
    "redesign",
    "audit",
    "apply",
    "fix",
  ]);
  expect(suggestedTexts(auditReply)).toEqual(["audit"]);
});

test("later words and other commands get no /ui-design mode suggestions", async ($, on) => {
  on("prompt.autocomplete", () => ({ suggestions: [] }));

  const laterReply = await autocomplete($, "/ui-design new a");
  const otherReply = await autocomplete($, "/handoff a");

  expect(suggestedTexts(laterReply)).toEqual([]);
  expect(suggestedTexts(otherReply)).toEqual([]);
});
