import { expect, test } from "claude-code/testing";
import {
  PAGE_POLICY,
  escapeHtml,
  renderVariantDocument,
  type Design,
  type DesignVariant,
} from "./design-page";
import {
  readGalleryEntry,
  renderGalleryPage,
  type GalleryEntry,
} from "./gallery-page";
import type { Theme } from "./theme";

const THEME: Theme = {
  tokens: [
    {
      name: "primary",
      kind: "color",
      value: "#2563eb",
      darkValue: "#60a5fa",
      source: "src/app/globals.css:2",
      isInferred: false,
    },
  ],
  stack: {
    framework: "Next.js",
    styling: "Tailwind v4",
    darkMode: "class",
    iconSet: "lucide",
  },
  components: [],
  inconsistencies: [],
};

const buildVariant = (name: string): DesignVariant => ({
  name,
  rationale: "One centered card.",
  html: `<main>${name}</main>`,
  css: "main{color:var(--primary)}",
  kept: [],
  changed: [],
  newTokens: [],
  restyledTokens: [],
});

const NEW_DESIGN: Design = {
  project: "acme-notes",
  mode: "new",
  subject: "A pricing page",
  theme: THEME,
  variants: [buildVariant("Single card"), buildVariant("Two columns")],
};

const REDESIGN: Design = {
  project: "acme-notes",
  mode: "redesign",
  subject: "src/app/settings/page.tsx",
  theme: THEME,
  variants: [
    buildVariant("Sidebar"),
    buildVariant("Tabs"),
    buildVariant("Stacked"),
  ],
};

const designEntry = (
  name: string,
  savedAt: string,
  design: Design
): GalleryEntry => ({
  kind: "design",
  name,
  savedAt,
  project: design.project,
  design,
});

const auditEntry = (
  name: string,
  savedAt: string,
  severities: string[],
  groupCount: number
): GalleryEntry => ({
  kind: "audit",
  name,
  savedAt,
  project: "acme-notes",
  severities,
  groupCount,
});

test("the gallery lists designs and audits newest first, each with its own page link", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
    auditEntry("audit-2026-11-12-120000", "2026-11-12T12:00:00Z", [], 0),
    designEntry("design-2026-11-11-093000", "2026-11-11T09:30:00Z", REDESIGN),
  ]);

  const newestIndex = html.indexOf('href="audit-2026-11-12-120000.html"');
  const middleIndex = html.indexOf('href="design-2026-11-11-093000.html"');
  const oldestIndex = html.indexOf('href="design-2026-11-10-090000.html"');
  expect(newestIndex).toBeGreaterThan(0);
  expect(newestIndex).toBeLessThan(middleIndex);
  expect(middleIndex).toBeLessThan(oldestIndex);
});

test("a redesign card shows its mode, subject, variant chips and apply command", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-11-093000", "2026-11-11T09:30:00Z", REDESIGN),
  ]);

  expect(html).toContain('<span class="pill">Redesign</span>');
  expect(html).toContain(
    '<h2 class="card-title">src/app/settings/page.tsx</h2>'
  );
  expect(html).toContain("B · Tabs");
  expect(html).toContain(
    'data-command="/ui-design apply design-2026-11-11-093000 B"'
  );
  expect(html).toContain(
    "<code data-command-output>/ui-design apply design-2026-11-11-093000 A</code>"
  );
  expect(html).toContain('href="design-2026-11-11-093000.html"');
  expect(html).toContain("2026-11-11 · 09:30 UTC");
});

test("a new design card carries the New pill", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
  ]);

  expect(html).toContain('<span class="pill">New</span>');
  expect(html).toContain('data-mode="new"');
});

test("every variant gets a sandboxed, lazy thumbnail, and only the first one is shown", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-11-093000", "2026-11-11T09:30:00Z", REDESIGN),
  ]);

  expect(html.match(/<iframe /g)).toHaveLength(3);
  expect(
    html.match(/<iframe sandbox="" loading="lazy" tabindex="-1" /g)
  ).toHaveLength(3);
  expect(html.match(/ hidden><\/iframe>/g)).toHaveLength(2);
  expect(html).toContain(
    `srcdoc="${escapeHtml(renderVariantDocument(THEME, REDESIGN.variants[0]!))}"`
  );
});

test("the thumbnails sit inside an aria-hidden container, so screen readers skip them", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
  ]);

  expect(html).toContain('<div class="thumb" aria-hidden="true" data-thumb>');
});

test("saved text is escaped wherever it appears", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", {
      ...NEW_DESIGN,
      project: "<b>acme</b>",
      subject: '<img src=x onerror="alert(1)">',
    }),
  ]);

  expect(html).toContain("&lt;b&gt;acme&lt;/b&gt;");
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(html).not.toContain("<b>acme</b>");
  expect(html).not.toContain('<img src=x onerror="alert(1)">');
});

test("an audit card shows counts by severity and component groups, with a link and no thumbnail", () => {
  const html = renderGalleryPage([
    auditEntry(
      "audit-2026-11-12-120000",
      "2026-11-12T12:00:00Z",
      ["error", "error", "warning"],
      1
    ),
  ]);

  expect(html).toContain('<span class="pill">Audit</span>');
  expect(html).toContain("Errors <strong>2</strong>");
  expect(html).toContain("Warnings <strong>1</strong>");
  expect(html).toContain("Notes <strong>0</strong>");
  expect(html).toContain("Component groups <strong>1</strong>");
  expect(html).toContain('href="audit-2026-11-12-120000.html"');
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("<code data-command-output>");
});

test("the count line says how many designs and audits are saved", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
    designEntry("design-2026-11-11-093000", "2026-11-11T09:30:00Z", REDESIGN),
    auditEntry("audit-2026-11-12-120000", "2026-11-12T12:00:00Z", [], 0),
  ]);

  expect(html).toContain("2 designs and 1 audit saved.");
  expect(html).toContain(
    '<p class="muted" id="result-count" aria-live="polite">Showing 3 of 3</p>'
  );
});

test("the toolbar offers a labelled search, the four filters and the sort toggle", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
  ]);

  expect(html).toContain('<label class="search">');
  expect(html).toContain('id="gallery-search"');
  expect(html).toContain('data-filter="all" aria-pressed="true"');
  expect(html).toContain('data-filter="new" aria-pressed="false"');
  expect(html).toContain('data-filter="redesign" aria-pressed="false"');
  expect(html).toContain('data-filter="audit" aria-pressed="false"');
  expect(html).toContain('id="gallery-sort" aria-pressed="false"');
  expect(html).toContain('id="no-match" hidden');
});

test("with nothing saved the gallery says so and offers no toolbar", () => {
  const html = renderGalleryPage([]);

  expect(html).toContain("No designs yet. Run /ui-design new");
  expect(html).not.toContain('id="gallery-search"');
  expect(html).not.toContain("<article");
});

test("the page keeps the house policy and loads nothing from the network", () => {
  const html = renderGalleryPage([
    designEntry("design-2026-11-10-090000", "2026-11-10T09:00:00Z", NEW_DESIGN),
    auditEntry("audit-2026-11-12-120000", "2026-11-12T12:00:00Z", ["note"], 0),
  ]);

  expect(html).toContain(`content="${PAGE_POLICY}"`);
  expect(html).not.toMatch(/(src|href)="https?:/);
  expect(html).not.toContain("<link");
  expect(html).not.toContain("@import");
});

const SAVED_DESIGN_TEXT = JSON.stringify({
  project: "acme-notes",
  mode: "redesign",
  subject: "src/app/settings/page.tsx",
  theme: THEME,
  variants: [
    {
      name: "Sidebar",
      rationale: "One centered card.",
      html: "<main>Sidebar</main>",
      css: "main{color:var(--primary)}",
      kept: ["Every field"],
      changed: ["The sidebar moves"],
      newTokens: [],
      restyledTokens: [],
    },
  ],
});

test("readGalleryEntry reads a saved design, taking its time from the file name", () => {
  const entry = readGalleryEntry(
    "design-2026-11-11-093000.json",
    SAVED_DESIGN_TEXT
  );

  expect(entry?.kind).toBe("design");
  expect(entry?.name).toBe("design-2026-11-11-093000");
  expect(entry?.savedAt).toBe("2026-11-11T09:30:00Z");
  expect(entry?.project).toBe("acme-notes");
});

test("readGalleryEntry reads an audit saved with the older four-digit stamp", () => {
  const entry = readGalleryEntry(
    "audit-2026-11-11-0930.json",
    JSON.stringify({
      project: "acme-notes",
      files: ["src/ui/button.tsx"],
      theme: THEME,
      componentGroups: [{ purpose: "Filtering" }],
      findings: [{ severity: "error" }, { severity: "note" }],
    })
  );

  expect(entry).toEqual({
    kind: "audit",
    name: "audit-2026-11-11-0930",
    savedAt: "2026-11-11T09:30:00Z",
    project: "acme-notes",
    severities: ["error", "note"],
    groupCount: 1,
  });
});

test("readGalleryEntry skips a file it cannot use", () => {
  expect(
    readGalleryEntry("design-2026-11-11-093000.json", undefined)
  ).toBeUndefined();
  expect(
    readGalleryEntry("design-2026-11-11-093000.json", "{not json")
  ).toBeUndefined();
  expect(
    readGalleryEntry("design-2026-11-11-093000.json", "null")
  ).toBeUndefined();
  expect(readGalleryEntry("notes.json", SAVED_DESIGN_TEXT)).toBeUndefined();
  expect(
    readGalleryEntry(
      "design-2026-11-11-093000.json",
      SAVED_DESIGN_TEXT.replace('"redesign"', '"sideways"')
    )
  ).toBeUndefined();
  expect(
    readGalleryEntry(
      "design-2026-11-11-093000.json",
      JSON.stringify({
        project: "acme-notes",
        mode: "new",
        theme: THEME,
        variants: [],
      })
    )
  ).toBeUndefined();
  expect(
    readGalleryEntry(
      "audit-2026-11-11-093000.json",
      JSON.stringify({
        project: "acme-notes",
        theme: THEME,
        componentGroups: [],
      })
    )
  ).toBeUndefined();
});
