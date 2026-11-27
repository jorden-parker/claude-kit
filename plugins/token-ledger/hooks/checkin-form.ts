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
<style>body{font:16px system-ui;margin:2rem auto;max-width:62rem;padding:0 1rem}fieldset{border:0;border-top:1px solid #aaa;margin:1rem 0}label{display:inline-block;padding:.45rem}label:has(input:checked){background:#dbeafe;color:#132544}button,select,input{font:inherit}button{padding:.4rem .8rem}</style>
<h1>Record work results</h1><p>Match the codes in Laptop check-in · ${scale} on the work screen.</p>
<form><label>Experiment and workload <input name="experiment" maxlength="160" required list="names" value="${html(experiment)}"></label><datalist id="names">${options([...new Set(records.map((r) => r.experiment))], "")}</datalist>
<label>Report <select name="phase">${options(phases, phase)}</select></label><button>Open selections</button></form>
<h2>${html(experiment)} · ${html(phase)}</h2>${query.has("saved") ? '<p role="status">Selections saved.</p>' : ""}
<form method="post"><input type="hidden" name="version" value="${scale}"><input type="hidden" name="experiment" value="${html(experiment)}"><input type="hidden" name="phase" value="${html(phase)}">
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
<label>Checks passed <select name="quality">${options(qualities, current?.quality ?? "Unknown")}</select></label><button>Save selections</button></form></html>`;
}
