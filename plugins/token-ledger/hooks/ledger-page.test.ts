import { expect, test } from "bun:test";
import {
  composeLedgerCopy,
  composeLedgerPage,
  describeCacheStatus,
  labelProjects,
} from "./ledger-page.ts";
import type { LedgerEntry } from "./ledger.ts";

type ModelTotals = LedgerEntry["main"][string];

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

test("composeLedgerPage writes a flat table with fourteen columns on every row", () => {
  const page = composeLedgerPage([sampleEntry]);
  const [headerRow = "", firstRow = "", secondRow = ""] = rowsOf(page);
  expect(rowsOf(page).length).toBe(3);
  expect((headerRow.match(/<th/g) ?? []).length).toBe(14);
  expect((firstRow.match(/<td/g) ?? []).length).toBe(14);
  expect((secondRow.match(/<td/g) ?? []).length).toBe(14);
});

test("composeLedgerPage names the fourteen columns in order", () => {
  const [headerRow = ""] = rowsOf(composeLedgerPage([sampleEntry]));
  expect(cellTextsOf(headerRow)).toEqual([
    "Updated",
    "Project",
    "Session",
    "Scope",
    "Model",
    "Context Tokens",
    "Last Nudge Tokens",
    "Input Tokens",
    "Cache Write Tokens",
    "Cache Read Tokens",
    "Cache Status",
    "Output Tokens",
    "Session Share",
    "Main Tool Result Characters",
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

test("composeLedgerPage script copies plain text only", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).not.toContain("text/html");
  expect(page).toContain('setData("text/plain"');
});

test("composeLedgerPage offers the ledger text as a file download", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).toContain('id="download-table"');
  expect(page).toContain("Download .txt");
  expect(page).toContain("composeLedgerText([...table.tBodies[0].rows])");
  expect(page).toContain('downloadLink.download = "claude-ledger-usage.txt"');
  expect(page).toContain(
    'setData("text/plain", composeLedgerText(selectedRows))'
  );
  const scriptBodies = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? ""
  );
  const scriptText =
    scriptBodies.find((body) => body.includes("copy-table")) ?? "";
  expect(scriptText).not.toBe("");
  expect(() => new Function(scriptText)).not.toThrow();
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
    "0",
    "1234567",
    "20000",
    "300000000",
    "OK",
    "4",
    "100%",
    "",
  ]);
  const subagentCells = cellTextsOf(secondRow);
  expect(subagentCells[3]).toBe("subagent");
  expect(subagentCells[4]).toBe("haiku");
  expect(subagentCells[10]).toBe("Not cached");
  expect(subagentCells[12]).toBe("0%");
});

test("composeLedgerPage flags only the rows whose cache is not working", () => {
  const rows = rowsOf(composeLedgerPage([sampleEntry]));
  expect(
    composeLedgerPage([sampleEntry]).match(/<tr class="cache-problem">/g)
  ).toHaveLength(1);
  expect(rows[1].startsWith('<tr class="session-start">')).toBe(true);
  expect(rows[2].startsWith('<tr class="cache-problem">')).toBe(true);
});

const shareEntry = (
  session: string,
  main: ModelTotals,
  subagents: Record<string, ModelTotals>
): LedgerEntry => ({
  ...sampleEntry,
  session,
  main: { fable: main },
  subagents,
});

const shareCells = (page: string) =>
  rowsOf(page)
    .slice(1)
    .map((row) => cellTextsOf(row).at(-2));

test("composeLedgerPage shows each row's part of its session's tokens", () => {
  const page = composeLedgerPage([
    shareEntry(
      "session-share",
      { input: 100, cacheWrite: 0, cacheRead: 100, output: 100 },
      { haiku: { input: 100, cacheWrite: 0, cacheRead: 0, output: 0 } }
    ),
  ]);
  expect(shareCells(page)).toEqual(["75%", "25%"]);
});

test("a session with one main row and no subagents shows 100%", () => {
  const page = composeLedgerPage([
    shareEntry(
      "session-solo",
      { input: 100, cacheWrite: 0, cacheRead: 100, output: 100 },
      {}
    ),
  ]);
  expect(shareCells(page)).toEqual(["100%"]);
});

test("a session whose totals are all zero shows 0%", () => {
  const zero = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const page = composeLedgerPage([
    shareEntry("session-zero", zero, { haiku: zero }),
  ]);
  expect(shareCells(page)).toEqual(["0%", "0%"]);
});

test("composeLedgerPage starts each session on a row with a top border class", () => {
  const healthy = { input: 100, cacheWrite: 0, cacheRead: 100, output: 0 };
  const flagged = { input: 100, cacheWrite: 500, cacheRead: 0, output: 0 };
  const page = composeLedgerPage([
    shareEntry("session-a", flagged, { haiku: healthy }),
    shareEntry("session-b", healthy, { haiku: healthy }),
  ]);
  const rows = rowsOf(page).slice(1);
  expect(rows[0].startsWith('<tr class="cache-problem session-start">')).toBe(
    true
  );
  expect(rows[1].startsWith("<tr>")).toBe(true);
  expect(rows[2].startsWith('<tr class="session-start">')).toBe(true);
  expect(rows[3].startsWith("<tr>")).toBe(true);
  expect(page).toContain(".session-start td{border-top:2px solid");
});

test("composeLedgerPage shows the legend and a summary above the table", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).toContain("What Good Looks Like");
  expect(page).toContain(
    "<strong>Session Share</strong> is each row's part of its session's tokens."
  );
  expect(page).toContain(
    "<li><strong>Last Nudge Tokens</strong> is the context size when the session was last told to hand off and clear. 0 means it never was. Context Tokens well above it means the session kept growing after the nudge.</li>"
  );
  expect(page).toContain(
    "<li><strong>Main Tool Result Characters</strong> lists what each tool returned into the main agent's context, largest first, on each session's first row. MCP tools are grouped as one total.</li>"
  );
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

test("composeLedgerCopy writes a plain text summary and one line per row", () => {
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
      "claude-ledger usage report, 3 rows. The last line starts with END; if it is missing, the paste was cut short.",
      "",
      "What this is: token usage from my Claude Code sessions, recorded by claude-ledger, a plugin in claude-kit, my repo of Claude Code plugins.",
      "What I want: propose claude-kit changes that cut context, tokens and cost. Start with the flagged rows and the largest numbers.",
      "",
      "TOTALS",
      "Sessions: 2",
      "Rows: 3",
      "Input tokens: 1,200",
      "Cache write tokens: 300",
      "Cache read tokens: 9,000 (86% of prompt tokens)",
      "Output tokens: 450",
      "Flagged rows: 1 of 3",
      "Subagent share of all tokens: 29%",
      "Largest tool results in the main agent's context, in characters: Read 120,000; Bash 30,000; Glob 4,000; Edit 3,000; Write 2,000",
      "",
      "COLUMNS",
      "Context Tokens: the main session's context size, reread on every turn.",
      "Last Nudge Tokens: the context size when the session was last told to hand off and clear, 0 if never.",
      "Session Share: the row's part of its session's tokens. A high main share means the main agent did work its subagents could take.",
      "Main Tool Result Characters: what each tool returned into the main agent's context, on each session's first row.",
      "Cache Status: OK when cache reads are at least cache writes. Flagged values: Not cached, Never read (writes paid for, never reused), Writes exceed reads. Cache writes cost more than input and cache reads cost far less, so a flagged row is waste.",
      "",
      "SESSIONS",
      'One line per session, scope (main agent or subagents) and model. Cells are separated by " | ", the first line names the columns, and an empty cell is written as -.',
      "Updated | Project | Session | Scope | Model | Context Tokens | Input Tokens | Cache Write Tokens | Cache Read Tokens | Cache Status | Output Tokens",
      "2026-01-02 03:04 | proj | s1 | main | fable | 120000 | 1000 | 100 | 6000 | OK | 200",
      "2026-01-02 03:04 | proj | s2 | main | fable | 120000 | 100 | 200 | 0 | Never read | 150",
      "2026-01-02 03:04 | proj | s1 | subagent | fable | 120000 | 100 | 0 | 3000 | OK | 100",
      "",
      "END of claude-ledger usage report",
    ].join("\n")
  );
});

test("composeLedgerCopy writes an empty cell as - and escapes a pipe", () => {
  const rows = [
    ledgerHeader,
    [
      "2026-01-02 03:04",
      "proj",
      "s1|x",
      "main",
      "",
      "120000",
      "1",
      "2",
      "3",
      "OK",
      "4",
    ],
  ];
  expect(composeLedgerCopy(rows, {})).toContain(
    "\n2026-01-02 03:04 | proj | s1\\|x | main | - | 120000 | 1 | 2 | 3 | OK | 4\n"
  );
});

test("composeLedgerCopy counts one row and omits the tool line without tool characters", () => {
  const rows = [
    ledgerHeader,
    ledgerRow("s1", "main", "OK", "1", "2", "3", "4"),
  ];
  const summary = composeLedgerCopy(rows, {});
  expect(summary).toContain("\nRows: 1\n");
  expect(summary).not.toContain("Largest tool results");
  expect(
    summary.endsWith(
      "SESSIONS\n" +
        'One line per session, scope (main agent or subagents) and model. Cells are separated by " | ", the first line names the columns, and an empty cell is written as -.\n' +
        "Updated | Project | Session | Scope | Model | Context Tokens | Input Tokens | Cache Write Tokens | Cache Read Tokens | Cache Status | Output Tokens\n" +
        "2026-01-02 03:04 | proj | s1 | main | fable | 120000 | 1 | 2 | 3 | OK | 4\n" +
        "\n" +
        "END of claude-ledger usage report"
    )
  ).toBe(true);
});

test("composeLedgerCopy reports 0% when every token cell is 0", () => {
  const rows = [
    ledgerHeader,
    ledgerRow("s1", "main", "Not cached", "0", "0", "0", "0"),
    ledgerRow("s1", "subagent", "Not cached", "0", "0", "0", "0"),
  ];
  const summary = composeLedgerCopy(rows, {});
  expect(summary).toContain("Cache read tokens: 0 (0% of prompt tokens)");
  expect(summary).toContain("Subagent share of all tokens: 0%");
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
  expect(page).not.toContain("text/html");
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

const toolEntry = (
  session: string,
  resultCharactersByTool: Record<string, number>
): LedgerEntry => ({
  ...shareEntry(
    session,
    { input: 100, cacheWrite: 0, cacheRead: 100, output: 100 },
    { haiku: { input: 100, cacheWrite: 0, cacheRead: 0, output: 0 } }
  ),
  lastNudgeTokens: 150000,
  resultCharactersByTool,
});

const toolCellsOf = (page: string) =>
  rowsOf(page)
    .slice(1)
    .map((row) => cellTextsOf(row).at(-1));

test("composeLedgerPage repeats the last nudge tokens on every row of a session", () => {
  const page = composeLedgerPage([toolEntry("session-nudge", {})]);
  const nudgeCells = rowsOf(page)
    .slice(1)
    .map((row) => cellTextsOf(row)[6]);
  expect(nudgeCells).toEqual(["150000", "150000"]);
});

test("composeLedgerPage lists each tool's result characters on the first row only", () => {
  const page = composeLedgerPage([
    toolEntry("session-tool-results", {
      Read: 30,
      Bash: 500,
      mcp__acme__search: 100,
      mcp__acme__read: 50,
      ToolSearch: 0,
    }),
  ]);
  expect(toolCellsOf(page)).toEqual([
    "Bash 500, MCP tools 150, Read 30, ToolSearch 0",
    "",
  ]);
  expect(page).not.toContain("mcp__");
});

test("composeLedgerPage leaves the tool cell empty when a session has no tools", () => {
  const page = composeLedgerPage([toolEntry("session-no-tools", {})]);
  expect(toolCellsOf(page)[0]).toBe("");
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

test("composeLedgerPage marks the repeated values on every row after a session's first", () => {
  const [, firstRow = "", secondRow = ""] = rowsOf(
    composeLedgerPage([toolEntry("session-repeat", {})])
  );
  const repeatedIndexes = [0, 1, 2, 5, 6];
  const classesOf = (row: string) =>
    (row.match(/<td[^>]*>/g) ?? []).map((cell) => cell.includes("repeated"));
  expect(classesOf(firstRow).some(Boolean)).toBe(false);
  expect(
    classesOf(secondRow).flatMap((isRepeated, index) =>
      isRepeated ? [index] : []
    )
  ).toEqual(repeatedIndexes);
});

test("composeLedgerPage styles a sticky header inside a scrollable table", () => {
  const page = composeLedgerPage([sampleEntry]);
  expect(page).toContain("thead th{position:sticky;top:0;z-index:1}");
  expect(page).toContain("max-height:80vh");
});

test("composeLedgerPage intro counts the sessions that have rows", () => {
  const page = composeLedgerPage([
    sampleEntry,
    { ...sampleEntry, session: "session-two" },
  ]);
  expect(page).toContain("Sessions shown: 2, newest first.");
  expect(page).toContain(
    "Each row is one model's tokens for a session's main agent or its subagents."
  );
});
