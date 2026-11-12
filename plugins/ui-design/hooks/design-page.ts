import { PAGE_SCRIPT } from "./page-script";
import { PAGE_STYLE } from "./page-style";
import {
  TOKEN_KINDS,
  hasDarkValues,
  readTokenVariable,
  renderThemeCss,
  type Theme,
  type ThemeToken,
  type TokenKind,
} from "./theme";

export type DesignMode = "redesign" | "new";

export type DesignVariant = {
  name: string;
  rationale: string;
  html: string;
  css: string;
  kept: string[];
  changed: string[];
  newTokens: ThemeToken[];
};

export type Design = {
  project: string;
  mode: DesignMode;
  subject: string;
  theme: Theme;
  variants: DesignVariant[];
};

export const MAX_NEW_TOKENS = 3;

const MODE_LABELS: Record<DesignMode, { eyebrow: string; subject: string }> = {
  redesign: { eyebrow: "Redesign", subject: "Target" },
  new: { eyebrow: "New design", subject: "Brief" },
};

const TOKEN_KIND_LABELS: Record<TokenKind, string> = {
  color: "Color",
  font: "Font",
  "text-size": "Text size",
  space: "Space",
  radius: "Radius",
  shadow: "Shadow",
};

const PLAIN_COLOR =
  /^(#[0-9a-f]{3,8}|[a-z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\))$/i;

const FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

export const PAGE_POLICY = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'`;

export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const readVariantLetter = (variantIndex: number) =>
  String.fromCharCode(65 + variantIndex);

const readProposedTokens = (variant: DesignVariant) =>
  variant.newTokens.slice(0, MAX_NEW_TOKENS);

export const renderVariantDocument = (theme: Theme, variant: DesignVariant) =>
  `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><style>${renderThemeCss([...theme.tokens, ...readProposedTokens(variant)])}</style><style>${variant.css}</style></head><body>${variant.html}</body></html>`;

const renderList = (heading: string, entries: string[]) =>
  entries.length
    ? `<div><h3>${heading}</h3><ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></div>`
    : "";

export const renderSwatch = (colorValue: string) =>
  PLAIN_COLOR.test(colorValue)
    ? `<span class="swatch" style="background:${escapeHtml(colorValue)}"></span>`
    : "";

const renderTokenValue = (token: ThemeToken, tokenValue: string) =>
  `${token.kind === "color" ? renderSwatch(tokenValue) : ""}${escapeHtml(tokenValue)}`;

const renderTokenRow = (token: ThemeToken) => {
  const inferredMark = token.isInferred
    ? `<span class="pill">Inferred</span>`
    : "";
  const darkValue = token.darkValue
    ? ` <span class="muted">· Dark</span> ${renderTokenValue(token, token.darkValue)}`
    : "";
  return `<tr><td><code>${escapeHtml(readTokenVariable(token.name))}</code>${inferredMark}</td><td>${renderTokenValue(token, token.value)}${darkValue}</td><td><code>${escapeHtml(token.source)}</code></td></tr>`;
};

const renderTokenTable = (heading: string, tokens: ThemeToken[]) =>
  tokens.length
    ? `<div><h3>${heading}</h3><div class="table-wrap"><table><thead><tr><th scope="col">Token</th><th scope="col">Value</th><th scope="col">Source</th></tr></thead><tbody>${tokens.map(renderTokenRow).join("")}</tbody></table></div></div>`
    : "";

const renderTab = (variant: DesignVariant, variantIndex: number) => {
  const letter = readVariantLetter(variantIndex);
  const slug = letter.toLowerCase();
  const isFirst = variantIndex === 0;
  return `<button type="button" role="tab" id="tab-${slug}" aria-controls="panel-${slug}" aria-selected="${isFirst}" tabindex="${isFirst ? 0 : -1}">${letter} · ${escapeHtml(variant.name)}</button>`;
};

const renderPanel =
  ({ mode, theme }: Design, designName: string) =>
  (variant: DesignVariant, variantIndex: number) => {
    const letter = readVariantLetter(variantIndex);
    const slug = letter.toLowerCase();
    const name = escapeHtml(variant.name);
    const redesignNotes =
      mode === "redesign"
        ? `${renderList("Kept", variant.kept)}${renderList("Changed", variant.changed)}`
        : "";
    return `<section role="tabpanel" id="panel-${slug}" aria-labelledby="tab-${slug}"${variantIndex ? " hidden" : ""}>
<div class="variant-head"><h2>${letter} · ${name}</h2><div class="apply"><code id="command-${slug}">/ui-design apply ${designName ? `${escapeHtml(designName)} ` : ""}${letter}</code><button type="button" class="button primary" data-copies="command-${slug}">Use this</button></div></div>
<p class="muted">${escapeHtml(variant.rationale)}</p>
<div class="stage"><iframe sandbox="" title="Variant ${letter}: ${name}" srcdoc="${escapeHtml(renderVariantDocument(theme, variant))}"></iframe></div>
<div class="notes">${redesignNotes}${renderTokenTable("Proposed additions", readProposedTokens(variant))}</div>
</section>`;
  };

const renderWidthButton = (width: string, label: string, isPressed: boolean) =>
  `<button type="button" class="button secondary" data-width="${width}" aria-pressed="${isPressed}">${label}</button>`;

export const renderThemePanel = ({ tokens, inconsistencies }: Theme) =>
  `<section class="theme" aria-labelledby="theme-heading"><h2 id="theme-heading">Theme</h2>${TOKEN_KINDS.map(
    (kind) =>
      renderTokenTable(
        TOKEN_KIND_LABELS[kind],
        tokens.filter((token) => token.kind === kind)
      )
  ).join("")}${renderList("Inconsistencies", inconsistencies)}</section>`;

export const renderDesignPage = (design: Design, designName = "") => {
  const labels = MODE_LABELS[design.mode];
  const darkToggle = hasDarkValues(design.theme.tokens)
    ? `<button type="button" class="button secondary" id="toggle-dark" aria-pressed="false">Dark</button>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">
<title>${labels.eyebrow} · ${escapeHtml(design.project)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body data-frame-width="desktop">
<main>
<header class="hero">
<p class="eyebrow">${labels.eyebrow}</p>
<h1>${escapeHtml(design.project)}</h1>
<p class="muted">${labels.subject}: ${escapeHtml(design.subject)}</p>
</header>
<div class="toolbar"><div role="tablist" aria-label="Variants">${design.variants.map(renderTab).join("")}</div><div class="toggles" role="group" aria-label="Preview">${renderWidthButton("desktop", "Desktop", true)}${renderWidthButton("mobile", "Mobile", false)}${darkToggle}</div></div>
<p class="muted" id="copy-status" role="status"></p>
${design.variants.map(renderPanel(design, designName)).join("\n")}
${renderThemePanel(design.theme)}
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
};
