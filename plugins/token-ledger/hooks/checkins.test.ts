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

test("CLI analysis and verification read saved work answers without local sessions", () => {
  const home = mkdtempSync(join(tmpdir(), "ledger-cli-"));
  const cli = join(import.meta.dir, "../bin/claude-ledger");
  const run = (...args: string[]) =>
    Bun.spawnSync([cli, ...args], { env: { ...process.env, HOME: home } });
  try {
    const form = new URLSearchParams({
      version: "v1",
      experiment: "test workload",
      phase: "Before",
      quality: "First try",
      B: "B3",
    });
    save(home, form);
    form.set("phase", "After");
    form.set("A", "A2");
    form.set("B", "B2");
    save(home, form);
    for (const args of [
      ["analyze", "1"],
      ["verify"],
      ["verify", "since", "2026-11-25"],
      ["--verify", "2026-11-25"],
    ]) {
      const result = run(...args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("B2 · 40k–<80k (lower)");
      expect(result.stdout.toString()).toContain("too early");
    }
    for (const args of [
      ["analyze", "0"],
      ["verify", "since", "2026-02-30"],
      ["verify", "since"],
    ]) {
      expect(run(...args).exitCode).toBe(2);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
