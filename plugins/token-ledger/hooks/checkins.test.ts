import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, groupAnswers } from "./checkins.ts";
import { entries, formPage, save, summary } from "./checkin-form.ts";

test("measured values map to the laptop buttons at the exact boundaries", () => {
  expect(answer(1, 79999).code).toBe("B2");
  expect(answer(1, 80000).code).toBe("B3");
  const group = {
    sessions: 8,
    medianContextTokens: 93412,
    medianToolResultCharacters: 17800,
    medianTokens: 500000,
    cacheReadPercent: 75,
    nudgedSessions: 2,
  };
  const page = formPage([], new URLSearchParams());
  for (const line of groupAnswers(group).split("\n")) {
    const label = line.split(" → ")[1];
    expect(page).toContain(label.replaceAll("<", "&lt;"));
  }
  expect(groupAnswers({ ...group, sessions: 0 })).toContain("B? · Unknown");
});

test("updating a follow-up preserves the baseline and compares only known bands", () => {
  const home = mkdtempSync(join(tmpdir(), "ledger-work-"));
  try {
    const form = new URLSearchParams({
      version: "v1",
      experiment: "work",
      phase: "Before",
      quality: "First try",
      B: "B3",
    });
    save(home, form);
    form.set("phase", "After");
    save(home, form);
    expect(summary(entries(home))).toContain("direction uncertain");
    form.set("B", "B2");
    save(home, form);
    expect(entries(home)).toHaveLength(2);
    expect(summary(entries(home))).toContain("B2 · 40k–<80k (lower)");
    expect(formPage(entries(home), form)).toContain('value="B2" checked');
    form.set("version", "v0");
    expect(() => save(home, form)).toThrow();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
