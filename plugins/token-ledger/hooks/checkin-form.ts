import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { rows, scale } from "./checkins.ts";

export const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
const phases = ["Before", "After", "Single session"];
const qualities = ["Unknown", "First try", "After rework", "Failed", "Mixed"];
type Entry = {
  experiment: string;
  phase: string;
  answers: string;
  quality: string;
  version: string;
};
const folder = (home: string) => join(home, ".cache/token-ledger");
const path = (home: string) => join(folder(home), "work-checkins.sqlite");

export function entries(home: string): Entry[] {
  if (!existsSync(path(home))) return [];
  const db = new Database(path(home), { readonly: true });
  try {
    return db
      .query<Entry, []>("SELECT * FROM observations ORDER BY experiment, phase")
      .all();
  } finally {
    db.close();
  }
}

export function save(home: string, form: URLSearchParams) {
  const experiment = form.get("experiment")?.trim();
  const phase = form.get("phase") ?? "";
  const quality = form.get("quality") ?? "";
  if (
    !experiment ||
    experiment.length > 160 ||
    !phases.includes(phase) ||
    !qualities.includes(quality) ||
    form.get("version") !== scale
  )
    throw Error("Invalid check-in");
  const answers = relevant(phase).map((row) => {
    const code = form.get(row.id) ?? row.id + "?";
    if (!row.choices.some((choice) => choice.code === code))
      throw Error("Invalid selection");
    return code;
  });
  mkdirSync(folder(home), { recursive: true });
  const db = new Database(path(home));
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS observations (experiment TEXT, phase TEXT, answers TEXT, quality TEXT, version TEXT, PRIMARY KEY(experiment, phase, version))"
    );
    db.query("INSERT OR REPLACE INTO observations VALUES (?, ?, ?, ?, ?)").run(
      experiment,
      phase,
      JSON.stringify(answers),
      quality,
      scale
    );
  } finally {
    db.close();
  }
}

function relevant(phase: string) {
  return phase === phases[2] ? rows.slice(6) : rows.slice(0, 6);
}
export function summary(records: Entry[]) {
  if (!records.length) return "No manually entered work results.";
  return records
    .map((record) => {
      const codes: string[] = JSON.parse(record.answers);
      const baseline =
        record.phase === "After" &&
        records.find(
          (other) =>
            other.experiment === record.experiment &&
            other.phase === "Before" &&
            other.version === record.version
        );
      const prior = baseline ? JSON.parse(baseline.answers) : [];
      return [
        record.experiment +
          " · " +
          record.phase +
          " · " +
          record.version +
          " · quality: " +
          record.quality,
        ...(record.phase === "After" && ["A1", "A2"].includes(codes[0])
          ? ["Fewer than five follow-up sessions: too early to judge."]
          : []),
        ...(record.phase === "After" && codes[0] === "A?"
          ? ["Follow-up sample size unknown."]
          : []),
        "Estimated cost: unknown",
        ...relevant(record.phase).map((row, i) => {
          const chosen = row.choices.find((c) => c.code === codes[i]);
          const before = row.choices.find((c) => c.code === prior[i]);
          const direction =
            !before || !chosen
              ? ""
              : !Number.isFinite(before.low + chosen.low) ||
                  before.low === chosen.low
                ? " (direction uncertain)"
                : chosen.low < before.low
                  ? " (lower)"
                  : " (higher)";
          return row.title + ": " + (chosen?.label ?? "Unknown") + direction;
        }),
      ].join("\n");
    })
    .join("\n\n");
}

export function selectedResults(
  values: Record<string, string>,
  available: {
    id: string;
    title: string;
    choices: { code: string; label: string }[];
  }[],
  version: string
): string {
  const selected = available.flatMap((row) => {
    const choice = row.choices.find(
      (choice) => choice.code === values[row.id] && choice.code !== row.id + "?"
    );
    return choice ? [row.title + ": " + choice.label] : [];
  });
  return [
    (values.experiment || "Work check-in") +
      " · " +
      values.phase +
      " · " +
      version,
    "Checks passed: " + (values.quality || "Unknown"),
    ...(selected.length ? selected : ["No readings selected."]),
  ].join("\n");
}

export function formPage(records: Entry[], query: URLSearchParams) {
  const experiment =
    query.get("experiment") ?? records.at(-1)?.experiment ?? "Work check-in";
  const phase = phases.includes(query.get("phase") ?? "")
    ? query.get("phase")!
    : "Before";
  const current = records.find(
    (r) =>
      r.experiment === experiment && r.phase === phase && r.version === scale
  );
  const codes: string[] = JSON.parse(current?.answers ?? "[]");
  const options = (items: string[], selected: string) =>
    items
      .map(
        (item) =>
          "<option" +
          (item === selected ? " selected" : "") +
          ">" +
          html(item) +
          "</option>"
      )
      .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Record work results</title>
<style>body{font:16px system-ui;margin:2rem auto;max-width:62rem;padding:0 1rem}fieldset{border:0;border-top:1px solid #aaa;margin:1rem 0}label{display:inline-block;padding:.45rem}label:has(input:checked){background:#dbeafe;color:#132544}button,select,input{font:inherit}button{padding:.4rem .8rem;min-height:44px}textarea{display:block;width:100%;box-sizing:border-box;padding:12px;font:14px/1.5 monospace;resize:vertical}button:focus-visible,textarea:focus-visible{outline:2px solid #165dcc;outline-offset:3px}</style>
<h1>Record work results</h1><p>Match the codes in Laptop check-in · ${scale} on the work screen.</p>
<form><label>Experiment and workload <input name="experiment" maxlength="160" required list="names" value="${html(experiment)}"></label><datalist id="names">${options([...new Set(records.map((r) => r.experiment))], "")}</datalist>
<label>Report <select name="phase">${options(phases, phase)}</select></label><button>Open selections</button></form>
<h2>${html(experiment)} · ${html(phase)}</h2>${query.has("saved") ? '<p role="status">Selections saved.</p>' : ""}
<form method="post" id="readings-form"><input type="hidden" name="version" value="${scale}"><input type="hidden" name="experiment" value="${html(experiment)}"><input type="hidden" name="phase" value="${html(phase)}">
${relevant(phase)
  .map(
    (row, i) =>
      "<fieldset><legend>" +
      row.title +
      "</legend>" +
      row.choices
        .map(
          (choice) =>
            '<label><input type="radio" name="' +
            row.id +
            '" value="' +
            choice.code +
            '" ' +
            (choice.code === (codes[i] ?? row.id + "?") ? "checked" : "") +
            ">" +
            html(choice.label) +
            "</label>"
        )
        .join("") +
      "</fieldset>"
  )
  .join("")}
<label>Checks passed <select name="quality">${options(qualities, current?.quality ?? "Unknown")}</select></label><button>Save selections</button>
<h2>Selected results to paste into chat</h2><p>Choose the readings above, then copy this result. Unselected or Unknown readings are omitted. Copying does not require saving.</p>
<textarea id="selected-results" readonly rows="8" aria-label="Selected results" spellcheck="false"></textarea>
<button type="button" id="copy-selected">Copy selected results</button><button type="button" id="select-selected">Select result text</button><span id="copy-status" role="status" aria-live="polite"></span>
</form><script>
const form = document.getElementById("readings-form");
const output = document.getElementById("selected-results");
const status = document.getElementById("copy-status");
const available = ${JSON.stringify(relevant(phase).map(({ id, title, choices }) => ({ id, title, choices: choices.map(({ code, label }) => ({ code, label })) }))).replaceAll("<", "\\u003c")};
const formatSelected = ${selectedResults.toString()};
function updateResult() {
  output.value = formatSelected(Object.fromEntries(new FormData(form)), available, ${JSON.stringify(scale)});
  status.textContent = "";
}
function selectResult() { output.focus(); output.select(); }
form.addEventListener("input", updateResult);
form.addEventListener("change", updateResult);
document.getElementById("select-selected").addEventListener("click", selectResult);
document.getElementById("copy-selected").addEventListener("click", async () => {
  updateResult(); selectResult();
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output.value);
    else if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
    status.textContent = "Selected results copied. Paste into chat.";
  } catch { status.textContent = "Result selected. Press Cmd+C or Ctrl+C to copy."; }
});
updateResult();
</script></html>`;
}
