import { expect, test } from "bun:test";
import { selectedResults, formPage } from "./checkin-form.ts";
import { rows } from "./checkins.ts";

test("copy contains only selected relevant readings", () => {
  const values = {
    experiment: "Work",
    phase: "After",
    quality: "First try",
    A: "A3",
    B: "B2",
    C: "C?",
    G: "G3",
  };
  const result = selectedResults(values, rows.slice(0, 6), "v1");
  expect(result).toContain("Work · After · v1");
  expect(result).toContain("Sessions: A3");
  expect(result).toContain("Median context tokens: B2");
  expect(result).not.toContain("Median tool-result");
  expect(result).not.toContain("G3");
  expect(result).not.toContain("Cache reads");
  expect(
    selectedResults({ phase: "Before" }, rows.slice(0, 6), "v1")
  ).toContain("No readings selected.");
});
test("form preview updates from current selections and copy does not submit", () => {
  const page = formPage([], new URLSearchParams());
  expect(page).toContain('id="selected-results" readonly');
  expect(page).toContain('type="button" id="copy-selected"');
  expect(page).toContain("new FormData(form)");
  expect(page).toContain('form.addEventListener("change", updateResult)');
  expect(page).toContain("Press Cmd+C or Ctrl+C");
  expect(page).not.toContain('"low":null');
});

test("rendered browser script copies current radio inputs without saving", async () => {
  const { runInNewContext } = await import("node:vm");
  const callbacks: Record<string, () => any> = {};
  let values: Record<string, string> = {
    experiment: "Work",
    phase: "Before",
    quality: "Unknown",
    B: "B?",
  };
  let copied = "";
  const result = { value: "", focus() {}, select() {} };
  const status = { textContent: "" };
  const form = {
    addEventListener(name: string, callback: () => any) {
      callbacks[name] = callback;
    },
  };
  const nodes: Record<string, any> = {
    "readings-form": form,
    "selected-results": result,
    "copy-status": status,
  };
  for (const id of ["copy-selected", "select-selected"])
    nodes[id] = {
      addEventListener(_name: string, callback: () => any) {
        callbacks[id] = callback;
      },
    };
  const page = formPage([], new URLSearchParams());
  runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)![1], {
    document: {
      getElementById(id: string) {
        return nodes[id];
      },
    },
    FormData: class {
      [Symbol.iterator]() {
        return Object.entries(values)[Symbol.iterator]();
      }
    },
    navigator: {
      clipboard: {
        async writeText(value: string) {
          copied = value;
        },
      },
    },
  });
  expect(result.value).toContain("No readings selected.");
  values = { ...values, B: "B2" };
  callbacks.change();
  expect(result.value).toContain("Median context tokens: B2");
  await callbacks["copy-selected"]();
  expect(copied).toBe(result.value);
  expect(copied).not.toContain("Cache reads");
  expect(status.textContent).toContain("copied");
});
