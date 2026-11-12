import { expect, test } from "claude-code/testing";
import {
  renderDesignPage,
  renderVariantDocument,
  type Design,
  type DesignVariant,
} from "./design-page";
import type { Theme, ThemeToken } from "./theme";

const PROPOSED_TOKEN: ThemeToken = {
  name: "accent-soft",
  kind: "color",
  value: "#e8f0ff",
  source: "proposed",
  isInferred: false,
};

const THEME: Theme = {
  tokens: [
    {
      name: "surface",
      kind: "color",
      value: "#ffffff",
      darkValue: "#0b0b0c",
      source: "src/app/globals.css:4",
      isInferred: false,
    },
    {
      name: "tracker",
      kind: "color",
      value: "url(https://tracker.example/pixel)",
      source: "src/<legacy>.css:1",
      isInferred: true,
    },
    {
      name: "radius-md",
      kind: "radius",
      value: "8px",
      source: "src/app/globals.css:9",
      isInferred: false,
    },
  ],
  stack: {
    framework: "Next.js",
    styling: "Tailwind v4",
    darkMode: "class",
    iconSet: "lucide",
  },
  components: [
    { name: "Button", path: "src/components/ui/button.tsx", variants: [] },
  ],
  inconsistencies: ["Five grays within 2% of <each other>"],
};

const FIRST_VARIANT: DesignVariant = {
  name: "Calm <list>",
  rationale: "Groups settings & drops the sidebar.",
  html: '<main class="page" title="x"><script>alert(1)</script>Settings</main>',
  css: ".page{background:var(--surface);border-radius:var(--radius-md)}",
  kept: ["Every field <and> its label"],
  changed: ["Sidebar becomes tabs"],
  newTokens: [],
};

const SECOND_VARIANT: DesignVariant = {
  name: "Dense grid",
  rationale: "Two columns on desktop.",
  html: "<main>Grid</main>",
  css: "main{background:var(--accent-soft)}",
  kept: [],
  changed: [],
  newTokens: [
    PROPOSED_TOKEN,
    { ...PROPOSED_TOKEN, name: "accent-two" },
    { ...PROPOSED_TOKEN, name: "accent-three" },
    { ...PROPOSED_TOKEN, name: "accent-four" },
  ],
};

const REDESIGN: Design = {
  project: "acme <notes>",
  mode: "redesign",
  subject: 'src/app/settings/page.tsx "<main>"',
  theme: THEME,
  variants: [FIRST_VARIANT, SECOND_VARIANT],
};

const NEW_DESIGN: Design = {
  ...REDESIGN,
  mode: "new",
  subject: "A pricing page with three plans",
  theme: {
    ...THEME,
    tokens: THEME.tokens.map((token) => ({ ...token, darkValue: undefined })),
  },
};

const countOccurrences = (text: string, searchedText: string) =>
  text.split(searchedText).length - 1;

test("the page has one tab and one panel per variant, the first one open", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain('<div role="tablist" aria-label="Variants">');
  expect(countOccurrences(pageHtml, 'role="tab"')).toBe(2);
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-a" aria-controls="panel-a" aria-selected="true" tabindex="0">A · Calm &lt;list&gt;</button>'
  );
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-b" aria-controls="panel-b" aria-selected="false" tabindex="-1">B · Dense grid</button>'
  );
  expect(pageHtml).toContain(
    '<section role="tabpanel" id="panel-a" aria-labelledby="tab-a">'
  );
  expect(pageHtml).toContain(
    '<section role="tabpanel" id="panel-b" aria-labelledby="tab-b" hidden>'
  );
});

test("each variant renders in a sandboxed iframe that cannot run scripts", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(countOccurrences(pageHtml, "<iframe ")).toBe(2);
  expect(countOccurrences(pageHtml, '<iframe sandbox="" ')).toBe(2);
  expect(pageHtml).not.toContain("allow-scripts");
  expect(pageHtml).toContain('title="Variant A: Calm &lt;list&gt;"');
});

test("variant markup reaches the page only attribute-escaped inside srcdoc", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).not.toContain("<script>alert(1)</script>");
  expect(pageHtml).toContain(
    "&lt;main class=&quot;page&quot; title=&quot;x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;Settings&lt;/main&gt;"
  );
  expect(pageHtml).toContain('srcdoc="&lt;!doctype html&gt;');
});

test("a variant document holds the theme variables, then the variant's own CSS and HTML", () => {
  const variantDocument = renderVariantDocument(THEME, FIRST_VARIANT);

  expect(
    variantDocument.startsWith('<!doctype html><html data-theme="light">')
  ).toBe(true);
  expect(variantDocument).toContain("--surface:#ffffff");
  expect(variantDocument).toContain(
    ':root[data-theme="dark"]{color-scheme:dark;--surface:#0b0b0c}'
  );
  expect(variantDocument).toContain(`<style>${FIRST_VARIANT.css}</style>`);
  expect(variantDocument).toContain(`<body>${FIRST_VARIANT.html}</body>`);
  expect(variantDocument).toContain(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`
  );
});

test("proposed tokens are variables of their own variant only, three at most", () => {
  const firstDocument = renderVariantDocument(THEME, FIRST_VARIANT);
  const secondDocument = renderVariantDocument(THEME, SECOND_VARIANT);
  const pageHtml = renderDesignPage(REDESIGN);

  expect(firstDocument).not.toContain("--accent-soft");
  expect(secondDocument).toContain("--accent-soft:#e8f0ff");
  expect(secondDocument).toContain("--accent-three:#e8f0ff");
  expect(secondDocument).not.toContain("--accent-four");
  expect(countOccurrences(pageHtml, "<h3>Proposed additions</h3>")).toBe(1);
  expect(pageHtml).toContain("<code>--accent-three</code>");
  expect(pageHtml).not.toContain("<code>--accent-four</code>");
});

test("every other model string is HTML-escaped", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain("<title>Design · acme &lt;notes&gt;</title>");
  expect(pageHtml).toContain("<h1>acme &lt;notes&gt;</h1>");
  expect(pageHtml).toContain(
    "src/app/settings/page.tsx &quot;&lt;main&gt;&quot;"
  );
  expect(pageHtml).toContain("Groups settings &amp; drops the sidebar.");
  expect(pageHtml).toContain("Every field &lt;and&gt; its label");
  expect(pageHtml).toContain("src/&lt;legacy&gt;.css:1");
  expect(pageHtml).toContain("Five grays within 2% of &lt;each other&gt;");
  expect(pageHtml).not.toContain("<notes>");
  expect(pageHtml).not.toContain("<legacy>");
});

test("a redesign names its target and lists what each variant kept and changed", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain('<p class="eyebrow">Redesign</p>');
  expect(pageHtml).toContain("Target");
  expect(pageHtml).toContain(
    "<h3>Kept</h3><ul><li>Every field &lt;and&gt; its label</li></ul>"
  );
  expect(pageHtml).toContain(
    "<h3>Changed</h3><ul><li>Sidebar becomes tabs</li></ul>"
  );
  expect(countOccurrences(pageHtml, "<h3>Kept</h3>")).toBe(1);
});

test("a new design names its brief and has no kept or changed lists", () => {
  const pageHtml = renderDesignPage(NEW_DESIGN);

  expect(pageHtml).toContain('<p class="eyebrow">New design</p>');
  expect(pageHtml).toContain("Brief");
  expect(pageHtml).toContain("A pricing page with three plans");
  expect(pageHtml).not.toContain("<h3>Kept</h3>");
  expect(pageHtml).not.toContain("<h3>Changed</h3>");
});

test("Use this carries the apply command of its variant letter", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain(
    '<code id="command-a">/design apply A</code><button type="button" class="button primary" data-copies="command-a">Use this</button>'
  );
  expect(pageHtml).toContain(
    '<code id="command-b">/design apply B</code><button type="button" class="button primary" data-copies="command-b">Use this</button>'
  );
});

test("the width toggle is always there, the dark toggle only with dark values", () => {
  const darkThemePage = renderDesignPage(REDESIGN);
  const lightOnlyPage = renderDesignPage(NEW_DESIGN);

  expect(darkThemePage).toContain(
    '<button type="button" class="button secondary" data-width="desktop" aria-pressed="true">Desktop</button>'
  );
  expect(darkThemePage).toContain(
    '<button type="button" class="button secondary" data-width="mobile" aria-pressed="false">Mobile</button>'
  );
  expect(lightOnlyPage).toContain('data-width="mobile"');
  expect(darkThemePage).toContain(
    '<button type="button" class="button secondary" id="toggle-dark" aria-pressed="false">Dark</button>'
  );
  expect(lightOnlyPage).not.toContain('id="toggle-dark"');
});

test("the theme panel groups tokens by kind with value, source and an inferred mark", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain("<h3>color</h3>");
  expect(pageHtml).toContain("<h3>radius</h3>");
  expect(pageHtml).not.toContain("<h3>shadow</h3>");
  expect(pageHtml.indexOf("<h3>color</h3>")).toBeLessThan(
    pageHtml.indexOf("<h3>radius</h3>")
  );
  expect(pageHtml).toContain("<code>--radius-md</code>");
  expect(pageHtml).toContain("<td>8px</td>");
  expect(pageHtml).toContain("<td><code>src/app/globals.css:9</code></td>");
  expect(countOccurrences(pageHtml, '<span class="pill">inferred</span>')).toBe(
    1
  );
  expect(pageHtml).toContain(
    "<h3>Inconsistencies</h3><ul><li>Five grays within 2% of &lt;each other&gt;</li></ul>"
  );
});

test("a color gets a swatch for its light and dark values, unless the value is not a plain color", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain(
    '<span class="swatch" style="background:#ffffff"></span>#ffffff'
  );
  expect(pageHtml).toContain(
    '<span class="swatch" style="background:#0b0b0c"></span>#0b0b0c'
  );
  expect(pageHtml).not.toContain('style="background:url(');
  expect(pageHtml).not.toContain('style="background:8px');
  expect(pageHtml).toContain("url(https://tracker.example/pixel)");
});

test("the page is self-contained and follows the system color scheme", () => {
  const pageHtml = renderDesignPage(REDESIGN);

  expect(pageHtml).toContain("@media (prefers-color-scheme:dark)");
  expect(pageHtml).toContain(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`
  );
  expect(pageHtml).not.toContain("<link");
  expect(pageHtml).not.toContain("<img");
  expect(pageHtml).not.toContain(' src="');
  expect(pageHtml).not.toContain("@import");
});
