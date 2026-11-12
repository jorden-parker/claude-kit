import { createSpecStreamCompiler } from "@json-render/core";
import { renderCatalogCss, renderSpecToHtml, type Spec, type StyleToken } from "./catalog";

const SPLIT_CHILD_LISTS = /"\s*\]\s*,\s*\[\s*"/g;
const TEXTS_AND_CHARACTERS = /"(?:[^"\\]|\\.)*"?|[\s\S]/g;
const CLOSERS = ["}", "]"];
const CLOSER_BY_OPENER: Record<string, string> = { "{": "}", "[": "]" };

const readLabeledLine = (replyText: string, label: string) =>
  new RegExp(`^${label}:[ \\t]*(.+)$`, "m").exec(replyText)?.[1]?.trim() ?? "";

const readRestyledTokens = (jsonText: string): unknown[] => {
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const balanceBrackets = (line: string) => {
  const awaitedClosers: string[] = [];
  const takeAwaitedCloser = (closer: string) =>
    awaitedClosers.at(-1) === closer && Boolean(awaitedClosers.pop());
  const keptTokens = (line.match(TEXTS_AND_CHARACTERS) ?? []).filter((token) => {
    if (CLOSER_BY_OPENER[token]) awaitedClosers.push(CLOSER_BY_OPENER[token]);
    return !CLOSERS.includes(token) || takeAwaitedCloser(token);
  });
  return keptTokens.join("") + awaitedClosers.reverse().join("");
};

const canTakeChildren = (value: unknown, children: unknown) =>
  Array.isArray(children) && Boolean(value) && typeof value === "object" && !("children" in (value as object));

const moveChildrenIntoValue = (patchText: string) => {
  try {
    const { children, ...patch } = JSON.parse(patchText);
    return canTakeChildren(patch.value, children)
      ? JSON.stringify({ ...patch, value: { ...patch.value, children } })
      : patchText;
  } catch {
    return patchText;
  }
};

const joinSplitChildLists = (patchText: string) => {
  const childrenStart = patchText.lastIndexOf('"children"');
  return childrenStart < 0
    ? patchText
    : patchText.slice(0, childrenStart) + patchText.slice(childrenStart).replace(SPLIT_CHILD_LISTS, '","');
};

export const mendPatchLine = (line: string) => {
  const patchText = line.trim().replace(/,$/, "");
  if (!patchText.startsWith("{")) return line;
  return moveChildrenIntoValue(balanceBrackets(joinSplitChildLists(patchText)));
};

export const readReplySpec = (replyText: string) => {
  const compiler = createSpecStreamCompiler<Spec>();
  let spec: Spec = {};
  for (const line of replyText.split("\n")) {
    try {
      spec = compiler.push(`${mendPatchLine(line)}\n`).result;
    } catch {
      continue;
    }
  }
  return spec;
};

export const parseVariantReply = (replyText: string, tokens: StyleToken[]) => ({
  name: readLabeledLine(replyText, "NAME"),
  rationale: readLabeledLine(replyText, "RATIONALE"),
  html: renderSpecToHtml(readReplySpec(replyText)),
  css: renderCatalogCss(tokens),
  restyledTokens: readRestyledTokens(readLabeledLine(replyText, "TOKENS")),
});
