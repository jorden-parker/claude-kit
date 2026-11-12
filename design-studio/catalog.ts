import { defineCatalog, defineSchema, validateSpec } from "@json-render/core";
import { z } from "zod";
import { escapeHtml } from "../plugins/ui-design/hooks/design-page";
import { readTokenVariable } from "../plugins/ui-design/hooks/theme";

export type StyleToken = { name: string; kind: string; value: string };

type Element = { type: string; props?: unknown; children?: string[] };
type Spec = { root?: string; elements?: Record<string, Element> };

const GAP_SIZES = { none: "0", sm: "8px", md: "16px", lg: "28px" };
const TEXT_SIZES = { sm: "14px", md: "16px", lg: "18px" };
const ROW_ALIGNS = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
const IMAGE_RATIOS = { square: "1 / 1", wide: "16 / 9", tall: "3 / 4" };
const COLUMN_COUNTS = ["1", "2", "3", "4"];

const readKeys = (sizes: Record<string, string>) => Object.keys(sizes) as [string, ...string[]];

const gap = z.enum(readKeys(GAP_SIZES)).default("md");
const plainText = z.string().default("");

const defineComponent = (
  description: string,
  props: z.ZodObject,
  render: (props: any, children: string) => string
) => ({ description, props, render });

const components = {
  Page: defineComponent("The whole screen. The root of most specs.", z.object({}), (_props, children) =>
    `<main class="page">${children}</main>`
  ),
  Stack: defineComponent("Children in one column, with a gap between them.", z.object({ gap }), (props, children) =>
    `<div class="stack gap-${props.gap}">${children}</div>`
  ),
  Row: defineComponent(
    "Children in one row that wraps when narrow.",
    z.object({ gap, align: z.enum(readKeys(ROW_ALIGNS)).default("center") }),
    (props, children) => `<div class="row gap-${props.gap} justify-${props.align}">${children}</div>`
  ),
  Grid: defineComponent(
    "Children in a grid of equal columns.",
    z.object({ gap, columns: z.enum(COLUMN_COUNTS as [string, ...string[]]).default("2") }),
    (props, children) => `<div class="grid gap-${props.gap} cols-${props.columns}">${children}</div>`
  ),
  Card: defineComponent(
    "A bordered box that groups related content.",
    z.object({ tone: z.enum(["plain", "muted", "accent"]).default("plain") }),
    (props, children) => `<section class="card card-${props.tone}">${children}</section>`
  ),
  Heading: defineComponent(
    "A heading. Level 1 is the largest.",
    z.object({ text: plainText, level: z.enum(["1", "2", "3"]).default("2") }),
    (props) => `<h${props.level} class="heading heading-${props.level}">${escapeHtml(props.text)}</h${props.level}>`
  ),
  Text: defineComponent(
    "A paragraph of text.",
    z.object({
      text: plainText,
      tone: z.enum(["default", "muted"]).default("default"),
      size: z.enum(readKeys(TEXT_SIZES)).default("md"),
    }),
    (props) => `<p class="text text-${props.tone} text-${props.size}">${escapeHtml(props.text)}</p>`
  ),
  Button: defineComponent(
    "A button with a label.",
    z.object({ label: plainText, tone: z.enum(["primary", "secondary", "ghost"]).default("secondary") }),
    (props) => `<button type="button" class="button button-${props.tone}">${escapeHtml(props.label)}</button>`
  ),
  Input: defineComponent(
    "A labelled text field.",
    z.object({
      label: plainText,
      placeholder: plainText,
      kind: z.enum(["text", "email", "password", "search", "number"]).default("text"),
    }),
    (props) =>
      `<label class="field"><span class="field-label">${escapeHtml(props.label)}</span><input class="input" type="${props.kind}" placeholder="${escapeHtml(props.placeholder)}"></label>`
  ),
  Badge: defineComponent(
    "A small label, such as a status.",
    z.object({ text: plainText, tone: z.enum(["neutral", "accent"]).default("neutral") }),
    (props) => `<span class="badge badge-${props.tone}">${escapeHtml(props.text)}</span>`
  ),
  List: defineComponent("A vertical list of ListItem children.", z.object({ gap }), (props, children) =>
    `<ul class="list gap-${props.gap}">${children}</ul>`
  ),
  ListItem: defineComponent("One row of a List.", z.object({ text: plainText }), (props) =>
    `<li class="list-item">${escapeHtml(props.text)}</li>`
  ),
  Stat: defineComponent(
    "A big number with its label and a detail line.",
    z.object({ label: plainText, value: plainText, detail: plainText }),
    (props) =>
      `<div class="stat"><span class="stat-label">${escapeHtml(props.label)}</span><strong class="stat-value">${escapeHtml(props.value)}</strong><span class="stat-detail">${escapeHtml(props.detail)}</span></div>`
  ),
  Divider: defineComponent("A thin rule between parts of a screen.", z.object({}), () => '<hr class="divider">'),
  Nav: defineComponent(
    "A top navigation bar with a brand and links.",
    z.object({ brand: plainText, items: z.array(z.string()).default([]) }),
    (props) =>
      `<nav class="nav"><span class="nav-brand">${escapeHtml(props.brand)}</span>${props.items.map((item: string) => `<a href="#">${escapeHtml(item)}</a>`).join("")}</nav>`
  ),
  Image: defineComponent(
    "A picture placeholder with a description.",
    z.object({ alt: plainText, ratio: z.enum(readKeys(IMAGE_RATIOS)).default("wide") }),
    (props) => `<div class="image ratio-${props.ratio}" role="img" aria-label="${escapeHtml(props.alt)}"></div>`
  ),
};

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: { ...s.propsOf("catalog.components"), ...s.optional() },
        children: { ...s.array(s.string()), ...s.optional() },
      })
    ),
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), description: s.string() }),
  }),
}));

export const catalog = defineCatalog(schema, { components });

const readEntry = <Value>(entries: Record<string, Value> | undefined, key: string) =>
  Object.hasOwn(entries ?? {}, key) ? entries?.[key] : undefined;

const readElementProps = ({ type, children, props, ...looseProps }: Element & Record<string, unknown>) =>
  props ?? looseProps;

const renderElement = (
  elements: Record<string, Element> | undefined,
  key: string,
  ancestorKeys: string[]
): string => {
  const element = readEntry(elements, key);
  const definition = element && readEntry(components, element.type);
  if (!element || !definition || ancestorKeys.includes(key)) return "";
  const parsed = definition.props.safeParse(readElementProps(element));
  const props = parsed.success ? parsed.data : definition.props.parse({});
  const children = (Array.isArray(element.children) ? element.children : [])
    .map((childKey) => renderElement(elements, childKey, [...ancestorKeys, key]))
    .join("");
  return definition.render(props, children);
};

export const renderSpecToHtml = (spec: Spec) =>
  typeof spec.root === "string" ? renderElement(spec.elements, spec.root, []) : "";

export const findSpecProblems = (spec: unknown): string[] => {
  const shape = catalog.validate(spec);
  if (!shape.success) {
    return (shape.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }
  const parsedSpec = shape.data!;
  const structure = validateSpec(parsedSpec as Parameters<typeof validateSpec>[0]);
  if (!structure.valid) return structure.issues.map((issue) => issue.message);
  return Object.entries((spec as { elements: Record<string, Element> }).elements).flatMap(([key, element]) => {
    const parsed = readEntry(components, element.type)!.props.safeParse(readElementProps(element));
    return parsed.success
      ? []
      : [
          `element "${key}" (${element.type}) props: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
        ];
  });
};

const pickVariable = (tokens: StyleToken[], kind: string, names: string[], fallback: string) => {
  const matches = names.flatMap((name) =>
    tokens.filter((token) => token.kind === kind && readTokenVariable(token.name) === `--${name}`)
  );
  return matches[0] ? `var(${readTokenVariable(matches[0].name)})` : fallback;
};

export const renderCatalogCss = (tokens: StyleToken[]) => {
  const surface = pickVariable(tokens, "color", ["background", "surface", "canvas", "paper"], "transparent");
  const ink = pickVariable(tokens, "color", ["foreground", "text", "ink", "on-background"], "currentColor");
  const accent = pickVariable(tokens, "color", ["primary", "brand", "accent"], "currentColor");
  const onAccent = pickVariable(
    tokens,
    "color",
    ["primary-foreground", "on-primary", "on-accent", "accent-foreground"],
    "currentColor"
  );
  const muted = pickVariable(tokens, "color", ["muted", "secondary", "subtle", "surface-alt"], "transparent");
  const border = pickVariable(tokens, "color", ["border", "line", "outline", "input"], "currentColor");
  const body = pickVariable(tokens, "font", ["font-body", "font-sans", "font-text", "body"], "inherit");
  const heading = pickVariable(tokens, "font", ["font-heading", "font-display", "heading"], body);
  const radius = pickVariable(tokens, "radius", ["radius", "radius-md", "rounded"], "0");
  return [
    `.page{box-sizing:border-box;min-height:100%;display:flex;flex-direction:column;gap:24px;padding:24px;background:${surface};color:${ink};font-family:${body}}`,
    ".stack{display:flex;flex-direction:column}",
    ".row{display:flex;flex-wrap:wrap;align-items:center}",
    ".grid{display:grid}",
    ".list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}",
    ...Object.entries(GAP_SIZES).map(([name, size]) => `.gap-${name}{gap:${size}}`),
    ...Object.entries(ROW_ALIGNS).map(([name, value]) => `.justify-${name}{justify-content:${value}}`),
    ...COLUMN_COUNTS.map((count) => `.cols-${count}{grid-template-columns:repeat(${count},minmax(0,1fr))}`),
    `.card{display:flex;flex-direction:column;gap:12px;padding:20px;border:1px solid ${border};border-radius:${radius};background:${surface};color:${ink}}`,
    `.card-muted{background:${muted}}`,
    `.card-accent{border-color:${accent}}`,
    `.heading{margin:0;line-height:1.2;color:${ink};font-family:${heading}}`,
    ".heading-1{font-size:32px}",
    ".heading-2{font-size:24px}",
    ".heading-3{font-size:18px}",
    `.text{margin:0;line-height:1.5;color:${ink};font-family:${body}}`,
    ".text-muted{opacity:0.7}",
    ...Object.entries(TEXT_SIZES).map(([name, size]) => `.text-${name}{font-size:${size}}`),
    `.button{padding:10px 16px;border:1px solid ${border};border-radius:${radius};background:${surface};color:${ink};font:inherit;font-family:${body};cursor:pointer}`,
    `.button-primary{border-color:${accent};background:${accent};color:${onAccent}}`,
    ".button-ghost{border-color:transparent;background:transparent}",
    `.button:focus-visible,.input:focus-visible{outline:2px solid ${accent};outline-offset:2px}`,
    `.field{display:flex;flex-direction:column;gap:6px;font-family:${body};color:${ink}}`,
    `.input{padding:10px 12px;border:1px solid ${border};border-radius:${radius};background:${surface};color:${ink};font:inherit}`,
    `.badge{display:inline-block;padding:2px 10px;border:1px solid ${border};border-radius:999px;font-size:12px}`,
    `.badge-accent{border-color:${accent};background:${accent};color:${onAccent}}`,
    `.list-item{padding:12px;border:1px solid ${border};border-radius:${radius}}`,
    `.stat{display:flex;flex-direction:column;gap:4px;padding:16px;border:1px solid ${border};border-radius:${radius}}`,
    `.stat-value{font-family:${heading};font-size:32px;font-weight:700}`,
    ".stat-label,.stat-detail{font-size:14px;opacity:0.7}",
    `.divider{width:100%;height:0;margin:0;border:0;border-top:1px solid ${border}}`,
    `.nav{display:flex;flex-wrap:wrap;align-items:center;gap:20px;padding:12px 0;font-family:${body};color:${ink}}`,
    `.nav-brand{font-family:${heading};font-weight:700}`,
    ".nav a{color:inherit;text-decoration:none}",
    `.image{width:100%;border-radius:${radius};background:${muted}}`,
    ...Object.entries(IMAGE_RATIOS).map(([name, ratio]) => `.ratio-${name}{aspect-ratio:${ratio}}`),
  ].join("\n");
};

export const renderStylesheet = (tokens: StyleToken[]) =>
  `:root{${tokens
    .map((token) => `${readTokenVariable(token.name)}:${token.value.replace(/[;{}<>]/g, "").trim()}`)
    .join(";")}}\n${renderCatalogCss(tokens)}`;

const REPLY_SHAPE = [
  "Reply in exactly this shape and with nothing else:",
  "NAME: <two to four words>",
  "RATIONALE: <one or two sentences on what this variant is good at>",
  "<the JSON Patch lines of the spec, one per line, starting with /root>",
  'TOKENS: [{"name": "<a color or font token of the theme>", "value": "<its new value>"}]',
  "The TOKENS line is optional. It gives theme tokens new values for this variant only. Leave it out to keep the theme's colors and fonts.",
].join("\n");

export const buildCatalogPrompt = (rules: string, tokens: StyleToken[]) =>
  catalog.prompt({
    system: "You design UI mockups as a json-render spec. Each reply is one variant.",
    mode: "inline",
    customRules: [
      "The spec is static: props are plain values. Do not use state, repeat, visible, on or watch.",
      "Write the patch lines bare, with no code fence around them.",
      "Where the rules below mention html, css or a json block, the spec and the TOKENS line replace them.",
      rules,
      [
        "The theme's tokens, each already defined as a CSS variable:",
        ...tokens.map((token) => `- ${readTokenVariable(token.name)} (${token.kind}): ${token.value}`),
      ].join("\n"),
      REPLY_SHAPE,
    ],
  });
