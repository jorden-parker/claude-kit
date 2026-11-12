import { AUDIT_SEVERITIES, type AuditSeverity } from "./audit";
import { pluralize } from "./audit-page";
import {
  PAGE_POLICY,
  SWATCH_FAN_MARK,
  escapeHtml,
  readVariantLetter,
  renderVariantDocument,
  type Design,
  type DesignMode,
  type DesignVariant,
} from "./design-page";
import { readFields, readList, readText, readTextList } from "./input";
import { PAGE_STYLE } from "./page-style";
import { readTheme, readTokens, type Theme } from "./theme";

type DesignEntry = {
  kind: "design";
  name: string;
  savedAt: string;
  project: string;
  design: Design;
};

type AuditEntry = {
  kind: "audit";
  name: string;
  savedAt: string;
  project: string;
  severities: string[];
  groupCount: number;
};

export type GalleryEntry = DesignEntry | AuditEntry;

const SAVED_NAME =
  /^(design|audit)-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})?\.json$/;
const FALLBACK_PROJECT = "This project";
const DESIGN_MODE_LABELS: Record<DesignMode, string> = {
  new: "New",
  redesign: "Redesign",
};
const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  error: "Errors",
  warning: "Warnings",
  note: "Notes",
};
const FILTERS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "redesign", label: "Redesign" },
  { value: "audit", label: "Audit" },
];

const GALLERY_STYLE = `
.gallery-toolbar{align-items:center}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.search{display:flex;flex:1 1 220px;align-items:center;gap:10px;max-width:420px;font-size:13px;color:var(--muted)}
.search input{flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;transition:border-color .2s}
.search input:hover{border-color:var(--line-strong)}
.search input:focus-visible,.chip:focus-visible,.card a.button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:24px}
.card{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);transition:border-color .2s}
.card:hover{border-color:var(--line-strong)}
.thumb{--scale:.25;position:relative;aspect-ratio:16/10;overflow:hidden;border-bottom:1px solid var(--line);background:var(--surface)}
.thumb iframe{position:absolute;top:0;left:0;width:1280px;height:800px;border:0;background:#fff;pointer-events:none;transform:scale(var(--scale));transform-origin:0 0}
.card-body{display:flex;flex:1;flex-direction:column;gap:12px;padding:16px 18px 18px}
.card-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.card-head .pill{margin-left:0}
.card-title{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
.card-body>.muted{margin:0;font-size:13px;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:inherit;font-size:12px;height:28px;padding:0 10px;border:1px solid var(--line);border-radius:99px;background:var(--panel);color:var(--muted);cursor:pointer;transition:color .2s,border-color .2s,background-color .2s}
.chip:hover{color:var(--text);border-color:var(--line-strong)}
.chip[aria-pressed=true]{border-color:var(--text);background:var(--surface);color:var(--text)}
.card .apply{min-width:0}
.card .apply code{min-width:0;max-width:100%}
.card a.button{display:inline-flex;align-items:center;align-self:flex-start;text-decoration:none}
.card .counts{margin:0}
.empty{margin:24px 0 0;padding:32px 20px;border:1px dashed var(--line-strong);border-radius:12px;text-align:center;color:var(--muted)}
.empty p{margin:0}
@media (max-width:640px){.chip,.button,.search input,#gallery-sort{min-height:44px}.search{max-width:none}}
`;

const GALLERY_SCRIPT = String.raw`
(function(){
  var grid = document.getElementById("gallery-grid");
  if (!grid) return;
  var REFERENCE_WIDTH = 1280;
  function listAll(selector, root){ return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  var cards = listAll("[data-card]");
  var search = document.getElementById("gallery-search");
  var filterButtons = listAll("[data-filter]");
  var sortButton = document.getElementById("gallery-sort");
  var resultCount = document.getElementById("result-count");
  var noMatch = document.getElementById("no-match");
  var copyStatus = document.getElementById("copy-status");
  var activeFilter = "all";

  function applyFilters(){
    var query = search.value.trim().toLowerCase();
    var shownCount = 0;
    cards.forEach(function(card){
      var matchesFilter = activeFilter === "all" || card.dataset.mode === activeFilter;
      var matchesQuery = card.dataset.search.indexOf(query) >= 0;
      card.hidden = !(matchesFilter && matchesQuery);
      if (!card.hidden) shownCount++;
    });
    resultCount.textContent = "Showing " + shownCount + " of " + cards.length;
    noMatch.hidden = shownCount > 0;
  }

  filterButtons.forEach(function(filterButton){
    filterButton.addEventListener("click", function(){
      activeFilter = filterButton.dataset.filter;
      filterButtons.forEach(function(otherButton){
        otherButton.setAttribute("aria-pressed", String(otherButton === filterButton));
      });
      applyFilters();
    });
  });
  search.addEventListener("input", applyFilters);

  sortButton.addEventListener("click", function(){
    var isOldestFirst = sortButton.getAttribute("aria-pressed") !== "true";
    sortButton.setAttribute("aria-pressed", String(isOldestFirst));
    var direction = isOldestFirst ? 1 : -1;
    cards.slice().sort(function(first, second){
      return direction * first.dataset.savedAt.localeCompare(second.dataset.savedAt);
    }).forEach(function(card){ grid.appendChild(card); });
  });

  function copyCommand(output){
    function showCopied(){
      copyStatus.textContent = "Copied " + output.textContent + ". Paste it in the session.";
    }
    function selectCommand(){
      var range = document.createRange();
      range.selectNodeContents(output);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = "Could not copy. The command is selected: press Cmd/Ctrl+C.";
    }
    try { navigator.clipboard.writeText(output.textContent).then(showCopied, selectCommand); } catch (error) { selectCommand(); }
  }

  function scaleThumb(thumb){ thumb.style.setProperty("--scale", String(thumb.clientWidth / REFERENCE_WIDTH)); }
  var thumbObserver = new ResizeObserver(function(resizedEntries){
    resizedEntries.forEach(function(resizedEntry){ scaleThumb(resizedEntry.target); });
  });
  listAll("[data-thumb]").forEach(function(thumb){ thumbObserver.observe(thumb); });

  cards.forEach(function(card){
    var copyButton = card.querySelector("[data-copy]");
    if (!copyButton) return;
    var output = card.querySelector("[data-command-output]");
    var chips = listAll("[data-show-variant]", card);
    var frames = listAll("[data-variant-frame]", card);
    chips.forEach(function(chip){
      chip.addEventListener("click", function(){
        var shownIndex = chip.dataset.showVariant;
        chips.forEach(function(otherChip){ otherChip.setAttribute("aria-pressed", String(otherChip === chip)); });
        frames.forEach(function(frame){ frame.hidden = frame.dataset.variantFrame !== shownIndex; });
        output.textContent = chip.dataset.command;
      });
    });
    copyButton.addEventListener("click", function(){ copyCommand(output); });
  });
})();
`;

const isDesignMode = (value: string): value is DesignMode =>
  value === "new" || value === "redesign";

const readSavedFields = (fileText: string): Record<string, unknown> => {
  try {
    return readFields(JSON.parse(fileText));
  } catch {
    return {};
  }
};

const readSavedVariant = (rawVariant: unknown): DesignVariant | undefined => {
  const fields = readFields(rawVariant);
  const name = readText(fields.name);
  if (
    !name ||
    typeof fields.html !== "string" ||
    typeof fields.css !== "string"
  ) {
    return undefined;
  }
  return {
    name,
    rationale: readText(fields.rationale),
    html: fields.html,
    css: fields.css,
    kept: readTextList(fields.kept),
    changed: readTextList(fields.changed),
    newTokens: readTokens(fields.newTokens, false).tokens,
    restyledTokens: readTokens(fields.restyledTokens, false).tokens,
  };
};

const readSavedDesign = (
  fields: Record<string, unknown>
): Design | undefined => {
  const { theme, problems } = readTheme(fields.theme);
  const mode = readText(fields.mode);
  const rawVariants = readList(fields.variants);
  const variants = rawVariants.flatMap((rawVariant) => {
    const variant = readSavedVariant(rawVariant);
    return variant ? [variant] : [];
  });
  if (
    problems.length ||
    !isDesignMode(mode) ||
    variants.length === 0 ||
    variants.length !== rawVariants.length
  ) {
    return undefined;
  }
  return {
    project: readText(fields.project) || FALLBACK_PROJECT,
    mode,
    subject: readText(fields.subject),
    theme,
    variants,
  };
};

export const readGalleryEntry = (
  fileName: string,
  fileText: string | undefined
): GalleryEntry | undefined => {
  const nameParts = SAVED_NAME.exec(fileName);
  if (!nameParts || fileText === undefined) return undefined;
  const [, kind, date, hours, minutes, seconds = "00"] = nameParts;
  const name = fileName.slice(0, -".json".length);
  const savedAt = `${date}T${hours}:${minutes}:${seconds}Z`;
  const fields = readSavedFields(fileText);
  if (kind === "design") {
    const design = readSavedDesign(fields);
    if (!design) return undefined;
    return { kind: "design", name, savedAt, project: design.project, design };
  }
  const { problems } = readTheme(fields.theme);
  if (
    problems.length ||
    !Array.isArray(fields.findings) ||
    !Array.isArray(fields.componentGroups)
  ) {
    return undefined;
  }
  return {
    kind: "audit",
    name,
    savedAt,
    project: readText(fields.project) || FALLBACK_PROJECT,
    severities: readList(fields.findings).map((finding) =>
      readText(readFields(finding).severity)
    ),
    groupCount: fields.componentGroups.length,
  };
};

const describeApplyCommand = (designName: string, letter: string) =>
  `/ui-design apply ${designName} ${letter}`;

const describeSavedAt = (savedAt: string) =>
  `${savedAt.slice(0, 10)} · ${savedAt.slice(11, 16)} UTC`;

const renderSavedTime = (savedAt: string) =>
  `<time datetime="${escapeHtml(savedAt)}">${describeSavedAt(savedAt)}</time>`;

const renderCardOpening = (savedAt: string, mode: string, searchText: string) =>
  `<article class="card" data-card data-mode="${mode}" data-saved-at="${escapeHtml(savedAt)}" data-search="${escapeHtml(searchText.toLowerCase())}">`;

const renderVariantChip =
  (designName: string) => (variant: DesignVariant, variantIndex: number) => {
    const letter = readVariantLetter(variantIndex);
    const command = escapeHtml(describeApplyCommand(designName, letter));
    return `<button type="button" class="chip" data-show-variant="${variantIndex}" data-command="${command}" aria-pressed="${variantIndex === 0}">${letter} · ${escapeHtml(variant.name)}</button>`;
  };

const renderVariantFrame =
  (theme: Theme) => (variant: DesignVariant, variantIndex: number) => {
    const letter = readVariantLetter(variantIndex);
    const srcdoc = escapeHtml(renderVariantDocument(theme, variant));
    return `<iframe sandbox="" loading="lazy" tabindex="-1" title="Variant ${letter}: ${escapeHtml(variant.name)}" srcdoc="${srcdoc}" data-variant-frame="${variantIndex}"${variantIndex ? " hidden" : ""}></iframe>`;
  };

const renderDesignCard = (entry: DesignEntry) => {
  const { design, name } = entry;
  const searchText = [
    name,
    design.project,
    design.subject,
    ...design.variants.map((variant) => variant.name),
  ].join(" ");
  return `${renderCardOpening(entry.savedAt, design.mode, searchText)}
<div class="thumb" aria-hidden="true" data-thumb>${design.variants.map(renderVariantFrame(design.theme)).join("")}</div>
<div class="card-body">
<div class="card-head"><span class="pill">${DESIGN_MODE_LABELS[design.mode]}</span>${renderSavedTime(entry.savedAt)}</div>
<h2 class="card-title">${escapeHtml(design.subject || design.project)}</h2>
<p class="muted">${escapeHtml(design.project)}</p>
<div class="chips" role="group" aria-label="Variants">${design.variants.map(renderVariantChip(name)).join("")}</div>
<div class="apply"><code data-command-output>${escapeHtml(describeApplyCommand(name, readVariantLetter(0)))}</code><button type="button" class="button secondary" data-copy>Copy</button></div>
<a class="button secondary" href="${escapeHtml(name)}.html">Open</a>
</div>
</article>`;
};

const renderCount = (label: string, count: number) =>
  `<li>${label} <strong>${count}</strong></li>`;

const renderAuditCard = (entry: AuditEntry) => {
  const counts = AUDIT_SEVERITIES.map((severity) =>
    renderCount(
      SEVERITY_LABELS[severity],
      entry.severities.filter((savedSeverity) => savedSeverity === severity)
        .length
    )
  ).join("");
  return `${renderCardOpening(entry.savedAt, "audit", `${entry.name} ${entry.project} audit`)}
<div class="card-body">
<div class="card-head"><span class="pill">Audit</span>${renderSavedTime(entry.savedAt)}</div>
<h2 class="card-title">${escapeHtml(entry.project)}</h2>
<ul class="counts">${counts}${renderCount("Component groups", entry.groupCount)}</ul>
<a class="button secondary" href="${escapeHtml(entry.name)}.html">Open</a>
</div>
</article>`;
};

const renderCard = (entry: GalleryEntry) =>
  entry.kind === "design" ? renderDesignCard(entry) : renderAuditCard(entry);

const renderFilter = ({ value, label }: { value: string; label: string }) =>
  `<button type="button" class="button secondary" data-filter="${value}" aria-pressed="${value === "all"}">${label}</button>`;

const renderToolbar = (total: number) =>
  `<div class="toolbar gallery-toolbar"><label class="search"><span>Search</span><input type="search" id="gallery-search" autocomplete="off" placeholder="Project, subject, variant or file"></label><div class="filters" role="group" aria-label="Show">${FILTERS.map(renderFilter).join("")}</div><button type="button" class="button secondary" id="gallery-sort" aria-pressed="false">Oldest first</button></div>
<p class="muted" id="result-count" aria-live="polite">Showing ${total} of ${total}</p>
<p class="empty" id="no-match" hidden>No saved designs or audits match this search.</p>`;

const renderEmptyState = () =>
  `<section class="empty"><p>No designs yet. Run /ui-design new … to make one.</p></section>`;

export const renderGalleryPage = (entries: GalleryEntry[]) => {
  const newestFirst = entries.toSorted((first, second) =>
    second.savedAt.localeCompare(first.savedAt)
  );
  const project = newestFirst[0]?.project ?? FALLBACK_PROJECT;
  const designCount = entries.filter((entry) => entry.kind === "design").length;
  const auditCount = entries.length - designCount;
  const countLine = entries.length
    ? `${pluralize(designCount, "design")} and ${pluralize(auditCount, "audit")} saved.`
    : "Nothing saved yet.";
  const body = entries.length
    ? `${renderToolbar(entries.length)}<div class="grid" id="gallery-grid">${newestFirst.map(renderCard).join("\n")}</div>`
    : renderEmptyState();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">
<title>Gallery · ${escapeHtml(project)}</title>
<style>${PAGE_STYLE}${GALLERY_STYLE}</style>
</head>
<body>
<main>
<header class="hero">
<span class="mark" aria-hidden="true">${SWATCH_FAN_MARK}</span>
<p class="eyebrow">Gallery</p>
<h1>${escapeHtml(project)}</h1>
<p class="muted">${countLine}</p>
</header>
${body}
<footer class="signoff"><span class="mark" aria-hidden="true">${SWATCH_FAN_MARK}</span>Gathered by <code>/ui-design</code>.</footer>
</main>
<script>${GALLERY_SCRIPT}</script>
</body>
</html>`;
};
