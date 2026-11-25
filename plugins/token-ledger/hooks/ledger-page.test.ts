import { expect, test } from "bun:test";
import {
  composeLedgerCopy,
  composeLedgerPage,
  composeMarkdownTable,
  describeCacheStatus,
  labelProjects,
} from "./ledger-page.ts";
import type { LedgerEntry } from "./ledger.ts";

const sampleEntry: LedgerEntry = {
  session: "session-abc",
  project: "<b>&co",
  updatedAt: "2026-01-02T03:04:05.000Z",
  contextTokens: 120000,
  lastNudgeTokens: 0,
  main: {
    fable: {
      input: 1234567,
      cacheWrite: 20000,
      cacheRead: 300000000,
      output: 4,
    },
  },
  subagents: {
    haiku: { input: 50000, cacheWrite: 0, cacheRead: 0, output: 12 },
  },
  resultCharactersByTool: {},
};

const tableOf = (page: string) =>
  page.slice(
    page.indexOf("<table"),
    page.indexOf("</table>") + "</table>".length
  );

const rowsOf = (page: string) =>
  tableOf(page).match(/<tr[\s>][\s\S]*?<\/tr>/g) ?? [];

const cellTextsOf = (row: string) =>
  (row.match(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/g) ?? []).map((cell) =>
    cell.replace(/<[^>]+>/g, "")
  );

test("describeCacheStatus names the cache state of a model", () => {
  expect(
    describeCacheStatus({
      input: 12,
      cacheWrite: 100,
      cacheRead: 500,
      output: 1,
    })
  ).toBe("OK");
  expect(
    describeCacheStatus({
      input: 12,
      cacheWrite: 500,
      cacheRead: 500,
      output: 1,
    })
  ).toBe("OK");
  expect(
    describeCacheStatus({
      input: 12,
      cacheWrite: 500,
      cacheRead: 100,
      output: 1,
    })
  ).toBe("Writes exceed reads");
  expect(
    describeCacheStatus({ input: 12, cacheWrite: 500, cacheRead: 0, output: 1 })
  ).toBe("Never read");
  expect(
    describeCacheStatus({ input: 50, cacheWrite: 0, cacheRead: 0, output: 1 })
  ).toBe("Not cached");
});

test("composeLedgerPage writes a flat table with eleven columns on every row", () => {
  const page = composeLedgerPage([sampleEntry]);
  const [headerRow = "", firstRow = "", secondRow = ""] = rowsOf(page);
  expect(rowsOf(page).length).toBe(3);
  expect((headerRow.match(/<th/g) ?? []).length).toBe(11);
  expect((firstRow.match(/<td/g) ?? []).length).toBe(11);
  expect((secondRow.match(/<td/g) ?? []).length).toBe(11);
});

test("composeLedgerPage names the eleven columns in order", () => {
  const [headerRow = ""] = rowsOf(composeLedgerPage([sampleEntry]));
  expect(cellTextsOf(headerRow)).toEqual([
    "Updated",
    "Project",
    "Session",
    "Scope",
    "Model",
    "Context Tokens",
    "Input Tokens",
    "Cache Write Tokens",
    "Cache Read Tokens",
    "Cache Status",
    "Output Tokens",
  ]);
});

test("composeLedgerPage highlights the cache read and write columns", () => {
  const [headerRow = "", firstRow = ""] = rowsOf(
    composeLedgerPage([sampleEntry])
  );
  expect(headerRow).toContain(
    '<th scope="col" class="number cache">Cache Write Tokens</th>'
  );
  expect(headerRow).toContain(
    '<th scope="col" class="number cache">Cache Read Tokens</th>'
  );
  expect((firstRow.match(/<td class="number cache">/g) ?? []).length).toBe(2);
});

test("composeMarkdownTable writes a header, a separator and escaped body rows", () => {
  expect(
    composeMarkdownTable([
      ["Model", "Input Tokens"],
      ["a|b", "12"],
    ])
  ).toBe("| Model | Input Tokens |\n| --- | --- |\n| a\\|b | 12 |");
});

test("composeLedgerPage script copies Markdown as plain text and HTML as a table", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).toContain("function composeMarkdownTable");
  expect(page).toContain('setData("text/html"');
  expect(page).toContain('setData("text/plain"');
});

test("composeLedgerPage puts the session values in order, escaped and unpadded", () => {
  const [, firstRow = "", secondRow = ""] = rowsOf(
    composeLedgerPage([sampleEntry])
  );
  expect(cellTextsOf(firstRow)).toEqual([
    "2026-01-02 03:04",
    "&lt;b&gt;&amp;co",
    "session-abc",
    "main",
    "fable",
    "120000",
    "1234567",
    "20000",
    "300000000",
    "OK",
    "4",
  ]);
  const subagentCells = cellTextsOf(secondRow);
  expect(subagentCells[3]).toBe("subagent");
  expect(subagentCells[4]).toBe("haiku");
  expect(subagentCells[9]).toBe("Not cached");
});

test("composeLedgerPage flags only the rows whose cache is not working", () => {
  const rows = rowsOf(composeLedgerPage([sampleEntry]));
  expect(
    composeLedgerPage([sampleEntry]).match(/<tr class="cache-problem">/g)
  ).toHaveLength(1);
  expect(rows[1].startsWith("<tr>")).toBe(true);
  expect(rows[2].startsWith('<tr class="cache-problem">')).toBe(true);
});

test("composeLedgerPage shows the legend and a summary above the table", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).toContain("What Good Looks Like");
  expect(page).toContain("1 of 2 rows flagged.");
  expect(page.indexOf('class="legend"')).toBeLessThan(page.indexOf("<table"));
});

test("composeLedgerPage reports all rows OK when none is flagged", () => {
  const page = composeLedgerPage([{ ...sampleEntry, subagents: {} }]);
  expect(page).toContain("All 1 rows OK.");
  expect(page).not.toContain('cache-problem">');
});

test("composeLedgerPage wraps digit groups in spans", () => {
  expect(composeLedgerPage([sampleEntry])).toContain('class="digit-group"');
});

test("composeLedgerPage keeps the table free of whitespace between tags", () => {
  const table = tableOf(composeLedgerPage([sampleEntry]));
  expect(table).not.toMatch(/>\s+</);
  const cellTexts = table.match(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/g) ?? [];
  for (const cell of cellTexts) {
    const text = cell.replace(/<[^>]+>/g, "");
    expect(text).toBe(text.trim());
  }
});

test("composeLedgerPage with no entries shows the empty message and no table", () => {
  const page = composeLedgerPage([]);
  expect(page).toContain("No sessions recorded yet.");
  expect(page).not.toContain("<table");
  expect(page).not.toContain('class="legend"');
});

const ledgerHeader = [
  "Updated",
  "Project",
  "Session",
  "Scope",
  "Model",
  "Context Tokens",
  "Input Tokens",
  "Cache Write Tokens",
  "Cache Read Tokens",
  "Cache Status",
  "Output Tokens",
];

const ledgerRow = (
  session: string,
  scope: string,
  cacheStatus: string,
  input: string,
  cacheWrite: string,
  cacheRead: string,
  output: string
) => [
  "2026-01-02 03:04",
  "proj",
  session,
  scope,
  "fable",
  "120000",
  input,
  cacheWrite,
  cacheRead,
  cacheStatus,
  output,
];

test("composeLedgerCopy puts a summary above the Markdown table", () => {
  const rows = [
    ledgerHeader,
    ledgerRow("s1", "main", "OK", "1000", "100", "6000", "200"),
    ledgerRow("s2", "main", "Never read", "100", "200", "0", "150"),
    ledgerRow("s1", "subagent", "OK", "100", "0", "3000", "100"),
  ];
  const toolCharactersBySession = {
    s1: { Read: 100000, Bash: 30000, Grep: 500 },
    s2: {
      Read: 20000,
      Glob: 4000,
      Edit: 3000,
      Write: 2000,
      Agent: 1500,
      Task: 100,
    },
    s3: { Bash: 999999 },
  };
  expect(composeLedgerCopy(rows, toolCharactersBySession)).toBe(
    [
      "claude-ledger: tokens per session, scope and model. Propose claude-kit changes that cut context, tokens and cost. Start with the flagged rows and the largest numbers.",
      "Context Tokens is the main session's context size, reread on every turn. Cache Status is OK when cache reads are at least cache writes. Flagged values: Not cached, Never read (writes paid for, never reused), Writes exceed reads. Cache writes cost more than input and cache reads cost far less, so a flagged row is waste.",
      "Totals for 3 rows: input 1200, cache write 300, cache read 9000, output 450. Cache reads are 86% of prompt tokens. Flagged 1 of 3. Subagents used 29% of all tokens.",
      "Largest tool results in characters: Read 120000, Bash 30000, Glob 4000, Edit 3000, Write 2000.",
      "",
      composeMarkdownTable(rows),
    ].join("\n")
  );
});

test("composeLedgerCopy says 1 row, omits the tool line and ends with the table", () => {
  const rows = [
    ledgerHeader,
    ledgerRow("s1", "main", "OK", "1", "2", "3", "4"),
  ];
  const summary = composeLedgerCopy(rows, {});
  expect(summary).toContain("Totals for 1 row: ");
  expect(summary).not.toContain("Largest tool results");
  expect(summary.endsWith("\n\n" + composeMarkdownTable(rows))).toBe(true);
});

test("composeLedgerCopy reports 0% when every token cell is 0", () => {
  const rows = [
    ledgerHeader,
    ledgerRow("s1", "main", "Not cached", "0", "0", "0", "0"),
    ledgerRow("s1", "subagent", "Not cached", "0", "0", "0", "0"),
  ];
  const summary = composeLedgerCopy(rows, {});
  expect(summary).toContain("Cache reads are 0% of prompt tokens.");
  expect(summary).toContain("Subagents used 0% of all tokens.");
});

test("composeLedgerPage copies the summary and embeds the tool map for each session", () => {
  const page = composeLedgerPage([
    {
      ...sampleEntry,
      session: "session-tools",
      resultCharactersByTool: { "Tool<x>": 5 },
    },
  ]);
  expect(page).toContain(
    "composeLedgerCopy(labelProjects(copiedRows, pageProjectNames), toolCharactersBySession)"
  );
  expect(page).toContain(
    'setData("text/html", buildPlainTable(labelProjects(copiedRows, pageProjectNames)))'
  );
  expect(page).toContain("labelProjects(copiedRows, pageProjectNames)");
  expect(page).toContain(
    "Copied rows name projects as project 1, project 2 and so on, and never include tool output."
  );
  expect(page).toContain("const toolCharactersBySession = {");
  expect(page).toContain('{"session-tools":{"Tool\\u003cx>":5}}');
  expect(page).not.toContain('"Tool<x>"');
});

test("composeLedgerPage folds MCP tool names into one MCP tools key", () => {
  const page = composeLedgerPage([
    {
      ...sampleEntry,
      session: "session-mcp",
      resultCharactersByTool: {
        mcp__acme__search: 100,
        mcp__acme__read: 50,
        Read: 30,
      },
    },
  ]);
  expect(page).toContain('"MCP tools":150');
  expect(page).toContain('"Read":30');
  expect(page).not.toContain("mcp__");
});

test("labelProjects numbers projects by page order and leaves other cells alone", () => {
  const rows = [
    ledgerHeader,
    [
      "2026-01-02 03:04",
      "beta",
      "s1",
      "main",
      "fable",
      "1",
      "2",
      "3",
      "4",
      "OK",
      "5",
    ],
    [
      "2026-01-02 03:04",
      "alpha",
      "s2",
      "main",
      "fable",
      "1",
      "2",
      "3",
      "4",
      "OK",
      "6",
    ],
    [
      "2026-01-02 03:04",
      "beta",
      "s3",
      "main",
      "fable",
      "1",
      "2",
      "3",
      "4",
      "OK",
      "7",
    ],
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  const labeled = labelProjects(rows, ["alpha", "alpha", "beta", "beta"]);
  expect(labeled[0]).toEqual(ledgerHeader);
  expect(labeled.slice(1).map((row) => row[1])).toEqual([
    "project 2",
    "project 1",
    "project 2",
  ]);
  expect(labeled[1].filter((_, index) => index !== 1)).toEqual(
    rows[1].filter((_, index) => index !== 1)
  );
  expect(rows).toEqual(snapshot);
});

test("labelProjects numbers a project missing from the page after the known ones", () => {
  const rows = [
    ledgerHeader,
    [
      "2026-01-02 03:04",
      "delta",
      "s1",
      "main",
      "fable",
      "1",
      "2",
      "3",
      "4",
      "OK",
      "5",
    ],
    [
      "2026-01-02 03:04",
      "gamma",
      "s2",
      "main",
      "fable",
      "1",
      "2",
      "3",
      "4",
      "OK",
      "5",
    ],
  ];
  const labeled = labelProjects(rows, ["delta"]);
  expect(labeled.slice(1).map((row) => row[1])).toEqual([
    "project 1",
    "project 2",
  ]);
});

test("labelProjects returns equal rows when there is no Project column", () => {
  const rows = [
    ["Model", "Input Tokens"],
    ["fable", "12"],
  ];
  expect(labelProjects(rows, ["fable"])).toEqual(rows);
});
