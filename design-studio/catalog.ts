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
  bread: '<path d="M5 11a4 4 0 0 1 2-7h10a4 4 0 0 1 2 7v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM10 8v3M14 8v3"/>',
  coffee: '<path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1a3 3 0 0 1 0 6h-1M8 3v3M12 3v3"/>',
  cake: '<path d="M4 20v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7zM4 16h16M12 11V7M12 4v.5"/>',
  fork: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 21V3c-2 1-3 4-3 8h3"/>',
  glass: '<path d="M7 3h10l-1 6a4 4 0 0 1-8 0zM12 13v8M8 21h8"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2zM4 20a2 2 0 0 0 2 2h14v-4M9 8h6"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5zM6 11.5V16c2 2.5 10 2.5 12 0v-4.5M22 9v6"/>',
  pen: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
  bike: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l3.5-8H15l3 8M9.5 8l2.5 8 3-8M8 5h3M15 8l-1-3h2"/>',
  car: '<path d="M3 16v-4l2-5h14l2 5v4zM3 12h18"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
  plane: '<path d="M21 3L3 10l7 3 3 7zM10 13l5-4"/>',
  rocket: '<path d="M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 3 1-6M15 15l3 3-1-6M11 19l1 3 1-3"/><circle cx="12" cy="9" r="1.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  mountain: '<path d="M2 20l7-13 4 7 2.5-4L22 20z"/>',
  tent: '<path d="M12 4L3 20h18zM12 13l-3 7M12 13l3 7"/>',
  tree: '<path d="M12 3l6 8h-3l4 6H5l4-6H6zM12 17v4"/>',
  flower: '<circle cx="12" cy="8" r="5"/><circle cx="12" cy="8" r="1.5"/><path d="M12 13v8M12 18c-3 0-5-1-5-4M12 16c3 0 5-1 5-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  flame: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3 0-6 2-9.5z"/>',
  water: '<path d="M2 9q2.5-3 5 0t5 0 5 0 5 0M2 15q2.5-3 5 0t5 0 5 0 5 0"/>',
  fish: '<path d="M3 12c3-5 9-6 14-2l4-3v10l-4-3c-5 4-11 3-14-2zM8 11v.5"/>',
  paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5 3-5 5.5 0 2 2.5 2 5 1 2.5 1 5 1 5-1C17 15 15 12 12 12z"/>',
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6"/>',
  building: '<path d="M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  lamp: '<path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.7.7-1 1.5-1 2.5H9c0-1-.3-1.8-1-2.5z"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z"/>',
  game: '<path d="M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.5 1.5L15 15H9l-1.5 1.5A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4zM7 10.5v3M5.5 12h3M16 12h.5"/>',
  cart: '<path d="M3 4h2l2.5 11h10l2-8H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  bag: '<path d="M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  dumbbell: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  health: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L21 19M8.5 16.5L21 5"/>',
  wrench: '<path d="M15 4a4 4 0 0 0-4.5 5.5L4 16l4 4 6.5-6.5A4 4 0 0 0 20 9l-3 2-2-2 2-3z"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
};
const ICON_ALIASES: Record<string, string> = {
  microphone: "mic", podcast: "mic", bicycle: "bike", cycle: "bike", house: "home", dog: "paw", pet: "paw", cat: "paw",
  books: "book", loaf: "bread", bakery: "bread", cup: "coffee", tea: "coffee", wine: "glass", utensils: "fork",
  food: "fork", shop: "bag", store: "bag", basket: "cart", fitness: "dumbbell", gym: "dumbbell", fire: "flame",
  wave: "water", location: "map", pin: "map", people: "user", person: "user", idea: "lamp", bulb: "lamp",
  travel: "plane", send: "plane", email: "mail", message: "chat", tool: "wrench", settings: "wrench", time: "clock",
  graph: "chart", video: "play", world: "globe", plant: "leaf", money: "card", date: "calendar", edit: "pen",
};
const findIcon = (name: string) => {
  const iconName = String(name).trim().toLowerCase();
  return ICON_SHAPES[iconName] ?? ICON_SHAPES[ICON_ALIASES[iconName] ?? ""];
};
const LOGO_SHAPES: Record<string, string> = {
  plain: "<g/>",
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

const drawIconPicture = (iconShape: string, ratio: string) => {
  const centerX = ART_WIDTHS[ratio]! / 2;
  return `<circle class="tone-accent" opacity="0.14" cx="${centerX}" cy="50" r="42"/><circle class="tone-accent outline" opacity="0.3" stroke-width="1" cx="${centerX}" cy="50" r="48"/><g class="tone-accent outline" stroke-width="1.6" stroke-linejoin="round" transform="translate(${centerX - 30} 20) scale(2.5)">${iconShape}</g>`;
};

const renderImage = (givenAlt: string, ratio: string, art = "") => {
  const alt = /^\w+:\/\//.test(givenAlt) ? "Picture" : givenAlt;
  if (findIcon(art)) return renderArtFrame(alt, ratio, "", " art-icon", drawIconPicture(findIcon(art), ratio));
  return ART_DRAWINGS[art]
    ? renderArtFrame(alt, ratio, "", ` art-${art}`, ART_DRAWINGS[art])
    : `<div class="image ratio-${ratio}" role="img" aria-label="${escapeHtml(alt)}">${IMAGE_ICON}<span>${alt === givenAlt ? escapeHtml(alt) : ""}</span></div>`;
};

const renderIcon = (icon: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${findIcon(icon) ?? ICON_SHAPES.check}</svg>`;

const renderLogoMark = (name: string, shape: string, icon: string) =>
  `<svg class="logo-mark logo-${shape}" viewBox="0 0 40 40" aria-hidden="true">${LOGO_SHAPES[shape]}${
    findIcon(icon)
      ? `<g class="logo-icon" transform="${shape === "plain" ? "translate(2 2) scale(1.5)" : "translate(9 9) scale(0.92)"}">${findIcon(icon)}</g>`
      : `<text class="logo-letter" x="20" y="21" text-anchor="middle" dominant-baseline="central">${escapeHtml(name.trim().charAt(0).toUpperCase())}</text>`
  }</svg>`;

const shapeProps = z.object({
  shape: plainText,
  x: z.coerce.number().min(0).max(100).default(50),
  y: z.coerce.number().min(0).max(100).default(50),
  size: z.coerce.number().min(1).max(100).default(30),
  tone: defineOption(SHAPE_TONES, "accent"),
  rotate: z.coerce.number().default(0),
});

const readIconShape = (icon: string) =>
  findIcon(icon) && {
    isOutline: true,
    draw: (size: number) =>
      `<g transform="scale(${size / 24}) translate(-12 -12)" stroke-width="2" stroke-linejoin="round">${findIcon(icon)}</g>`,
  };

const renderShape = (givenShape: unknown, ratio: string) => {
  if (!givenShape || typeof givenShape !== "object") return "";
  const drawn = readProps(shapeProps, { type: "Shape", props: givenShape as Record<string, unknown> });
  const { isOutline, draw } = DRAWN_SHAPES[drawn.shape] ?? readIconShape(drawn.shape) ?? DRAWN_SHAPES.circle!;
  return `<g transform="translate(${(drawn.x * ART_WIDTHS[ratio]!) / 100} ${drawn.y}) rotate(${drawn.rotate})" class="tone-${drawn.tone}${isOutline ? " outline" : ""}">${draw(drawn.size)}</g>`;
};

const HEADING_STYLES = ["plain", "uppercase", "underline", "bar", "accent"];
const HEADING_SIZES = ["auto", "sm", "md", "lg", "xl"];
const HEADING_WEIGHTS = ["auto", "light", "regular", "bold", "black"];
const UNSTYLED_OPTIONS = ["plain", "auto", "line", "none", "row", "stacked", "md", undefined];

type TitleTreatment = { style?: string; size?: string; weight?: string; eyebrow?: string };

const listOptionClasses = (chosenByPrefix: Record<string, string | undefined>) =>
  Object.entries(chosenByPrefix)
    .filter(([, chosen]) => !UNSTYLED_OPTIONS.includes(chosen))
    .map(([prefix, chosen]) => ` ${prefix}-${chosen}`)
    .join("");

const renderHeading = (text: string, level: string, { style, size, weight, eyebrow }: TitleTreatment = {}) =>
  text
    ? `${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h${level} class="heading heading-${level}${listOptionClasses({ "heading-style": style, "heading-size": size, "heading-weight": weight })}">${escapeHtml(text)}</h${level}>`
    : "";

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
    "The top bar: a brand, links, and one optional action button. The first child of the Page. Layout centered puts all of it in the middle, stacked puts a big brand above the links, split puts the brand between the links and the button, left puts the links right after the brand. Style is its treatment: a line under it, plain, a filled color bar, a box, or a floating pill. logo draws a mark of that shape before the brand, holding the icon named in logoIcon or else the brand's first letter.",
    z.object({
      brand: plainText,
      items: textList,
      action: plainText,
      layout: defineOption(["spread", "centered", "stacked", "split", "left"], "spread"),
      logo: defineOption(["none", ...Object.keys(LOGO_SHAPES)], "none"),
      logoIcon: plainText,
      style: defineOption(["line", "plain", "filled", "boxed", "floating"], "line"),
      links: defineOption(["plain", "underline", "pill", "uppercase"], "plain"),
      brandSize: defineOption(["md", "lg", "xl"], "md"),
    }),
    (props) =>
      `<nav class="nav nav-${props.layout}${listOptionClasses({ "nav-style": props.style, "nav-links": props.links })}"><span class="nav-brand${listOptionClasses({ "nav-brand": props.brandSize })}">${props.logo === "none" ? "" : renderLogoMark(props.brand, props.logo, props.logoIcon)}${escapeHtml(props.brand)}</span><span class="nav-links">${props.items
        .map((link: string) => `<a href="#">${escapeHtml(link)}</a>`)
        .join("")}</span>${renderButton(props.action, "primary")}</nav>`
  ),
  Hero: defineComponent(
    "The opening of a landing, onboarding or pricing screen: a small badge, the level 1 title, a sentence, up to two buttons, and an optional picture described in image, which sits beside the text on the side you choose. imageArt draws that picture as an ICONS name or a PATTERNS name.",
    z.object({
      badge: plainText,
      title: plainText,
      text: plainText,
      primaryAction: plainText,
      secondaryAction: plainText,
      align: defineOption(["center", "start", "end"], "center"),
      image: plainText,
      imageArt: plainText,
      imageSide: defineOption(["right", "left", "below", "above"], "right"),
      tone: defineOption(["plain", "muted", "accent", "outline"], "plain"),
      titleSize: defineOption(HEADING_SIZES, "auto"),
      titleStyle: defineOption(HEADING_STYLES, "plain"),
    }),
    (props) => {
      const copy = `${renderBadge(props.badge, "neutral")}${renderHeading(props.title, "1", { style: props.titleStyle, size: props.titleSize })}${renderText(props.text, "text-muted text-lg")}<div class="row gap-sm items-center">${renderButton(props.primaryAction, "primary")}${renderButton(props.secondaryAction, "secondary")}</div>`;
      const toneClass = listOptionClasses({ "hero-tone": props.tone });
      return props.image
        ? `<header class="hero hero-split hero-image-${props.imageSide}${toneClass}"><div class="hero-copy">${copy}</div>${renderImage(props.image, "wide", props.imageArt)}</header>`
        : `<header class="hero hero-${props.align}${toneClass}">${copy}</header>`;
    }
  ),
  Section: defineComponent(
    "A band of the screen with its own title, sentence and children. Eyebrow is a small label or number above the title. Layout side puts the title in a left column beside the children. Tone muted or accent gives it a full-width background, which breaks up a long screen.",
    z.object({
      title: plainText,
      text: plainText,
      tone: defineOption(["plain", "muted", "accent"], "plain"),
      align: defineOption(["start", "center", "end"], "start"),
      layout: defineOption(["stacked", "side"], "stacked"),
      eyebrow: plainText,
      titleStyle: defineOption(HEADING_STYLES, "plain"),
      titleSize: defineOption(HEADING_SIZES, "auto"),
    }),
    (props, children) => {
      const header = `${renderHeading(props.title, "2", { style: props.titleStyle, size: props.titleSize, eyebrow: props.eyebrow })}${renderText(props.text, "text-muted text-lg")}`;
      const content =
        props.layout === "side"
          ? `<div class="section-header">${header}</div><div class="section-body">${children}</div>`
          : `${header}${children}`;
      return `<section class="section section-${props.tone} section-${props.align}${listOptionClasses({ section: props.layout })}">${content}</section>`;
    }
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
    "A heading. Level 1 is the screen title and appears once. Style bar draws a color bar beside it, accent colors it. Eyebrow is a small label above it.",
    z.object({
      text: plainText,
      level: defineOption(["1", "2", "3"], "2"),
      size: defineOption(HEADING_SIZES, "auto"),
      weight: defineOption(HEADING_WEIGHTS, "auto"),
      style: defineOption(HEADING_STYLES, "plain"),
      eyebrow: plainText,
    }),
    (props) => renderHeading(props.text, props.level, props)
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
    "A picture, described in alt. art draws it in the theme's colors: an ICONS name draws that subject large, a PATTERNS name draws a pattern. Without art it is a placeholder for a photo.",
    z.object({
      alt: plainText,
      ratio: defineOption(readKeys(IMAGE_RATIOS), "wide"),
      art: plainText,
    }),
    (props) => renderImage(props.alt, props.ratio, props.art)
  ),
  Graphic: defineComponent(
    "A picture you compose yourself. A shape is any ICONS name, drawn as that subject, or a geometric shape. Each has x and y from 0 to 100 (its center, from the left and from the top), size from 1 to 100, and rotate in degrees. Later shapes lie on top. Build a scene of the subject: one or two large icons, with a few geometric shapes around them as ground, sky or accent.",
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
    "A brand mark you design: an icon from ICONS that shows what the brand does, beside the name and an optional tagline. Shape plain draws the icon alone; the other shapes put it in a filled badge. With no icon it shows the first letter of the name.",
    z.object({
      name: plainText,
      shape: defineOption(Object.keys(LOGO_SHAPES), "plain"),
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
    z.object({
      title: plainText,
      text: plainText,
      action: plainText,
      tone: defineOption(["accent", "muted"], "accent"),
      layout: defineOption(["row", "centered"], "row"),
      titleStyle: defineOption(HEADING_STYLES, "plain"),
    }),
    (props) =>
      `<aside class="banner banner-${props.tone}${listOptionClasses({ banner: props.layout })}"><div class="banner-copy">${renderHeading(props.title, "2", { style: props.titleStyle })}${renderText(props.text, "text-md")}</div>${renderButton(props.action, "primary")}</aside>`
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

const SHORTEST_REPEATED_TEXT = 12;

const readShownText = (html: string) => html.replace(/<[^>]+>/g, "");

const dropRepeatedBlocks = (htmls: string[]) => {
  const shownTexts = htmls.map(readShownText);
  return htmls.filter(
    (_, htmlIndex) =>
      shownTexts[htmlIndex]!.length < SHORTEST_REPEATED_TEXT || shownTexts.indexOf(shownTexts[htmlIndex]!) === htmlIndex
  );
};

const renderElement = (spec: Spec, key: string, ancestorKeys: string[]): string => {
  const element = readShownElement(spec, key, ancestorKeys);
  if (!element) return "";
  const children = dropRepeatedBlocks(
    readChildKeys(element).map((childKey) => renderElement(spec, childKey, [...ancestorKeys, key]))
  ).join("");
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
  ".look-bold .hero .text-muted,.look-bold .card-accent .list-detail,.look-bold .card-accent .text-muted,.look-bold .card-accent .plan-period{color:inherit;opacity:0.85}",
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
    ".page-inner>.image-art{max-height:280px}",
    ".page-narrow:has(.nav,.hero,.grid,.split,.section){max-width:1120px}",
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
    `.logo-plain .logo-icon{stroke:${accent}}`,
    `.logo-plain .logo-letter{fill:${accent};font-size:30px}`,
    `.nav-style-filled .logo-mark>:first-child{fill:${onAccent}}`,
    `.nav-style-filled .logo-icon,.nav-style-filled .logo-letter{stroke:${accent};fill:${accent}}`,
    `.nav-style-filled .logo-plain .logo-icon{stroke:${onAccent}}`,
    `.nav-style-filled .logo-plain .logo-letter{fill:${onAccent};stroke:none}`,
    `.graphic-accent .tone-accent{fill:${onAccent};stroke:${onAccent}}`,
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
    ".hero-split .image,.split .image{max-height:420px}",
    ".nav-stacked{flex-direction:column;gap:12px;text-align:center}",
    ".nav-stacked .nav-links,.nav-left .nav-links,.nav-split .nav-links{margin-left:0}",
    ".nav-stacked .nav-links{justify-content:center}",
    ".nav-left .button{margin-left:auto}",
    ".nav-stacked .button{align-self:center}",
    ".nav-split{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}",
    ".nav-split .nav-links{order:-1}",
    ".nav-split .button{justify-self:end}",
    ".page .nav.nav-style-plain{border-bottom:0}",
    `.page .nav.nav-style-filled{margin:-24px calc(50% - 50vw) 0;padding:16px calc(50vw - 50%);border-bottom:0;background:${accent};color:${onAccent}}`,
    `.nav-style-filled .button-primary{border-color:${onAccent};background:${onAccent};color:${accent}}`,
    `.page .nav.nav-style-boxed{padding:12px 20px;border:1px solid ${border};border-radius:${radius}}`,
    `.page .nav.nav-style-floating{padding:10px 24px;border:0;border-radius:999px;background:${muted}}`,
    ".nav-links-underline a{padding-bottom:4px;border-bottom:2px solid currentColor}",
    ".nav-links-pill a{padding:5px 14px;border:1px solid currentColor;border-radius:999px}",
    ".nav-links-pill{gap:10px}",
    ".nav-links-uppercase a{font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase}",
    ".page .nav-brand.nav-brand-lg{font-size:26px}",
    ".page .nav-brand.nav-brand-xl{font-size:38px;letter-spacing:-0.02em}",
    ".nav-brand-lg .logo-mark{width:38px;height:38px}",
    ".nav-brand-xl .logo-mark{width:48px;height:48px}",
    `.eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${accent}}`,
    ".page .heading.heading-size-sm{font-size:18px}",
    ".page .heading.heading-size-md{font-size:26px}",
    ".page .heading.heading-size-lg{font-size:40px}",
    ".page .heading.heading-size-xl{font-size:68px;line-height:1.02}",
    ".page .heading.heading-weight-light{font-weight:300}",
    ".page .heading.heading-weight-regular{font-weight:400}",
    ".page .heading.heading-weight-bold{font-weight:700}",
    ".page .heading.heading-weight-black{font-weight:900}",
    ".page .heading.heading-style-uppercase{letter-spacing:0.04em;text-transform:uppercase}",
    `.page .heading.heading-style-underline{width:fit-content;padding-bottom:10px;border-bottom:4px solid ${accent}}`,
    `.page .heading.heading-style-bar{padding-left:16px;border-left:6px solid ${accent}}`,
    `.page .heading.heading-style-accent{color:${accent}}`,
    ":is(.section-accent,.banner-accent,.card-accent,.hero-tone-accent,.look-bold .hero) :is(.heading,.eyebrow){border-color:currentColor;color:inherit}",
    ".hero>.badge{align-self:auto}",
    ".hero-end{align-items:flex-end;text-align:right}",
    ".hero-end .row{justify-content:flex-end}",
    ".hero-image-below{flex-direction:column;gap:32px}",
    ".hero-image-above{flex-direction:column-reverse;gap:32px}",
    ".hero-image-below>*,.hero-image-above>*{flex:none;width:100%}",
    ".hero-image-below .image,.hero-image-above .image{max-height:340px}",
    `.hero-tone-muted,.hero-tone-accent,.hero-tone-outline{border-radius:${radius}}`,
    ".page .hero.hero-tone-muted,.page .hero.hero-tone-accent,.page .hero.hero-tone-outline{padding:56px 40px;border:0}",
    `.page:not(.look-bold) .hero-tone-muted{background:${muted}}`,
    ".page:not(.look-bold) .hero.hero-tone-outline{border:2px solid currentColor}",
    `.hero-tone-accent{background:${accent};color:${onAccent}}`,
    ".hero-tone-accent .text-muted{color:inherit;opacity:0.85}",
    `.hero-tone-accent .button-primary{border-color:${onAccent};background:${onAccent};color:${accent}}`,
    ".hero-tone-accent .button-secondary,.hero-tone-accent .badge{border-color:currentColor;background:transparent;color:inherit}",
    ".section-center>.eyebrow{align-self:center}",
    ".section-end>.heading,.section-end>.text,.section-end>.eyebrow{align-self:flex-end;text-align:right}",
    ".section-side{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:40px;align-items:start}",
    ".section-header,.section-body{display:flex;flex-direction:column;gap:16px;min-width:0}",
    ".section-body{gap:24px}",
    ".banner-centered{flex-direction:column;justify-content:center;text-align:center}",
    ".banner-centered .banner-copy{align-items:center}",
    "@media (max-width:760px){.section-side,.nav-split{grid-template-columns:minmax(0,1fr)}.page .heading.heading-size-xl{font-size:40px}}",
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
    'loud and playful: look "bold", headingFont "rounded", corners "pill", big type and filled color',
    'quiet luxury: look "editorial", headingFont "serif", spacing "airy", rules instead of boxes',
    'technical and raw: look "sharp", headingFont "mono", corners "square", spacing "compact"',
    'warm and friendly: look "soft", headingFont "rounded", corners "rounded"',
    'crisp and minimal: look "clean", headingFont "sans", corners "rounded", spacing "airy", a lot of empty space',
    'retro print: look "sharp", headingFont "serif", corners "square", thick outlines',
    'bold poster: look "bold", headingFont "mono", corners "square", spacing "compact", filled color blocks',
    'magazine: look "editorial", headingFont "sans", corners "square", large type',
    'gentle and calm: look "soft", headingFont "serif", corners "pill", spacing "airy"',
  ],
  Header: [
    'a Nav with layout "stacked", style "plain" and brandSize "xl"; every title with titleStyle "bar"',
    'a Nav with layout "split", style "floating" and links "pill"; an eyebrow above every Section title',
    'a Nav with style "filled" and links "uppercase"; Sections with layout "side"',
    'a Nav with layout "left", style "boxed" and links "underline"; titles with titleStyle "underline" and titleSize "lg"',
    'a Nav with layout "centered" and brandSize "lg"; titles with titleStyle "uppercase", Headings with weight "light" and size "xl"',
    'a Nav with layout "spread", style "plain", links "pill" and a logo; titles with titleStyle "accent"; centered Sections',
    'a Nav with layout "split" and style "line"; numbered eyebrows such as "01", "02" above Section titles; Sections with layout "side"',
    'a Nav with layout "stacked", style "filled" and links "uppercase"; Section titles aligned "end" with titleSize "lg"',
  ],
  Opening: [
    "a Hero whose picture sits on the left",
    "a Split: a big Heading and Text on one side, a Card or a Graphic on the other",
    'a start-aligned Hero with no picture, tone "outline" and titleSize "xl", and a Row of Stats or Badges right under it',
    "a centered Nav and a large centered Logo above a centered Hero",
    'a Hero with tone "muted" whose picture sits below the text, drawn as artwork',
    "a Split: the title, a Text and a Button on one side, a square Graphic you draw on the other",
  ],
  Body: [
    "a bento Grid of 4 columns where the pieces mix span 2 and rowSpan 2",
    "alternating Splits, every second one reversed, each with an Image or a Graphic",
    "one dominant element beside a narrow side column: a Split with ratio wide-left",
    "bands: plain, muted and accent Sections in turn",
    "one centered column on a wide Page: each part with maxWidth lg and place center, large type, Dividers between the parts",
    "dense: a Grid of 4 columns of small pieces, then one wide piece under it",
    "a Split with ratio wide-right: a narrow column of Stats or a List, then the main content",
  ],
  Artwork: [
    "a logo whose icon shows the product, drawn plain with no shape around it, and Images whose art is an icon of the subject",
    "one Graphic that is a scene of the subject: a large icon or two, with geometric shapes as ground and sky",
    "a logo in a badge shape with an icon of the product, and pattern art for mood beside pictures of the subject",
    "large Icons of the subject as decoration beside the headings, a different fitting icon for each",
    "a Logo with a tagline and an icon of the product, and a Hero whose imageArt is an icon of the subject",
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
      "- A picture is described in a few words, never with a link. A person is an Avatar.",
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
      "- An Image's art and a Hero's imageArt take an ICONS name, which draws a large picture of that subject. Choose that for the main picture.",
      `PATTERNS, for mood only, also for art and imageArt: ${Object.keys(ART_DRAWINGS).join(", ")}.`,
      `- A Graphic's shapes: {"shape":"<an ICONS name> | ${Object.keys(DRAWN_SHAPES).join(" | ")}","x":50,"y":50,"size":30,"tone":"${SHAPE_TONES.join(" | ")}","rotate":0}.`,
      "- You make the pictures, and they show what this product is: a bakery gets bread, a bike shop a bike, a podcast a mic. Never pick an icon that has nothing to do with the subject.",
      "- Give the brand a logo with such an icon: on the Nav, or as a Logo. Give each Feature its own fitting icon. Use an icon name as an Image's art or a Hero's imageArt for a picture of the subject, and compose a Graphic from icons for a scene. Patterns and geometric shapes are for mood, and photo only for a real product photo.",
    ].join("\n"),
    [
      "HEADERS AND TITLES. You shape them too, so no two screens open alike:",
      "- The Nav: its layout, style, links and brandSize. The Hero: its align, tone, titleSize, titleStyle and imageSide.",
      "- A Section: its layout, align, eyebrow, titleStyle and titleSize. A Heading: its size, weight, style and eyebrow. A Banner: its layout and titleStyle.",
      "- Keep one title treatment through a screen. Do not leave these at their defaults.",
    ].join("\n"),
    ["LAYOUTS TO START FROM. Change them when the brief or your own idea calls for it.", ...LAYOUT_ADVICE].join("\n"),
    `TOKENS, an optional last line: TOKENS: [{"name":"<token>","value":"<new value>"}] gives theme tokens new values for this design only. Leave it out unless the brief asks for other colors. The tokens: ${tokens
      .filter((token) => token.kind === "color" || token.kind === "font")
      .map((token) => readTokenVariable(token.name).slice(2))
      .join(", ")}.`,
    `EXAMPLE of the format, for another product. Choose the layout that fits your brief.\n${EXAMPLE_REPLY}`,
  ].join("\n\n");
