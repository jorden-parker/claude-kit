import { compileSpecStream } from "@json-render/core";
import { renderCatalogCss, renderSpecToHtml, type StyleToken } from "./catalog";

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

export const readReplySpec = (replyText: string) => compileSpecStream(replyText);

export const parseVariantReply = (replyText: string, tokens: StyleToken[]) => ({
  name: readLabeledLine(replyText, "NAME"),
  rationale: readLabeledLine(replyText, "RATIONALE"),
  html: renderSpecToHtml(readReplySpec(replyText)),
  css: renderCatalogCss(tokens),
  restyledTokens: readRestyledTokens(readLabeledLine(replyText, "TOKENS")),
});
