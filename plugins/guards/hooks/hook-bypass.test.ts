import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GRANT_MINUTES, mergeGrants } from "./hook-bypass.ts";

const GRANT_SECONDS = GRANT_MINUTES * 60;

test("mergeGrants writes one expiry and path line per file", () => {
  const { expiry, text } = mergeGrants(
    "",
    ["/repo/a.json", "/repo/b.json"],
    1000
  );
  expect(expiry).toBe(1000 + GRANT_SECONDS);
  expect(text).toBe(`${expiry}\t/repo/a.json\n${expiry}\t/repo/b.json\n`);
});

test("mergeGrants stores each path normalized like node path.resolve", () => {
  const { expiry, text } = mergeGrants(
    "",
    ["/repo/./fixtures/../a.json"],
    1000
  );
  expect(text).toBe(`${expiry}\t/repo/a.json\n`);
});

test("mergeGrants collapses repeated and trailing slashes and never climbs above root", () => {
  const { expiry, text } = mergeGrants(
    "",
    ["/repo//nested/", "/../../etc/x.json"],
    1000
  );
  expect(text).toBe(`${expiry}\t/repo/nested\n${expiry}\t/etc/x.json\n`);
});

test("mergeGrants rejects a relative path and names it", () => {
  expect(() => mergeGrants("", ["relative/a.json"], 1000)).toThrow(
    "Hook bypass path must be absolute with no tab or newline: relative/a.json"
  );
});

test("mergeGrants rejects a path containing a tab", () => {
  expect(() => mergeGrants("", ["/repo/a\tb.json"], 1000)).toThrow();
});

test("mergeGrants rejects a path containing a newline", () => {
  expect(() => mergeGrants("", ["/repo/a\nb.json"], 1000)).toThrow();
});

test("mergeGrants rejects an empty list and a list over twenty paths", () => {
  const twentyOne = Array.from(
    { length: 21 },
    (_, index) => `/repo/${index}.json`
  );
  expect(() => mergeGrants("", [], 1000)).toThrow(
    "Hook bypass takes 1 to 20 files, got 0."
  );
  expect(() => mergeGrants("", twentyOne, 1000)).toThrow(
    "Hook bypass takes 1 to 20 files, got 21."
  );
});

test("mergeGrants drops expired lines and keeps live ones", () => {
  const expired = mergeGrants("", ["/repo/expired.json"], 0);
  const live = mergeGrants(expired.text, ["/repo/live.json"], expired.expiry);
  expect(live.text).toBe(`${live.expiry}\t/repo/live.json\n`);
  const merged = mergeGrants(live.text, ["/repo/third.json"], live.expiry - 1);
  expect(merged.text).toBe(
    `${live.expiry}\t/repo/live.json\n${merged.expiry}\t/repo/third.json\n`
  );
});

test("hook-bypass.ts and register.ts import no node modules", () => {
  for (const fileName of ["hook-bypass.ts", "register.ts"]) {
    const source = readFileSync(
      new URL(`./${fileName}`, import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/from\s+["']node:/);
  }
});
