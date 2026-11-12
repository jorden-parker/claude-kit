import { expect, test } from "bun:test";
import {
  buildCatalogPrompt,
  catalog,
  findSpecProblems,
  renderCatalogCss,
  renderSpecToHtml,
  renderStylesheet,
} from "./catalog";

const THEME_TOKENS = [
  { name: "background", kind: "color", value: "#ffffff" },
  { name: "foreground", kind: "color", value: "#111827" },
  { name: "primary", kind: "color", value: "#0f766e" },
  { name: "primary-foreground", kind: "color", value: "#ffffff" },
  { name: "Font Sans", kind: "font", value: "system-ui, sans-serif" },
  { name: "font-heading", kind: "font", value: "Georgia, serif" },
  { name: "radius", kind: "radius", value: "8px" },
];

const FULL_SPEC = {
  root: "page",
  elements: {
    page: { type: "Page", props: {}, children: ["title", "card"] },
    title: { type: "Heading", props: { text: "Cook <tonight>", level: "1" } },
    card: { type: "Card", props: { tone: "accent" }, children: ["stat"] },
    stat: {
      type: "Stat",
      props: { label: "Recipes", value: "42", detail: "this week" },
    },
  },
};

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i;

test("renderSpecToHtml renders a full spec as escaped markup", () => {
  expect(renderSpecToHtml(FULL_SPEC)).toBe(
    '<main class="page"><h1 class="heading heading-1">Cook &lt;tonight&gt;</h1><section class="card card-accent"><div class="stat"><span class="stat-label">Recipes</span><strong class="stat-value">42</strong><span class="stat-detail">this week</span></div></section></main>'
  );
});

test("renderSpecToHtml renders partial specs without throwing", () => {
  expect(renderSpecToHtml({})).toBe("");
  expect(renderSpecToHtml({ root: "page" })).toBe("");
  expect(
    renderSpecToHtml({
      root: "page",
      elements: { page: { type: "Page", children: ["later"] } },
    })
  ).toBe('<main class="page"></main>');
  expect(
    renderSpecToHtml({ root: "x", elements: { x: { type: "Unknown" } } })
  ).toBe("");
  expect(
    renderSpecToHtml({
      root: "b",
      elements: { b: { type: "Button", props: { tone: "neon", label: 5 } } },
    })
  ).toBe('<button type="button" class="button button-secondary"></button>');
  expect(renderSpecToHtml({ root: "constructor", elements: {} })).toBe("");
  expect(renderSpecToHtml({ root: "a", elements: { a: null } })).toBe("");
  expect(
    renderSpecToHtml({
      root: "a",
      elements: { a: { type: "Stack", children: ["a"] } },
    })
  ).toBe('<div class="stack gap-md"></div>');
});

test("findSpecProblems accepts a full spec and names what is wrong with the rest", () => {
  expect(findSpecProblems(FULL_SPEC)).toEqual([]);
  expect(findSpecProblems({ root: "page" })).not.toEqual([]);
  expect(
    findSpecProblems({ root: "b", elements: { b: { type: "Nope" } } })
  ).toContainEqual(expect.stringContaining("elements.b.type"));
  expect(
    findSpecProblems({
      root: "b",
      elements: { b: { type: "Button", props: { tone: "neon" } } },
    })
  ).toContainEqual(expect.stringContaining('element "b" (Button)'));
  expect(
    findSpecProblems({
      root: "a",
      elements: { a: { type: "Page", children: ["ghost"] } },
    })
  ).toContainEqual(expect.stringContaining("ghost"));
});

test("renderCatalogCss styles with the theme's variables and no raw colors", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  expect(css).toContain("var(--primary)");
  expect(css).toContain("var(--font-heading)");
  expect(css).toContain("var(--radius)");
  expect(css).not.toMatch(RAW_COLOR);
});

test("renderCatalogCss falls back to keywords for the roles the theme lacks", () => {
  const css = renderCatalogCss([{ name: "ink", kind: "color", value: "#111827" }]);
  expect(css).not.toContain("var(--primary)");
  expect(css).toContain("background:transparent");
  expect(css).not.toMatch(RAW_COLOR);
});

test("renderStylesheet puts the theme tokens on :root before the catalog styles", () => {
  const stylesheet = renderStylesheet(THEME_TOKENS);
  expect(stylesheet.startsWith(":root{--background:#ffffff;--foreground:#111827;")).toBe(true);
  expect(stylesheet).toContain("--font-sans:system-ui, sans-serif");
  expect(stylesheet).toContain(renderCatalogCss(THEME_TOKENS));
});

test("the catalog holds the sixteen layout and content components", () => {
  expect(catalog.componentNames).toHaveLength(16);
  expect(catalog.componentNames).toContain("ListItem");
});

test("buildCatalogPrompt carries the rules, the tokens and the reply shape", () => {
  const prompt = buildCatalogPrompt("RULE TEXT FROM THE SKILL", THEME_TOKENS);
  expect(prompt).toContain("AVAILABLE COMPONENTS (16)");
  expect(prompt).toContain("RULE TEXT FROM THE SKILL");
  expect(prompt).toContain("--primary (color): #0f766e");
  expect(prompt).toContain("NAME: <two to four words>");
  expect(prompt).toContain('TOKENS: [{"name"');
});

test("renderSpecToHtml and findSpecProblems read props a model wrote beside the type", () => {
  const looseSpec = {
    root: "title",
    elements: { title: { type: "Heading", level: "1", text: "Cook tonight", children: [] } },
  };
  expect(renderSpecToHtml(looseSpec)).toContain("Cook tonight");
  expect(
    findSpecProblems({ root: "title", elements: { title: { type: "Heading", level: "9", children: [] } } })
  ).not.toEqual([]);
});
