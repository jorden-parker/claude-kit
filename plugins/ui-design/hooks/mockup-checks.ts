import { MAX_NEW_TOKENS } from "./design-page";
import { listProblemUnless } from "./input";
import { findHardcodedValues, type LiteralKind } from "./hardcoded-values";
import type { ThemeToken } from "./theme";

const RAW_KINDS = ["color", "font"] as const;
const HTML_TAG = /<[a-z][^>]*>/gi;
const STYLE_ELEMENT = /<style[\s>]/i;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const COLOR_ATTRIBUTE =
  /\s(?:fill|stroke|stop-color|flood-color|color)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

const readAttributeValues = (html: string, attribute: RegExp) =>
  [...(html.match(HTML_TAG) ?? []).join("\n").matchAll(attribute)]
    .map((match) => match[1] ?? match[2] ?? "")
    .join("\n");

const readColorAttributeDeclarations = (html: string) =>
  readAttributeValues(html, COLOR_ATTRIBUTE)
    .split("\n")
    .map((colorValue) => `color: ${colorValue}`)
    .join("\n");

const describeRawValues = (
  sourceText: string,
  place: string,
  searchedKinds: readonly LiteralKind[] = RAW_KINDS
) =>
  findHardcodedValues(sourceText, searchedKinds).map(
    ({ kind, value }) =>
      `raw ${kind} ${value} in its ${place}. Use var(--token).`
  );

export const listNewTokenProblems = (
  newTokens: ThemeToken[],
  tokenProblems: string[]
) => [
  ...listProblemUnless(
    newTokens.length <= MAX_NEW_TOKENS,
    `at most three newTokens, and it has ${newTokens.length}.`
  ),
  ...tokenProblems,
];

export const listRawCssProblems = (css: string) =>
  describeRawValues(css, "css");

export const listMarkupProblems = (html: string) => [
  ...listProblemUnless(
    !STYLE_ELEMENT.test(html),
    "a <style> element in its html. Styles belong in css."
  ),
  ...describeRawValues(
    readAttributeValues(html, STYLE_ATTRIBUTE),
    "html style attributes"
  ),
  ...describeRawValues(
    readColorAttributeDeclarations(html),
    "html color attributes",
    ["color"]
  ),
];
