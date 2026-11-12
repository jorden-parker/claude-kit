import { expect, test } from "bun:test";
import {
  buildCatalogPrompt,
  catalog,
  findSpecProblems,
  renderCatalogCss,
  renderSpecToHtml,
  renderStylesheet,
} from "./catalog";
import { readReplySpec } from "./variant-reply";

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
  const html = renderSpecToHtml(FULL_SPEC);
  expect(html.startsWith('<main class="page"><div class="page-inner page-wide">')).toBe(true);
  expect(html).toContain('<h1 class="heading heading-1">Cook &lt;tonight&gt;</h1>');
  expect(html).toContain('<section class="card card-accent">');
  expect(html).toContain('<strong class="stat-value">42</strong>');
});

test("renderSpecToHtml renders partial specs without throwing", () => {
  expect(renderSpecToHtml({})).toBe("");
  expect(renderSpecToHtml({ root: "page" })).toBe("");
  expect(renderSpecToHtml({ root: "page", elements: { page: { type: "Page", children: ["later"] } } })).toBe(
    '<main class="page"><div class="page-inner page-wide"></div></main>'
  );
  expect(renderSpecToHtml({ root: "constructor", elements: {} })).toBe("");
  expect(renderSpecToHtml({ root: "a", elements: { a: null as never } })).toBe("");
  expect(renderSpecToHtml({ root: "a", elements: { a: { type: "Stack", children: ["a"] } } })).toContain(
    '<div class="stack gap-md align-stretch"></div>'
  );
});

test("renderSpecToHtml keeps the valid props of an element when one prop is wrong", () => {
  const html = renderSpecToHtml({
    root: "save",
    elements: { save: { type: "Button", props: { tone: "neon", label: "Save" } } },
  });
  expect(html).toContain('<button type="button" class="button button-secondary">Save</button>');
});

test("renderSpecToHtml reads numbers a model wrote for text options", () => {
  const html = renderSpecToHtml({
    root: "title",
    elements: { title: { type: "Heading", props: { level: 1, text: "Cook" } } },
  });
  expect(html).toContain('<h1 class="heading heading-1">Cook</h1>');
});

test("renderSpecToHtml flattens nested child lists and shows the children of an unknown component", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: [["tabs"], ["title"]] as never },
      tabs: { type: "Tabs", children: ["title"] },
      title: { type: "Heading", props: { text: "Cook" } },
    },
  });
  expect(html.split("Cook")).toHaveLength(3);
});

test("renderSpecToHtml wraps a root that is not a Page in a page", () => {
  expect(
    renderSpecToHtml({ root: "title", elements: { title: { type: "Heading", props: { text: "Cook" } } } })
  ).toBe('<main class="page"><div class="page-inner page-wide"><h2 class="heading heading-2">Cook</h2></div></main>');
});

test("renderSpecToHtml draws a chart as bars sized by their values and a table with its rows", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["chart", "table"] },
      chart: { type: "Chart", props: { title: "Revenue", labels: ["Jan", "Feb"], values: [50, 100] } },
      table: { type: "Table", props: { columns: ["Plan", "Seats"], rows: [["Pro", 12]] } },
    },
  });
  expect(html).toContain('style="height:50%"');
  expect(html).toContain('style="height:100%"');
  expect(html).toContain("<th scope=\"col\">Plan</th>");
  expect(html).toContain("<td>12</td>");
});

test("findSpecProblems accepts a full spec and small slips, and refuses a spec that shows next to nothing", () => {
  expect(findSpecProblems(FULL_SPEC)).toEqual([]);
  expect(
    findSpecProblems({
      ...FULL_SPEC,
      elements: { ...FULL_SPEC.elements, title: { type: "Heading", props: { level: "9", text: "Cook" } } },
    })
  ).toEqual([]);
  expect(findSpecProblems({ root: "page" })).toContainEqual(expect.stringContaining("/root"));
  expect(findSpecProblems({})).toContainEqual(expect.stringContaining("/root"));
  expect(
    findSpecProblems({ root: "page", elements: { page: { type: "Page", children: ["ghost"] } } })
  ).toContainEqual(expect.stringContaining("only 1"));
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
    expect(css).not.toMatch(RAW_COLOR);
});

test("renderStylesheet puts the theme tokens on :root before the catalog styles", () => {
  const stylesheet = renderStylesheet(THEME_TOKENS);
  expect(stylesheet.startsWith(":root{--background:#ffffff;--foreground:#111827;")).toBe(true);
  expect(stylesheet).toContain("--font-sans:system-ui, sans-serif");
  expect(stylesheet).toContain(renderCatalogCss(THEME_TOKENS));
});

test("the catalog holds the layout, content and data components", () => {
  expect(catalog.componentNames).toHaveLength(21);
  expect(catalog.componentNames).toContain("Chart");
});

test("buildCatalogPrompt lists the components and the reply shape, without json-render's state features", () => {
  const prompt = buildCatalogPrompt(THEME_TOKENS);
  expect(prompt).toContain("- Chart: {");
  expect(prompt).toContain("NAME: <two to four words>");
  expect(prompt).toContain('{"op":"add","path":"/root","value":"page"}');
  expect(prompt).toContain("primary, primary-foreground");
  expect(prompt).not.toContain("$state");
  expect(prompt).not.toContain("```");
  expect(prompt.length).toBeLessThan(8000);
});

test("the example spec in the prompt renders with no problems", () => {
  const exampleSpec = readReplySpec(buildCatalogPrompt(THEME_TOKENS).split("EXAMPLE")[1]!);
  expect(findSpecProblems(exampleSpec)).toEqual([]);
  expect(renderSpecToHtml(exampleSpec)).toContain("</table>");
});

test("renderSpecToHtml reads props a model wrote beside the type", () => {
  const looseSpec = {
    root: "title",
    elements: { title: { type: "Heading", level: "1", text: "Cook tonight", children: [] } },
  };
  expect(renderSpecToHtml(looseSpec)).toContain('<h1 class="heading heading-1">Cook tonight</h1>');
});
