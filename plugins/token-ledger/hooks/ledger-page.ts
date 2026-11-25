import type { LedgerEntry } from "./ledger.ts";

type ModelTotals = LedgerEntry["main"][string];

type ScopedModel = {
  scope: "main" | "subagent";
  model: string;
  totals: ModelTotals;
};

const HEADER_NAMES = [
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

const NUMBER_HEADER_NAMES = [
  "Context Tokens",
  "Input Tokens",
  "Cache Write Tokens",
  "Cache Read Tokens",
  "Output Tokens",
];

const CACHE_HEADER_NAMES = ["Cache Write Tokens", "Cache Read Tokens"];

const STYLE = String.raw`:root{color-scheme:light dark;--border:color-mix(in srgb,CanvasText 18%,Canvas);--muted:color-mix(in srgb,CanvasText 65%,Canvas);--accent:light-dark(#0b5cad,#7ab8ff);--good:light-dark(#1a7f37,#56d364);--problem:light-dark(#b42318,#ff8a80)}
body{margin:0;padding:24px 16px;font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}
main{max-width:1400px;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 4px;text-wrap:balance}
p{margin:0 0 16px;color:var(--muted)}
.toolbar{display:flex;align-items:center;gap:12px;margin-bottom:12px}
button{font:inherit;min-height:44px;padding:0 16px;border:1px solid var(--border);border-radius:8px;background:Canvas;color:CanvasText;cursor:pointer;touch-action:manipulation}
button:hover{background:color-mix(in srgb,CanvasText 8%,Canvas)}
button:active{background:color-mix(in srgb,CanvasText 14%,Canvas)}
button:focus-visible,.table-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.table-scroll{overflow-x:auto;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:.875rem;font-variant-numeric:tabular-nums;white-space:nowrap}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--border)}
th{white-space:normal;vertical-align:bottom}
td{vertical-align:top}
td:nth-child(2),td:nth-child(3){white-space:normal;overflow-wrap:anywhere}
th{background:color-mix(in srgb,CanvasText 6%,Canvas);font-weight:600}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:color-mix(in srgb,CanvasText 5%,Canvas)}
.number{text-align:right}
.digit-group{margin-left:.25em}
.legend{border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px}
.legend h2{font-size:1rem;margin:0 0 4px}
.legend ul{margin:0 0 8px;padding-left:20px}
.legend p{margin:0}
.summary{font-weight:600;color:var(--good)}
.summary.has-problem{color:var(--problem)}
.cache{background:color-mix(in srgb,var(--accent) 10%,Canvas)}
.cache-status{white-space:normal;font-weight:600;color:var(--good)}
.cache-status::before{content:"";display:inline-block;width:.5em;height:.5em;margin-right:6px;border-radius:50%;background:var(--good);vertical-align:middle}
.cache-problem td.cache{background:color-mix(in srgb,var(--problem) 18%,Canvas);font-weight:600}
.cache-problem .cache-status{color:var(--problem)}
.cache-problem .cache-status::before{content:"!";width:1.25em;height:1.25em;line-height:1.25em;background:var(--problem);color:Canvas;text-align:center;font-weight:700}`;

export function composeMarkdownTable(rows: string[][]): string {
  const composeLine = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
  const [headerCells, ...bodyRows] = rows;
  return [
    composeLine(headerCells),
    composeLine(headerCells.map(() => "---")),
    ...bodyRows.map(composeLine),
  ].join("\n");
}

export function composeLedgerCopy(
  rows: string[][],
  toolCharactersBySession: Record<string, Record<string, number>>
): string {
  const MAIN_SCOPE = "main";
  const TOKEN_COLUMNS = [
    "Input Tokens",
    "Cache Write Tokens",
    "Cache Read Tokens",
    "Output Tokens",
  ];
  const [headerCells, ...bodyRows] = rows;
  const readColumn = (row: string[], name: string) =>
    row[headerCells.indexOf(name)];
  const addUpColumn = (matrix: string[][], name: string) =>
    matrix.reduce((total, row) => total + Number(readColumn(row, name)), 0);
  const addUpTokens = (matrix: string[][]) =>
    TOKEN_COLUMNS.reduce((total, name) => total + addUpColumn(matrix, name), 0);
  const computePercent = (part: number, whole: number) =>
    whole === 0 ? 0 : Math.round((100 * part) / whole);

  const input = addUpColumn(bodyRows, "Input Tokens");
  const cacheWrite = addUpColumn(bodyRows, "Cache Write Tokens");
  const cacheRead = addUpColumn(bodyRows, "Cache Read Tokens");
  const output = addUpColumn(bodyRows, "Output Tokens");
  const promptTokens = input + cacheWrite + cacheRead;
  const flaggedCount = bodyRows.filter(
    (row) => readColumn(row, "Cache Status") !== "OK"
  ).length;
  const subagentRows = bodyRows.filter(
    (row) => readColumn(row, "Scope") !== MAIN_SCOPE
  );
  const rowCountText =
    bodyRows.length === 1 ? "1 row" : `${bodyRows.length} rows`;
  const totalsLine =
    `Totals for ${rowCountText}: input ${input}, cache write ${cacheWrite}, cache read ${cacheRead}, output ${output}. ` +
    `Cache reads are ${computePercent(cacheRead, promptTokens)}% of prompt tokens. ` +
    `Flagged ${flaggedCount} of ${bodyRows.length}. ` +
    `Subagents used ${computePercent(addUpTokens(subagentRows), addUpTokens(bodyRows))}% of all tokens.`;

  const characterTotals = new Map();
  const sessionNames = new Set(
    bodyRows.map((row) => readColumn(row, "Session"))
  );
  for (const sessionName of sessionNames) {
    if (!Object.hasOwn(toolCharactersBySession, sessionName)) continue;
    for (const [toolName, characters] of Object.entries(
      toolCharactersBySession[sessionName]
    )) {
      characterTotals.set(
        toolName,
        (characterTotals.get(toolName) ?? 0) + characters
      );
    }
  }
  const largestTools = [...characterTotals]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  const lines = [
    "claude-ledger: tokens per session, scope and model. Propose claude-kit changes that cut context, tokens and cost. Start with the flagged rows and the largest numbers.",
    "Context Tokens is the main session's context size, reread on every turn. Cache Status is OK when cache reads are at least cache writes. Flagged values: Not cached, Never read (writes paid for, never reused), Writes exceed reads. Cache writes cost more than input and cache reads cost far less, so a flagged row is waste.",
    totalsLine,
  ];
  if (largestTools.length > 0) {
    lines.push(
      "Largest tool results in characters: " +
        largestTools
          .map(([toolName, characters]) => `${toolName} ${characters}`)
          .join(", ") +
        "."
    );
  }
  return [...lines, "", composeMarkdownTable(rows)].join("\n");
}

export function labelProjects(
  rows: string[][],
  pageProjectNames: string[]
): string[][] {
  const [headerCells, ...bodyRows] = rows;
  const projectColumn = headerCells.indexOf("Project");
  if (projectColumn === -1) return rows;
  const knownNames = [
    ...pageProjectNames,
    ...bodyRows.map((row) => row[projectColumn]),
  ];
  const projectNumbers = new Map<string, number>();
  for (const name of knownNames) {
    if (!projectNumbers.has(name)) {
      projectNumbers.set(name, projectNumbers.size + 1);
    }
  }
  const labelRow = (row: string[]) =>
    row.map((cell, index) =>
      index === projectColumn ? `project ${projectNumbers.get(cell)}` : cell
    );
  return [headerCells, ...bodyRows.map(labelRow)];
}

const SCRIPT = String.raw`const table = document.querySelector("table");
const copyStatus = document.getElementById("copy-status");
${composeMarkdownTable.toString()}
${composeLedgerCopy.toString()}
${labelProjects.toString()}
const readCellTexts = (row) => [...row.cells].map((cell) => cell.textContent);
function hasSelectedText(row) {
  const selection = getSelection();
  for (let i = 0; i < selection.rangeCount; i++) {
    const selectedRange = selection.getRangeAt(i);
    const rowRange = document.createRange();
    rowRange.selectNodeContents(row);
    if (selectedRange.compareBoundaryPoints(Range.START_TO_START, rowRange) > 0)
      rowRange.setStart(selectedRange.startContainer, selectedRange.startOffset);
    if (selectedRange.compareBoundaryPoints(Range.END_TO_END, rowRange) < 0)
      rowRange.setEnd(selectedRange.endContainer, selectedRange.endOffset);
    if (rowRange.toString() !== "") return true;
  }
  return false;
}
function buildPlainTable(rows) {
  const plainTable = document.createElement("table");
  for (const cellTexts of rows) {
    const plainRow = plainTable.insertRow();
    for (const cellText of cellTexts) plainRow.insertCell().textContent = cellText;
  }
  return plainTable.outerHTML;
}
document.addEventListener("copy", (event) => {
  const selectedText = getSelection().toString().trim();
  if (!selectedText) return;
  event.preventDefault();
  const selectedRows = [...table.tBodies[0].rows].filter(hasSelectedText);
  const isInsideOneCell = !/[\t\n]/.test(selectedText);
  if (isInsideOneCell || selectedRows.length === 0) {
    event.clipboardData.setData("text/plain", selectedText);
    return;
  }
  const copiedRows = [table.tHead.rows[0], ...selectedRows].map(readCellTexts);
  const projectColumn = readCellTexts(table.tHead.rows[0]).indexOf("Project");
  const pageProjectNames = [...table.tBodies[0].rows].map((row) => readCellTexts(row)[projectColumn]);
  event.clipboardData.setData("text/plain", composeLedgerCopy(labelProjects(copiedRows, pageProjectNames), toolCharactersBySession));
  event.clipboardData.setData("text/html", buildPlainTable(labelProjects(copiedRows, pageProjectNames)));
});
document.getElementById("copy-table").addEventListener("click", () => {
  getSelection().selectAllChildren(table);
  const hasCopied = document.execCommand("copy");
  copyStatus.textContent = hasCopied
    ? "Copied " + table.tBodies[0].rows.length + " rows"
    : "Copy failed. Press Cmd+C while the table is selected.";
});`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scopedModels(entry: LedgerEntry): ScopedModel[] {
  return [
    ...Object.entries(entry.main).map(([model, totals]) => ({
      scope: "main" as const,
      model,
      totals,
    })),
    ...Object.entries(entry.subagents).map(([model, totals]) => ({
      scope: "subagent" as const,
      model,
      totals,
    })),
  ];
}

function textCell(value: string): string {
  return `<td>${escapeHtml(value)}</td>`;
}

function numberCell(count: number, className = "number"): string {
  const digits = String(Math.round(count)).replace(
    /\B(?=(\d{3})+$)/g,
    '</span><span class="digit-group">'
  );
  return `<td class="${className}"><span>${digits}</span></td>`;
}

export function describeCacheStatus(totals: ModelTotals): string {
  if (totals.cacheRead === 0 && totals.cacheWrite === 0) return "Not cached";
  if (totals.cacheRead === 0) return "Never read";
  if (totals.cacheRead < totals.cacheWrite) return "Writes exceed reads";
  return "OK";
}

function hasCacheProblem(totals: ModelTotals): boolean {
  return describeCacheStatus(totals) !== "OK";
}

function composeRow(entry: LedgerEntry, scoped: ScopedModel): string {
  return (
    (hasCacheProblem(scoped.totals) ? '<tr class="cache-problem">' : "<tr>") +
    textCell(entry.updatedAt.slice(0, 16).replace("T", " ")) +
    textCell(entry.project) +
    textCell(entry.session) +
    textCell(scoped.scope) +
    textCell(scoped.model) +
    numberCell(entry.contextTokens) +
    numberCell(scoped.totals.input) +
    numberCell(scoped.totals.cacheWrite, "number cache") +
    numberCell(scoped.totals.cacheRead, "number cache") +
    `<td class="cache-status">${describeCacheStatus(scoped.totals)}</td>` +
    numberCell(scoped.totals.output) +
    "</tr>"
  );
}

function composeHeader(): string {
  return HEADER_NAMES.map((name) => {
    const classNames = [
      NUMBER_HEADER_NAMES.includes(name) ? "number" : "",
      CACHE_HEADER_NAMES.includes(name) ? "cache" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const classAttribute = classNames ? ` class="${classNames}"` : "";
    return `<th scope="col"${classAttribute}>${escapeHtml(name)}</th>`;
  }).join("");
}

function composeLegend(rowCount: number, flaggedCount: number): string {
  const hasProblem = flaggedCount > 0;
  const summary = hasProblem
    ? `${flaggedCount} of ${rowCount} rows flagged.`
    : `All ${rowCount} rows OK.`;
  const summaryClass = hasProblem ? "summary has-problem" : "summary";
  return (
    '<section class="legend" aria-labelledby="legend-title"><h2 id="legend-title">What Good Looks Like</h2><ul><li><strong>Cache Read Tokens</strong> should be well above Cache Write Tokens. The prompt is being reused instead of resent.</li><li><strong>Cache Write Tokens</strong> should stay at or below reads. A write only pays off when it is read back later.</li><li><strong>Cache Status</strong> says OK when that holds. Otherwise it names the fault: Writes exceed reads, Never read, or Not cached.</li></ul>' +
    `<p class="${summaryClass}" role="status">${summary}</p></section>`
  );
}

function foldMcpTools(
  resultCharactersByTool: Record<string, number>
): Record<string, number> {
  const folded: Record<string, number> = {};
  for (const [toolName, characters] of Object.entries(resultCharactersByTool)) {
    const key = toolName.startsWith("mcp__") ? "MCP tools" : toolName;
    folded[key] = (folded[key] ?? 0) + characters;
  }
  return folded;
}

export function composeLedgerPage(entries: LedgerEntry[]): string {
  const rows = entries.flatMap((entry) =>
    scopedModels(entry).map((scoped) => composeRow(entry, scoped))
  );
  const flaggedCount = entries
    .flatMap(scopedModels)
    .filter((scoped) => hasCacheProblem(scoped.totals)).length;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Token Ledger</title><style>${STYLE}</style></head><body><main><h1 id="ledger-title">Token Ledger</h1>`;
  const tail = "</main></body></html>";
  if (rows.length === 0) {
    return `${head}<p>No sessions recorded yet.</p>${tail}`;
  }
  const toolCharactersJson = JSON.stringify(
    Object.fromEntries(
      entries.map((entry) => [
        entry.session,
        foldMcpTools(entry.resultCharactersByTool),
      ])
    )
  ).replaceAll("<", "\\u003c");
  return (
    head +
    "<p>Tokens per model for the newest sessions. Select rows and copy, or use Copy Table. It pastes as a short summary and a Markdown table in Claude Code and text editors, and as cells in a spreadsheet. Copied rows name projects as project 1, project 2 and so on, and never include tool output. A selection inside one cell copies just that text.</p>" +
    composeLegend(rows.length, flaggedCount) +
    '<div class="toolbar"><button type="button" id="copy-table">Copy Table</button><span id="copy-status" role="status" aria-live="polite"></span></div>' +
    '<div class="table-scroll" tabindex="0" role="region" aria-labelledby="ledger-title"><table aria-labelledby="ledger-title">' +
    `<thead><tr>${composeHeader()}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody>` +
    "</table></div>" +
    "</main>" +
    `<script>const toolCharactersBySession = ${toolCharactersJson};</script>` +
    `<script>${SCRIPT}</script>` +
    "</body></html>"
  );
}
