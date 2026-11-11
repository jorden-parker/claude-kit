import { expect, test } from "claude-code/testing";
import {
  DEFAULT_PR_TEMPLATE,
  findMissingTemplateParts,
  findPrTemplates,
  listTemplateHeadings,
  type TemplateFiles,
} from "./pr-template";

const buildTemplateFiles = (
  textByPath: Record<string, string>
): TemplateFiles => ({
  read: async (filePath) => textByPath[filePath],
  list: async (folder) => {
    const childNames = Object.keys(textByPath)
      .filter((filePath) => filePath.startsWith(`${folder}/`))
      .map((filePath) => filePath.slice(folder.length + 1).split("/")[0] ?? "");
    return [...new Set(childNames)];
  },
});

const TEMPLATE_TEXT = [
  "<!-- Thanks for the PR!",
  "## Not a heading, this is a comment",
  "-->",
  "## Summary",
  "",
  "<!-- What changed and why -->",
  "",
  "## Test plan",
  "",
  "```md",
  "## Not a heading, this is code",
  "```",
  "",
  "### Checklist",
  "",
  "- [ ] Tests added",
  "- [ ] Docs updated",
  "",
].join("\n");

test("finds the template in .github whatever its letter case", async () => {
  const templateFiles = buildTemplateFiles({
    "/repo/.github/PULL_REQUEST_TEMPLATE.md": TEMPLATE_TEXT,
    "/repo/README.md": "# Readme",
  });

  const templates = await findPrTemplates(templateFiles, "/repo");

  expect(templates).toEqual([
    { path: ".github/PULL_REQUEST_TEMPLATE.md", text: TEMPLATE_TEXT },
  ]);
});

test("finds templates in the project root and in docs", async () => {
  const templateFiles = buildTemplateFiles({
    "/repo/pull_request_template.md": "## Root",
    "/repo/docs/pull_request_template.md": "## Docs",
  });

  const templates = await findPrTemplates(templateFiles, "/repo");

  expect(templates.map((template) => template.path)).toEqual([
    "pull_request_template.md",
    "docs/pull_request_template.md",
  ]);
});

test("finds every template of a PULL_REQUEST_TEMPLATE folder", async () => {
  const templateFiles = buildTemplateFiles({
    "/repo/.github/PULL_REQUEST_TEMPLATE/bugfix.md": "## Bug",
    "/repo/.github/PULL_REQUEST_TEMPLATE/feature.md": "## Feature",
    "/repo/.github/PULL_REQUEST_TEMPLATE/notes.txt": "not a template",
  });

  const templates = await findPrTemplates(templateFiles, "/repo");

  expect(templates.map((template) => template.path)).toEqual([
    ".github/PULL_REQUEST_TEMPLATE/bugfix.md",
    ".github/PULL_REQUEST_TEMPLATE/feature.md",
  ]);
});

test("finds no template in a project without one", async () => {
  const templateFiles = buildTemplateFiles({ "/repo/README.md": "# Readme" });

  expect(await findPrTemplates(templateFiles, "/repo")).toEqual([]);
});

test("lists the headings outside comments and code fences", () => {
  expect(listTemplateHeadings(TEMPLATE_TEXT)).toEqual([
    "## Summary",
    "## Test plan",
    "### Checklist",
  ]);
});

test("a body that keeps every heading and checklist item has nothing missing", () => {
  const body = [
    "## Summary",
    "Adds token expiry.",
    "## Test Plan",
    "Ran the suite.",
    "### Checklist ###",
    "- [x] Tests added",
    "- [ ] Docs updated",
  ].join("\n");

  expect(findMissingTemplateParts(TEMPLATE_TEXT, body)).toEqual([]);
});

test("names the headings and checklist items a body dropped", () => {
  const body = ["## Summary", "Adds token expiry.", "- [x] Tests added"].join(
    "\n"
  );

  expect(findMissingTemplateParts(TEMPLATE_TEXT, body)).toEqual([
    'heading "## Test plan"',
    'heading "### Checklist"',
    'checklist item "Docs updated"',
  ]);
});

test("the default template has headings of its own", () => {
  expect(listTemplateHeadings(DEFAULT_PR_TEMPLATE)).toEqual([
    "## Summary",
    "## Changes",
    "## Testing",
  ]);
});
