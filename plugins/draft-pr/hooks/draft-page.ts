import {
  COMMENT_LABEL_NAMES,
  STANDARD_DECORATION_NAMES,
  type CommentLabel,
  type ConventionalComment,
} from "./conventional-comment";
import type { DiffLine, DiffSide } from "./diff-lines";
import { PAGE_SCRIPT } from "./page-script";
import { PAGE_STYLE } from "./page-style";

const REVIEW_EVENTS = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
  PENDING: "Pending · finish on GitHub",
} as const;

export type ReviewEvent = keyof typeof REVIEW_EVENTS;

export const REVIEW_EVENT_NAMES = Object.keys(REVIEW_EVENTS) as ReviewEvent[];

const LABEL_TONES: Record<CommentLabel, string> = {
  praise: "green",
  nitpick: "gray",
  suggestion: "blue",
  issue: "red",
  todo: "amber",
  question: "purple",
  thought: "teal",
  chore: "amber",
  note: "gray",
  typo: "pink",
  polish: "teal",
  quibble: "gray",
};

const BLOCKING_DECORATION = "blocking";
const GENERAL_GROUP_TITLE = "General";

export type PullRequestDraft = {
  kind: "pr";
  draftId: string;
  cwd: string;
  repository: string;
  base: string;
  head: string;
  title: string;
  body: string;
  isDraft: boolean;
  existingNumber: number | null;
  existingUrl: string;
  templatePath: string;
  templateHeadings: string[];
};

export type ReviewCommentDraft = ConventionalComment & {
  path: string;
  side: DiffSide;
  line: number | null;
  startLine: number | null;
  context: DiffLine[];
};

export type ReviewDraft = {
  kind: "review";
  draftId: string;
  cwd: string;
  repository: string;
  host: string;
  number: number;
  title: string;
  url: string;
  author: string;
  base: string;
  head: string;
  headSha: string;
  summary: string;
  event: ReviewEvent;
  comments: ReviewCommentDraft[];
};

export type Draft = PullRequestDraft | ReviewDraft;

type IndexedComment = { comment: ReviewCommentDraft; index: number };

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const embedAsScriptData = (draft: Draft) =>
  JSON.stringify(draft)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");

const HEADING_MARKS_PATTERN = /^#+\s*/;

const renderTextarea = (attributes: string, text: string) =>
  `<textarea ${attributes} spellcheck="true" autocomplete="off">\n${escapeHtml(text)}</textarea>`;

const renderBranches = (head: string, base: string) =>
  `<span class="branch mono">${escapeHtml(head)}</span><span>→</span><span class="branch mono">${escapeHtml(base)}</span>`;

type PageParts = {
  pageTitle: string;
  crumb: string;
  place: string;
  topbarActions: string;
  postLabel: string;
  mainClass: string;
  mainHtml: string;
  draft: Draft;
};

const renderPageShell = ({
  pageTitle,
  crumb,
  place,
  topbarActions,
  postLabel,
  mainClass,
  mainHtml,
  draft,
}: PageParts) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(pageTitle)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body data-label-tones="${escapeHtml(JSON.stringify(LABEL_TONES))}">
<header class="topbar"><span class="mark"></span><span class="crumb">${crumb}</span><span class="slash">/</span><strong>${escapeHtml(place)}</strong><div class="topbar-actions"><span class="pill" id="save-state"><span class="dot tone-gray"></span>Original draft</span><button type="button" class="link is-hidden" id="reset-draft">Reset</button>${topbarActions}<button type="button" class="button primary" id="post-draft">${escapeHtml(postLabel)}</button></div></header>
<section id="confirm-post" class="confirm is-hidden" role="alertdialog" aria-labelledby="confirm-text"><p id="confirm-text"></p><div class="confirm-actions"><button type="button" class="button secondary" id="cancel-post">Cancel</button><button type="button" class="button primary" id="confirm-post-button">Post</button></div></section>
<section id="notice" class="notice is-hidden" role="status"><span class="dot"></span><div class="notice-body"></div></section>
<main class="${mainClass}">
${mainHtml}
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="draft-data">${embedAsScriptData(draft)}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;

const SHORTCUTS_PANEL = `<section class="panel"><div class="panel-head"><h2>Shortcuts</h2></div><p class="shortcuts"><span>Post <kbd>⌘/Ctrl + Enter</kbd></span><span>Cancel <kbd>Esc</kbd></span></p></section>`;

const renderTemplateSection = (heading: string) =>
  `<li data-heading="${escapeHtml(heading)}"><span class="dot"></span><span>${escapeHtml(heading.replace(HEADING_MARKS_PATTERN, ""))}</span><span class="state"></span></li>`;

const renderTemplatePanel = ({
  templatePath,
  templateHeadings,
}: PullRequestDraft) => {
  const templateNote = templatePath
    ? `Follows <code>${escapeHtml(templatePath)}</code>`
    : "No PR template in this project. The draft uses a default layout.";
  return `<section class="panel"><div class="panel-head"><h2>Template</h2><span class="count" id="template-score"></span></div><p class="panel-note">${templateNote}</p><ul class="sections" id="template-sections">${templateHeadings.map(renderTemplateSection).join("")}</ul></section>`;
};

const renderDetailRow = (term: string, detailHtml: string) =>
  `<div><dt>${term}</dt><dd>${detailHtml}</dd></div>`;

const renderPullRequestDetails = (draft: PullRequestDraft) => {
  const draftToggle =
    draft.existingNumber === null
      ? `<div class="panel-foot"><label class="toggle"><input type="checkbox" id="pr-is-draft"${draft.isDraft ? " checked" : ""}> Open as a draft</label></div>`
      : "";
  const existingRow =
    draft.existingNumber === null
      ? ""
      : renderDetailRow(
          "Open PR",
          `<a href="${escapeHtml(draft.existingUrl)}" target="_blank" rel="noopener noreferrer">#${draft.existingNumber}</a>`
        );
  return `<section class="panel"><div class="panel-head"><h2>Details</h2></div><dl class="details">${renderDetailRow("Repository", escapeHtml(draft.repository || "unknown"))}${renderDetailRow("Base", `<code>${escapeHtml(draft.base)}</code>`)}${renderDetailRow("Head", `<code>${escapeHtml(draft.head)}</code>`)}${existingRow}</dl>${draftToggle}</section>`;
};

const renderPullRequestPage = (draft: PullRequestDraft) => {
  const isUpdate = draft.existingNumber !== null;
  const mainHtml = `<section class="hero">
<p class="eyebrow">${isUpdate ? `Update pull request #${draft.existingNumber}` : "Draft pull request"}</p>
<h1>${escapeHtml(draft.repository || draft.head)}</h1>
<p class="muted">${renderBranches(draft.head, draft.base)}</p>
</section>
<div class="layout">
<section>
<label class="field"><span class="field-label">Title <span class="count" id="title-count"></span></span><span class="field-row"><input id="pr-title" type="text" value="${escapeHtml(draft.title)}" spellcheck="true" autocomplete="off"><button type="button" class="button secondary" id="copy-title">Copy title</button></span></label>
<section class="panel"><div class="panel-head"><nav class="tabs" role="tablist" aria-label="Body view"><button type="button" class="tab" role="tab" data-view="write">Write</button><button type="button" class="tab" role="tab" data-view="preview">Preview</button><button type="button" class="tab" role="tab" data-view="split">Split</button></nav><span class="count" id="body-count"></span></div>
<div class="editor is-write" id="body-editor">${renderTextarea('id="pr-body" class="source" aria-label="Body"', draft.body)}<article class="markdown" id="pr-preview" aria-label="Preview"></article></div></section>
</section>
<aside class="side-column">
${renderTemplatePanel(draft)}
${renderPullRequestDetails(draft)}
${SHORTCUTS_PANEL}
</aside>
</div>`;
  return renderPageShell({
    pageTitle: `Draft PR · ${draft.repository || draft.head}`,
    crumb: "Draft PR",
    place: draft.repository || draft.head,
    topbarActions: `<button type="button" class="button secondary" id="copy-body">Copy body</button>`,
    postLabel: isUpdate
      ? `Update #${draft.existingNumber} on GitHub`
      : "Post to GitHub",
    mainClass: "",
    mainHtml,
    draft,
  });
};

const describeLocation = ({ path, line, startLine }: ReviewCommentDraft) => {
  if (!path || line === null) return "Whole PR";
  return startLine === null ? `L${line}` : `L${startLine}–${line}`;
};

const DIFF_LINE_CLASSES = { "+": " is-added", "-": " is-removed", " ": "" };

const renderDiffLine = (diffLine: DiffLine, side: DiffSide) => {
  const sideNumber =
    side === "LEFT"
      ? (diffLine.leftNumber ?? diffLine.rightNumber)
      : (diffLine.rightNumber ?? diffLine.leftNumber);
  return `<span class="diff-line${DIFF_LINE_CLASSES[diffLine.marker]}"><span class="line-number">${sideNumber ?? ""}</span><span class="marker">${diffLine.marker}</span><span class="code">${escapeHtml(diffLine.text)}</span></span>`;
};

const renderDiffContext = ({ context, side }: ReviewCommentDraft) =>
  context.length
    ? `<pre class="diff">${context.map((diffLine) => renderDiffLine(diffLine, side)).join("")}</pre>`
    : "";

const renderLabelBadge = (label: CommentLabel) =>
  `<span class="badge"><span class="dot tone-${LABEL_TONES[label]}"></span>${label}</span>`;

const renderDecorationBadge = (decoration: string) =>
  `<span class="badge${decoration === BLOCKING_DECORATION ? " is-blocking" : ""}">${escapeHtml(decoration)}</span>`;

const renderLabelOption = (label: CommentLabel, selectedLabel: CommentLabel) =>
  `<option value="${label}"${label === selectedLabel ? " selected" : ""}>${label}</option>`;

const renderDecorationChip = (decoration: string, isPressed: boolean) =>
  `<button type="button" class="chip" data-decoration="${escapeHtml(decoration)}" aria-pressed="${isPressed}">${escapeHtml(decoration)}</button>`;

const renderCommentForm = (comment: ReviewCommentDraft) => {
  const offeredDecorations = [
    ...new Set([...STANDARD_DECORATION_NAMES, ...comment.decorations]),
  ];
  const labelOptions = COMMENT_LABEL_NAMES.map((label) =>
    renderLabelOption(label, comment.label)
  ).join("");
  const decorationChips = offeredDecorations
    .map((decoration) =>
      renderDecorationChip(decoration, comment.decorations.includes(decoration))
    )
    .join("");
  return `<div class="comment-form is-hidden"><div class="form-row"><select data-field="label" aria-label="Label">${labelOptions}</select><div class="chips" role="group" aria-label="Decorations">${decorationChips}</div></div><input type="text" data-field="subject" value="${escapeHtml(comment.subject)}" aria-label="Subject" placeholder="Subject" spellcheck="true" autocomplete="off">${renderTextarea('data-field="discussion" class="source" aria-label="Discussion" placeholder="Discussion (optional)"', comment.discussion)}</div>`;
};

const renderCommentCard = ({ comment, index }: IndexedComment) => {
  const location = describeLocation(comment);
  const place = comment.path ? `${comment.path} ${location}` : location;
  return `<article class="comment" data-index="${index}" data-label="${comment.label}" data-place="${escapeHtml(place)}">
<div class="comment-top"><span class="comment-badges">${renderLabelBadge(comment.label)}${comment.decorations.map(renderDecorationBadge).join("")}</span><span class="location">${location}</span><label class="toggle"><input type="checkbox" data-include checked autocomplete="off"> Include</label></div>
${renderDiffContext(comment)}
<div class="markdown comment-preview"></div>
${renderCommentForm(comment)}
<div class="card-actions"><button type="button" class="button secondary" data-action="edit-comment">Edit</button><button type="button" class="button secondary" data-action="copy-comment">Copy</button></div>
</article>`;
};

const groupCommentsByFile = (comments: ReviewCommentDraft[]) => {
  const commentsByPath = new Map<string, IndexedComment[]>([["", []]]);
  comments.forEach((comment, index) => {
    const fileComments = commentsByPath.get(comment.path) ?? [];
    fileComments.push({ comment, index });
    commentsByPath.set(comment.path, fileComments);
  });
  return [...commentsByPath].filter(
    ([, fileComments]) => fileComments.length > 0
  );
};

const renderFileGroup = ([path, fileComments]: [string, IndexedComment[]]) => {
  const groupTitle = path
    ? `<code class="file-path">${escapeHtml(path)}</code>`
    : `<span>${GENERAL_GROUP_TITLE}</span>`;
  return `<section class="file-group"><h2>${groupTitle}<span class="count">${fileComments.length}</span></h2>
${fileComments.map(renderCommentCard).join("\n")}
</section>`;
};

const renderFilterTab = (
  comments: ReviewCommentDraft[],
  label: CommentLabel
) => {
  const labelCount = comments.filter(
    (comment) => comment.label === label
  ).length;
  return labelCount
    ? `<button type="button" class="tab" data-filter="${label}"><span class="dot tone-${LABEL_TONES[label]}"></span>${label} <span class="count">${labelCount}</span></button>`
    : "";
};

const renderReviewToolbar = (comments: ReviewCommentDraft[]) =>
  `<div class="toolbar"><nav class="tabs" id="label-filters" aria-label="Filter by label"><button type="button" class="tab is-active" data-filter="all">All <span class="count">${comments.length}</span></button>${COMMENT_LABEL_NAMES.map((label) => renderFilterTab(comments, label)).join("")}</nav><button type="button" class="button secondary" id="toggle-edit-all">Edit all</button></div>`;

const renderStat = (statLabel: string, statHtml: string) =>
  `<div class="stat"><span class="muted">${statLabel}</span>${statHtml}</div>`;

const renderReviewStats = (comments: ReviewCommentDraft[]) => {
  const blockingCount = comments.filter((comment) =>
    comment.decorations.includes(BLOCKING_DECORATION)
  ).length;
  const fileCount = new Set(
    comments.map((comment) => comment.path).filter(Boolean)
  ).size;
  return `<section class="stats">${renderStat("Comments", `<strong>${comments.length}</strong>`)}${renderStat("Included", `<strong id="stat-included">${comments.length} / ${comments.length}</strong>`)}${renderStat("Blocking", `<strong id="stat-blocking">${blockingCount}</strong>`)}${renderStat("Files", `<strong>${fileCount}</strong>`)}</section>`;
};

const renderEventChoice = (event: ReviewEvent, chosenEvent: ReviewEvent) =>
  `<label class="event"><input type="radio" name="review-event" value="${event}"${event === chosenEvent ? " checked" : ""} autocomplete="off"> ${REVIEW_EVENTS[event]}</label>`;

const renderSummaryPanel = ({ summary, event }: ReviewDraft) =>
  `<section class="panel summary"><div class="panel-head"><h2>Summary</h2><div class="panel-tools"><nav class="tabs" aria-label="Summary view"><button type="button" class="tab is-active" data-summary-view="write">Write</button><button type="button" class="tab" data-summary-view="preview">Preview</button></nav><button type="button" class="button secondary" id="copy-summary">Copy</button></div></div>${renderTextarea('id="review-summary" class="source" aria-label="Review summary" placeholder="Overall feedback (optional)"', summary)}<article class="markdown is-hidden" id="summary-preview"></article><div class="events" role="radiogroup" aria-label="Review type">${REVIEW_EVENT_NAMES.map((eventName) => renderEventChoice(eventName, event)).join("")}</div></section>`;

const renderReviewPage = (draft: ReviewDraft) => {
  const place = `${draft.repository}#${draft.number}`;
  const author = draft.author
    ? `<span>@${escapeHtml(draft.author)}</span>`
    : "";
  const mainHtml = `<section class="hero">
<p class="eyebrow">Draft review</p>
<h1><a href="${escapeHtml(draft.url)}" target="_blank" rel="noopener noreferrer">#${draft.number}</a> ${escapeHtml(draft.title)}</h1>
<p class="muted">${author}${renderBranches(draft.head, draft.base)}</p>
</section>
${renderReviewStats(draft.comments)}
${renderSummaryPanel(draft)}
${renderReviewToolbar(draft.comments)}
${groupCommentsByFile(draft.comments).map(renderFileGroup).join("\n")}`;
  return renderPageShell({
    pageTitle: `Draft review · ${place}`,
    crumb: "Draft review",
    place,
    topbarActions: "",
    postLabel: "Post to GitHub",
    mainClass: "is-narrow",
    mainHtml,
    draft,
  });
};

export const renderDraftPage = (draft: Draft) =>
  draft.kind === "review"
    ? renderReviewPage(draft)
    : renderPullRequestPage(draft);
