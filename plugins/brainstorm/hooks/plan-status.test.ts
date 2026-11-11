import { expect, test } from "claude-code/testing";
import {
  readIndexEntries,
  readPlanStatus,
  setPlanStatus,
  type StatusFiles,
} from "./plan-status";

const RUN_FOLDER = "/repo/.claude/brainstorm/plans/plan-2026-11-11-1200";
const INDEX_PATH = `${RUN_FOLDER}/index.md`;
const ALPHA_FOLDER = `${RUN_FOLDER}/01-alpha`;
const ALPHA_PLAN_PATH = `${ALPHA_FOLDER}/plan.md`;

const INDEX_TEXT = [
  "# Plans: Test run",
  "",
  "- Ideas: #1 Alpha idea, #2 Beta idea",
  "- Written against: abc1234 on main",
  "",
  "## Plans",
  "",
  "| Order | Plan | Status | Kind | Depends on | Ideas |",
  "| ----- | ---- | ------ | ---- | ---------- | ----- |",
  "| 1 | [Alpha change](01-alpha/plan.md) | pending | change | none | #1 |",
  "| 2 | [Beta [draft] change](02-beta/plan.md) | pending | spike | 01-alpha | #2 |",
  "",
  "## Dropped",
  "",
  "None.",
  "",
].join("\n");

const PLAN_TEXT = [
  "# Plan: Alpha change",
  "",
  "- Status: pending",
  "- Ideas: #1 Alpha idea",
  "- Kind: change",
  "- Depends on: none",
  "",
  "## Goal",
  "",
  "Make the alpha thing work.",
  "",
].join("\n");

const createStatusFiles = (textByPath: Record<string, string>) => {
  const writtenTextByPath: Record<string, string> = {};
  const statusFiles: StatusFiles = {
    read: async (path) => textByPath[path],
    write: async (path, text) => {
      writtenTextByPath[path] = text;
    },
  };
  return { statusFiles, writtenTextByPath };
};

test("a plan's status is read from its Status line", () => {
  expect(readPlanStatus(PLAN_TEXT)).toBe("pending");
});

test("a plan without a Status line has no status", () => {
  expect(
    readPlanStatus(PLAN_TEXT.replace("- Status: pending\n", ""))
  ).toBeUndefined();
});

test("the index lists each plan folder with its status, in table order", () => {
  expect(readIndexEntries(INDEX_TEXT)).toEqual([
    { planFolder: "01-alpha", status: "pending" },
    { planFolder: "02-beta", status: "pending" },
  ]);
});

test("setting a status writes it to the plan file and to that plan's index row", async () => {
  const { statusFiles, writtenTextByPath } = createStatusFiles({
    [INDEX_PATH]: INDEX_TEXT,
    [ALPHA_PLAN_PATH]: PLAN_TEXT,
  });

  const problems = await setPlanStatus(statusFiles, ALPHA_FOLDER, "done");

  expect(problems).toEqual([]);
  expect(writtenTextByPath[ALPHA_PLAN_PATH]).toBe(
    PLAN_TEXT.replace("- Status: pending", "- Status: done")
  );
  expect(writtenTextByPath[INDEX_PATH]).toBe(
    INDEX_TEXT.replace(
      "(01-alpha/plan.md) | pending |",
      "(01-alpha/plan.md) | done |"
    )
  );
});

test("setting a status leaves the other plans' index rows alone", async () => {
  const { statusFiles, writtenTextByPath } = createStatusFiles({
    [INDEX_PATH]: INDEX_TEXT,
    [`${RUN_FOLDER}/02-beta/plan.md`]: PLAN_TEXT,
  });

  await setPlanStatus(statusFiles, `${RUN_FOLDER}/02-beta/`, "in-progress");

  expect(readIndexEntries(writtenTextByPath[INDEX_PATH] ?? "")).toEqual([
    { planFolder: "01-alpha", status: "pending" },
    { planFolder: "02-beta", status: "in-progress" },
  ]);
});

test("an unknown status is refused and nothing is written", async () => {
  const { statusFiles, writtenTextByPath } = createStatusFiles({
    [INDEX_PATH]: INDEX_TEXT,
    [ALPHA_PLAN_PATH]: PLAN_TEXT,
  });

  const problems = await setPlanStatus(statusFiles, ALPHA_FOLDER, "finished");

  expect(problems).toEqual([
    "Status must be pending, in-progress, done or blocked",
  ]);
  expect(writtenTextByPath).toEqual({});
});

test("a plan the index does not list is refused and nothing is written", async () => {
  const { statusFiles, writtenTextByPath } = createStatusFiles({
    [INDEX_PATH]: INDEX_TEXT,
    [`${RUN_FOLDER}/03-gamma/plan.md`]: PLAN_TEXT,
  });

  const problems = await setPlanStatus(
    statusFiles,
    `${RUN_FOLDER}/03-gamma`,
    "done"
  );

  expect(problems).toEqual([`${INDEX_PATH}: has no row for 03-gamma`]);
  expect(writtenTextByPath).toEqual({});
});

test("a plan file without a Status line is refused and nothing is written", async () => {
  const { statusFiles, writtenTextByPath } = createStatusFiles({
    [INDEX_PATH]: INDEX_TEXT,
    [ALPHA_PLAN_PATH]: PLAN_TEXT.replace("- Status: pending\n", ""),
  });

  const problems = await setPlanStatus(statusFiles, ALPHA_FOLDER, "done");

  expect(problems).toEqual([`${ALPHA_PLAN_PATH}: has no Status line`]);
  expect(writtenTextByPath).toEqual({});
});

test("a missing plan file or index is refused", async () => {
  const { statusFiles } = createStatusFiles({});

  const problems = await setPlanStatus(statusFiles, ALPHA_FOLDER, "done");

  expect(problems).toEqual([
    `${ALPHA_PLAN_PATH}: missing`,
    `${INDEX_PATH}: missing`,
  ]);
});
