import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "./read-guard.ts";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "rg-"));
const big = join(fixtureDirectory, "big.txt");
const small = join(fixtureDirectory, "small.txt");
writeFileSync(big, "x\n".repeat(301));
writeFileSync(small, "x\n".repeat(300));

test("denies a big file without limit", () =>
  expect(decide({ tool_input: { file_path: big } })).not.toBeNull());
test("allows a big file with limit 300", () =>
  expect(decide({ tool_input: { file_path: big, limit: 300 } })).toBeNull());
test("denies limit 301", () =>
  expect(
    decide({ tool_input: { file_path: big, limit: 301 } })
  ).not.toBeNull());
test("allows a 300-line file", () =>
  expect(decide({ tool_input: { file_path: small } })).toBeNull());
test("allows a missing file", () =>
  expect(
    decide({ tool_input: { file_path: join(fixtureDirectory, "no") } })
  ).toBeNull());
test("denial message never points at the denied Grep tool", () =>
  expect(
    JSON.stringify(decide({ tool_input: { file_path: big } }))
  ).not.toMatch(/Glob|Grep/));

const wide = join(fixtureDirectory, "wide.json");
const binary = join(fixtureDirectory, "blob.bin");
writeFileSync(wide, "x".repeat(6_000_000));
writeFileSync(binary, Buffer.alloc(6_000_000));

test("denies a few-line file over the byte limit", () =>
  expect(JSON.stringify(decide({ tool_input: { file_path: wide } }))).toContain(
    "is 6 MB"
  ));
test("allows the over-limit text file with a limit", () =>
  expect(decide({ tool_input: { file_path: wide, limit: 100 } })).toBeNull());
test("allows a large binary file", () =>
  expect(decide({ tool_input: { file_path: binary } })).toBeNull());
