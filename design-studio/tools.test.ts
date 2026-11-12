import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCatalogCss, renderSpecToHtml } from "./catalog";
import { startDesignTools } from "./tools";

const TOKENS = [
  { name: "background", kind: "color", value: "#ffffff", source: "app.css:2" },
  { name: "foreground", kind: "color", value: "#111827", source: "app.css:3" },
  { name: "primary", kind: "color", value: "#0f766e", source: "app.css:4" },
  { name: "primary-foreground", kind: "color", value: "#ffffff", source: "app.css:5" },
  { name: "Font Sans", kind: "font", value: "system-ui, sans-serif", source: "app.css:6" },
  { name: "radius", kind: "radius", value: "8px", source: "app.css:7" },
];

const TOKEN_SOURCE = [
  ":root {",
  "  --background: #ffffff;",
  "  --foreground: #111827;",
  "  --primary: #0f766e;",
  "  --primary-foreground: #ffffff;",
  "  --font-sans: system-ui, sans-serif;",
  "  --radius: 8px;",
  "}",
  "",
].join("\n");

const SPEC = {
  root: "page",
  elements: {
    page: { type: "Page", props: {}, children: ["title", "card", "field", "save"] },
    title: { type: "Heading", props: { text: "Cook tonight", level: "1" } },
    card: { type: "Card", props: { tone: "accent" }, children: ["stat", "badge"] },
    stat: { type: "Stat", props: { label: "Recipes", value: "42", detail: "this week" } },
    badge: { type: "Badge", props: { text: "New", tone: "accent" } },
    field: { type: "Input", props: { label: "Email", placeholder: "you@example.com", kind: "email" } },
    save: { type: "Button", props: { label: "Save", tone: "primary" } },
  },
};

let projectFolder: string;
let binFolder: string;
let originalPath: string | undefined;
let openLogPath: string;

beforeEach(async () => {
  projectFolder = await mkdtemp(join(tmpdir(), "design-studio-host-"));
  binFolder = join(projectFolder, "bin");
  openLogPath = join(projectFolder, "opened.log");
  await mkdir(binFolder, { recursive: true });
  for (const opener of ["open", "xdg-open"]) {
    const openerPath = join(binFolder, opener);
    await writeFile(openerPath, `#!/bin/sh\necho "$1" >> "${openLogPath}"\n`);
    await chmod(openerPath, 0o755);
  }
  await writeFile(join(projectFolder, "app.css"), TOKEN_SOURCE);
  originalPath = process.env.PATH;
  process.env.PATH = `${binFolder}:${originalPath}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
});

test("render_design accepts a catalog spec with its stylesheet, and refuses a raw color in it", async () => {
  const tools = await startDesignTools(projectFolder);
  const saved = await tools.callTool("save_design_theme", { tokens: TOKENS });
  expect(saved.isError).toBe(false);

  const rendered = await tools.callTool("render_design", {
    project: "sample",
    mode: "new",
    subject: "Recipe onboarding",
    variants: [
      {
        name: "Single card",
        rationale: "One column with the stat up top.",
        html: renderSpecToHtml(SPEC),
        css: renderCatalogCss(TOKENS),
      },
    ],
  });
  expect(rendered).toEqual({ text: expect.stringContaining("Opened"), isError: false });
  expect(await readFile(openLogPath, "utf8")).toContain("design-");

  const refused = await tools.callTool("render_design", {
    project: "sample",
    mode: "new",
    subject: "Recipe onboarding",
    variants: [
      {
        name: "Raw color",
        rationale: "Uses a literal.",
        html: renderSpecToHtml(SPEC),
        css: `${renderCatalogCss(TOKENS)}\n.page{color:#123456}`,
      },
    ],
  });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("raw color #123456");
});
