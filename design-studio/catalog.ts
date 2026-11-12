import { defineCatalog, defineSchema } from "@json-render/core";
import { z } from "zod";
import { escapeHtml } from "../plugins/ui-design/hooks/design-page";
import { readTokenVariable } from "../plugins/ui-design/hooks/theme";

export type StyleToken = { name: string; kind: string; value: string };

type Element = { type: string; props?: unknown; children?: unknown };
export type Spec = { root?: string; elements?: Record<string, Element> };

const GAP_SIZES = { sm: "8px", md: "16px", lg: "32px", xl: "56px" };
const TEXT_SIZES = { sm: "14px", md: "16px", lg: "20px" };
const ROW_ALIGNS = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };
const IMAGE_RATIOS = { square: "1 / 1", wide: "16 / 9", tall: "3 / 4" };
const PAGE_WIDTHS = { wide: "1120px", narrow: "480px" };
const COLUMN_COUNTS = ["1", "2", "3", "4"];
const MIN_SHOWN_ELEMENTS = 4;
const LOOK_ORDER = ["sharp", "bold", "editorial", "soft", "clean"] as const;
export type Look = (typeof LOOK_ORDER)[number];
const DISTINCTIVE_STYLES: [Look, RegExp][] = [
  ["sharp", /brutal|raw|mono|terminal|retro|pixel|industrial/i],
  ["bold", /vibrant|block|playful|energetic|gradient|neon|maximal|colorful/i],
  ["editorial", /editorial|magazine|luxury|elegant|serif|classic|premium|refined/i],
  ["soft", /soft|neumorph|glass|friendly|organic|rounded|pastel|clay/i],
];
const HEADING_FONTS: Record<string, string> = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif',
};
const HEADING_FONT_BY_LOOK: Record<string, string> = { sharp: "mono", editorial: "serif", soft: "rounded" };
const HEADING_TOKEN_NAMES = ["font-heading", "font-display", "heading"];
const CORNER_RADII = { square: "0", rounded: "12px", pill: "999px" };
const PAGE_SPACINGS = { compact: "24px", normal: "40px", airy: "72px" };
const SPLIT_RATIOS = { equal: "1fr 1fr", "wide-left": "2fr 1fr", "wide-right": "1fr 2fr" };
const CROSS_ALIGNS = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const MAX_WIDTHS = { sm: "360px", md: "560px", lg: "760px" };
const SPAN_COUNTS = ["2", "3", "4"];
const ICON_SHAPES: Record<string, string> = {
  check: '<path d="M5 12l5 5 9-10"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15zM5 19l8-8"/>',
  map: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  gift: '<rect x="3" y="9" width="18" height="12"/><path d="M12 9v12M3 13h18M12 9c-2-4-7-3-5 0zM12 9c2-4 7-3 5 0z"/>',
};
const LOGO_SHAPES: Record<string, string> = {
  circle: '<circle cx="20" cy="20" r="18"/>',
  square: '<rect x="3" y="3" width="34" height="34" rx="8"/>',
  diamond: '<rect x="6" y="6" width="28" height="28" rx="4" transform="rotate(45 20 20)"/>',
  hexagon: '<path d="M20 2l15.6 9v18L20 38 4.4 29V11z"/>',
  shield: '<path d="M20 2l15 5v12c0 10-6.5 15.5-15 19-8.5-3.5-15-9-15-19V7z"/>',
  blob: '<path d="M21 2c9 0 17 6 17 16s-6 20-18 20S2 30 2 20 10 2 21 2z"/>',
};
const ART_HEIGHT = 100;
const ART_WIDTHS: Record<string, number> = { square: 100, wide: 160, tall: 75 };
const SHAPE_TONES = ["accent", "ink", "muted", "surface"];
const countUp = (count: number) => Array.from({ length: count }, (_, index) => index);
const ART_DRAWINGS: Record<string, string> = {
  waves: [62, 74, 86]
    .map(
      (height, waveIndex) =>
        `<path class="tone-accent" opacity="${0.25 + waveIndex * 0.25}" d="M0 ${height}q20-14 40 0t40 0 40 0 40 0V100H0z"/>`
    )
    .join(""),
  dots: countUp(40)
    .map(
      (dotIndex) =>
        `<circle class="tone-accent" opacity="${(0.2 + (dotIndex % 8) * 0.1).toFixed(1)}" cx="${10 + (dotIndex % 8) * 20}" cy="${10 + Math.floor(dotIndex / 8) * 20}" r="${2 + (dotIndex % 5)}"/>`
    )
    .join(""),
  rings: countUp(6)
    .map(
      (ringIndex) =>
        `<circle class="tone-accent outline" opacity="${(1 - ringIndex * 0.14).toFixed(2)}" cx="110" cy="60" r="${12 + ringIndex * 16}" stroke-width="3"/>`
    )
    .join(""),
  sun: '<circle class="tone-accent" cx="80" cy="62" r="26"/><path class="tone-ink" opacity="0.85" d="M0 74q40-22 80-6t80-8v40H0z"/><path class="tone-accent outline" stroke-width="2" d="M80 22v-10M46 34l-8-7M114 34l8-7"/>',
  hills:
    '<circle class="tone-surface" cx="122" cy="26" r="10"/><path class="tone-accent" opacity="0.35" d="M0 70l40-34 36 26 30-20 54 34v24H0z"/><path class="tone-accent" opacity="0.7" d="M0 84q46-34 86-8t74-14v38H0z"/><path class="tone-ink" opacity="0.8" d="M0 94q60-18 160-4v10H0z"/>',
  stripes: countUp(12)
    .map(
      (stripeIndex) =>
        `<path class="tone-accent outline" opacity="${0.25 + (stripeIndex % 3) * 0.25}" stroke-width="7" d="M${-80 + stripeIndex * 24} 110l90-120"/>`
    )
    .join(""),
  grid:
    countUp(9)
      .map((lineIndex) => `<path class="tone-accent outline" opacity="0.4" stroke-width="1" d="M${lineIndex * 20} 0v100M0 ${lineIndex * 20}h160"/>`)
      .join("") + '<rect class="tone-accent" x="60" y="20" width="40" height="40"/><rect class="tone-ink" x="100" y="60" width="20" height="20"/>',
};
const STAR_POINTS = countUp(10)
  .map((pointIndex) => {
    const reach = pointIndex % 2 ? 0.2 : 0.5;
    const angle = (pointIndex * Math.PI) / 5;
    return `${(Math.sin(angle) * reach).toFixed(3)},${(-Math.cos(angle) * reach).toFixed(3)}`;
  })
  .join(" ");
const DRAWN_SHAPES: Record<string, { isOutline?: boolean; draw: (size: number) => string }> = {
  circle: { draw: (size) => `<circle r="${size / 2}"/>` },
  ring: { isOutline: true, draw: (size) => `<circle r="${size / 2}" stroke-width="${size / 8}"/>` },
  square: { draw: (size) => `<rect x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}"/>` },
  diamond: { draw: (size) => `<rect x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" transform="rotate(45)"/>` },
  triangle: { draw: (size) => `<path d="M0 ${-size / 2}L${size / 2} ${size / 2}H${-size / 2}z"/>` },
  half: { draw: (size) => `<path d="M${-size / 2} 0a${size / 2} ${size / 2} 0 0 1 ${size} 0z"/>` },
  star: { draw: (size) => `<polygon points="${STAR_POINTS}" transform="scale(${size})"/>` },
  line: { isOutline: true, draw: (size) => `<path d="M${-size / 2} 0H${size / 2}" stroke-width="3"/>` },
  wave: {
    isOutline: true,
    draw: (size) => `<path d="M${-size / 2} 0q${size / 8}-${size / 4} ${size / 4} 0t${size / 4} 0 ${size / 4} 0 ${size / 4} 0" stroke-width="3"/>`,
  },
};
const TRUTH_BY_WORD: Record<string, boolean> = { true: true, false: false };
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

const defineContainer = (
  description: string,
  props: z.ZodObject,
  render: (props: any, children: string) => string
) => defineComponent(description, props, (givenProps, children) => (children ? render(givenProps, children) : ""));

const renderButton = (label: string, tone: string) =>
  label ? `<button type="button" class="button button-${tone}">${escapeHtml(label)}</button>` : "";

const renderBadge = (text: string, tone: string) =>
  text ? `<span class="badge badge-${tone}">${escapeHtml(text)}</span>` : "";

const renderListItem = (text: string, detail: string) =>
  `<li class="list-item"><span>${escapeHtml(text)}</span><span class="list-detail">${escapeHtml(detail)}</span></li>`;

const placementProps = z.object({
  span: z.enum(SPAN_COUNTS as [string, ...string[]]).optional(),
  rowSpan: z.enum(SPAN_COUNTS as [string, ...string[]]).optional(),
  place: z.enum(readKeys(CROSS_ALIGNS)).optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  maxWidth: z.enum(readKeys(MAX_WIDTHS)).optional(),
});

const PLACEMENT_CLASS_STEMS: Record<string, string> = {
  span: "span",
  rowSpan: "row-span",
  place: "place",
  textAlign: "text-align",
  maxWidth: "max-width",
};

const renderArtFrame = (alt: string, ratio: string, frameClass: string, svgClass: string, drawing: string) =>
  `<div class="image image-art${frameClass} ratio-${ratio}" role="img" aria-label="${escapeHtml(alt)}"><svg class="graphic${svgClass}" viewBox="0 0 ${ART_WIDTHS[ratio]} ${ART_HEIGHT}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${drawing}</svg></div>`;

const renderImage = (alt: string, ratio: string, art = "") =>
  ART_DRAWINGS[art]
    ? renderArtFrame(alt, ratio, "", ` art-${art}`, ART_DRAWINGS[art])
    : `<div class="image ratio-${ratio}" role="img" aria-label="${escapeHtml(alt)}">${IMAGE_ICON}<span>${escapeHtml(alt)}</span></div>`;

const renderIcon = (icon: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SHAPES[icon] ?? ICON_SHAPES.check}</svg>`;

const renderLogoMark = (name: string, shape: string, icon: string) =>
  `<svg class="logo-mark logo-${shape}" viewBox="0 0 40 40" aria-hidden="true">${LOGO_SHAPES[shape]}${
    ICON_SHAPES[icon]
      ? `<g class="logo-icon" transform="translate(9 9) scale(0.92)">${ICON_SHAPES[icon]}</g>`
      : `<text class="logo-letter" x="20" y="21" text-anchor="middle" dominant-baseline="central">${escapeHtml(name.trim().charAt(0).toUpperCase())}</text>`
  }</svg>`;

const shapeProps = z.object({
  shape: defineOption(Object.keys(DRAWN_SHAPES), "circle"),
  x: z.coerce.number().min(0).max(100).default(50),
  y: z.coerce.number().min(0).max(100).default(50),
  size: z.coerce.number().min(1).max(100).default(30),
  tone: defineOption(SHAPE_TONES, "accent"),
  rotate: z.coerce.number().default(0),
});

const renderShape = (givenShape: unknown, ratio: string) => {
  if (!givenShape || typeof givenShape !== "object") return "";
  const drawn = readProps(shapeProps, { type: "Shape", props: givenShape as Record<string, unknown> });
  const { isOutline, draw } = DRAWN_SHAPES[drawn.shape]!;
  return `<g transform="translate(${(drawn.x * ART_WIDTHS[ratio]!) / 100} ${drawn.y}) rotate(${drawn.rotate})" class="tone-${drawn.tone}${isOutline ? " outline" : ""}">${draw(drawn.size)}</g>`;
};

const renderHeading = (text: string, level: string) =>
  text ? `<h${level} class="heading heading-${level}">${escapeHtml(text)}</h${level}>` : "";

const renderText = (text: string, toneAndSize: string) =>
  text ? `<p class="text ${toneAndSize}">${escapeHtml(text)}</p>` : "";

const renderAvatar = (name: string, detail: string) =>
  `<div class="avatar"><span class="avatar-mark" aria-hidden="true">${escapeHtml(renderInitials(name))}</span><span class="avatar-text"><span class="avatar-name">${escapeHtml(name)}</span><span class="avatar-detail">${escapeHtml(detail)}</span></span></div>`;

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
    "The whole screen and the root of every spec. Use width narrow for a single form such as a login. look, headingFont, corners and spacing set the style of the whole design: you choose them.",
    z.object({
      width: defineOption(readKeys(PAGE_WIDTHS), "wide"),
      look: z.enum(LOOK_ORDER).optional(),
      headingFont: z.enum(["sans", ...Object.keys(HEADING_FONTS)] as [string, ...string[]]).optional(),
      corners: z.enum(readKeys(CORNER_RADII)).optional(),
      spacing: defineOption(readKeys(PAGE_SPACINGS), "normal"),
    }),
    (props, children) =>
      `<main class="page"><div class="page-inner page-${props.width} spacing-${props.spacing}">${children}</div></main>`
  ),
  Nav: defineComponent(
    "The top bar: a brand, links, and one optional action button. The first child of the Page. Layout centered puts the brand in the middle. logo draws a mark of that shape before the brand, holding the icon named in logoIcon or else the brand's first letter.",
    z.object({
      brand: plainText,
      items: textList,
      action: plainText,
      layout: defineOption(["spread", "centered"], "spread"),
      logo: defineOption(["none", ...Object.keys(LOGO_SHAPES)], "none"),
      logoIcon: plainText,
    }),
    (props) =>
      `<nav class="nav nav-${props.layout}"><span class="nav-brand">${props.logo === "none" ? "" : renderLogoMark(props.brand, props.logo, props.logoIcon)}${escapeHtml(props.brand)}</span><span class="nav-links">${props.items
        .map((link: string) => `<a href="#">${escapeHtml(link)}</a>`)
        .join("")}</span>${renderButton(props.action, "primary")}</nav>`
  ),
  Hero: defineComponent(
    "The opening of a landing, onboarding or pricing screen: a small badge, the level 1 title, a sentence, up to two buttons, and an optional picture described in image, which sits beside the text on the side you choose. imageArt draws that picture as one of the ARTWORK names.",
    z.object({
      badge: plainText,
      title: plainText,
      text: plainText,
      primaryAction: plainText,
      secondaryAction: plainText,
      align: defineOption(["center", "start"], "center"),
      image: plainText,
      imageArt: plainText,
      imageSide: defineOption(["right", "left"], "right"),
    }),
    (props) => {
      const copy = `${renderBadge(props.badge, "neutral")}<h1 class="heading heading-1">${escapeHtml(props.title)}</h1>${renderText(props.text, "text-muted text-lg")}<div class="row gap-sm items-center">${renderButton(props.primaryAction, "primary")}${renderButton(props.secondaryAction, "secondary")}</div>`;
      return props.image
        ? `<header class="hero hero-split hero-image-${props.imageSide}"><div class="hero-copy">${copy}</div>${renderImage(props.image, "wide", props.imageArt)}</header>`
        : `<header class="hero hero-${props.align}">${copy}</header>`;
    }
  ),
  Section: defineComponent(
    "A band of the screen with its own title, sentence and children. Tone muted or accent gives it a full-width background, which breaks up a long screen.",
    z.object({
      title: plainText,
      text: plainText,
      tone: defineOption(["plain", "muted", "accent"], "plain"),
      align: defineOption(["start", "center"], "start"),
    }),
    (props, children) =>
      `<section class="section section-${props.tone} section-${props.align}">${renderHeading(props.title, "2")}${renderText(props.text, "text-muted text-lg")}${children}</section>`
  ),
  Split: defineContainer(
    "Two columns side by side: exactly two children, such as text beside a picture, or an order beside a form. Put several things in one column with a Stack. Reverse swaps the sides.",
    z.object({
      ratio: defineOption(readKeys(SPLIT_RATIOS), "equal"),
      align: defineOption(["start", "center", "stretch"], "start"),
      reverse: z.boolean().default(false),
    }),
    (props, children) =>
      `<div class="split split-${props.ratio} items-${props.align}${props.reverse ? " split-reverse" : ""}">${children}</div>`
  ),
  Stack: defineContainer(
    "Children in one column. Align places them across the column.",
    z.object({ gap, align: defineOption(["stretch", "start", "center", "end"], "stretch") }),
    (props, children) => `<div class="stack gap-${props.gap} align-${props.align}">${children}</div>`
  ),
  Row: defineContainer(
    "Children side by side, wrapping when narrow. Use it for buttons, badges, or a title with an action.",
    z.object({
      gap,
      align: defineOption(readKeys(ROW_ALIGNS), "start"),
      vertical: defineOption(["start", "center", "end"], "center"),
    }),
    (props, children) => `<div class="row gap-${props.gap} justify-${props.align} items-${props.vertical}">${children}</div>`
  ),
  Grid: defineContainer(
    "Children in equal columns. Use it for cards or stats that sit side by side.",
    z.object({ gap, columns: defineOption(COLUMN_COUNTS, "3"), align: defineOption(["stretch", "start", "center"], "stretch") }),
    (props, children) => `<div class="grid gap-${props.gap} cols-${props.columns} items-${props.align}">${children}</div>`
  ),
  Card: defineContainer(
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
    (props) => renderButton(props.label || "Continue", props.tone)
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
    (props) => renderBadge(props.text, props.tone)
  ),
  List: defineContainer(
    "A list of ListItem children. Marker check suits the features of a plan.",
    z.object({ marker: defineOption(["none", "check"], "none") }),
    (props, children) => `<ul class="list list-${props.marker}">${children}</ul>`
  ),
  ListItem: defineComponent(
    "One row of a List: a text, and an optional detail shown at the end of the row.",
    z.object({ text: plainText, detail: plainText }),
    (props) => renderListItem(props.text, props.detail)
  ),
  Plan: defineComponent(
    "One plan of a pricing screen. Each plan has its own features. Give a badge such as Most popular to the one recommended plan only.",
    z.object({
      name: plainText,
      price: plainText,
      period: plainText,
      description: plainText,
      features: textList,
      action: plainText,
      badge: plainText,
    }),
    (props) =>
      `<section class="card plan card-${props.badge ? "accent" : "plain"}"><div class="row gap-sm justify-between items-center"><h3 class="heading heading-3">${escapeHtml(props.name)}</h3>${renderBadge(props.badge, "accent")}</div><p class="plan-cost"><strong class="plan-price">${escapeHtml(props.price)}</strong> <span class="plan-period">${escapeHtml(props.period)}</span></p><p class="text text-muted text-sm">${escapeHtml(props.description)}</p><ul class="list list-check">${props.features
        .map((feature: string) => renderListItem(feature, ""))
        .join("")}</ul>${renderButton(props.action, props.badge ? "primary" : "secondary")}</section>`
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
    (props) => renderAvatar(props.name, props.detail)
  ),
  Image: defineComponent(
    "A picture. With art it is drawn artwork in the theme's colors; with art photo it is a placeholder for a photo, described in alt.",
    z.object({
      alt: plainText,
      ratio: defineOption(readKeys(IMAGE_RATIOS), "wide"),
      art: defineOption(["photo", ...Object.keys(ART_DRAWINGS)], "photo"),
    }),
    (props) => renderImage(props.alt, props.ratio, props.art)
  ),
  Graphic: defineComponent(
    "A picture you draw yourself from shapes, such as a record, a sunrise, a coffee cup or an abstract pattern. Each shape has x and y from 0 to 100 (its center, from the left and from the top), size from 1 to 100, and rotate in degrees. Shapes later in the list lie on top. Use 4 to 10 shapes.",
    z.object({
      alt: plainText,
      ratio: defineOption(readKeys(IMAGE_RATIOS), "wide"),
      background: defineOption(["muted", "accent", "plain"], "muted"),
      shapes: z.array(z.unknown()).default([]),
    }),
    (props) =>
      renderArtFrame(
        props.alt,
        props.ratio,
        ` graphic-${props.background}`,
        "",
        props.shapes.map((givenShape: unknown) => renderShape(givenShape, props.ratio)).join("")
      )
  ),
  Logo: defineComponent(
    "A brand mark you design: a shape holding an icon from ICONS, or the first letter of the name when icon is empty, beside the name and an optional tagline.",
    z.object({
      name: plainText,
      shape: defineOption(Object.keys(LOGO_SHAPES), "circle"),
      icon: plainText,
      tagline: plainText,
      size: defineOption(["sm", "md", "lg"], "md"),
    }),
    (props) =>
      `<div class="logo logo-${props.size}">${renderLogoMark(props.name, props.shape, props.icon)}<span class="logo-text"><span class="logo-name">${escapeHtml(props.name)}</span>${props.tagline ? `<span class="logo-tagline">${escapeHtml(props.tagline)}</span>` : ""}</span></div>`
  ),
  Icon: defineComponent(
    "One icon from ICONS on its own, as a decoration or a marker.",
    z.object({
      icon: plainText,
      size: defineOption(["sm", "md", "lg"], "md"),
      tone: defineOption(["accent", "ink", "muted"], "accent"),
    }),
    (props) => `<span class="icon icon-${props.size} icon-${props.tone}">${renderIcon(props.icon)}</span>`
  ),
  Feature: defineComponent(
    "One benefit or fact: an icon from ICONS, a short title and a sentence. Several sit in a Grid.",
    z.object({ icon: plainText, title: plainText, text: plainText }),
    (props) =>
      `<div class="feature"><span class="feature-icon">${renderIcon(props.icon)}</span>${renderHeading(props.title, "3")}${renderText(props.text, "text-muted text-md")}</div>`
  ),
  Steps: defineContainer(
    "A numbered sequence of Step children, such as how it works.",
    z.object({}),
    (_props, children) => `<ol class="steps">${children}</ol>`
  ),
  Step: defineComponent(
    "One step of Steps: a title and a sentence. The number is added for you.",
    z.object({ title: plainText, text: plainText }),
    (props) => `<li class="step">${renderHeading(props.title, "3")}${renderText(props.text, "text-muted text-md")}</li>`
  ),
  Quote: defineComponent(
    "What a customer said, with their name and role.",
    z.object({ text: plainText, name: plainText, role: plainText }),
    (props) =>
      `<blockquote class="quote"><p>${escapeHtml(props.text)}</p><footer>${renderAvatar(props.name, props.role)}</footer></blockquote>`
  ),
  Banner: defineComponent(
    "A wide closing call to action: a title, a sentence and one button.",
    z.object({ title: plainText, text: plainText, action: plainText, tone: defineOption(["accent", "muted"], "accent") }),
    (props) =>
      `<aside class="banner banner-${props.tone}"><div class="banner-copy">${renderHeading(props.title, "2")}${renderText(props.text, "text-md")}</div>${renderButton(props.action, "primary")}</aside>`
  ),
  Spacer: defineComponent(
    "Empty space, to push things apart.",
    z.object({ size: defineOption(readKeys(GAP_SIZES), "lg") }),
    (props) => `<div class="spacer spacer-${props.size}" aria-hidden="true"></div>`
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

const listReadings = (givenValue: unknown) => [
  givenValue,
  typeof givenValue === "number" ? String(givenValue) : TRUTH_BY_WORD[String(givenValue)],
];

const readProps = (propsShape: z.ZodObject, element: Element) => {
  const givenProps = readGivenProps(element);
  return Object.fromEntries(
    Object.entries(propsShape.shape).map(([propName, field]) => {
      const reading = listReadings(givenProps[propName])
        .map((givenValue) => (field as z.ZodType).safeParse(givenValue))
        .find((parsed) => parsed.success);
      return [propName, reading ? reading.data : (field as z.ZodType).parse(undefined)];
    })
  );
};

const readChildKeys = (element: Element) =>
  (Array.isArray(element.children) ? element.children.flat(Infinity) : []).filter(
    (childKey): childKey is string => typeof childKey === "string"
  );

const placeElement = (html: string, element: Element) => {
  const placementClasses = Object.entries(readProps(placementProps, element))
    .filter(([, chosen]) => chosen)
    .map(([propName, chosen]) => `${PLACEMENT_CLASS_STEMS[propName]}-${chosen}`)
    .join(" ");
  return placementClasses ? html.replace('class="', `class="${placementClasses} `) : html;
};

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
  if (!definition) return children;
  return placeElement(definition.render(readProps(definition.props, element), children), element);
};

const readRootElement = (spec: Spec) =>
  typeof spec.root === "string" ? readEntry(spec.elements, spec.root) : undefined;

const readPageStyle = (spec: Spec, fallbackLook: Look) => {
  const rootElement = readRootElement(spec);
  const chosen = rootElement?.type === "Page" ? readProps(components.Page.props, rootElement) : {};
  const look: Look = chosen.look ?? fallbackLook;
  return {
    look,
    headingFont: (chosen.headingFont ?? HEADING_FONT_BY_LOOK[look]) as string | undefined,
    cornersClass: chosen.corners ? ` corners-${chosen.corners}` : "",
  };
};

export const renderSpecToHtml = (spec: Spec, fallbackLook: Look = "clean") => {
  const rootElement = readRootElement(spec);
  if (!rootElement) return "";
  const html = renderElement(spec, spec.root!, []);
  const pageHtml =
    rootElement.type === "Page" ? html : components.Page.render(readProps(components.Page.props, rootElement), html);
  const { look, cornersClass } = readPageStyle(spec, fallbackLook);
  return pageHtml.replace('class="page"', `class="page look-${look}${cornersClass}"`);
};

const sumCharacterCodes = (text: string) =>
  [...text].reduce((sum, character) => sum + character.charCodeAt(0), 0);

export const pickLook = (styleText: string, brief: string, variantIndex: number): Look => {
  const distinctiveLook = DISTINCTIVE_STYLES.find(([, keywords]) => keywords.test(styleText))?.[0];
  const firstIndex = distinctiveLook ? LOOK_ORDER.indexOf(distinctiveLook) : sumCharacterCodes(brief);
  return LOOK_ORDER[(firstIndex + variantIndex) % LOOK_ORDER.length]!;
};

export const listStyleTokens = (spec: Spec, fallbackLook: Look, tokens: StyleToken[]) => {
  const headingToken = tokens.find(
    (token) => token.kind === "font" && HEADING_TOKEN_NAMES.includes(readTokenVariable(token.name).slice(2))
  );
  const headingFont = HEADING_FONTS[readPageStyle(spec, fallbackLook).headingFont ?? ""];
  return headingToken && headingFont ? [{ name: headingToken.name, value: headingFont }] : [];
};

export const findSpecProblems = (spec: Spec): string[] => {
  if (!readRootElement(spec)) {
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

const renderLookCss = ({ ink, accent, onAccent, muted }: Record<string, string>) => [
  `.look-bold .hero{padding:72px 40px;border-radius:28px;background:${accent};color:${onAccent}}`,
  ".look-bold .hero .text-muted,.look-bold .card-accent .text-muted,.look-bold .card-accent .plan-period{color:inherit;opacity:0.85}",
  `.look-bold .hero .button-primary,.look-bold .card-accent .button-primary,.look-bold .card-accent .badge-accent{border-color:${onAccent};background:${onAccent};color:${accent}}`,
  ".look-bold .hero .button-secondary,.look-bold .hero .badge{border-color:currentColor;background:transparent;color:inherit}",
  ".look-bold .heading-1{font-size:60px;font-weight:800}",
  ".look-bold .button{border-radius:999px}",
  `.look-bold .card,.look-bold .stat{border-color:transparent;background:${muted}}`,
  `.look-bold .card-accent{outline:0;background:${accent};color:${onAccent}}`,
  ".look-bold .card-accent .list-item::before{color:inherit}",
  `.look-bold .stat-value{color:${accent}}`,
  `.look-bold .feature-icon{border-radius:999px;background:${accent};color:${onAccent}}`,
  ".look-bold .nav{border-bottom:0}",
  ".look-sharp .card,.look-sharp .stat,.look-sharp .button,.look-sharp .input,.look-sharp .badge,.look-sharp .image,.look-sharp .chart-bar,.look-sharp .toggle-input,.look-sharp .toggle-input::before,.look-sharp .banner,.look-sharp .feature-icon,.look-sharp .step::before{border-radius:0}",
  `.look-sharp .card,.look-sharp .stat,.look-sharp .banner{border:2px solid ${ink};box-shadow:6px 6px 0 ${ink}}`,
  `.look-sharp .card-accent{outline:0;box-shadow:6px 6px 0 ${accent}}`,
  ".look-sharp .card .stat{border:0;box-shadow:none}",
  `.look-sharp .button,.look-sharp .input,.look-sharp .badge,.look-sharp .feature-icon{border:2px solid ${ink}}`,
  ".look-sharp .button,.look-sharp .badge,.look-sharp .heading{text-transform:uppercase}",
  ".look-sharp .button{font-size:14px;letter-spacing:0.04em}",
  `.look-sharp .button-primary{box-shadow:4px 4px 0 ${ink}}`,
  ".look-sharp .button-ghost{border-color:transparent}",
  ".look-sharp .heading{letter-spacing:-0.01em}",
  ".look-sharp .heading-1{font-size:48px}",
  `.look-sharp .nav{border-bottom:2px solid ${ink}}`,
  `.look-sharp .hero{padding:56px 0 32px;border-bottom:2px solid ${ink}}`,
  ".look-editorial .heading{font-weight:500;letter-spacing:-0.01em}",
  ".look-editorial .heading-1{font-size:64px;line-height:1.05}",
  ".look-editorial .text-lg{font-size:22px}",
  ".look-editorial .nav-brand{font-size:22px}",
  `.look-editorial .hero{padding:72px 0 40px;border-bottom:1px solid ${ink}}`,
  `.look-editorial .card,.look-editorial .stat{padding:24px 0 0;border:0;border-top:1px solid ${ink};border-radius:0;background:transparent}`,
  `.look-editorial .card-accent{outline:0;border-top:3px solid ${accent}}`,
  `.look-editorial .card-muted{padding:24px;border-top:0;background:${muted}}`,
  ".look-editorial .card .stat{padding:0;border-top:0}",
  ".look-editorial .button,.look-editorial .banner{border-radius:0}",
  ".look-editorial .feature-icon{width:auto;height:auto;background:transparent}",
  ".look-editorial .quote p{font-size:30px}",
  `.look-soft .card,.look-soft .stat{border-color:transparent;border-radius:24px;box-shadow:0 12px 32px color-mix(in srgb,${ink} 9%,transparent)}`,
  `.look-soft .card-accent{outline:2px solid ${accent}}`,
  ".look-soft .card-muted,.look-soft .card .stat{box-shadow:none}",
  ".look-soft .button,.look-soft .input,.look-soft .badge,.look-soft .feature-icon{border-radius:999px}",
  ".look-soft .input{padding-inline:18px}",
  ".look-soft .image,.look-soft .banner{border-radius:24px}",
  `.look-soft .hero .badge{border-color:transparent;background:${muted}}`,
  ".look-soft .nav{border-bottom:0}",
  ".look-soft .chart-bar{border-radius:999px 999px 0 0}",
];

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
    `.page{box-sizing:border-box;overflow-x:clip;min-height:100vh;padding:0 24px 64px;background:${surface};color:${ink};font-family:${body};font-size:16px;line-height:1.5}`,
    ".page *{box-sizing:border-box}",
    ".page-inner{display:flex;flex-direction:column;margin:0 auto;padding-top:24px}",
    ...Object.entries(PAGE_SPACINGS).map(([name, size]) => `.spacing-${name}{gap:${size}}`),
    ...Object.entries(PAGE_WIDTHS).map(([name, width]) => `.page-${name}{max-width:${width}}`),
    ".page-narrow{padding-top:64px}",
    ".stack{display:flex;flex-direction:column;min-width:0}",
    ".align-center{align-items:center;text-align:center}",
    ".align-start{align-items:flex-start}",
    ".align-end{align-items:flex-end;text-align:right}",
    ...Object.entries(CROSS_ALIGNS).flatMap(([name, value]) => [
      `.items-${name}{align-items:${value}}`,
      `.place-${name}{align-self:${value};justify-self:${name}}`,
    ]),
    ...SPAN_COUNTS.flatMap((count) => [`.span-${count}{grid-column:span ${count}}`, `.row-span-${count}{grid-row:span ${count}}`]),
    ...["left", "center", "right"].map((side) => `.text-align-${side}{text-align:${side}}`),
    ...Object.entries(MAX_WIDTHS).map(([name, width]) => `.max-width-${name}{width:100%;max-width:${width}}`),
    ...Object.entries(GAP_SIZES).map(([name, size]) => `.spacer-${name}{flex:none;height:${size}}`),
    ".hero{display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 0 8px;text-align:center}",
    ".hero .row{justify-content:center}",
    ".hero .row:empty{display:none}",
    ".hero-start{align-items:flex-start;text-align:left}",
    ".hero-start .row{justify-content:flex-start}",
    ".hero-split{flex-direction:row;gap:48px;text-align:left}",
    ".hero-image-left{flex-direction:row-reverse}",
    ".hero-split>*{flex:1 1 0;min-width:0}",
    ".hero-copy{display:flex;flex-direction:column;align-items:flex-start;gap:16px}",
    ".hero-split .row{justify-content:flex-start}",
    ".section{display:flex;flex-direction:column;gap:24px}",
    ".section-muted,.section-accent{margin-inline:calc(50% - 50vw);padding:56px calc(50vw - 50%)}",
    `.section-muted{background:${muted}}`,
    `.section-accent{background:${accent};color:${onAccent}}`,
    ".section-accent>.text-muted{color:inherit;opacity:0.85}",
    ".section-center>.heading,.section-center>.text{align-self:center;text-align:center}",
    ".split{display:grid;gap:32px}",
    ...Object.entries(SPLIT_RATIOS).map(([name, columns]) => `.split-${name}{grid-template-columns:${columns}}`),
    ".split>*{min-width:0}",
    ".split-reverse>:first-child{order:2}",
    ".feature{display:flex;flex-direction:column;align-items:flex-start;gap:10px}",
    `.feature-icon{display:grid;place-items:center;width:44px;height:44px;border-radius:${radius};background:${muted};color:${accent}}`,
    ".steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:32px;margin:0;padding:0;list-style:none;counter-reset:step}",
    ".step{display:flex;flex-direction:column;gap:8px;counter-increment:step}",
    `.step::before{content:counter(step);display:grid;place-items:center;width:36px;height:36px;border-radius:999px;background:${accent};color:${onAccent};font-weight:700}`,
    `.quote{display:flex;flex-direction:column;gap:20px;margin:0;padding-left:24px;border-left:3px solid ${accent}}`,
    `.quote p{margin:0;font-family:${heading};font-size:24px;line-height:1.35;text-wrap:balance}`,
    ".quote footer{margin:0}",
    `.banner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;padding:40px;border-radius:${radius}}`,
    ".banner-copy{display:flex;flex-direction:column;gap:8px;min-width:0}",
    `.banner-accent{background:${accent};color:${onAccent}}`,
    `.banner-accent .button-primary{border-color:${onAccent};background:${onAccent};color:${accent}}`,
    `.banner-muted{background:${muted}}`,
    ".banner .button{align-self:center}",
    ".nav-centered{justify-content:center}",
    ".nav-centered .nav-links{margin-left:0}",
    ".row{display:flex;flex-wrap:wrap}",
    ".row>.card,.row>.stat,.row>.field{flex:1 1 220px}",
    ".grid{display:grid}",
    ...Object.entries(GAP_SIZES).map(([name, size]) => `.gap-${name}{gap:${size}}`),
    ...Object.entries(ROW_ALIGNS).map(([name, value]) => `.justify-${name}{justify-content:${value}}`),
    ...COLUMN_COUNTS.map((count) => `.cols-${count}{grid-template-columns:repeat(${count},minmax(0,1fr))}`),
    `.card{display:flex;flex-direction:column;gap:16px;min-width:0;padding:24px;border:1px solid ${border};border-radius:${radius};background:${card};color:${cardInk}}`,
    `.card-muted{border-color:transparent;background:${muted}}`,
    `.card-accent{border-color:${accent};outline:1px solid ${accent}}`,
    ".page-inner:has(.field,.toggle):not(:has(.table,.chart,.stat,.plan,.grid,.split,.section))>:not(.nav){width:100%;max-width:610px;margin-inline:auto}",
    ".field,.toggle,.field~.button,.toggle~.button{width:100%;max-width:560px}",
    ".grid>.field,.row>.field{max-width:none}",
    ".row:has(>.field){align-items:flex-end}",
    ".card+.divider,.divider:has(+.card){display:none}",
    ".plan-cost{margin:0}",
    `.plan-price{font-family:${heading};font-size:40px;line-height:1;letter-spacing:-0.02em}`,
    `.plan-period{font-size:14px;${quietStyle}}`,
    ".plan .list{flex:1}",
    ".plan .button{align-self:stretch}",
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
    ".row>.field~.button{width:auto}",
    `.button:focus-visible,.input:focus-visible,.toggle-input:focus-visible,.nav a:focus-visible{outline:2px solid ${accent};outline-offset:2px}`,
    `.field{display:flex;flex-direction:column;gap:6px;text-align:left;font-family:${body}}`,
    ".field-label{font-size:14px;font-weight:600}",
    `.input{width:100%;min-height:44px;padding:10px 12px;border:1px solid ${border};border-radius:${radius};background:${surface};color:${ink};font:inherit}`,
    ".toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left}",
    ".toggle-text{display:flex;flex-direction:column}",
    ".toggle-label{font-weight:600}",
    `.toggle-detail,.list-detail,.avatar-detail,.stat-label,.stat-detail,.chart-labels{font-size:14px;${quietStyle}}`,
    `.toggle-input{appearance:none;position:relative;flex:none;width:44px;height:26px;margin:0;border:1px solid ${border};border-radius:999px;background:${muted};cursor:pointer}`,
    `.toggle-input::before{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:999px;background:${ink};opacity:0.5}`,
    `.toggle-input:checked{border-color:${accent};background:${accent}}`,
    `.toggle-input:checked::before{left:21px;background:${onAccent};opacity:1}`,
    `.badge{display:inline-block;align-self:flex-start;padding:2px 10px;border:1px solid ${border};border-radius:999px;font-size:12px;font-weight:600}`,
    ".align-center>.badge{align-self:center}",
    `.badge-accent{border-color:${accent};background:${accent};color:${onAccent}}`,
    ".list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}",
    `.list-item{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid ${border}}`,
    ".list-item:first-child{border-top:0}",
    ".list-check .list-item{justify-content:flex-start;gap:10px;padding:6px 0;border-top:0}",
    ".list-check .list-detail{margin-left:auto}",
    `.list-check .list-item::before{content:"\\2713";font-weight:700;color:${accent}}`,
    `.stat{display:flex;flex-direction:column;gap:4px;min-width:0;padding:20px;border:1px solid ${border};border-radius:${radius};background:${card};color:${cardInk}}`,
    ".card .stat{padding:0;border:0}",
    `.stat-value{font-family:${heading};font-size:32px;line-height:1.1;letter-spacing:-0.02em}`,
    ".chart{display:flex;flex-direction:column;gap:12px;margin:0}",
    ".chart-title{font-weight:600}",
    `.chart-bars{display:flex;align-items:flex-end;justify-content:space-around;gap:8px;height:180px;border-bottom:1px solid ${border}}`,
    `.chart-bar{flex:0 1 64px;border-radius:${radius} ${radius} 0 0;background:${accent}}`,
    ".chart-labels{display:flex;justify-content:space-around;gap:8px;text-align:center}",
    ".chart-labels span{flex:0 1 64px;min-width:0;overflow:hidden;text-overflow:ellipsis}",
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
    `.image{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;max-height:240px;padding:16px;border-radius:${radius};background:linear-gradient(135deg,${muted},color-mix(in srgb,${accent} 24%,${muted}));font-size:14px;text-align:center;${quietStyle}}`,
    ...Object.entries(IMAGE_RATIOS).map(([name, ratio]) => `.ratio-${name}{aspect-ratio:${ratio}}`),
    ".grid .image:not(.image-art){aspect-ratio:4 / 3}",
    ".image-art{position:relative;overflow:hidden;max-height:360px;padding:0}",
    ".graphic{position:absolute;inset:0;width:100%;height:100%}",
    ...Object.entries({ accent, ink, muted, surface }).map(([name, color]) => `.graphic .tone-${name}{fill:${color};stroke:${color}}`),
    ".graphic :not(.outline):not(.outline *){stroke-width:0}",
    ".graphic .outline{fill:none}",
    ".graphic .outline{stroke-linecap:round}",
    `.graphic-accent{background:${accent}}`,
    ".graphic-plain{background:transparent}",
    ".logo{display:flex;align-items:center;gap:12px}",
    ".logo-mark{flex:none;width:40px;height:40px}",
    ".logo-sm .logo-mark{width:28px;height:28px}",
    ".logo-lg .logo-mark{width:72px;height:72px}",
    `.logo-mark>:first-child{fill:${accent}}`,
    `.logo-letter{fill:${onAccent};font-family:${heading};font-size:20px;font-weight:800}`,
    `.logo-icon{fill:none;stroke:${onAccent};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}`,
    ".logo-text{display:flex;flex-direction:column}",
    `.logo-name{font-family:${heading};font-size:20px;font-weight:700}`,
    ".logo-lg .logo-name{font-size:32px}",
    `.logo-tagline{font-size:13px;${quietStyle}}`,
    ".nav-brand{display:inline-flex;align-items:center;gap:10px}",
    ".nav-brand .logo-mark{width:30px;height:30px}",
    ".icon{display:inline-grid;place-items:center}",
    ".icon-md svg{width:32px;height:32px}",
    ".icon-lg svg{width:64px;height:64px}",
    `.icon-accent{color:${accent}}`,
    `.icon-muted{${quietStyle}}`,
    ".hero-split .image,.split>.image{max-height:none}",
    ...renderLookCss({ ink, accent, onAccent, muted }),
    ...Object.entries(CORNER_RADII).map(
      ([name, cornerRadius]) =>
        `.corners-${name} .button,.corners-${name} .input,.corners-${name} .badge{border-radius:${cornerRadius}}`
    ),
    ".corners-square .card,.corners-square .stat,.corners-square .image,.corners-square .hero,.corners-square .banner,.corners-square .feature-icon{border-radius:0}",
    ".corners-rounded .card,.corners-rounded .stat,.corners-rounded .image,.corners-rounded .banner,.corners-pill .card,.corners-pill .stat,.corners-pill .image,.corners-pill .banner{border-radius:20px}",
    "@media (max-width:760px){.hero-split{flex-direction:column}.split{grid-template-columns:minmax(0,1fr)}.span-2,.span-3,.span-4{grid-column:auto}.cols-2,.cols-3,.cols-4{grid-template-columns:minmax(0,1fr)}.page{padding:0 16px 40px}.heading-1{font-size:32px}.nav-links{margin-left:0}}",
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
  '{"op":"add","path":"/elements/orders-card","value":{"type":"Card","props":{"tone":"plain","maxWidth":"lg"},"children":["orders-head","orders-table"]}}',
  '{"op":"add","path":"/elements/orders-head","value":{"type":"Row","props":{"align":"between"},"children":["orders-title","orders-badge"]}}',
  '{"op":"add","path":"/elements/orders-title","value":{"type":"Heading","props":{"text":"Waiting for parts","level":"3"},"children":[]}}',
  '{"op":"add","path":"/elements/orders-badge","value":{"type":"Badge","props":{"text":"3 delayed","tone":"accent"},"children":[]}}',
  '{"op":"add","path":"/elements/orders-table","value":{"type":"Table","props":{"columns":["Bike","Customer","Part","Due"],"rows":[["Trek FX 2","Dana Ortiz","Rear derailleur","Thu"],["Brompton C","Sam Lee","Hinge clamp","Fri"]]},"children":[]}}',
].join("\n");

const LAYOUT_ADVICE = [
  "- Landing or onboarding: Nav, a Hero, a Grid of Features, a muted Section with Steps or a Quote, and a Banner to close.",
  "- Dashboard: Nav, a title, a Grid of three or four Stats, then a Grid of two Cards holding a Chart and a Table.",
  "- Login, sign-up or any single form: Page with width narrow, one Card holding a Heading, the Inputs and one primary Button.",
  "- Inbox, admin or any list of records: Nav, a Row with align between holding the Heading level 1 and a Button, then one Card holding a Table or a List with at least five different rows.",
  "- Checkout: a Heading level 1, then a Split of two Cards: the order as a List with prices in the detail, and the payment form.",
  "- Settings: Page with width wide, one Card per group of settings, each with a Heading level 3 and Toggles, Selects or Inputs.",
  "- Pricing: Nav, a Hero with no actions, then a Grid of Plans. One Plan has a badge.",
];

const DESIGN_MOVES: Record<string, string[]> = {
  Mood: [
    "loud and playful: big type, filled color, pill corners",
    "quiet luxury: serif headings, airy spacing, rules instead of boxes",
    "technical and raw: mono headings, square corners, hard outlines, compact spacing",
    "warm and friendly: rounded headings, soft shadows, generous corners",
    "crisp and minimal: sans headings, thin borders, a lot of empty space",
    "retro print: serif headings with square corners and thick outlines",
    "bold poster: filled color blocks with mono headings and compact spacing",
  ],
  Opening: [
    "a Hero whose picture sits on the left",
    "a Split: a big Heading and Text on one side, a Card or a Graphic on the other",
    "a start-aligned Hero with no picture, and a Row of Stats or Badges right under it",
    "a centered Nav and a large centered Logo above a centered Hero",
    "a Hero whose picture sits on the right, drawn as artwork",
    "a wide Graphic you draw across the top, with the title under it",
  ],
  Body: [
    "a bento Grid of 4 columns where the pieces mix span 2 and rowSpan 2",
    "alternating Splits, every second one reversed, each with an Image or a Graphic",
    "one dominant element beside a narrow side column: a Split with ratio wide-left",
    "bands: plain, muted and accent Sections in turn",
    "one narrow centered column: maxWidth lg, large type, Dividers between the parts",
    "dense: a Grid of 4 columns of small pieces, then one wide piece under it",
    "a Split with ratio wide-right: a narrow column of Stats or a List, then the main content",
  ],
  Artwork: [
    "give the brand a logo with a shape and an icon that fit the product",
    "draw one Graphic of 5 to 9 shapes that pictures the product",
    "use Image art instead of photos, a different art each time",
    "use large Icons as decoration beside the headings",
    "a Logo with a tagline, and one Graphic with background accent",
  ],
};

export const pickDesignMoves = (random: () => number) =>
  [
    "Creative brief for this design, drawn at random so that no two designs come out alike. It wins over the layouts to start from. Adapt it to this screen and make it your own:",
    ...Object.entries(DESIGN_MOVES).map(
      ([moveName, choices]) => `- ${moveName}: ${choices[Math.floor(random() * choices.length)]}.`
    ),
  ].join("\n");

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
      "- Only Page, Section, Split, Stack, Row, Grid, Card, List and Steps take children.",
    ].join("\n"),
    [
      "RULES FOR THE DESIGN",
      "- The root is a Page. A Nav, when the screen has one, is its first child.",
      "- One Hero or one Heading of level 1, never both. One primary Button per group of buttons.",
      "- An Image is a real picture such as a product photo. A person is an Avatar.",
      "- Put things that belong side by side in a Grid or a Row, not in a long column.",
      "- Write real content for this product: real names, numbers and labels. No lorem ipsum and no placeholders.",
      "- Things side by side never repeat each other: every card, plan, stat and row has its own title and its own content.",
      "- Between 15 and 40 elements. Fill the screen the brief asks for and nothing else.",
      "- The theme sets every color and font. Never write a color, a font or CSS.",
    ].join("\n"),
    [
      "PLACEMENT. Any element also takes these props, so you decide where things sit:",
      '- span "2" | "3" | "4" and rowSpan "2" | "3" | "4": how many columns and rows of a Grid it covers. Mix sizes for a bento layout.',
      '- place "start" | "center" | "end" | "stretch": where it sits inside its parent.',
      '- textAlign "left" | "center" | "right", and maxWidth "sm" | "md" | "lg" to keep it narrow.',
    ].join("\n"),
    [
      "STYLE. You are the designer. On the Page, choose the look, headingFont, corners and spacing that suit this product and the design direction. Do not always pick the same.",
      "- look clean: quiet, thin borders. bold: a filled color hero, big type, filled cards. sharp: thick outlines, hard shadows, uppercase. editorial: large type, rules instead of boxes. soft: round, shadowed, friendly.",
      "- Give the screen rhythm: a Hero with an image on either side, a reversed Split, a Section with a muted or accent tone, a Card that spans two columns, a Quote, a Banner.",
    ].join("\n"),
    [
      `ICONS: ${Object.keys(ICON_SHAPES).join(", ")}.`,
      `ARTWORK names, for an Image's art and a Hero's imageArt: ${Object.keys(ART_DRAWINGS).join(", ")}.`,
      `- A Graphic's shapes: {"shape":"${Object.keys(DRAWN_SHAPES).join(" | ")}","x":50,"y":50,"size":30,"tone":"${SHAPE_TONES.join(" | ")}","rotate":0}.`,
      "- You make the pictures. Give the brand a logo: on the Nav, or as a Logo. Draw a Graphic from shapes when the product has a clear symbol. Use art for mood, and photo only for a real product photo.",
    ].join("\n"),
    ["LAYOUTS TO START FROM. Change them when the brief or your own idea calls for it.", ...LAYOUT_ADVICE].join("\n"),
    `TOKENS, an optional last line: TOKENS: [{"name":"<token>","value":"<new value>"}] gives theme tokens new values for this design only. Leave it out unless the brief asks for other colors. The tokens: ${tokens
      .filter((token) => token.kind === "color" || token.kind === "font")
      .map((token) => readTokenVariable(token.name).slice(2))
      .join(", ")}.`,
    `EXAMPLE of the format, for another product. Choose the layout that fits your brief.\n${EXAMPLE_REPLY}`,
  ].join("\n\n");
