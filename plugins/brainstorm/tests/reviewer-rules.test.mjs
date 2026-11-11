import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const readPluginFile = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const checkerSource = readPluginFile("hooks/plan-check.ts");
const reviewerInstructions = readPluginFile("agents/plan-reviewer.md");

test("the reviewer agent's rules name every banned phrase of the checker", () => {
  const bannedPhrasesSource =
    /BANNED_PHRASES = \[([^\]]*)\]/.exec(checkerSource)?.[1] ?? "";
  const bannedPhrases = [...bannedPhrasesSource.matchAll(/"([^"]+)"/g)].map(
    (phraseMatch) => phraseMatch[1]
  );
  const missingPhrases = bannedPhrases.filter(
    (phrase) => !reviewerInstructions.includes(`"${phrase}"`)
  );

  assert.notEqual(bannedPhrases.length, 0);
  assert.deepEqual(missingPhrases, []);
});

test("the reviewer agent's rules state the checker's line limit", () => {
  const lineLimit = /MAX_CHANGED_LINES_PER_STEP = (\d+)/.exec(
    checkerSource
  )?.[1];

  assert.ok(lineLimit);
  assert.ok(reviewerInstructions.includes(`at most ${lineLimit} lines`));
});
