import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  describeBlockedAgent,
  isRepositoryAgent,
  parseSavedModels,
  REPOSITORY_AGENT_TYPES,
  resolveSpawn,
} from "./repository-agents.ts";

const PLUGINS_FOLDER = join(import.meta.dir, "..", "..");

function agentTypesOnDisk(): string[] {
  const files = [...new Glob("*/agents/*.md").scanSync(PLUGINS_FOLDER)];
  return files
    .map((file) => {
      const text = readFileSync(join(PLUGINS_FOLDER, file), "utf8");
      const name = text.match(/^name:\s*(\S+)/m)?.[1];
      return `${basename(dirname(dirname(file)))}:${name}`;
    })
    .sort();
}

test("lists exactly the agents defined in this repository", () => {
  expect([...REPOSITORY_AGENT_TYPES]).toEqual(agentTypesOnDisk());
});

test.each([
  "guards:context-scout",
  "guards:worker",
  "guards:web-researcher",
  "guards:planner",
  "guards:reviewer",
  "guards:generalist",
])("accepts %s", (agentType) => {
  expect(isRepositoryAgent(agentType)).toBe(true);
});

test.each([
  "fork",
  "general-purpose",
  "Explore",
  "claude",
  "vercel:ai-architect",
  "",
  undefined,
])("rejects %p", (agentType) => {
  expect(isRepositoryAgent(agentType)).toBe(false);
});

test("describes a blocked type, lists the allowed types and hints", () => {
  const sentence = describeBlockedAgent("Explore");
  expect(sentence).toContain("Explore");
  for (const agentType of REPOSITORY_AGENT_TYPES) {
    expect(sentence).toContain(agentType);
  }
  expect(sentence).toContain("guards:context-scout");
  expect(sentence).toContain("guards:worker");
  expect(sentence).toContain("guards:web-researcher");
  expect(sentence).toContain("guards:generalist");
});

test("describes an omitted type", () => {
  expect(describeBlockedAgent(undefined)).toContain("no subagent_type");
});

test("denies a spawn of a type outside the repository", () => {
  const result = resolveSpawn("general-purpose", {});
  expect(result).toEqual({ deny: describeBlockedAgent("general-purpose") });
});

test("applies the saved model of a repository agent", () => {
  expect(
    resolveSpawn("guards:worker", { "guards:worker": "claude-sonnet-5-5" })
  ).toEqual({ model: "claude-sonnet-5-5" });
});

test.each<Record<string, string>>([
  {},
  { "guards:worker": "" },
  { "guards:planner": "haiku" },
])("leaves the model alone when none is saved: %j", (saved) => {
  expect(resolveSpawn("guards:worker", saved)).toEqual({});
});

test("parses a saved model file", () => {
  expect(parseSavedModels('{"guards:worker":"haiku"}')).toEqual({
    "guards:worker": "haiku",
  });
});

test("drops entries that are not strings", () => {
  expect(parseSavedModels('{"a":"haiku","b":3,"c":null}')).toEqual({
    a: "haiku",
  });
});

test.each(["", "not json", "[]", "null", "3", '"x"'])(
  "parses %p as no saved models",
  (text) => {
    expect(parseSavedModels(text)).toEqual({});
  }
);
