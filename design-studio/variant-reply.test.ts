import { expect, test } from "bun:test";
import { renderCatalogCss } from "./catalog";
import { mendPatchLine, parseVariantReply, readReplySpec } from "./variant-reply";

const TOKENS = [{ name: "primary", kind: "color", value: "#2563eb" }];
const ROOT_LINE = '{"op":"add","path":"/root","value":"page"}';
const PAGE_LINE =
  '{"op":"add","path":"/elements/page","value":{"type":"Page","props":{},"children":["title"]}}';
const TITLE_LINE =
  '{"op":"add","path":"/elements/title","value":{"type":"Heading","props":{"text":"Cook tonight","level":"1"}}}';
const FULL_REPLY = [
  "NAME: Split hero",
  "RATIONALE: Puts the call to action beside the picture.",
  ROOT_LINE,
  PAGE_LINE,
  TITLE_LINE,
  'TOKENS: [{"name":"primary","value":"#0f766e"}]',
].join("\n");

test("parseVariantReply reads the name, rationale, rendered html, catalog css and restyled tokens", () => {
  const variant = parseVariantReply(FULL_REPLY, TOKENS);
  expect(variant).toEqual({
    name: "Split hero",
    rationale: "Puts the call to action beside the picture.",
    html: expect.stringContaining('<h1 class="heading heading-1">Cook tonight</h1>'),
    css: renderCatalogCss(TOKENS),
    restyledTokens: [{ name: "primary", value: "#0f766e" }],
  });
});

test("parseVariantReply leaves the restyled tokens empty without a TOKENS line or with a broken one", () => {
  const withoutTokens = FULL_REPLY.split("TOKENS")[0]!;
  expect(parseVariantReply(withoutTokens, TOKENS).restyledTokens).toEqual([]);
  expect(parseVariantReply(`${withoutTokens}TOKENS: [{"name":`, TOKENS).restyledTokens).toEqual([]);
});

test("parseVariantReply returns empty text for the parts a reply lacks", () => {
  expect(parseVariantReply("Sorry, I cannot.", TOKENS)).toMatchObject({
    name: "",
    rationale: "",
    html: "",
    restyledTokens: [],
  });
});

test("mendPatchLine closes a line that lacks its last brace", () => {
  expect(JSON.parse(mendPatchLine(PAGE_LINE.slice(0, -1)))).toEqual(JSON.parse(PAGE_LINE));
});

test("mendPatchLine joins child lists a model split in two and drops the surplus bracket", () => {
  const splitLine =
    '{"op":"add","path":"/elements/tabs","value":{"type":"Stack","props":{},"children":["login"],["signup"]]}}';
  expect(JSON.parse(mendPatchLine(splitLine)).value.children).toEqual(["login", "signup"]);
});

test("mendPatchLine moves children written beside the value into it", () => {
  const besideLine =
    '{"op":"add","path":"/elements/hero","value":{"type":"Stack","gap":"md"},"children":["title"]}';
  expect(JSON.parse(mendPatchLine(besideLine)).value).toEqual({
    type: "Stack",
    gap: "md",
    children: ["title"],
  });
});

test("mendPatchLine leaves braces inside text alone and returns other lines as they are", () => {
  const braceLine = '{"op":"add","path":"/elements/code","value":{"type":"Text","props":{"text":"Use {name} ]"}}}';
  expect(mendPatchLine(braceLine)).toBe(braceLine);
  expect(mendPatchLine("NAME: Split hero")).toBe("NAME: Split hero");
});

test("readReplySpec reads a fenced reply, mends its lines and skips a patch it cannot apply", () => {
  const spec = readReplySpec(
    ["```spec", ROOT_LINE, '{"op":"add","path":5,"value":"page"}', PAGE_LINE.slice(0, -1), TITLE_LINE, "```"].join("\n")
  );
  expect(spec.root).toBe("page");
  expect(Object.keys(spec.elements ?? {})).toEqual(["page", "title"]);
});

test("mendPatchLine keeps the rows of a table apart, also in a line it has to close", () => {
  const tableLine =
    '{"op":"add","path":"/elements/orders","value":{"type":"Table","props":{"columns":["Bike"],"rows":[["Trek"],["Brompton"]]},"children":[]}}';
  expect(mendPatchLine(tableLine)).toBe(tableLine);
  expect(JSON.parse(mendPatchLine(tableLine.slice(0, -1))).value.props.rows).toEqual([["Trek"], ["Brompton"]]);
});
