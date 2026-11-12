import {
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  countFindings,
  describeProgress,
  type Audit,
  type AuditCategory,
  type AuditFinding,
  type AuditSeverity,
  type NumberedFinding,
} from "./audit";
import type {
  DiscrepancyAspect,
  GroupComponent,
  NumberedGroup,
} from "./component-groups";
import {
  PAGE_POLICY,
  escapeHtml,
  renderSwatch,
  renderThemePanel,
} from "./design-page";
import { PAGE_SCRIPT } from "./page-script";
import { PAGE_STYLE } from "./page-style";

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  hardcoded: "Hardcoded values",
  typography: "Typography",
  components: "Components",
  theme: "Theme",
  accessibility: "Accessibility",
};

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  error: "Errors",
  warning: "Warnings",
  note: "Notes",
};

const ASPECT_LABELS: Record<DiscrepancyAspect, string> = {
  look: "Look",
  behavior: "Behavior",
  implementation: "Implementation",
};

const SEVERITY_NAMES: Record<AuditSeverity, string> = {
  error: "Error",
  warning: "Warning",
  note: "Note",
};

const AUDIT_EYEBROW = "Design audit";
const GROUPS_SLUG = "groups";
const GROUPS_LABEL = "Same-purpose components";
const BARE_WORD = /^[a-z]+$/i;

type Section = { slug: string; label: string; count: number };

const pluralize = (count: number, noun: string) =>
  `${count || "No"} ${noun}${count === 1 ? "" : "s"}`;

const listSections = (groupCount: number, findings: AuditFinding[]) => [
  ...(groupCount
    ? [{ slug: GROUPS_SLUG, label: GROUPS_LABEL, count: groupCount }]
    : []),
  ...countFindings(
    AUDIT_CATEGORIES,
    findings,
    (finding) => finding.category
  ).map(({ key, count }) => ({
    slug: key,
    label: CATEGORY_LABELS[key],
    count,
  })),
];

const renderCount = (label: string, count: number) =>
  `<li>${label} <strong>${count}</strong></li>`;

const renderCounts = (findings: AuditFinding[], sections: Section[]) =>
  `<ul class="counts">${AUDIT_SEVERITIES.map((severity) =>
    renderCount(
      SEVERITY_LABELS[severity],
      findings.filter((finding) => finding.severity === severity).length
    )
  ).join(
    ""
  )}${sections.map(({ label, count }) => renderCount(label, count)).join("")}</ul>`;

const renderTab = (
  slug: string,
  panelIds: string,
  label: string,
  isSelected: boolean
) =>
  `<button type="button" role="tab" id="tab-${slug}" aria-controls="${panelIds}" aria-selected="${isSelected}" tabindex="${isSelected ? 0 : -1}">${label}</button>`;

const renderTabs = (sections: Section[]) =>
  `<div class="toolbar"><div role="tablist" aria-label="Categories">${renderTab(
    "all",
    sections.map(({ slug }) => `panel-${slug}`).join(" "),
    `All · ${sections.reduce((entryCount, { count }) => entryCount + count, 0)}`,
    true
  )}${sections
    .map(({ slug, label, count }) =>
      renderTab(slug, `panel-${slug}`, `${label} · ${count}`, false)
    )
    .join("")}</div></div>`;

const renderPanel = (slug: string, label: string, cards: string[]) =>
  `<section role="tabpanel" id="panel-${slug}" aria-labelledby="tab-${slug}"><h2>${label}</h2>${cards.join("")}</section>`;

const renderComponentRow =
  (recommendedComponent: GroupComponent | undefined) =>
  (component: GroupComponent) =>
    `<tr><td><strong>${escapeHtml(component.name)}</strong>${component === recommendedComponent ? `<span class="pill recommended">Recommended</span>` : ""}</td><td><code>${escapeHtml(component.path)}</code></td><td>${pluralize(component.usedIn, "file")}</td><td>${escapeHtml(component.notes)}</td></tr>`;

const renderGroup = (group: NumberedGroup) => {
  const recommendedComponent = group.components.find(
    (component) => component.name === group.recommended
  );
  const componentsRecommendedFirst = [
    ...(recommendedComponent ? [recommendedComponent] : []),
    ...group.components.filter(
      (component) => component !== recommendedComponent
    ),
  ];
  const discrepancies = group.discrepancies.length
    ? `<h4>Discrepancies</h4><ul>${group.discrepancies.map(({ aspect, detail }) => `<li><strong>${ASPECT_LABELS[aspect]}:</strong> ${escapeHtml(detail)}</li>`).join("")}</ul>`
    : "";
  return `<article class="finding"><span class="number">#${group.number}</span><h3 class="finding-title">${escapeHtml(group.purpose)}</h3><div class="table-wrap"><table><thead><tr><th scope="col">Component</th><th scope="col">Path</th><th scope="col">Used in</th><th scope="col">Notes</th></tr></thead><tbody>${componentsRecommendedFirst.map(renderComponentRow(recommendedComponent)).join("")}</tbody></table></div>${discrepancies}<h4>Why this one</h4><p>${escapeHtml(group.reasoning)}</p></article>`;
};

const renderPlaces = ({ file, lines }: NumberedFinding) => {
  if (!file) return "";
  const places = lines.length ? lines.map((line) => `${file}:${line}`) : [file];
  return `<ul>${places.map((place) => `<li><code>${escapeHtml(place)}</code></li>`).join("")}</ul>`;
};

const renderValue = (value: string | undefined) =>
  value
    ? `<p>${BARE_WORD.test(value) ? "" : renderSwatch(value)}<code>${escapeHtml(value)}</code></p>`
    : "";

const renderFinding = (finding: NumberedFinding) =>
  `<article class="finding"><span class="number">#${finding.number}</span><span class="pill ${finding.severity}">${SEVERITY_NAMES[finding.severity]}</span><h3 class="finding-title">${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.detail)}</p>${renderValue(finding.value)}${renderPlaces(finding)}<p><strong>Fix:</strong> ${escapeHtml(finding.fix)}</p></article>`;

const renderSectionPanel =
  ({ componentGroups, findings }: Audit) =>
  ({ slug, label }: Section) =>
    renderPanel(
      slug,
      label,
      slug === GROUPS_SLUG
        ? componentGroups.map(renderGroup)
        : findings
            .filter((finding) => finding.category === slug)
            .map(renderFinding)
    );

export const renderAuditPage = (audit: Audit) => {
  const { project, files, theme, componentGroups, findings, progress } = audit;
  const sections = listSections(componentGroups.length, findings);
  const groupSummary = componentGroups.length
    ? ` and ${pluralize(componentGroups.length, "component group")}`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">
<title>${AUDIT_EYEBROW} · ${escapeHtml(project)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<header class="hero">
<p class="eyebrow">${AUDIT_EYEBROW}</p>
<h1>${escapeHtml(project)}</h1>
<p class="muted">${pluralize(findings.length, "finding")}${groupSummary} in ${pluralize(files.length, "file")}</p>
${progress ? `<p class="muted">${describeProgress(progress)}</p>` : ""}
</header>
${sections.length ? `${renderCounts(findings, sections)}\n${renderTabs(sections)}` : ""}
${sections.map(renderSectionPanel(audit)).join("\n")}
${renderThemePanel(theme)}
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
};
