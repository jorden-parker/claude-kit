import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRANT_MINUTES, recordGrants } from "./hook-bypass.ts";

const makeGrantsFile = () =>
  join(mkdtempSync(join(tmpdir(), "guards-grants-")), "nested", "grants.tsv");

const GRANT_SECONDS = GRANT_MINUTES * 60;

test("recordGrants writes one expiry and path line per file", () => {
  const grantsFile = makeGrantsFile();
  const expiry = recordGrants(
    ["/repo/a.json", "/repo/b.json"],
    1000,
    grantsFile
  );
  expect(expiry).toBe(1000 + GRANT_SECONDS);
  expect(readFileSync(grantsFile, "utf8")).toBe(
    `${expiry}\t/repo/a.json\n${expiry}\t/repo/b.json\n`
  );
});

test("recordGrants stores each path normalized with path.resolve", () => {
  const grantsFile = makeGrantsFile();
  const expiry = recordGrants(["/repo/./fixtures/../a.json"], 1000, grantsFile);
  expect(readFileSync(grantsFile, "utf8")).toBe(`${expiry}\t/repo/a.json\n`);
});

test("recordGrants rejects a relative path and names it", () => {
  expect(() =>
    recordGrants(["relative/a.json"], 1000, makeGrantsFile())
  ).toThrow("relative/a.json");
});

test("recordGrants rejects a path containing a tab", () => {
  expect(() =>
    recordGrants(["/repo/a\tb.json"], 1000, makeGrantsFile())
  ).toThrow("a\tb.json");
});

test("recordGrants rejects a path containing a newline", () => {
  expect(() =>
    recordGrants(["/repo/a\nb.json"], 1000, makeGrantsFile())
  ).toThrow("a\nb.json");
});

test("recordGrants rejects an empty list and a list over twenty paths", () => {
  const twentyOne = Array.from(
    { length: 21 },
    (item, index) => `/repo/${index}.json`
  );
  expect(() => recordGrants([], 1000, makeGrantsFile())).toThrow();
  expect(() => recordGrants(twentyOne, 1000, makeGrantsFile())).toThrow();
});

test("recordGrants drops expired lines and keeps live ones", () => {
  const grantsFile = makeGrantsFile();
  recordGrants(["/repo/expired.json"], 0, grantsFile);
  recordGrants(["/repo/live.json"], 600, grantsFile);
  const expiry = recordGrants(
    ["/repo/new.json"],
    GRANT_SECONDS + 1,
    grantsFile
  );
  expect(readFileSync(grantsFile, "utf8")).toBe(
    `${GRANT_SECONDS + 600}\t/repo/live.json\n${expiry}\t/repo/new.json\n`
  );
});
