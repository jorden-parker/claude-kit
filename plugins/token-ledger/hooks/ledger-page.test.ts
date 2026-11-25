import { expect, test } from "bun:test";
import {
  composeLedgerPage,
  composeMarkdownTable,
  describeCacheStatus,
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
