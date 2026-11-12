import { expect, test } from "claude-code/testing";
import type { Audit, NumberedFinding } from "./audit";
import type { NumberedGroup } from "./component-groups";
import { renderAuditPage } from "./audit-page";
import type { Theme } from "./theme";

const THEME: Theme = {
  tokens: [
    {
      name: "primary",
      kind: "color",
      value: "#2563eb",
      source: "src/app/globals.css:14",
      isInferred: false,
    },
  ],
  stack: { framework: "", styling: "", darkMode: "", iconSet: "" },
  components: [],
  inconsistencies: ["Two button heights"],
};

const HARDCODED_COLOR: NumberedFinding = {
  number: 1,
  category: "hardcoded",
  severity: "error",
  title: "Hardcoded color #2563EB",
  detail: "It has the same value as the primary token.",
  fix: "Use the primary token (--primary).",
  file: "src/components/<Button>.tsx",
  lines: [3, 9],
  value: "#2563EB",
};

const HARDCODED_FONT: NumberedFinding = {
  number: 2,
  category: "hardcoded",
  severity: "warning",
  title: "Hardcoded font Georgia",
  detail: "No font token has this value.",
  fix: "Add a font token for it, or use the nearest existing one.",
  file: "src/components/quote.tsx",
  lines: [],
  value: "Georgia",
};

const TYPOGRAPHY_NOTE: NumberedFinding = {
  number: 3,
  category: "typography",
  severity: "note",
  title: "Three <h2> sizes",
  detail: "Page titles use 24px, 28px & 32px.",
  fix: 'Pick one size for "h2".',
  lines: [],
};

const ACCESSIBILITY_ERROR: NumberedFinding = {
  number: 4,
  category: "accessibility",
  severity: "error",
  title: "foreground on background is 4.48:1 in light mode",
  detail: "WCAG AA asks for 4.5:1 for body text.",
  fix: "Change one of the two until the pair reaches 4.5:1.",
  file: "src/app/globals.css",
  lines: [7],
};

const AUDIT: Audit = {
  project: "acme <notes>",
  files: ["src/components/button.tsx", "src/components/quote.tsx"],
  theme: THEME,
  componentGroups: [],
  findings: [
    HARDCODED_COLOR,
    HARDCODED_FONT,
    TYPOGRAPHY_NOTE,
    ACCESSIBILITY_ERROR,
  ],
};

const countOccurrences = (text: string, searchedText: string) =>
  text.split(searchedText).length - 1;

test("the page names the project and counts findings per severity and per category", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain(
    "<title>Design audit · acme &lt;notes&gt;</title>"
  );
  expect(pageHtml).toContain('<p class="eyebrow">Design audit</p>');
  expect(pageHtml).toContain("<h1>acme &lt;notes&gt;</h1>");
  expect(pageHtml).toContain("4 findings in 2 files");
  expect(pageHtml).toContain(
    '<ul class="counts"><li>Errors <strong>2</strong></li><li>Warnings <strong>1</strong></li><li>Notes <strong>1</strong></li><li>Hardcoded values <strong>2</strong></li><li>Typography <strong>1</strong></li><li>Accessibility <strong>1</strong></li></ul>'
  );
});

test("a filter tab per category with findings, and one for all of them", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain('<div role="tablist" aria-label="Categories">');
  expect(countOccurrences(pageHtml, 'role="tab"')).toBe(4);
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-all" aria-controls="panel-hardcoded panel-typography panel-accessibility" aria-selected="true" tabindex="0">All · 4</button>'
  );
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-hardcoded" aria-controls="panel-hardcoded" aria-selected="false" tabindex="-1">Hardcoded values · 2</button>'
  );
  expect(pageHtml).not.toContain('id="tab-components"');
  expect(pageHtml).not.toContain('id="panel-theme"');
});

test("findings are grouped in panels by category, in their numbered order, all shown at first", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain(
    '<section role="tabpanel" id="panel-hardcoded" aria-labelledby="tab-hardcoded"><h2>Hardcoded values</h2>'
  );
  expect(countOccurrences(pageHtml, 'role="tabpanel"')).toBe(3);
  expect(pageHtml).not.toContain(" hidden>");
  const titlePositions = AUDIT.findings.map((finding) =>
    pageHtml.indexOf(`<span class="number">#${finding.number}</span>`)
  );
  expect(titlePositions).toEqual(
    titlePositions.toSorted((first, second) => first - second)
  );
  expect(titlePositions).not.toContain(-1);
  expect(pageHtml.indexOf('id="panel-hardcoded"')).toBeLessThan(
    pageHtml.indexOf('id="panel-typography"')
  );
  expect(pageHtml.indexOf("#2</span>")).toBeLessThan(
    pageHtml.indexOf('id="panel-typography"')
  );
});

test("a finding shows its severity, title, detail, places, value and fix", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain(
    '<article class="finding"><span class="number">#1</span><span class="pill error">Error</span><h3 class="finding-title">Hardcoded color #2563EB</h3>'
  );
  expect(pageHtml).toContain(
    "<p>It has the same value as the primary token.</p>"
  );
  expect(pageHtml).toContain(
    '<p><span class="swatch" style="background:#2563EB"></span><code>#2563EB</code></p>'
  );
  expect(pageHtml).toContain(
    "<ul><li><code>src/components/&lt;Button&gt;.tsx:3</code></li><li><code>src/components/&lt;Button&gt;.tsx:9</code></li></ul>"
  );
  expect(pageHtml).toContain(
    "<p><strong>Fix:</strong> Use the primary token (--primary).</p>"
  );
});

test("a file without lines is listed alone, and only a color value gets a swatch", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain(
    "<ul><li><code>src/components/quote.tsx</code></li></ul>"
  );
  expect(pageHtml).toContain("<p><code>Georgia</code></p>");
  expect(countOccurrences(pageHtml, 'class="swatch"')).toBe(2);
});

test("every model string is HTML-escaped", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain("Three &lt;h2&gt; sizes");
  expect(pageHtml).toContain("Page titles use 24px, 28px &amp; 32px.");
  expect(pageHtml).toContain("Pick one size for &quot;h2&quot;.");
  expect(pageHtml).not.toContain("<notes>");
  expect(pageHtml).not.toContain("<Button>");
  expect(pageHtml).not.toContain("<h2> sizes");
});

test("an audit with no findings says so and has no filters", () => {
  const pageHtml = renderAuditPage({ ...AUDIT, findings: [] });

  expect(pageHtml).toContain("No findings in 2 files");
  expect(pageHtml).not.toContain('role="tablist"');
  expect(pageHtml).not.toContain('role="tabpanel"');
});

test("the theme panel follows the findings", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml.indexOf('id="theme-heading"')).toBeGreaterThan(
    pageHtml.indexOf('id="panel-accessibility"')
  );
  expect(pageHtml).toContain("<code>--primary</code>");
  expect(pageHtml).toContain("<li>Two button heights</li>");
});

test("the page is self-contained and follows the system color scheme", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain("@media (prefers-color-scheme:dark)");
  expect(pageHtml).toContain(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`
  );
  expect(pageHtml).not.toContain("<link");
  expect(pageHtml).not.toContain("<img");
  expect(pageHtml).not.toContain(' src="');
  expect(pageHtml).not.toContain("<iframe");
});

test("a tab can show several panels, so the All filter needs no script of its own", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).toContain('getAttribute("aria-controls").split(" ")');
});

const FILTER_GROUP: NumberedGroup = {
  number: 1,
  purpose: "Filtering & selecting <results>",
  components: [
    {
      name: "ResultFilter",
      path: "src/search/result-filter.tsx",
      usedIn: 1,
      notes: "A dropdown, no <kbd> support.",
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
    { aspect: "behavior", detail: "Only FilterBar can clear every filter." },
    { aspect: "implementation", detail: "One uses <select>, one a listbox." },
  ],
  recommended: "FilterBar",
  reasoning: "It is used twelve times as often & is keyboard accessible.",
};

const BUTTON_GROUP: NumberedGroup = {
  ...FILTER_GROUP,
  number: 2,
  purpose: "Primary actions",
  recommended: "ResultFilter",
};

const GROUPED_AUDIT: Audit = {
  ...AUDIT,
  componentGroups: [FILTER_GROUP, BUTTON_GROUP],
  findings: AUDIT.findings.map((finding) => ({
    ...finding,
    number: finding.number + 2,
  })),
};

test("same-purpose components come before the findings, numbered in one sequence with them", () => {
  const pageHtml = renderAuditPage(GROUPED_AUDIT);

  expect(pageHtml).toContain(
    '<section role="tabpanel" id="panel-groups" aria-labelledby="tab-groups"><h2>Same-purpose components</h2><article class="finding"><span class="number">#1</span><h3 class="finding-title">Filtering &amp; selecting &lt;results&gt;</h3>'
  );
  expect(pageHtml).toContain(
    '<span class="number">#2</span><h3 class="finding-title">Primary actions</h3>'
  );
  expect(pageHtml.indexOf('id="panel-groups"')).toBeLessThan(
    pageHtml.indexOf('id="panel-hardcoded"')
  );
  expect(pageHtml).toContain('<span class="number">#3</span>');
  expect(countOccurrences(pageHtml, '<span class="number">#1</span>')).toBe(1);
});

test("the groups have their own count and filter tab, and All shows them too", () => {
  const pageHtml = renderAuditPage(GROUPED_AUDIT);

  expect(pageHtml).toContain("4 findings and 2 component groups in 2 files");
  expect(pageHtml).toContain(
    "<li>Notes <strong>1</strong></li><li>Same-purpose components <strong>2</strong></li><li>Hardcoded values <strong>2</strong></li>"
  );
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-all" aria-controls="panel-groups panel-hardcoded panel-typography panel-accessibility" aria-selected="true" tabindex="0">All · 6</button><button type="button" role="tab" id="tab-groups" aria-controls="panel-groups" aria-selected="false" tabindex="-1">Same-purpose components · 2</button>'
  );
});

test("a group lists its components in a table, the recommended one first and marked in words", () => {
  const pageHtml = renderAuditPage(GROUPED_AUDIT);

  expect(pageHtml).toContain(
    '<thead><tr><th scope="col">Component</th><th scope="col">Path</th><th scope="col">Used in</th><th scope="col">Notes</th></tr></thead><tbody><tr><td><strong>FilterBar</strong><span class="pill recommended">Recommended</span></td><td><code>src/ui/filter-bar.tsx</code></td><td>12 files</td><td>Chips with a clear-all action.</td></tr><tr><td><strong>ResultFilter</strong></td><td><code>src/search/result-filter.tsx</code></td><td>1 file</td><td>A dropdown, no &lt;kbd&gt; support.</td></tr></tbody>'
  );
  expect(countOccurrences(pageHtml, "Recommended</span>")).toBe(2);
  expect(pageHtml).toContain(
    '<tbody><tr><td><strong>ResultFilter</strong><span class="pill recommended">Recommended</span></td>'
  );
});

test("a group lists its discrepancies by aspect, then why the recommended one wins", () => {
  const pageHtml = renderAuditPage(GROUPED_AUDIT);

  expect(pageHtml).toContain(
    "<h4>Discrepancies</h4><ul><li><strong>Look:</strong> Chips in one, a dropdown in the other.</li><li><strong>Behavior:</strong> Only FilterBar can clear every filter.</li><li><strong>Implementation:</strong> One uses &lt;select&gt;, one a listbox.</li></ul><h4>Why this one</h4><p>It is used twelve times as often &amp; is keyboard accessible.</p></article>"
  );
  expect(pageHtml).not.toContain("<results>");
  expect(pageHtml).not.toContain("<kbd>");
  expect(pageHtml).not.toContain("<select>");
});

test("groups alone still get the counts and the filters", () => {
  const pageHtml = renderAuditPage({ ...GROUPED_AUDIT, findings: [] });

  expect(pageHtml).toContain("No findings and 2 component groups in 2 files");
  expect(pageHtml).toContain(
    '<button type="button" role="tab" id="tab-all" aria-controls="panel-groups" aria-selected="true" tabindex="0">All · 2</button>'
  );
  expect(countOccurrences(pageHtml, 'role="tabpanel"')).toBe(1);
});

test("an audit without groups has no trace of them", () => {
  const pageHtml = renderAuditPage(AUDIT);

  expect(pageHtml).not.toContain("Same-purpose components");
  expect(pageHtml).not.toContain("panel-groups");
  expect(pageHtml).not.toContain("component group");
});
