import { expect, test } from "bun:test";
import { renderCatalogCss } from "./catalog";
import { parseVariantReply } from "./variant-reply";

const TOKENS = [
  { name: "primary", kind: "color", value: "#0f766e" },
  { name: "Font Sans", kind: "font", value: "system-ui" },
];

const FULL_REPLY = [
  "NAME: Split hero",
  "RATIONALE: Puts the call to action beside the picture.",
  '{"op":"add","path":"/root","value":"page"}',
  '{"op":"add","path":"/elements/page","value":{"type":"Page","props":{},"children":["title"]}}',
  '{"op":"add","path":"/elements/title","value":{"type":"Heading","props":{"text":"Cook tonight","level":"1"}}}',
  'TOKENS: [{"name":"primary","value":"#be123c"}]',
].join("\n");

test("parseVariantReply reads the name, rationale, html, css and restyled tokens", () => {
  expect(parseVariantReply(FULL_REPLY, TOKENS)).toEqual({
    name: "Split hero",
    rationale: "Puts the call to action beside the picture.",
    html: '<main class="page"><h1 class="heading heading-1">Cook tonight</h1></main>',
    css: renderCatalogCss(TOKENS),
    restyledTokens: [{ name: "primary", value: "#be123c" }],
  });
});

test("parseVariantReply leaves the restyled tokens empty without a TOKENS line or with a broken one", () => {
  const withoutTokens = FULL_REPLY.split("\nTOKENS:")[0]!;
  expect(parseVariantReply(withoutTokens, TOKENS).restyledTokens).toEqual([]);
  expect(
    parseVariantReply(`${withoutTokens}\nTOKENS: [{"name":\n`, TOKENS).restyledTokens
  ).toEqual([]);
});

test("parseVariantReply returns empty text for the parts a reply lacks", () => {
  expect(parseVariantReply("Sorry, I cannot.", TOKENS)).toEqual({
    name: "",
    rationale: "",
    html: "",
    css: renderCatalogCss(TOKENS),
    restyledTokens: [],
  });
});
