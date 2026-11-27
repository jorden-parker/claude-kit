import { expect, test } from "bun:test";
import { verifyPage } from "./verify-page.ts";

test("deployment readings are escaped and explain session coverage", () => {
  const group = {
    sessions: 8,
    medianContextTokens: 40000,
    medianToolResultCharacters: 10000,
    medianTokens: 100000,
    cacheReadPercent: 75,
    nudgedSessions: 0,
  };
  const page = verifyPage({
    title: "Update </textarea><script>bad()</script>",
    since: "2026-11-27T00:00:00Z",
    before: group,
    after: { ...group, sessions: 2 },
    spanningSessions: 3,
  });
  expect(page).toContain("8 sessions");
  expect(page).toContain("2 sessions");
  expect(page).toContain("Excludes 3 sessions");
  expect(page).toContain("all locally recorded sessions across projects");
  expect(page).toContain("including subagent totals");
  expect(page).toContain("Sessions on other machines");
  expect(page).toContain("Fewer than five follow-up sessions");
  expect(page).not.toContain("Update </textarea><script>");
});
test("no deployment still renders without copy controls", () => {
  expect(verifyPage()).toContain("No deployments recorded");
  expect(verifyPage()).not.toContain('id="copy-results"');
});
