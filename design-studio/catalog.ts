import { defineCatalog, defineSchema } from "@json-render/core";
import { z } from "zod";
import { escapeHtml } from "../plugins/ui-design/hooks/design-page";
import { readTokenVariable } from "../plugins/ui-design/hooks/theme";

export type StyleToken = { name: string; kind: string; value: string };

type Element = { type: string; props?: unknown; children?: unknown };
export type Spec = { root?: string; elements?: Record<string, Element> };

const GAP_SIZES = { sm: "8px", md: "16px", lg: "32px" };
const TEXT_SIZES = { sm: "14px", md: "16px", lg: "20px" };
const ROW_ALIGNS = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
const IMAGE_RATIOS = { square: "1 / 1", wide: "16 / 9", tall: "3 / 4" };
const PAGE_WIDTHS = { wide: "1120px", narrow: "480px" };
const COLUMN_COUNTS = ["1", "2", "3", "4"];
const MIN_SHOWN_ELEMENTS = 4;
const IMAGE_ICON =
  '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></svg>';

const readKeys = (sizes: Record<string, string>) => Object.keys(sizes) as [string, ...string[]];

const defineOption = (options: string[], fallback: string) =>
  z.enum(options as [string, ...string[]]).default(fallback);

const gap = defineOption(readKeys(GAP_SIZES), "md");
const plainText = z.string().default("");
const cellText = z.coerce.string();
const textList = z.array(cellText).default([]);

const defineComponent = (
  description: string,
  props: z.ZodObject,
  render: (props: any, children: string) => string
) => ({ description, props, render });

const renderInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

const renderBars = (values: number[]) => {
  const tallestValue = Math.max(...values, 1);
  return values
    .map(
      (value) =>
        `<span class="chart-bar" style="height:${Math.max(4, Math.round((Math.max(value, 0) / tallestValue) * 100))}%"></span>`
    )
    .join("");
};

const renderCells = (cells: string[], tag: string) =>
  cells.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag.split(" ")[0]}>`).join("");

const components = {
  Page: defineComponent(
    "The whole screen and the root of every spec. Use width narrow for a single form such as a login.",
    z.object({ width: defineOption(readKeys(PAGE_WIDTHS), "wide") }),
    (props, children) => `<main class="page"><div class="page-inner page-${props.width}">${children}</div></main>`
  ),
  Nav: defineComponent(
    "The top bar: a brand, links, and one optional action button. The first child of the Page.",
    z.object({ brand: plainText, items: textList, action: plainText }),
    (props) =>
      `<nav class="nav"><span class="nav-brand">${escapeHtml(props.brand)}</span><span class="nav-links">${props.items
        .map((link: string) => `<a href="#">${escapeHtml(link)}</a>`)
        .join("")}</span>${props.action ? `<button type="button" class="button button-primary">${escapeHtml(props.action)}</button>` : ""}</nav>`
  ),
  Stack: defineComponent(
    "Children in one column. Use align center for a hero.",
    z.object({ gap, align: defineOption(["stretch", "center"], "stretch") }),
    (props, children) => `<div class="stack gap-${props.gap} align-${props.align}">${children}</div>`
  ),
  Row: defineComponent(
    "Children side by side, wrapping when narrow. Use it for buttons, badges, or a title with an action.",
    z.object({ gap, align: defineOption(readKeys(ROW_ALIGNS), "start") }),
    (props, children) => `<div class="row gap-${props.gap} justify-${props.align}">${children}</div>`
  ),
  Grid: defineComponent(
    "Children in equal columns. Use it for cards or stats that sit side by side.",
    z.object({ gap, columns: defineOption(COLUMN_COUNTS, "3") }),
    (props, children) => `<div class="grid gap-${props.gap} cols-${props.columns}">${children}</div>`
  ),
  Card: defineComponent(
    "A box that groups related content. Tone accent marks the one card to notice.",
    z.object({ tone: defineOption(["plain", "muted", "accent"], "plain") }),
    (props, children) => `<section class="card card-${props.tone}">${children}</section>`
  ),
  Heading: defineComponent(
    "A heading. Level 1 is the screen title and appears once.",
    z.object({ text: plainText, level: defineOption(["1", "2", "3"], "2") }),
    (props) => `<h${props.level} class="heading heading-${props.level}">${escapeHtml(props.text)}</h${props.level}>`
  ),
  Text: defineComponent(
    "A paragraph.",
    z.object({
      text: plainText,
      tone: defineOption(["default", "muted"], "default"),
      size: defineOption(readKeys(TEXT_SIZES), "md"),
    }),
    (props) => `<p class="text text-${props.tone} text-${props.size}">${escapeHtml(props.text)}</p>`
  ),
  Button: defineComponent(
    "A button. One primary button per group.",
    z.object({ label: plainText, tone: defineOption(["primary", "secondary", "ghost"], "secondary") }),
    (props) => `<button type="button" class="button button-${props.tone}">${escapeHtml(props.label)}</button>`
  ),
  Input: defineComponent(
    "A labelled text field.",
    z.object({
      label: plainText,
      placeholder: plainText,
      kind: defineOption(["text", "email", "password", "search", "number"], "text"),
    }),
    (props) =>
      `<label class="field"><span class="field-label">${escapeHtml(props.label)}</span><input class="input" type="${props.kind}" placeholder="${escapeHtml(props.placeholder)}"></label>`
  ),
  Select: defineComponent(
    "A labelled dropdown showing its current value.",
    z.object({ label: plainText, value: plainText }),
    (props) =>
      `<label class="field"><span class="field-label">${escapeHtml(props.label)}</span><select class="input"><option>${escapeHtml(props.value)}</option></select></label>`
  ),
  Toggle: defineComponent(
    "A labelled on or off switch, for a setting.",
    z.object({ label: plainText, detail: plainText, checked: z.boolean().default(false) }),
    (props) =>
      `<label class="toggle"><span class="toggle-text"><span class="toggle-label">${escapeHtml(props.label)}</span><span class="toggle-detail">${escapeHtml(props.detail)}</span></span><input class="toggle-input" type="checkbox" role="switch"${props.checked ? " checked" : ""}></label>`
  ),
  Badge: defineComponent(
    "A small label, such as a status or Most popular.",
    z.object({ text: plainText, tone: defineOption(["neutral", "accent"], "neutral") }),
    (props) => `<span class="badge badge-${props.tone}">${escapeHtml(props.text)}</span>`
  ),
  List: defineComponent(
    "A list of ListItem children. Marker check suits the features of a plan.",
    z.object({ marker: defineOption(["none", "check"], "none") }),
    (props, children) => `<ul class="list list-${props.marker}">${children}</ul>`
  ),
  ListItem: defineComponent(
    "One row of a List: a text, and an optional detail shown at the end of the row.",
    z.object({ text: plainText, detail: plainText }),
    (props) =>
      `<li class="list-item"><span>${escapeHtml(props.text)}</span><span class="list-detail">${escapeHtml(props.detail)}</span></li>`
  ),
  Stat: defineComponent(
    "A key number with its label and a short detail such as a change.",
    z.object({ label: plainText, value: plainText, detail: plainText }),
    (props) =>
      `<div class="stat"><span class="stat-label">${escapeHtml(props.label)}</span><strong class="stat-value">${escapeHtml(props.value)}</strong><span class="stat-detail">${escapeHtml(props.detail)}</span></div>`
  ),
  Chart: defineComponent(
    "A bar chart: one label and one number per bar.",
    z.object({ title: plainText, labels: textList, values: z.array(z.number()).default([]) }),
    (props) =>
      `<figure class="chart"><figcaption class="chart-title">${escapeHtml(props.title)}</figcaption><div class="chart-bars" role="img" aria-label="${escapeHtml(props.title)}">${renderBars(props.values)}</div><div class="chart-labels">${renderCells(props.labels, "span")}</div></figure>`
  ),
  Table: defineComponent(
    "A table of data: column names, then rows of cells.",
    z.object({ columns: textList, rows: z.array(z.array(cellText)).default([]) }),
    (props) =>
      `<div class="table-scroll"><table class="table"><thead><tr>${renderCells(props.columns, 'th scope="col"')}</tr></thead><tbody>${props.rows
        .map((cells: string[]) => `<tr>${renderCells(cells, "td")}</tr>`)
        .join("")}</tbody></table></div>`
  ),
  Avatar: defineComponent(
    "A person, shown as their initials beside their name.",
    z.object({ name: plainText, detail: plainText }),
    (props) =>
      `<div class="avatar"><span class="avatar-mark" aria-hidden="true">${escapeHtml(renderInitials(props.name))}</span><span class="avatar-text"><span class="avatar-name">${escapeHtml(props.name)}</span><span class="avatar-detail">${escapeHtml(props.detail)}</span></span></div>`
  ),
  Image: defineComponent(
    "A picture placeholder with a description of the picture.",
    z.object({ alt: plainText, ratio: defineOption(readKeys(IMAGE_RATIOS), "wide") }),
    (props) =>
      `<div class="image ratio-${props.ratio}" role="img" aria-label="${escapeHtml(props.alt)}">${IMAGE_ICON}<span>${escapeHtml(props.alt)}</span></div>`
  ),
  Divider: defineComponent("A thin rule between parts of a screen.", z.object({}), () => '<hr class="divider">'),
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

const readGivenProps = ({ type, children, props, ...looseProps }: Element & Record<string, unknown>) =>
  (props && typeof props === "object" ? props : looseProps) as Record<string, unknown>;

const readProps = (propsShape: z.ZodObject, element: Element) => {
  const givenProps = readGivenProps(element);
  return Object.fromEntries(
    Object.entries(propsShape.shape).map(([propName, field]) => {
      const givenValue = givenProps[propName];
      const parsed = (field as z.ZodType).safeParse(typeof givenValue === "number" ? String(givenValue) : givenValue);
      return [propName, parsed.success ? parsed.data : (field as z.ZodType).parse(undefined)];
    })
  );
};

const readChildKeys = (element: Element) =>
  (Array.isArray(element.children) ? element.children.flat(Infinity) : []).filter(
    (childKey): childKey is string => typeof childKey === "string"
  );

const readShownElement = (spec: Spec, key: string, ancestorKeys: string[]) => {
  const element = readEntry(spec.elements, key);
  return element && typeof element.type === "string" && !ancestorKeys.includes(key) ? element : undefined;
};

const listShownElements = (spec: Spec, key: string, ancestorKeys: string[]): Element[] => {
  const element = readShownElement(spec, key, ancestorKeys);
  if (!element) return [];
  return [
    element,
    ...readChildKeys(element).flatMap((childKey) => listShownElements(spec, childKey, [...ancestorKeys, key])),
  ];
};

const renderElement = (spec: Spec, key: string, ancestorKeys: string[]): string => {
  const element = readShownElement(spec, key, ancestorKeys);
  if (!element) return "";
  const children = readChildKeys(element)
    .map((childKey) => renderElement(spec, childKey, [...ancestorKeys, key]))
    .join("");
  const definition = readEntry(components, element.type);
  return definition ? definition.render(readProps(definition.props, element), children) : children;
};

export const renderSpecToHtml = (spec: Spec) => {
  const rootElement = typeof spec.root === "string" ? readEntry(spec.elements, spec.root) : undefined;
  if (!rootElement) return "";
  const html = renderElement(spec, spec.root!, []);
  return rootElement.type === "Page" ? html : components.Page.render(readProps(components.Page.props, rootElement), html);
};

export const findSpecProblems = (spec: Spec): string[] => {
  const rootElement = typeof spec.root === "string" ? readEntry(spec.elements, spec.root) : undefined;
  if (!rootElement) {
    return [
      'the spec has no root element. Start with {"op":"add","path":"/root","value":"page"} and add a line for /elements/page.',
    ];
  }
  const shownCount = listShownElements(spec, spec.root!, []).filter((element) =>
    readEntry(components, element.type)
  ).length;
  return shownCount < MIN_SHOWN_ELEMENTS
    ? [
        `the spec shows only ${shownCount} of its elements. Every key in a "children" list needs its own /elements/<key> line, and every element must be reachable from the root.`,
      ]
    : [];
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
  const card = pickVariable(tokens, "color", ["card", "surface", "popover"], surface);
  const cardInk = pickVariable(tokens, "color", ["card-foreground", "on-surface"], ink);
  const accent = pickVariable(tokens, "color", ["primary", "brand", "accent"], "currentColor");
  const onAccent = pickVariable(
    tokens,
    "color",
    ["primary-foreground", "on-primary", "on-accent", "accent-foreground"],
    "currentColor"
  );
  const muted = pickVariable(tokens, "color", ["muted", "secondary", "subtle", "surface-alt"], "transparent");
  const mutedInk = pickVariable(tokens, "color", ["muted-foreground", "text-muted", "on-muted"], "");
  const quietStyle = mutedInk ? `color:${mutedInk}` : "opacity:0.7";
  const border = pickVariable(tokens, "color", ["border", "line", "outline", "input"], "currentColor");
  const body = pickVariable(tokens, "font", ["font-body", "font-sans", "font-text", "body"], "inherit");
  const heading = pickVariable(tokens, "font", ["font-heading", "font-display", "heading"], body);
  const radius = pickVariable(tokens, "radius", ["radius", "radius-md", "rounded"], "0");
  return [
    `.page{box-sizing:border-box;min-height:100vh;padding:0 24px 64px;background:${surface};color:${ink};font-family:${body};font-size:16px;line-height:1.5}`,
    ".page *{box-sizing:border-box}",
    ".page-inner{display:flex;flex-direction:column;gap:40px;margin:0 auto;padding-top:24px}",
    ...Object.entries(PAGE_WIDTHS).map(([name, width]) => `.page-${name}{max-width:${width}}`),
    ".page-narrow{padding-top:64px}",
    ".stack{display:flex;flex-direction:column;min-width:0}",
    ".align-center{align-items:center;text-align:center}",
    ".row{display:flex;flex-wrap:wrap;align-items:center}",
    ".row>.card,.row>.stat,.row>.field{flex:1 1 220px}",
    ".grid{display:grid;align-items:stretch}",
    ...Object.entries(GAP_SIZES).map(([name, size]) => `.gap-${name}{gap:${size}}`),
    ...Object.entries(ROW_ALIGNS).map(([name, value]) => `.justify-${name}{justify-content:${value}}`),
    ...COLUMN_COUNTS.map((count) => `.cols-${count}{grid-template-columns:repeat(${count},minmax(0,1fr))}`),
    `.card{display:flex;flex-direction:column;gap:16px;min-width:0;padding:24px;border:1px solid ${border};border-radius:${radius};background:${card};color:${cardInk}}`,
    `.card-muted{border-color:transparent;background:${muted}}`,
    `.card-accent{border-color:${accent};outline:1px solid ${accent}}`,
    `.heading{margin:0;line-height:1.15;letter-spacing:-0.02em;text-wrap:balance;color:inherit;font-family:${heading};font-weight:700}`,
    ".heading-1{font-size:44px}",
    ".heading-2{font-size:26px}",
    ".heading-3{font-size:18px;letter-spacing:0}",
    `.text{max-width:68ch;margin:0;color:inherit;font-family:${body}}`,
    `.text-muted{${quietStyle}}`,
    ...Object.entries(TEXT_SIZES).map(([name, size]) => `.text-${name}{font-size:${size}}`),
    `.button{align-self:flex-start;min-height:44px;padding:10px 20px;border:1px solid ${border};border-radius:${radius};background:${card};color:${cardInk};font:inherit;font-family:${body};font-weight:600;cursor:pointer}`,
    `.button-primary{border-color:${accent};background:${accent};color:${onAccent}}`,
    ".button-ghost{border-color:transparent;background:transparent;color:inherit}",
    ".align-center>.button{align-self:center}",
    ".field~.button,.toggle~.button{align-self:stretch}",
    `.button:focus-visible,.input:focus-visible,.toggle-input:focus-visible,.nav a:focus-visible{outline:2px solid ${accent};outline-offset:2px}`,
    `.field{display:flex;flex-direction:column;gap:6px;text-align:left;font-family:${body}}`,
    ".field-label{font-size:14px;font-weight:600}",
    `.input{width:100%;min-height:44px;padding:10px 12px;border:1px solid ${border};border-radius:${radius};background:${surface};color:${ink};font:inherit}`,
    ".toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left}",
    ".toggle-text{display:flex;flex-direction:column}",
    ".toggle-label{font-weight:600}",
    `.toggle-detail,.list-detail,.avatar-detail,.stat-label,.stat-detail,.chart-labels{font-size:14px;${quietStyle}}`,
    `.toggle-input{width:20px;height:20px;margin:0;accent-color:${accent}}`,
    `.badge{display:inline-block;align-self:flex-start;padding:2px 10px;border:1px solid ${border};border-radius:999px;font-size:12px;font-weight:600}`,
    ".align-center>.badge{align-self:center}",
    `.badge-accent{border-color:${accent};background:${accent};color:${onAccent}}`,
    ".list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}",
    `.list-item{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid ${border}}`,
    ".list-item:first-child{border-top:0}",
    ".list-check .list-item{justify-content:flex-start;gap:10px;padding:6px 0;border-top:0}",
    `.list-check .list-item::before{content:"\\2713";font-weight:700;color:${accent}}`,
    `.stat{display:flex;flex-direction:column;gap:4px;min-width:0;padding:20px;border:1px solid ${border};border-radius:${radius};background:${card};color:${cardInk}}`,
    ".card .stat{padding:0;border:0}",
    `.stat-value{font-family:${heading};font-size:32px;line-height:1.1;letter-spacing:-0.02em}`,
    ".chart{display:flex;flex-direction:column;gap:12px;margin:0}",
    ".chart-title{font-weight:600}",
    `.chart-bars{display:flex;align-items:flex-end;gap:8px;height:180px;border-bottom:1px solid ${border}}`,
    `.chart-bar{flex:1;border-radius:${radius} ${radius} 0 0;background:${accent}}`,
    ".chart-labels{display:flex;gap:8px;text-align:center}",
    ".chart-labels span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ".table-scroll{overflow-x:auto}",
    ".table{width:100%;border-collapse:collapse;font-size:14px;text-align:left}",
    `.table th,.table td{padding:12px 16px 12px 0;border-bottom:1px solid ${border}}`,
    `.table th{font-weight:600;${quietStyle}}`,
    ".table tr:last-child td{border-bottom:0}",
    ".avatar{display:flex;align-items:center;gap:12px;text-align:left}",
    `.avatar-mark{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:999px;background:${accent};color:${onAccent};font-size:14px;font-weight:700}`,
    ".avatar-text{display:flex;flex-direction:column}",
    ".avatar-name{font-weight:600}",
    `.divider{width:100%;height:0;margin:0;border:0;border-top:1px solid ${border}}`,
    `.nav{display:flex;flex-wrap:wrap;align-items:center;gap:24px;padding-bottom:16px;border-bottom:1px solid ${border};font-family:${body}}`,
    `.nav-brand{font-family:${heading};font-size:18px;font-weight:700}`,
    ".nav-links{display:flex;flex-wrap:wrap;gap:24px;margin-left:auto;font-size:14px}",
    ".nav a{color:inherit;text-decoration:none}",
    ".nav .button{min-height:36px;padding:6px 14px}",
    `.image{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;max-height:360px;padding:16px;border-radius:${radius};background:${muted};font-size:14px;text-align:center;${quietStyle}}`,
    ...Object.entries(IMAGE_RATIOS).map(([name, ratio]) => `.ratio-${name}{aspect-ratio:${ratio}}`),
    "@media (max-width:760px){.cols-2,.cols-3,.cols-4{grid-template-columns:minmax(0,1fr)}.page{padding:0 16px 40px}.heading-1{font-size:32px}.nav-links{margin-left:0}}",
  ].join("\n");
};

export const renderStylesheet = (tokens: StyleToken[]) =>
  `:root{${tokens
    .map((token) => `${readTokenVariable(token.name)}:${token.value.replace(/[;{}<>]/g, "").trim()}`)
    .join(";")}}\n${renderCatalogCss(tokens)}`;

const readComponentLines = () =>
  /AVAILABLE COMPONENTS \(\d+\):\n\n([\s\S]*?)\n\n/.exec(catalog.prompt())?.[1] ?? "";

const EXAMPLE_REPLY = [
  "NAME: Order desk",
  "RATIONALE: Puts today's numbers first, then the orders that need a decision.",
  '{"op":"add","path":"/root","value":"page"}',
  '{"op":"add","path":"/elements/page","value":{"type":"Page","props":{"width":"wide"},"children":["nav","intro","stats","orders-card"]}}',
  '{"op":"add","path":"/elements/nav","value":{"type":"Nav","props":{"brand":"Spoke & Chain","items":["Orders","Parts","Customers"],"action":"New order"},"children":[]}}',
  '{"op":"add","path":"/elements/intro","value":{"type":"Stack","props":{"gap":"sm"},"children":["title","subtitle"]}}',
  '{"op":"add","path":"/elements/title","value":{"type":"Heading","props":{"text":"Repairs this week","level":"1"},"children":[]}}',
  '{"op":"add","path":"/elements/subtitle","value":{"type":"Text","props":{"text":"14 bikes in the workshop, 3 waiting for parts.","tone":"muted","size":"lg"},"children":[]}}',
  '{"op":"add","path":"/elements/stats","value":{"type":"Grid","props":{"columns":"3","gap":"md"},"children":["stat-open","stat-ready","stat-income"]}}',
  '{"op":"add","path":"/elements/stat-open","value":{"type":"Stat","props":{"label":"Open repairs","value":"14","detail":"2 more than last week"},"children":[]}}',
  '{"op":"add","path":"/elements/stat-ready","value":{"type":"Stat","props":{"label":"Ready for pickup","value":"5","detail":"Oldest since Monday"},"children":[]}}',
  '{"op":"add","path":"/elements/stat-income","value":{"type":"Stat","props":{"label":"Income","value":"$2,480","detail":"Up 12% on last week"},"children":[]}}',
  '{"op":"add","path":"/elements/orders-card","value":{"type":"Card","props":{"tone":"plain"},"children":["orders-head","orders-table"]}}',
  '{"op":"add","path":"/elements/orders-head","value":{"type":"Row","props":{"align":"between"},"children":["orders-title","orders-badge"]}}',
  '{"op":"add","path":"/elements/orders-title","value":{"type":"Heading","props":{"text":"Waiting for parts","level":"3"},"children":[]}}',
  '{"op":"add","path":"/elements/orders-badge","value":{"type":"Badge","props":{"text":"3 delayed","tone":"accent"},"children":[]}}',
  '{"op":"add","path":"/elements/orders-table","value":{"type":"Table","props":{"columns":["Bike","Customer","Part","Due"],"rows":[["Trek FX 2","Dana Ortiz","Rear derailleur","Thu"],["Brompton C","Sam Lee","Hinge clamp","Fri"]]},"children":[]}}',
].join("\n");

const LAYOUT_ADVICE = [
  "- Landing or onboarding: Nav, a Stack with align center holding a Heading level 1, a Text of size lg and a Row of Buttons, then a Grid of three Cards.",
  "- Dashboard: Nav, a title, a Grid of three or four Stats, then a Grid of two Cards holding a Chart and a Table.",
  "- Login, sign-up or any single form: Page with width narrow, one Card holding a Heading, the Inputs and one primary Button.",
  "- Settings: Page with width wide, one Card per group of settings, each with a Heading level 3 and Toggles, Selects or Inputs.",
  "- Pricing: a centered title, then a Grid of Cards, one per plan, each with the plan name, the price as a Heading, a List with marker check and a Button. The recommended plan has tone accent and a Badge.",
];

export const buildCatalogPrompt = (tokens: StyleToken[]) =>
  [
    "You design one screen of an app as a json-render spec. A renderer turns the spec into the finished screen, so you never write HTML or CSS.",
    "COMPONENTS. Use only these, with only these props and these option values:",
    readComponentLines(),
    [
      "REPLY SHAPE. Reply in exactly this shape and with nothing else:",
      "NAME: <two to four words>",
      "RATIONALE: <one or two sentences on what this design is good at>",
      "<one JSON Patch line per element>",
    ].join("\n"),
    [
      "RULES FOR THE LINES",
      '- The first line is {"op":"add","path":"/root","value":"page"}. Each later line adds one element: {"op":"add","path":"/elements/<key>","value":{"type":...,"props":{...},"children":[...]}}.',
      '- Every element has "type", "props" and "children". Props go inside "props". "children" is a flat list of keys, and every key in it gets its own line.',
      "- Each line is one complete JSON object on one line. Close every brace. No code fence and no comments.",
      "- Only Page, Stack, Row, Grid, Card and List take children.",
    ].join("\n"),
    [
      "RULES FOR THE DESIGN",
      "- The root is a Page. A Nav, when the screen has one, is its first child.",
      "- One Heading of level 1. One primary Button per group of buttons.",
      "- Put things that belong side by side in a Grid or a Row, not in a long column.",
      "- Write real content for this product: real names, numbers and labels. No lorem ipsum and no placeholders.",
      "- Between 15 and 40 elements. Fill the screen the brief asks for and nothing else.",
      "- The theme sets every color and font. Never write a color, a font or CSS.",
    ].join("\n"),
    ["LAYOUTS THAT WORK", ...LAYOUT_ADVICE].join("\n"),
    `TOKENS, an optional last line: TOKENS: [{"name":"<token>","value":"<new value>"}] gives theme tokens new values for this design only. Leave it out unless the brief asks for other colors. The tokens: ${tokens
      .filter((token) => token.kind === "color" || token.kind === "font")
      .map((token) => readTokenVariable(token.name).slice(2))
      .join(", ")}.`,
    `EXAMPLE of the format, for another product. Choose the layout that fits your brief.\n${EXAMPLE_REPLY}`,
  ].join("\n\n");
