import { expect, test } from "claude-code/testing";
import {
  auditProject,
  compareFindings,
  describeFindingCounts,
  describeProgress,
  numberFindings,
  pickPreviousAuditName,
  readPreviousFindings,
  type AuditFinding,
} from "./audit";
import type { Theme, ThemeToken } from "./theme";

const buildToken = (
  name: string,
  kind: ThemeToken["kind"],
  value: string,
  otherFields: Partial<ThemeToken> = {}
): ThemeToken => ({
  name,
  kind,
  value,
  source: "src/app/globals.css:1",
  isInferred: false,
  ...otherFields,
});

const buildTheme = (tokens: ThemeToken[]): Theme => ({
  tokens,
  stack: { framework: "", styling: "", darkMode: "", iconSet: "" },
  components: [],
  inconsistencies: [],
});

const PLAIN_THEME = buildTheme([
  buildToken("primary", "color", "#2563eb", {
    source: "src/app/globals.css:14",
  }),
  buildToken("font-sans", "font", "Inter, sans-serif"),
  buildToken("text-sm", "text-size", "0.875rem"),
]);

const BUTTON_FILE = {
  path: "src/components/button.tsx",
  text: [
    'const buttonStyle = { color: "#2563EB", background: "#f0f" };',
    'const labelStyle = { color: "#2563eb", fontFamily: "Inter, sans-serif" };',
    'const hintStyle = { fontSize: "0.875rem", padding: "7px" };',
  ].join("\n"),
};

test("a literal that equals a token is an error whose fix names the token", () => {
  const findings = auditProject(PLAIN_THEME, [BUTTON_FILE]);

  expect(findings[0]).toEqual({
    category: "hardcoded",
    severity: "error",
    title: "Hardcoded color #2563EB",
    detail: "It has the same value as the primary token.",
    fix: "Use the primary token (--primary).",
    file: "src/components/button.tsx",
    lines: [1, 2],
    value: "#2563EB",
  });
  expect(findings.map((finding) => finding.fix)).toContain(
    "Use the font-sans token (--font-sans)."
  );
  expect(findings.map((finding) => finding.fix)).toContain(
    "Use the text-sm token (--text-sm)."
  );
});

test("a named color that equals a token is an error, and one that matches none is a warning", () => {
  const namedTheme = buildTheme([
    buildToken("ink", "color", "black", { source: "src/app/globals.css:3" }),
  ]);
  const cardFile = {
    path: "src/components/card.tsx",
    text: 'const cardStyle = { color: "black", background: "white" };',
  };

  const findings = auditProject(namedTheme, [cardFile]);

  expect(
    findings.map(({ title, severity, fix }) => ({ title, severity, fix }))
  ).toEqual([
    {
      title: "Hardcoded color black",
      severity: "error",
      fix: "Use the ink token (--ink).",
    },
    {
      title: "Hardcoded color white",
      severity: "warning",
      fix: "Add a color token for it, or use the nearest existing one.",
    },
  ]);
});

test("a literal that matches no token is a warning that asks for a token", () => {
  const findings = auditProject(PLAIN_THEME, [BUTTON_FILE]);

  expect(findings[1]).toEqual({
    category: "hardcoded",
    severity: "warning",
    title: "Hardcoded color #f0f",
    detail: "No color token has this value.",
    fix: "Add a color token for it, or use the nearest existing one.",
    file: "src/components/button.tsx",
    lines: [1],
    value: "#f0f",
  });
});

test("a literal that equals a token's dark value also names the token", () => {
  const theme = buildTheme([
    buildToken("surface", "color", "#ffffff", { darkValue: "#0b0b0c" }),
  ]);

  const findings = auditProject(theme, [
    { path: "src/card.css", text: ".card{background:#0B0B0C}" },
  ]);

  expect(findings[0]?.severity).toBe("error");
  expect(findings[0]?.fix).toBe("Use the surface token (--surface).");
});

test("spacing literals count only when the theme has space tokens", () => {
  const spacedTheme = buildTheme([buildToken("space-2", "space", "8px")]);
  const spacingFile = { path: "src/card.css", text: ".card{padding:8px 7px}" };

  expect(auditProject(PLAIN_THEME, [spacingFile])).toEqual([]);
  expect(
    auditProject(spacedTheme, [spacingFile]).map((finding) => [
      finding.title,
      finding.severity,
    ])
  ).toEqual([
    ["Hardcoded spacing 8px", "error"],
    ["Hardcoded spacing 7px", "warning"],
  ]);
});

test("the files the theme's tokens come from are not scanned", () => {
  const themeFile = {
    path: "./src/app/globals.css",
    text: ":root{--primary:#2563eb;--other:#123456}",
  };

  expect(auditProject(PLAIN_THEME, [themeFile])).toEqual([]);
});

test("tokens of one kind with the same light and dark value are flagged once", () => {
  const theme = buildTheme([
    buildToken("primary", "color", "#2563EB", { source: "src/theme.css:3" }),
    buildToken("brand", "color", "#2563eb"),
    buildToken("ring", "color", "#2563eb", { darkValue: "#60a5fa" }),
    buildToken("radius-blue", "radius", "#2563eb"),
  ]);

  expect(auditProject(theme, [])).toEqual([
    {
      category: "theme",
      severity: "warning",
      title: "primary and brand share the value #2563EB",
      detail: "Tokens with one value drift apart when only one is changed.",
      fix: "Keep one token, or make the others refer to it.",
      file: "src/theme.css",
      lines: [3],
      value: "#2563EB",
    },
    {
      category: "theme",
      severity: "warning",
      title: "primary has no dark value",
      detail: "Other color tokens change in dark mode.",
      fix: "Give it a dark value, or confirm it is the same in both modes.",
      file: "src/theme.css",
      lines: [3],
    },
    {
      category: "theme",
      severity: "warning",
      title: "brand has no dark value",
      detail: "Other color tokens change in dark mode.",
      fix: "Give it a dark value, or confirm it is the same in both modes.",
      file: "src/app/globals.css",
      lines: [1],
    },
  ]);
});

test("a foreground pair under 4.5:1 is an accessibility error, in each mode it fails", () => {
  const theme = buildTheme([
    buildToken("primary", "color", "#2563eb", { darkValue: "#ffffff" }),
    buildToken("primary-foreground", "color", "#fff", {
      darkValue: "#777",
      source: "src/theme.css:9",
    }),
    buildToken("background", "color", "#ffffff", { darkValue: "#0b0b0c" }),
    buildToken("foreground", "color", "#777777", { darkValue: "#f3f4f6" }),
    buildToken("muted", "color", "oklch(0.9 0 0)", { darkValue: "#111" }),
    buildToken("muted-foreground", "color", "#eee", { darkValue: "#eee" }),
  ]);

  expect(auditProject(theme, [])).toEqual([
    {
      category: "accessibility",
      severity: "error",
      title: "primary-foreground on primary is 4.48:1 in dark mode",
      detail:
        "WCAG AA asks for 4.5:1 for body text. Large text (24px, or 18.66px bold) needs only 3:1, so a pair used only for large text may stay at 3:1.",
      fix: "Change one of the two until the pair reaches 4.5:1.",
      file: "src/theme.css",
      lines: [9],
    },
    {
      category: "accessibility",
      severity: "error",
      title: "foreground on background is 4.48:1 in light mode",
      detail:
        "WCAG AA asks for 4.5:1 for body text. Large text (24px, or 18.66px bold) needs only 3:1, so a pair used only for large text may stay at 3:1.",
      fix: "Change one of the two until the pair reaches 4.5:1.",
      file: "src/app/globals.css",
      lines: [1],
    },
  ]);
});

const buildFinding = (
  category: AuditFinding["category"],
  severity: AuditFinding["severity"],
  title: string
): AuditFinding => ({
  category,
  severity,
  title,
  detail: "",
  fix: "Fix it.",
  lines: [],
});

test("findings are numbered by category, errors first", () => {
  const numberedFindings = numberFindings([
    buildFinding("theme", "warning", "theme warning"),
    buildFinding("hardcoded", "note", "hardcoded note"),
    buildFinding("typography", "error", "typography error"),
    buildFinding("hardcoded", "error", "hardcoded error"),
    buildFinding("hardcoded", "warning", "hardcoded warning"),
  ]);

  expect(
    numberedFindings.map((finding) => [finding.number, finding.title])
  ).toEqual([
    [1, "hardcoded error"],
    [2, "hardcoded warning"],
    [3, "hardcoded note"],
    [4, "typography error"],
    [5, "theme warning"],
  ]);
});

test("the counts line names each category that has findings", () => {
  expect(
    describeFindingCounts([
      buildFinding("theme", "warning", "one"),
      buildFinding("hardcoded", "error", "two"),
      buildFinding("hardcoded", "note", "three"),
    ])
  ).toBe("3 findings: 2 hardcoded, 1 theme.");
  expect(
    describeFindingCounts([buildFinding("components", "note", "one")])
  ).toBe("1 finding: 1 components.");
  expect(describeFindingCounts([])).toBe("No findings.");
});

test("findings are numbered after the entries listed before them", () => {
  const numberedFindings = numberFindings(
    [
      buildFinding("theme", "warning", "theme warning"),
      buildFinding("hardcoded", "error", "hardcoded error"),
    ],
    2
  );

  expect(
    numberedFindings.map((finding) => [finding.number, finding.title])
  ).toEqual([
    [3, "hardcoded error"],
    [4, "theme warning"],
  ]);
});

test("the counts line ends with the component groups, when there are any", () => {
  expect(
    describeFindingCounts([buildFinding("theme", "warning", "one")], 2)
  ).toBe("1 finding: 1 theme. 2 component groups.");
  expect(describeFindingCounts([], 1)).toBe("No findings. 1 component group.");
});

test("a literal that equals several tokens names them all, since only the role tells them apart", () => {
  const theme = buildTheme([
    buildToken("background", "color", "#ffffff"),
    buildToken("card", "color", "#fff"),
    buildToken("primary-foreground", "color", "#FFFFFF"),
    buildToken("radius-white", "radius", "#ffffff"),
  ]);

  const [finding] = auditProject(theme, [
    { path: "src/card.css", text: ".card{color:#fff}" },
  ]);

  expect(finding?.severity).toBe("error");
  expect(finding?.detail).toBe(
    "It has the same value as the background, card and primary-foreground tokens."
  );
  expect(finding?.fix).toBe(
    "Use the one that fits its role: background (--background), card (--card) or primary-foreground (--primary-foreground)."
  );
});

const FIXED_FINDING = {
  category: "accessibility" as const,
  title: "muted on surface is 3.9:1 in light mode",
  file: "src/app/globals.css",
};
const SHARED_FINDING = {
  category: "hardcoded" as const,
  title: "Hardcoded color #2563eb",
  file: "src/ui/button.tsx",
};

test("a finding is the same finding when its number and lines moved, and a new title or file is a new one", () => {
  const earlierCopy = { ...SHARED_FINDING, number: 1, lines: [4] };
  const movedCopy = { ...SHARED_FINDING, number: 7, lines: [40] };

  expect(compareFindings([earlierCopy], [movedCopy])).toEqual({
    fixed: 0,
    new: 0,
  });
  expect(
    compareFindings(
      [SHARED_FINDING],
      [{ ...SHARED_FINDING, file: "src/ui/card.tsx" }]
    )
  ).toEqual({ fixed: 1, new: 1 });
});

test("compareFindings counts the earlier findings gone and the current ones not seen before", () => {
  expect(
    compareFindings(
      [SHARED_FINDING, FIXED_FINDING],
      [SHARED_FINDING, { ...SHARED_FINDING, title: "Hardcoded color #f0f" }]
    )
  ).toEqual({ fixed: 1, new: 1 });
  expect(compareFindings([FIXED_FINDING], [])).toEqual({ fixed: 1, new: 0 });
});

test("pickPreviousAuditName takes the newest audit by name, whether its time has seconds or not", () => {
  expect(
    pickPreviousAuditName(
      [
        "audit-2026-11-10-235900.json",
        "audit-2026-11-11-0930.json",
        "audit-2026-11-11-093000.json",
        "audit-2026-11-11-0930.html",
        "design-2026-11-12-120000.json",
        "theme.json",
      ],
      "audit-2026-11-12-120000.json"
    )
  ).toBe("audit-2026-11-11-093000.json");
  expect(
    pickPreviousAuditName(
      ["audit-2026-11-11-0930.json", "audit-2026-11-11-093000.json"],
      "audit-2026-11-12-120000.json"
    )
  ).toBe("audit-2026-11-11-093000.json");
  expect(
    pickPreviousAuditName(
      ["audit-2026-11-12-120000.json"],
      "audit-2026-11-12-120000.json"
    )
  ).toBeUndefined();
});

test("readPreviousFindings reads the saved findings, and gives nothing for a file it cannot use", () => {
  expect(
    readPreviousFindings(
      JSON.stringify({ findings: [{ ...SHARED_FINDING, number: 1 }] })
    )
  ).toEqual([{ ...SHARED_FINDING, number: 1 }]);
  expect(readPreviousFindings(undefined)).toBeUndefined();
  expect(readPreviousFindings("{ not json")).toBeUndefined();
  expect(readPreviousFindings("null")).toBeUndefined();
  expect(readPreviousFindings(JSON.stringify({ findings: "none" }))).toBe(
    undefined
  );
  expect(
    readPreviousFindings(
      JSON.stringify({ findings: [{ category: "hardcoded" }] })
    )
  ).toBeUndefined();
});

test("describeProgress says what changed since the last audit, and nothing without one", () => {
  expect(describeProgress(undefined)).toBe("");
  expect(
    describeProgress({
      previousAudit: "audit-2026-11-11-093000.json",
      fixed: 3,
      new: 1,
    })
  ).toBe("Since the last audit: 3 fixed, 1 new.");
});
