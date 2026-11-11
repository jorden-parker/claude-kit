export type TemplateFiles = {
  read: (filePath: string) => Promise<string | undefined>;
  list: (folder: string) => Promise<string[]>;
};

export type PrTemplate = { path: string; text: string };

export const DEFAULT_PR_TEMPLATE = `## Summary

<!-- What this pull request changes, and why. -->

## Changes

<!-- The notable changes, one bullet each. -->

## Testing

<!-- How the change was tested, with the commands that were run. -->
`;

const TEMPLATE_FOLDERS = [".github", "", "docs"];
const TEMPLATE_FILE_NAME = "pull_request_template.md";
const TEMPLATE_FOLDER_NAME = "pull_request_template";
const MARKDOWN_FILE_PATTERN = /\.md$/i;

const joinPath = (...pathParts: string[]) =>
  pathParts.filter(Boolean).join("/");

const readTemplate = async (
  templateFiles: TemplateFiles,
  projectRoot: string,
  templatePath: string
): Promise<PrTemplate | undefined> => {
  const templateText = await templateFiles.read(
    joinPath(projectRoot, templatePath)
  );
  return templateText === undefined
    ? undefined
    : { path: templatePath, text: templateText };
};

const listFolderTemplatePaths = async (
  templateFiles: TemplateFiles,
  projectRoot: string,
  folder: string
) => {
  const entryNames = await templateFiles.list(joinPath(projectRoot, folder));
  const singleFilePaths = entryNames
    .filter((entryName) => entryName.toLowerCase() === TEMPLATE_FILE_NAME)
    .map((entryName) => joinPath(folder, entryName));
  const templateFolderPaths = entryNames
    .filter((entryName) => entryName.toLowerCase() === TEMPLATE_FOLDER_NAME)
    .map((entryName) => joinPath(folder, entryName));
  const nestedPaths = await Promise.all(
    templateFolderPaths.map(async (templateFolderPath) => {
      const nestedNames = await templateFiles.list(
        joinPath(projectRoot, templateFolderPath)
      );
      return nestedNames
        .filter((nestedName) => MARKDOWN_FILE_PATTERN.test(nestedName))
        .sort()
        .map((nestedName) => joinPath(templateFolderPath, nestedName));
    })
  );
  return [...singleFilePaths, ...nestedPaths.flat()];
};

export const findPrTemplates = async (
  templateFiles: TemplateFiles,
  projectRoot: string
): Promise<PrTemplate[]> => {
  const templatePathsByFolder = await Promise.all(
    TEMPLATE_FOLDERS.map((folder) =>
      listFolderTemplatePaths(templateFiles, projectRoot, folder)
    )
  );
  const templates = await Promise.all(
    templatePathsByFolder
      .flat()
      .map((templatePath) =>
        readTemplate(templateFiles, projectRoot, templatePath)
      )
  );
  return templates.filter(
    (template): template is PrTemplate => template !== undefined
  );
};

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const CHECKLIST_ITEM_PATTERN = /^\s*[-*+]\s+\[[ xX]\]\s+(.*?)\s*$/;

const listProseLines = (markdownText: string) => {
  const proseLines: string[] = [];
  let isInsideCodeFence = false;
  const uncommentedText = markdownText.replace(HTML_COMMENT_PATTERN, "");
  for (const line of uncommentedText.split("\n")) {
    if (CODE_FENCE_PATTERN.test(line)) {
      isInsideCodeFence = !isInsideCodeFence;
      continue;
    }
    if (!isInsideCodeFence) proseLines.push(line);
  }
  return proseLines;
};

const collectMatches = (markdownText: string, linePattern: RegExp) =>
  listProseLines(markdownText)
    .map((line) => linePattern.exec(line))
    .filter((lineMatch): lineMatch is RegExpExecArray => lineMatch !== null);

export const listTemplateHeadings = (templateText: string) =>
  collectMatches(templateText, HEADING_PATTERN).map(
    (headingMatch) => `${headingMatch[1]} ${headingMatch[2]}`
  );

const listChecklistItems = (markdownText: string) =>
  collectMatches(markdownText, CHECKLIST_ITEM_PATTERN).map(
    (itemMatch) => itemMatch[1] ?? ""
  );

const normalizeForComparison = (text: string) =>
  text.toLowerCase().replace(/\s+/g, " ").trim();

const findMissing = (expectedTexts: string[], presentTexts: string[]) => {
  const presentKeys = new Set(presentTexts.map(normalizeForComparison));
  return expectedTexts.filter(
    (expectedText) => !presentKeys.has(normalizeForComparison(expectedText))
  );
};

export const findMissingTemplateParts = (
  templateText: string,
  body: string
) => [
  ...findMissing(
    listTemplateHeadings(templateText),
    listTemplateHeadings(body)
  ).map((heading) => `heading "${heading}"`),
  ...findMissing(
    listChecklistItems(templateText),
    listChecklistItems(body)
  ).map((checklistItem) => `checklist item "${checklistItem}"`),
];
