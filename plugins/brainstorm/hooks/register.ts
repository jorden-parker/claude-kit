import type { EngineInterface, Register, RenderElement } from "claude-code";
import {
  BANNED_PHRASES,
  checkPlan,
  MAX_CHANGED_LINES_PER_STEP,
  type PlanFiles,
} from "./plan-check";
import {
  PLAN_STATUSES_AS_TEXT,
  PLAN_STATUSES,
  PLAN_FILE_NAME,
  readPlanFolderName,
  setPlanStatus,
  type StatusFiles,
} from "./plan-status";

const BRAINSTORM_COMMAND = "brainstorm";
const PLAN_MODE = "plan";
const BUILD_MODE = "build";
const BRAINSTORM_COMMAND_PREFIX = "/brainstorm ";

const BRAINSTORM_MODE_SUGGESTIONS = [
  { text: PLAN_MODE, description: "Turn picked ideas into a small-step plan" },
  {
    text: BUILD_MODE,
    description: "Implement plans with small-model subagents",
  },
];
const PLAN_INVOCATION = `/${BRAINSTORM_COMMAND} ${PLAN_MODE}`;
const BUILD_INVOCATION = `/${BRAINSTORM_COMMAND} ${BUILD_MODE}`;
const ALL_KEYWORD = "all";
const UNNAMED_RUN = "the run you pick, or the only one";

const TOOL_NAME = "render_brainstorm";
const QUALIFIED_TOOL_NAME = `mcp__brainstorm__${TOOL_NAME}`;
const CHECK_TOOL_NAME = "check_brainstorm_plan";
const QUALIFIED_CHECK_TOOL_NAME = `mcp__brainstorm__${CHECK_TOOL_NAME}`;
const STATUS_TOOL_NAME = "set_brainstorm_plan_status";
const QUALIFIED_STATUS_TOOL_NAME = `mcp__brainstorm__${STATUS_TOOL_NAME}`;

const LEGACY_BRAINSTORM_FOLDER = ".claude/brainstorm";
const PLANS_FOLDER_NAME = "plans";
const GIT_FOLDER_SUFFIX = /(\/\.git|\/\.bare|\.git)$/;
const CLAUDE_WORKTREE_PATH = /^(.+?)\/\.claude\/worktrees\/[^/]+/;
const RUN_FILE_TOOLS = ["Read", "Write", "Edit"];
const OWN_FOLDER_REASON =
  "The file is in the brainstorm plugin's own folder under ~/.claude/brainstorm.";
const FILE_STAMP_PATTERN = String.raw`\d{4}-\d{2}-\d{2}-\d{4}`;
const SAVED_BRAINSTORM_PATTERN = new RegExp(
  `^brainstorm-${FILE_STAMP_PATTERN}\\.json$`
);
const START_HERE_COUNT = 3;

declare module "claude-code" {
  interface McpToolInputs {
    [QUALIFIED_TOOL_NAME]: Record<string, unknown>;
    [QUALIFIED_CHECK_TOOL_NAME]: { path: string };
    [QUALIFIED_STATUS_TOOL_NAME]: { path: string; status: string };
  }
}

const CATEGORIES = {
  security: { label: "Security", tone: "red" },
  "must-have": { label: "Must-have", tone: "amber" },
  "quick-win": { label: "Quick win", tone: "green" },
  performance: { label: "Performance", tone: "blue" },
  "developer-experience": { label: "Dev experience", tone: "teal" },
  creative: { label: "Creative", tone: "purple" },
  moonshot: { label: "Moonshot", tone: "pink" },
} as const;

const PRIORITIES = {
  now: { label: "Do now" },
  next: { label: "Next up" },
  later: { label: "Later" },
} as const;

const EFFORTS = {
  small: { label: "S · under an hour" },
  medium: { label: "M · a day or so" },
  large: { label: "L · a project" },
} as const;

type Category = keyof typeof CATEGORIES;
type Priority = keyof typeof PRIORITIES;
type Effort = keyof typeof EFFORTS;

const CATEGORIES_MOST_URGENT_FIRST = Object.keys(CATEGORIES) as Category[];
const PRIORITIES_MOST_URGENT_FIRST = Object.keys(PRIORITIES) as Priority[];
const EFFORTS_SMALLEST_FIRST = Object.keys(EFFORTS) as Effort[];

type Idea = {
  title: string;
  category: Category;
  priority: Priority;
  effort: Effort;
  why: string;
  nextStep: string;
  files: string[];
};

type NumberedIdea = Idea & { number: number };

type Brainstorm<SomeIdea extends Idea = Idea> = {
  project: string;
  summary: string;
  ideas: SomeIdea[];
};

type SavedBrainstorm = Brainstorm<NumberedIdea>;

const BRAINSTORM_INSTRUCTIONS = `Brainstorm improvements for the project the focus below names, or else the project in the current working directory. When the focus could mean more than one repository, ask the user with AskUserQuestion which one before studying it.

1. Study the project first: README, manifests, entry points, tests, CI, config, git log. Read real code, not just file names.
2. Generate 12 to 25 ideas across these categories:
   - security: vulnerabilities, leaked secrets, unsafe input handling, outdated or risky dependencies, missing auth checks.
   - must-have: bugs, missing tests, missing error handling, broken docs, anything a careful reviewer would block on.
   - quick-win: small changes with an outsized payoff.
   - performance: measurable speed or resource wins.
   - developer-experience: tooling, scripts, onboarding, feedback loops.
   - creative: features or directions the authors probably have not considered. Be bold and specific to this project.
   - moonshot: ambitious, outside-the-checkbox bets that could change what the project is.
   Include at least two security or must-have ideas when the code supports them, and at least three creative or moonshot ideas.
3. Ground every practical idea in evidence: name the file, and the line when you can. Invent nothing.
4. Keep each idea scannable: a title under 10 words, one or two sentences of why, and one concrete next step that can be started today.
5. Set priority (now, next, later) by risk and payoff, and effort (small, medium, large) honestly.

When done, call the ${QUALIFIED_TOOL_NAME} tool once with every idea, and pass as folder a folder of the repository you brainstormed when it is not the working directory's. It writes the page and opens it in the browser. Then reply with the page's path and the top three ideas in one line each.`;

const buildBrainstormPrompt = (focus: string) =>
  focus
    ? `${BRAINSTORM_INSTRUCTIONS}\n\nCenter the brainstorm on this focus, and keep the rest brief:\n<focus>\n${focus}\n</focus>`
    : BRAINSTORM_INSTRUCTIONS;

const RENDER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "The project's name." },
    folder: {
      type: "string",
      description:
        "The repository the ideas are about, as an absolute folder path inside it. Choose it from what was brainstormed, not from the working directory. Leave it out only when the ideas are about the working directory's repository. When they could belong to more than one repository, ask the user with AskUserQuestion, listing the candidate folders, before calling.",
    },
    summary: {
      type: "string",
      description: "One sentence on what the project is.",
    },
    ideas: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Under 10 words." },
          category: { type: "string", enum: CATEGORIES_MOST_URGENT_FIRST },
          priority: { type: "string", enum: PRIORITIES_MOST_URGENT_FIRST },
          effort: { type: "string", enum: EFFORTS_SMALLEST_FIRST },
          why: { type: "string", description: "One or two sentences." },
          nextStep: {
            type: "string",
            description: "One concrete action that can be started today.",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files the idea touches, relative to the project.",
          },
        },
        required: [
          "title",
          "category",
          "priority",
          "effort",
          "why",
          "nextStep",
        ],
      },
    },
  },
  required: ["project", "summary", "ideas"],
};

const CHECK_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "The run folder to check. A relative path is under this project's brainstorm folder, ~/.claude/brainstorm/<project>/.",
    },
  },
  required: ["path"],
};

const STATUS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "The plan folder (NN-slug) inside a run folder. A relative path is under this project's brainstorm folder, ~/.claude/brainstorm/<project>/.",
    },
    status: { type: "string", enum: PLAN_STATUSES },
  },
  required: ["path", "status"],
};

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const pickKnownKey = <Key extends string>(
  knownKeys: Key[],
  value: unknown,
  fallback: Key
) => knownKeys.find((knownKey) => knownKey === value) ?? fallback;

const readIdea = (rawIdea: unknown): Idea | undefined => {
  if (typeof rawIdea !== "object" || rawIdea === null) return undefined;
  const fields = rawIdea as Record<string, unknown>;
  const title = readText(fields.title);
  const nextStep = readText(fields.nextStep);
  if (!title || !nextStep) return undefined;
  const files = Array.isArray(fields.files)
    ? fields.files.map(readText).filter(Boolean)
    : [];
  return {
    title,
    nextStep,
    why: readText(fields.why),
    category: pickKnownKey(
      CATEGORIES_MOST_URGENT_FIRST,
      fields.category,
      "creative"
    ),
    priority: pickKnownKey(
      PRIORITIES_MOST_URGENT_FIRST,
      fields.priority,
      "next"
    ),
    effort: pickKnownKey(EFFORTS_SMALLEST_FIRST, fields.effort, "medium"),
    files,
  };
};

const readNumberedIdea = (
  rawIdea: unknown,
  index: number
): NumberedIdea | undefined => {
  const idea = readIdea(rawIdea);
  if (!idea) return undefined;
  const rawNumber = (rawIdea as Record<string, unknown>).number;
  const number =
    typeof rawNumber === "number" && Number.isInteger(rawNumber)
      ? rawNumber
      : index + 1;
  return { ...idea, number };
};

const readBrainstorm = <SomeIdea extends Idea>(
  rawBrainstorm: unknown,
  readOneIdea: (rawIdea: unknown, index: number) => SomeIdea | undefined
): Brainstorm<SomeIdea> | undefined => {
  if (typeof rawBrainstorm !== "object" || rawBrainstorm === null)
    return undefined;
  const fields = rawBrainstorm as Record<string, unknown>;
  const rawIdeas: unknown[] = Array.isArray(fields.ideas) ? fields.ideas : [];
  const ideas = rawIdeas
    .map(readOneIdea)
    .filter((idea): idea is SomeIdea => idea !== undefined);
  if (!ideas.length) return undefined;
  return {
    project: readText(fields.project) || "This project",
    summary: readText(fields.summary),
    ideas,
  };
};

const compareUrgency = (first: Idea, second: Idea) =>
  PRIORITIES_MOST_URGENT_FIRST.indexOf(first.priority) -
    PRIORITIES_MOST_URGENT_FIRST.indexOf(second.priority) ||
  CATEGORIES_MOST_URGENT_FIRST.indexOf(first.category) -
    CATEGORIES_MOST_URGENT_FIRST.indexOf(second.category) ||
  EFFORTS_SMALLEST_FIRST.indexOf(first.effort) -
    EFFORTS_SMALLEST_FIRST.indexOf(second.effort);

const listPresentCategories = (ideas: Idea[]) =>
  CATEGORIES_MOST_URGENT_FIRST.filter((category) =>
    ideas.some((idea) => idea.category === category)
  );

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderFiles = (files: string[]) =>
  files.length
    ? `<div class="files">${files.map((file) => `<code>${escapeHtml(file)}</code>`).join("")}</div>`
    : "";

const renderWhy = (why: string) =>
  why
    ? `<details><summary>Why</summary><p>${escapeHtml(why)}</p></details>`
    : "";

const renderCategoryBadge = (category: Category) =>
  `<span class="badge"><span class="dot tone-${CATEGORIES[category].tone}"></span>${CATEGORIES[category].label}</span>`;

const renderIdeaCard = (idea: NumberedIdea) =>
  `<article class="card" data-category="${idea.category}">
  <div class="card-top">
    <span class="number">#${idea.number}</span>
    ${renderCategoryBadge(idea.category)}
    <span class="badge effort">${EFFORTS[idea.effort].label}</span>
  </div>
  <h3>${escapeHtml(idea.title)}</h3>
  <p class="next"><span class="label">Next step</span>${escapeHtml(idea.nextStep)}</p>
  ${renderWhy(idea.why)}
  ${renderFiles(idea.files)}
  <div class="card-actions">
    <label class="toggle"><input type="checkbox" data-done="${idea.number}"> Done</label>
    <label class="toggle"><input type="checkbox" data-plan="${idea.number}"> Plan</label>
  </div>
</article>`;

const renderStartHere = (ideas: NumberedIdea[]) => {
  const startHereSteps = ideas
    .slice(0, START_HERE_COUNT)
    .map(
      (idea, index) =>
        `<li><span class="step">${index + 1}</span><div><strong>${escapeHtml(idea.title)}</strong><p>${escapeHtml(idea.nextStep)}</p></div><span class="number">#${idea.number}</span></li>`
    )
    .join("");
  return `<section id="start-here"><div class="panel-head"><h2>Start here</h2><span class="muted">The ${Math.min(START_HERE_COUNT, ideas.length)} most urgent ideas</span></div><ol>${startHereSteps}</ol></section>`;
};

const renderPrioritySection = (priority: Priority, ideas: NumberedIdea[]) => {
  const matchingIdeas = ideas.filter((idea) => idea.priority === priority);
  if (!matchingIdeas.length) return "";
  const cards = matchingIdeas.map((idea) => renderIdeaCard(idea)).join("\n");
  return `<section class="priority"><h2>${PRIORITIES[priority].label} <span class="count">${matchingIdeas.length}</span></h2><div class="grid">${cards}</div></section>`;
};

const renderStats = (ideas: NumberedIdea[]) => {
  const priorityStats = PRIORITIES_MOST_URGENT_FIRST.map((priority) => [
    PRIORITIES[priority].label,
    ideas.filter((idea) => idea.priority === priority).length,
  ]);
  const statCells = [["Ideas", ideas.length], ...priorityStats]
    .map(
      ([statLabel, statValue]) =>
        `<div class="stat"><span class="muted">${statLabel}</span><strong>${statValue}</strong></div>`
    )
    .join("");
  return `<section class="stats">${statCells}<div class="stat"><span class="muted">Progress <button type="button" id="reset-done" class="link">Reset</button></span><strong class="progress-label"></strong><div class="progress"><div></div></div></div></section>`;
};

const renderToolbar = (ideas: Idea[]) => {
  const categoryTabs = listPresentCategories(ideas)
    .map((category) => {
      const { label, tone } = CATEGORIES[category];
      const count = ideas.filter((idea) => idea.category === category).length;
      return `<button type="button" class="tab" data-filter="${category}" data-label="${label}"><span class="dot tone-${tone}"></span>${label} <span class="count">${count}</span></button>`;
    })
    .join("");
  return `<div class="toolbar"><nav class="tabs"><button type="button" class="tab is-active" data-filter="all" data-label="All">All <span class="count">${ideas.length}</span></button>${categoryTabs}</nav><div class="select-actions"><button type="button" class="button secondary is-hidden" data-select="filtered">Select all in category</button><button type="button" class="button secondary" data-select="all">Select all <span class="count">${ideas.length}</span></button></div></div>`;
};

const PAGE_STYLE = `
:root{--bg:#fff;--surface:#fafafa;--panel:#fff;--text:#171717;--muted:#666;--subtle:#8f8f8f;--line:#ebebeb;--line-strong:#d4d4d4;--invert-bg:#171717;--invert-text:#fff;--invert-muted:#a1a1a1;--invert-line:#333;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.04);--red:#e5484d;--amber:#f5a524;--green:#45a557;--blue:#0070f3;--teal:#12a594;--purple:#8e4ec6;--pink:#d6409f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--surface:#000;--panel:#0a0a0a;--text:#ededed;--muted:#a1a1a1;--subtle:#7c7c7c;--line:#262626;--line-strong:#3d3d3d;--invert-bg:#ededed;--invert-text:#0a0a0a;--invert-muted:#666;--invert-line:#d4d4d4;--shadow:0 0 0 1px rgba(255,255,255,.02);--red:#ff6369;--amber:#ffb224;--green:#62c073;--blue:#3291ff;--teal:#0ac5b3;--purple:#bf7af0;--pink:#f76ac0;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Geist","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
code,.number,.count,.step{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
.topbar{position:sticky;top:0;z-index:3;height:56px;display:flex;align-items:center;gap:10px;padding:0 24px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--bg) 80%,transparent);backdrop-filter:saturate(180%) blur(8px)}
.mark{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--text),var(--subtle))}
.crumb{color:var(--muted)}
.slash{color:var(--line-strong);font-size:20px;font-weight:200}
.topbar strong{font-weight:500}
main{max-width:1200px;margin:0 auto;padding:48px 24px 140px}
.hero h1{margin:0;font-size:40px;line-height:1.1;font-weight:600;letter-spacing:-.04em}
.hero p{margin:12px 0 0;max-width:640px;color:var(--muted);font-size:16px}
.muted{color:var(--muted)}
.stats{margin:32px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
.stat{padding:16px 20px;display:flex;flex-direction:column;gap:4px;border-right:1px solid var(--line);margin-right:-1px}
.stat .muted{font-size:13px;display:flex;justify-content:space-between;gap:8px}
.stat strong{font-size:24px;font-weight:600;letter-spacing:-.02em}
.progress{height:4px;border-radius:99px;background:var(--line);overflow:hidden}
.progress div{height:100%;width:0;background:var(--text);transition:width .3s}
.link{font:inherit;font-size:13px;padding:0;border:0;background:none;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.link:hover{color:var(--text)}
#start-here{margin:0 0 40px;border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}
.panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)}
.panel-head h2{margin:0;font-size:16px;font-weight:600}
.panel-head .muted{font-size:13px}
#start-here ol{list-style:none;margin:0;padding:0}
#start-here li{display:flex;gap:14px;align-items:flex-start;padding:14px 20px;border-top:1px solid var(--line)}
#start-here li:first-child{border-top:0}
#start-here li div{flex:1}
#start-here li p{margin:2px 0 0;color:var(--muted)}
.step{flex:none;width:24px;height:24px;border-radius:50%;border:1px solid var(--line-strong);display:grid;place-items:center;font-size:12px}
.toolbar{position:sticky;top:56px;z-index:2;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;background:var(--bg);border-bottom:1px solid var(--line)}
.tabs{display:flex;flex-wrap:wrap;gap:4px}
.tab{font:inherit;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer;transition:background .15s,color .15s}
.tab:hover{background:var(--surface);color:var(--text)}
.tab.is-active{background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.count{font-size:12px;color:var(--subtle)}
.select-actions{display:flex;gap:8px;flex-wrap:wrap}
.button{font:inherit;font-weight:500;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:6px;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.button.secondary{border:1px solid var(--line);background:var(--panel);color:var(--text)}
.button.secondary:hover{border-color:var(--line-strong);background:var(--surface)}
.button.primary{border:1px solid var(--invert-text);background:var(--invert-text);color:var(--invert-bg)}
.button.primary:hover{opacity:.88}
.button.ghost{border:1px solid var(--invert-line);background:none;color:var(--invert-text)}
.button.ghost:hover{border-color:var(--invert-muted)}
.priority h2{display:flex;align-items:center;gap:8px;margin:40px 0 16px;font-size:20px;font-weight:600;letter-spacing:-.02em}
.priority h2 .count{font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow);transition:border-color .15s,box-shadow .15s}
.card:hover{border-color:var(--line-strong)}
.card.is-picked{border-color:var(--text);box-shadow:0 0 0 1px var(--text)}
.card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.number{font-size:12px;color:var(--subtle)}
.badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:99px;background:var(--surface);border:1px solid var(--line);font-size:12px;font-weight:500}
.badge.effort{margin-left:auto;color:var(--muted);font-weight:400}
.dot{width:8px;height:8px;border-radius:50%;flex:none}
.tone-red{background:var(--red)}.tone-amber{background:var(--amber)}.tone-green{background:var(--green)}.tone-blue{background:var(--blue)}.tone-teal{background:var(--teal)}.tone-purple{background:var(--purple)}.tone-pink{background:var(--pink)}
.card h3{margin:0;font-size:16px;line-height:1.35;font-weight:600;letter-spacing:-.01em}
.next{margin:0;color:var(--muted)}
.label{display:block;font-size:12px;font-weight:500;color:var(--text)}
details summary{cursor:pointer;color:var(--muted);font-size:13px;width:fit-content}
details summary:hover{color:var(--text)}
details p{margin:6px 0 0;color:var(--muted)}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files code{font-size:12px;padding:2px 6px;border-radius:4px;background:var(--surface);border:1px solid var(--line);color:var(--muted)}
.card-actions{margin:auto -16px -16px;padding:10px 16px;display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line);background:var(--surface);border-radius:0 0 12px 12px}
.toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);cursor:pointer;user-select:none}
.toggle:hover{color:var(--text)}
input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:var(--text);cursor:pointer}
#plan-picker{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:4;width:min(860px,calc(100% - 32px));padding:10px 10px 10px 16px;border-radius:12px;background:var(--invert-bg);color:var(--invert-text);display:flex;flex-wrap:wrap;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.24)}
#picked-count{font-weight:500;white-space:nowrap}
#plan-command{flex:1;min-width:160px;font-size:13px;padding:6px 10px;border-radius:6px;border:1px solid var(--invert-line);color:var(--invert-text);user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.picker-actions{display:flex;gap:6px;flex-wrap:wrap}
.card.is-done{opacity:.5}
.card.is-done h3{text-decoration:line-through}
.is-hidden{display:none!important}
@media (max-width:640px){main{padding:32px 16px 200px}.topbar{padding:0 16px}.hero h1{font-size:30px}.grid{grid-template-columns:1fr}}
@font-face{font-family:"Fredoka";font-style:normal;font-weight:300 700;font-display:swap;src:url(data:font/woff2;base64,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) format("woff2")}
:root{--kit-bg:#fdfbff;--kit-surface:#f6f2ff;--kit-panel:#fff;--kit-hover:#efe9fc;--kit-text:#2a2140;--kit-text-soft:#43395e;--kit-muted:#6e6588;--kit-subtle:#9d95b5;--kit-line:#ece6f7;--kit-line-strong:#dcd3ee;--kit-accent:#8a4dff;--kit-on-accent:#fff;--kit-pink:#ff4fa3;--kit-peach:#ff8a3d;--kit-amber:#c27c00;--kit-green:#12a26b;--kit-teal:#0ba5a0;--kit-blue:#3a7dff;--kit-red:#f0445a;--kit-r1:#ff5c8a;--kit-r2:#ff9e3d;--kit-r3:#ffd23f;--kit-r4:#3ddc97;--kit-r5:#47b8ff;--kit-r6:#a66bff;--kit-radius-sm:8px;--kit-radius:12px;--kit-radius-lg:16px;--kit-shadow:0 1px 2px rgba(42,33,64,.04),0 6px 20px -10px rgba(42,33,64,.14);--kit-lift:0 16px 34px -14px rgba(138,77,255,.4);--kit-sans:"Geist","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--kit-mono:"Geist Mono",ui-monospace,"SF Mono",Menlo,monospace;--kit-display:"Fredoka",ui-rounded,"SF Pro Rounded","Nunito",system-ui,sans-serif;--kit-ease:cubic-bezier(.2,.8,.2,1);--kit-spring:cubic-bezier(.34,1.56,.64,1);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--kit-bg:#252040;--kit-surface:#2c2649;--kit-panel:#2a2445;--kit-hover:#352e57;--kit-text:#faf7ff;--kit-text-soft:#e2dcf3;--kit-muted:#c4bcdc;--kit-subtle:#9a91b8;--kit-line:#3e3760;--kit-line-strong:#514873;--kit-accent:#b38cff;--kit-on-accent:#1d1833;--kit-pink:#ff85c0;--kit-peach:#ffb37f;--kit-amber:#ffd166;--kit-green:#6be3a8;--kit-teal:#5ee0d6;--kit-blue:#8ab8ff;--kit-red:#ff7a8a;--kit-r1:#ff8fb1;--kit-r2:#ffb86b;--kit-r3:#ffe27a;--kit-r4:#7ff0b8;--kit-r5:#8fd3ff;--kit-r6:#c3a0ff;--kit-shadow:0 0 0 1px rgba(255,255,255,.03),0 8px 24px -10px rgba(10,6,24,.5);--kit-lift:0 16px 36px -14px rgba(179,140,255,.5);color-scheme:dark}}
:root{--kit-rainbow:linear-gradient(90deg,var(--kit-r1),var(--kit-r2),var(--kit-r3),var(--kit-r4),var(--kit-r5),var(--kit-r6))}
:root{--bg:var(--kit-bg);--surface:var(--kit-surface);--panel:var(--kit-panel);--text:var(--kit-text);--muted:var(--kit-muted);--subtle:var(--kit-subtle);--line:var(--kit-line);--line-strong:var(--kit-line-strong);--ring:color-mix(in srgb,var(--kit-accent) 18%,transparent);--shadow:var(--kit-shadow);--lift:var(--kit-lift);--ease:var(--kit-ease);--grid:color-mix(in srgb,var(--kit-accent) 7%,transparent);--dot:var(--kit-line-strong);--invert-bg:var(--kit-text);--invert-text:var(--kit-bg);--invert-muted:var(--kit-subtle);--invert-line:color-mix(in srgb,var(--kit-bg) 25%,var(--kit-text))}
:root{--red:var(--kit-red);--amber:var(--kit-amber);--amber-bright:var(--kit-peach);--green:var(--kit-green);--blue:var(--kit-blue);--teal:var(--kit-teal);--purple:var(--kit-accent);--pink:var(--kit-pink);--gray:var(--kit-subtle)}
:root{--background:var(--kit-bg);--sidebar:var(--kit-surface);--hover:var(--kit-hover);--selected:color-mix(in srgb,var(--kit-accent) 13%,var(--kit-panel));--text-soft:var(--kit-text-soft);--border:var(--kit-line);--border-strong:var(--kit-line-strong);--accent:var(--kit-accent);--focus:var(--kit-accent);--danger:var(--kit-red);--danger-hover:color-mix(in srgb,var(--kit-red) 82%,var(--kit-text));--on-danger:var(--kit-on-accent);--primary:var(--kit-accent);--on-primary:var(--kit-on-accent);--done:var(--kit-green);--in-progress:var(--kit-amber);--pending:var(--kit-muted);--blocked:var(--kit-red);--radius:var(--kit-radius-sm);--spring:var(--kit-spring);--sans:var(--kit-sans);--mono:var(--kit-mono)}
:root{--color-background:var(--kit-bg);--color-card:var(--kit-panel);--color-muted:var(--kit-hover);--color-hairline:var(--kit-line);--color-border:var(--kit-line-strong);--color-foreground:var(--kit-text);--color-muted-foreground:var(--kit-muted);--color-accent:var(--kit-accent);--color-on-accent:var(--kit-on-accent);--color-destructive:var(--kit-red);--color-ring:var(--kit-accent);--font-sans:var(--kit-sans);--font-mono:var(--kit-mono)}
html{accent-color:var(--kit-accent);scrollbar-color:var(--kit-line-strong) transparent}
body{background-image:radial-gradient(900px 380px at 0% -10%,color-mix(in srgb,var(--kit-r1) 14%,transparent),transparent 70%),radial-gradient(800px 360px at 50% -16%,color-mix(in srgb,var(--kit-r3) 12%,transparent),transparent 70%),radial-gradient(900px 400px at 100% -10%,color-mix(in srgb,var(--kit-r5) 14%,transparent),transparent 70%);background-attachment:fixed}
html::before{content:"";position:fixed;inset:0 0 auto;height:4px;z-index:100;pointer-events:none;background:var(--kit-rainbow)}
.topbar,body>header{border-bottom-color:transparent;border-image:var(--kit-rainbow) 1}
h1,h2,.brand{font-family:var(--kit-display);letter-spacing:-.01em}
::selection{background:color-mix(in srgb,var(--kit-accent) 26%,transparent);color:inherit}
:focus-visible{outline:2px solid var(--kit-accent);outline-offset:2px}
:where(input,textarea,select):focus-visible{outline:none;border-color:var(--kit-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--kit-accent) 22%,transparent)}
.button,.call-button,.icon-button,.chip,.event{transition:background-position .6s var(--kit-ease),transform .28s var(--kit-spring),box-shadow .25s var(--kit-ease),background-color .2s,border-color .2s,color .2s,opacity .2s}
.button{border-radius:var(--kit-radius-sm)}
.button:not(:disabled):hover,.call-button:not(:disabled):hover,.chip:hover{transform:translateY(-1px)}
.button:not(:disabled):active,.call-button:not(:disabled):active,.chip:active{transform:translateY(0) scale(.96)}
.button.primary{border-color:transparent;background:linear-gradient(120deg,var(--kit-accent),var(--kit-pink),var(--kit-accent)) 0 0/200% 100%;color:var(--kit-on-accent);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 6px 16px -8px var(--kit-accent)}
.button.primary:not(:disabled):hover{opacity:1;background-position:100% 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),var(--kit-lift)}
.chip,.badge,.pill,.count{border-radius:999px}
.card,.panel,.comment,.finding,.window,.stats{border-radius:var(--kit-radius)}
.card{transition:transform .3s var(--kit-spring),box-shadow .3s var(--kit-ease),border-color .2s}
.card:hover{transform:translateY(-2px);box-shadow:var(--kit-lift)}
#toast,.toast{border-radius:999px;box-shadow:var(--kit-lift)}
.mark:empty{position:relative;flex:none;width:22px;height:22px;clip-path:none;border-radius:42% 58% 55% 45%/50% 44% 56% 50%;background:conic-gradient(from 200deg,var(--kit-r1),var(--kit-r2),var(--kit-r3),var(--kit-r4),var(--kit-r5),var(--kit-r6),var(--kit-r1));box-shadow:inset 0 -2px 4px rgba(0,0,0,.14);transition:transform .6s var(--kit-spring),border-radius .6s var(--kit-ease)}
.mark:empty::before{content:"";position:absolute;top:20%;left:24%;width:26%;height:26%;border-radius:50%;background:rgba(255,255,255,.6)}
.mark:empty::after{content:none}
:hover>.mark:empty,.brand:hover .mark:empty{transform:rotate(-16deg) scale(1.12);border-radius:56% 44% 40% 60%/44% 56% 50% 50%}
@media (prefers-reduced-motion:reduce){*,::before,::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

const PAGE_SCRIPT = `
(function(){
  var storageKey = "brainstorm:" + location.pathname;
  var doneCards = {};
  try { doneCards = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (error) {}
  var doneCheckboxes = document.querySelectorAll("[data-done]");
  var planCheckboxes = document.querySelectorAll("[data-plan]");
  var activeFilter = "all";
  function saveDoneCards(){
    try { localStorage.setItem(storageKey, JSON.stringify(doneCards)); } catch (error) {}
  }
  function refreshProgress(){
    var doneCount = 0;
    doneCheckboxes.forEach(function(checkbox){
      checkbox.closest(".card").classList.toggle("is-done", checkbox.checked);
      if (checkbox.checked) doneCount++;
    });
    document.querySelector(".progress div").style.width = (doneCheckboxes.length ? doneCount / doneCheckboxes.length * 100 : 0) + "%";
    document.querySelector(".progress-label").textContent = doneCount + " / " + doneCheckboxes.length;
  }
  function setDone(checkbox, isDone){
    checkbox.checked = isDone;
    doneCards[checkbox.dataset.done] = isDone;
  }
  doneCheckboxes.forEach(function(checkbox){
    checkbox.checked = Boolean(doneCards[checkbox.dataset.done]);
    checkbox.addEventListener("change", function(){
      setDone(checkbox, checkbox.checked);
      saveDoneCards();
      refreshProgress();
    });
  });
  document.getElementById("reset-done").addEventListener("click", function(){
    doneCheckboxes.forEach(function(checkbox){ setDone(checkbox, false); });
    saveDoneCards();
    refreshProgress();
  });
  var filteredSelectButton = document.querySelector('[data-select="filtered"]');
  document.querySelectorAll("[data-filter]").forEach(function(tab){
    tab.addEventListener("click", function(){
      activeFilter = tab.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(function(otherTab){ otherTab.classList.toggle("is-active", otherTab === tab); });
      document.querySelectorAll(".card").forEach(function(card){
        card.classList.toggle("is-hidden", activeFilter !== "all" && card.dataset.category !== activeFilter);
      });
      document.querySelectorAll("section.priority").forEach(function(section){
        section.classList.toggle("is-hidden", !section.querySelector(".card:not(.is-hidden)"));
      });
      var visibleCount = document.querySelectorAll(".card:not(.is-hidden)").length;
      filteredSelectButton.innerHTML = "";
      filteredSelectButton.append("Select all in " + tab.dataset.label + " ");
      var countLabel = document.createElement("span");
      countLabel.className = "count";
      countLabel.textContent = visibleCount;
      filteredSelectButton.append(countLabel);
      filteredSelectButton.classList.toggle("is-hidden", activeFilter === "all");
    });
  });
  var planPicker = document.getElementById("plan-picker");
  var planCommand = document.getElementById("plan-command");
  var pickedCountLabel = document.getElementById("picked-count");
  var numbersByCategory = {};
  planCheckboxes.forEach(function(checkbox){
    var category = checkbox.closest(".card").dataset.category;
    (numbersByCategory[category] = numbersByCategory[category] || []).push(Number(checkbox.dataset.plan));
  });
  function describeNumberRange(first, last){
    if (first === last) return String(first);
    if (last === first + 1) return first + " " + last;
    return first + "-" + last;
  }
  function compressNumbers(pickedNumbers){
    var numberRanges = [];
    var rangeStart = null;
    var previousNumber = null;
    pickedNumbers.forEach(function(number){
      if (previousNumber !== null && number === previousNumber + 1) { previousNumber = number; return; }
      if (rangeStart !== null) numberRanges.push(describeNumberRange(rangeStart, previousNumber));
      rangeStart = number;
      previousNumber = number;
    });
    if (rangeStart !== null) numberRanges.push(describeNumberRange(rangeStart, previousNumber));
    return numberRanges.join(" ");
  }
  function findMatchingCategory(pickedNumbers){
    return Object.keys(numbersByCategory).find(function(category){
      var categoryNumbers = numbersByCategory[category];
      return categoryNumbers.length === pickedNumbers.length && categoryNumbers.every(function(number){ return pickedNumbers.indexOf(number) !== -1; });
    });
  }
  function describePicks(pickedNumbers){
    if (pickedNumbers.length === planCheckboxes.length) return "${ALL_KEYWORD}";
    return findMatchingCategory(pickedNumbers) || compressNumbers(pickedNumbers);
  }
  function listPickedCheckboxes(){
    return Array.prototype.filter.call(planCheckboxes, function(checkbox){ return checkbox.checked; });
  }
  function refreshPlanPicker(){
    var pickedNumbers = listPickedCheckboxes().map(function(checkbox){ return Number(checkbox.dataset.plan); });
    pickedNumbers.sort(function(first, second){ return first - second; });
    planCheckboxes.forEach(function(checkbox){ checkbox.closest(".card").classList.toggle("is-picked", checkbox.checked); });
    pickedCountLabel.textContent = pickedNumbers.length + " selected";
    planCommand.textContent = "${PLAN_INVOCATION} " + describePicks(pickedNumbers);
    planPicker.classList.toggle("is-hidden", pickedNumbers.length === 0);
  }
  function setPicked(shouldPickCard){
    planCheckboxes.forEach(function(checkbox){
      checkbox.checked = shouldPickCard(checkbox.closest(".card"), checkbox.checked);
    });
    refreshPlanPicker();
  }
  planCheckboxes.forEach(function(checkbox){ checkbox.addEventListener("change", refreshPlanPicker); });
  document.querySelector('[data-select="all"]').addEventListener("click", function(){
    setPicked(function(){ return true; });
  });
  filteredSelectButton.addEventListener("click", function(){
    setPicked(function(card, isPicked){ return isPicked || !card.classList.contains("is-hidden"); });
  });
  document.querySelector('[data-select="none"]').addEventListener("click", function(){
    setPicked(function(){ return false; });
  });
  document.addEventListener("keydown", function(event){
    if (event.key === "Escape") setPicked(function(){ return false; });
  });
  document.getElementById("mark-picked-done").addEventListener("click", function(){
    listPickedCheckboxes().forEach(function(checkbox){
      setDone(checkbox.closest(".card").querySelector("[data-done]"), true);
    });
    saveDoneCards();
    refreshProgress();
    setPicked(function(){ return false; });
  });
  document.getElementById("copy-plan").addEventListener("click", function(event){
    var copyButton = event.currentTarget;
    function showCopied(){ copyButton.textContent = "Copied"; setTimeout(function(){ copyButton.textContent = "Copy"; }, 1500); }
    function selectCommand(){
      var range = document.createRange();
      range.selectNodeContents(planCommand);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyButton.textContent = "Press Cmd/Ctrl+C";
    }
    try { navigator.clipboard.writeText(planCommand.textContent).then(showCopied, selectCommand); } catch (error) { selectCommand(); }
  });
  refreshProgress();
  refreshPlanPicker();
})();
`;

const PLAN_PICKER = `<section id="plan-picker" class="is-hidden"><span id="picked-count"></span><code id="plan-command"></code><div class="picker-actions"><button type="button" class="button primary" id="copy-plan">Copy</button><button type="button" class="button ghost" id="mark-picked-done">Mark done</button><button type="button" class="button ghost" data-select="none">Clear</button></div></section>`;

const numberIdeasByUrgency = (ideas: Idea[]): NumberedIdea[] =>
  [...ideas]
    .sort(compareUrgency)
    .map((idea, index) => ({ ...idea, number: index + 1 }));

const renderBrainstormPage = ({
  project,
  summary,
  ideas: sortedIdeas,
}: SavedBrainstorm) => {
  const prioritySections = PRIORITIES_MOST_URGENT_FIRST.map((priority) =>
    renderPrioritySection(priority, sortedIdeas)
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brainstorm · ${escapeHtml(project)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="topbar"><span class="mark"></span><span class="crumb">Brainstorm</span><span class="slash">/</span><strong>${escapeHtml(project)}</strong></header>
<main>
<section class="hero">
<h1>${escapeHtml(project)}</h1>
<p>${escapeHtml(summary)}</p>
</section>
${renderStats(sortedIdeas)}
${renderStartHere(sortedIdeas)}
${renderToolbar(sortedIdeas)}
${prioritySections}
</main>
${PLAN_PICKER}
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
};

const padTwoDigits = (value: number) => String(value).padStart(2, "0");

const formatFileStamp = (milliseconds: number) => {
  const stampDate = new Date(milliseconds);
  const datePart = [
    stampDate.getUTCFullYear(),
    padTwoDigits(stampDate.getUTCMonth() + 1),
    padTwoDigits(stampDate.getUTCDate()),
  ].join("-");
  return `${datePart}-${padTwoDigits(stampDate.getUTCHours())}${padTwoDigits(stampDate.getUTCMinutes())}`;
};

const BROWSER_OPENERS = [
  (pagePath: string) => ["open", pagePath],
  (pagePath: string) => ["xdg-open", pagePath],
  (pagePath: string) => ["cmd", "/c", "start", "", pagePath],
];

const tryOpener = async (engine: EngineInterface, openerCommand: string[]) => {
  try {
    const { exitCode } = await engine.process.run(openerCommand, {
      timeoutMs: 10000,
    });
    return exitCode === 0;
  } catch {
    return false;
  }
};

const openInBrowser = async (engine: EngineInterface, pagePath: string) => {
  for (const buildOpener of BROWSER_OPENERS) {
    if (await tryOpener(engine, buildOpener(pagePath))) return true;
  }
  return false;
};

const toProjectName = (folder: string) => {
  const lastSegment = folder.split("/").filter(Boolean).pop() ?? "";
  const projectName = lastSegment.replace(/[^A-Za-z0-9._-]+/g, "-");
  return /[A-Za-z0-9]/.test(projectName) ? projectName : "unknown";
};

const resolveProjectName = async (
  engine: EngineInterface,
  requestedFolder?: string
) => {
  const folder = requestedFolder || (await engine.session.cwd());
  const commonGitFolder = await engine.process
    .run([
      "git",
      "-C",
      folder,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
    .then((outcome) => (outcome.exitCode === 0 ? outcome.stdout.trim() : ""))
    .catch(() => "");
  return toProjectName(
    commonGitFolder.replace(GIT_FOLDER_SUFFIX, "") ||
      folder.match(CLAUDE_WORKTREE_PATH)?.[1] ||
      folder
  );
};

const readBrainstormRoot = async (engine: EngineInterface) =>
  (await engine.env.get("BRAINSTORM_DIR")) ??
  `${(await engine.env.get("HOME")) ?? ""}/.claude/brainstorm`;

const resolveBrainstormFolder = async (
  engine: EngineInterface,
  requestedFolder?: string
) =>
  `${await readBrainstormRoot(engine)}/${await resolveProjectName(engine, requestedFolder)}`;

const moveLegacyBrainstormFolder = async (engine: EngineInterface) => {
  const legacyFolder = `${await engine.session.cwd()}/${LEGACY_BRAINSTORM_FOLDER}`;
  const brainstormFolder = await resolveBrainstormFolder(engine);
  const hasLegacyFolder = await engine.fs.exists(legacyFolder);
  if (!hasLegacyFolder || (await engine.fs.exists(brainstormFolder))) return;
  await engine.process.run(["mkdir", "-p", await readBrainstormRoot(engine)]);
  await engine.process.run(["mv", legacyFolder, brainstormFolder]);
};

const isInsideFolder = (filePath: string, folder: string) =>
  filePath.startsWith(`${folder}/`) && !filePath.split("/").includes("..");

const writeBrainstormPage = async (
  engine: EngineInterface,
  brainstorm: Brainstorm,
  requestedFolder: string
) => {
  const brainstormFolder = await resolveBrainstormFolder(
    engine,
    requestedFolder
  );
  const pathWithoutExtension = `${brainstormFolder}/brainstorm-${formatFileStamp(await engine.clock.now())}`;
  const pagePath = `${pathWithoutExtension}.html`;
  const savedBrainstorm: SavedBrainstorm = {
    ...brainstorm,
    ideas: numberIdeasByUrgency(brainstorm.ideas),
  };
  await engine.fs.write(
    `${pathWithoutExtension}.json`,
    `${JSON.stringify(savedBrainstorm, null, 2)}\n`
  );
  await engine.fs.write(pagePath, renderBrainstormPage(savedBrainstorm));
  return pagePath;
};

type FolderEntry = { name: string; kind: string };

const listEntryPathsOldestFirst = async (
  engine: EngineInterface,
  folder: string,
  isWantedEntry: (entry: FolderEntry) => boolean
) => {
  const entries = await engine.fs.list(folder).catch(() => []);
  return entries
    .filter(isWantedEntry)
    .map((entry) => entry.name)
    .sort()
    .map((entryName) => `${folder}/${entryName}`);
};

const isSavedBrainstorm = (entry: FolderEntry) =>
  entry.kind === "file" && SAVED_BRAINSTORM_PATTERN.test(entry.name);

const loadNewestBrainstorm = async (
  engine: EngineInterface,
  brainstormFolder: string
): Promise<SavedBrainstorm | undefined> => {
  const savedPaths = await listEntryPathsOldestFirst(
    engine,
    brainstormFolder,
    isSavedBrainstorm
  );
  const newestSavedPath = savedPaths.at(-1);
  if (!newestSavedPath) return undefined;
  try {
    return readBrainstorm(
      JSON.parse(String(await engine.fs.read(newestSavedPath))),
      readNumberedIdea
    );
  } catch {
    return undefined;
  }
};

const describeIdeaLine = (idea: NumberedIdea) =>
  `${idea.number}. ${idea.title} · ${CATEGORIES[idea.category].label} · ${EFFORTS[idea.effort].label}`;

const listIdeasToPick = (brainstorm: SavedBrainstorm) => {
  const presentCategories = listPresentCategories(brainstorm.ideas);
  return [
    `Pick ideas by number or range, for example ${PLAN_INVOCATION} 1 3 or ${PLAN_INVOCATION} 2-5. ${PLAN_INVOCATION} all picks every idea, and a category such as ${PLAN_INVOCATION} ${presentCategories[0]} picks its ideas. Categories: ${presentCategories.join(", ")}.`,
    `Ideas from the newest brainstorm of ${brainstorm.project}:`,
    ...brainstorm.ideas.map(describeIdeaLine),
  ].join("\n");
};

const describeIdeaForPlanner = (idea: NumberedIdea) =>
  [
    `<idea number="${idea.number}">`,
    `Title: ${idea.title}`,
    `Category: ${CATEGORIES[idea.category].label}`,
    `Priority: ${PRIORITIES[idea.priority].label}`,
    `Effort: ${EFFORTS[idea.effort].label}`,
    `Why: ${idea.why || "(not given)"}`,
    `Next step: ${idea.nextStep}`,
    `Files: ${idea.files.join(", ") || "(none named)"}`,
    "</idea>",
  ].join("\n");

const CODE_FENCE = "```";
const OUTER_FENCE = "````";

const INDEX_TEMPLATE = `# Plans: <short title>

- Ideas: <#number title, for each idea>
- Written against: <git rev-parse --short HEAD> on <branch>

## Plans

| Order | Plan | Status | Kind | Depends on | Ideas |
| ----- | ---- | ------ | ---- | ---------- | ----- |
| 1 | [<title>](01-<slug>/plan.md) | pending | <change or spike> | <none, or NN-slug> | <#numbers> |
| 2 | [<title>](02-<slug>/plan.md) | pending | <change or spike> | <none, or NN-slug, NN-slug> | <#numbers> |

## Dropped

<Each dropped idea and why, or "None".>`;

const PLAN_TEMPLATE = `# Plan: <title>

- Status: pending
- Ideas: <#number title, for each idea in this plan>
- Kind: <change or spike>
- Depends on: <none, or NN-slug, NN-slug>

## Goal

<Two or three sentences: what changes for the user when this is done.>

## Context

<Language, test command, formatter, conventions, and every rule and edit-blocking hook from your study of the code that applies to this plan. Under 15 lines.>

## Steps

- [ ] [step-01](step-01.md): <imperative title>
- [ ] [step-02](step-02.md): <imperative title>

## Done criteria

- \`<command that runs what the plan delivers: its tests, or the feature itself>\`: expect <exact result, such as the test names reported as passed or the output the feature prints>

## Out of scope

<What the implementers must not touch.>`;

const STEP_TEMPLATE = `# Step 01: <imperative title>

- Plan: <NN-slug>
- Kind: <test, code, docs or spike>
- Depends on: <none, or step-01, step-02>

## Context

<The plan's Context lines this step needs, copied in full, plus any rule specific to this step.>

## Edits

### Edit 1

- File: \`<exact path>\`
- Action: replace
- Near line: <number>

Surrounding:

${CODE_FENCE}<language>
<2 to 3 unchanged lines before and after the Find text, for orientation only>
${CODE_FENCE}

Find:

${CODE_FENCE}<language>
<exact current text; appears exactly once in the file at the time this step runs>
${CODE_FENCE}

Replace:

${CODE_FENCE}<language>
<exact new text; an empty block deletes the Find text>
${CODE_FENCE}

### Edit 2

- File: \`<exact path>\`
- Action: create

Contents:

${CODE_FENCE}<language>
<the whole new file>
${CODE_FENCE}

## Check

- Run: \`<one narrow command: one test file or one test name, not the whole suite>\`
- Expect: exit 0, output contains \`<exact text>\``;

const listPickedNumbers = (pickedIdeas: NumberedIdea[]) => {
  const pickedNumbers = pickedIdeas.map((idea) => `#${idea.number}`);
  if (pickedNumbers.length < 2) return pickedNumbers.join("");
  return `${pickedNumbers.slice(0, -1).join(", ")} and ${pickedNumbers.at(-1)}`;
};

const buildPlanPrompt = (pickedIdeas: NumberedIdea[], runFolderPath: string) =>
  `Write an implementation plan for these ideas from the project's brainstorm. Do not implement anything.

The user picked ideas ${listPickedNumbers(pickedIdeas)} on the brainstorm page and ran ${PLAN_INVOCATION} with those numbers. Claude Code does not show a plugin command's arguments, so the numbers are listed here. Plan every picked idea. Do not ask the user to narrow the selection.

${pickedIdeas.map(describeIdeaForPlanner).join("\n\n")}

Who reads the plan: one small-model subagent builds each plan, working through its step files one at a time; it cannot ask questions, and it makes poor judgement calls. After the steps run one after another, a strong model reviews the finished work against the plan.

Write the plan as a run folder at ${runFolderPath}. Work in this order:

1. Study the code. Read the real files each idea touches. Read ~/.claude/CLAUDE.md, the CLAUDE.md files of the project, and the hooks in .claude/settings*.json and ~/.claude/settings.json. Copy every rule and every edit-blocking hook you find into the Context of each plan that needs it: TDD red-first, no code comments, naming, and any other hook that can block an edit. Say in Context that a blocked edit means reply BLOCKED.
2. Split into plans. Make one plan folder per idea by default. Merge ideas into one plan only when they change the same code. Name each folder NN-slug, numbered in build order. Order the plans so each depends only on earlier ones, and record Depends on in each plan.md and in index.md.
3. Spikes. An idea whose effort is large, or whose category is moonshot, gets a plan with Kind: spike. A spike has spike steps with Questions, which write findings.md in the plan folder, and no product code. Its idea needs re-planning, with a new ${PLAN_INVOCATION} run, once findings.md is written.
4. Decide. Ask the user with AskUserQuestion only for a choice that changes the plan materially. Make every smaller decision yourself and write it down in the plan. Drop an idea that the code contradicts, and list it with its reason under Dropped in index.md.
5. Write the files in exactly these formats. The run folder holds index.md, the index of the run: one table row per plan, in build order. Each plan folder holds plan.md and its step files. A status is one of ${PLAN_STATUSES_AS_TEXT}. Every plan starts as pending, and a plan.md and its index.md row always show the same status. Keep the | character out of plan titles.

index.md:

${CODE_FENCE}
${INDEX_TEMPLATE}
${CODE_FENCE}

plan.md:

${CODE_FENCE}
${PLAN_TEMPLATE}
${CODE_FENCE}

step-NN.md:

${OUTER_FENCE}
${STEP_TEMPLATE}
${OUTER_FENCE}

Rules for plan.md: its ## Done criteria prove the behaviour the plan delivers works, not only that the code builds. Each line is a backticked command, then ": expect" and the exact result that counts as passing. A build, type-check, lint or format command alone is refused. A spike plan's Done criteria run test -s on its findings.md path.

Rules for every step file:
- One small change per step: one file, or one test with the code it tests. Its Replace and Contents blocks hold at most ${MAX_CHANGED_LINES_PER_STEP} changed lines in total; aim under 40.
- An edit is Action: replace or Action: create, with exactly the blocks the template shows for it.
- Find text is copied exactly from the file as earlier steps of the run leave it.
- Copy into each step every Context line that the step needs. A build can resume at any step, so no step relies on another step's Context.
- Where the project has tests, a test step comes before its code step. The test step's Expect is exit non-zero, output contains the failure text, which proves the test runs before the code exists. The code step's Expect is exit 0 and its passing text.
- Each Check runs one narrow command: one test file or one test name, never the whole suite. State its exact exit code and exact output text.
- Give new code in full. Leave no judgement to the implementer.
- Never write these phrases outside code fences, in any case: ${BANNED_PHRASES.join(", ")}.
- A spike step has no Edits. It has a numbered Questions list, and its Check is test -s on its findings.md path.

6. Check. Call the ${QUALIFIED_CHECK_TOOL_NAME} tool with the run folder path. Fix every problem it returns, and call it again until it returns OK.
7. Clarity pass. For every plan folder, call the Agent tool once with subagent_type "brainstorm:step-reader" and the plan folder's absolute path as its prompt. One call reads every step of that plan: never call it once per step. Send the calls for all plans in one message so they run in parallel. Rewrite each step a QUESTIONS reply names, then run the checker again. Do at most two rounds of this.
8. Reply with the run folder path, one line per plan (title, kind, step count), and: Run ${BUILD_INVOCATION} to implement it.`;

const describeRunsToBuild = (requestedRuns: string) =>
  requestedRuns
    ? `The user named the runs or plans to build. Find them as the skill's "Find the runs" section says:
<runs>
${requestedRuns}
</runs>`
    : `The user named no run, so pick the run as the skill's "Find the runs" section says for a request with no detail.`;

const buildImplementationPrompt = (
  requestedRuns: string,
  plansFolder: string
) =>
  `Build brainstorm plans. Load the brainstorm:build-plans skill with the Skill tool and follow it exactly. Commit and push each plan the reviewer approves, then the leftover work, as the skill says.

The plans folder of this project is ${plansFolder}.

${describeRunsToBuild(requestedRuns)}`;

const NUMBER_RANGE_PATTERN = /^(\d+)-(\d+)$/;

const parseRequestedPicks = (args: string) =>
  args.split(/[\s,]+/).filter(Boolean);

const listIdeaNumbers = (ideas: NumberedIdea[]) =>
  ideas.map((idea) => idea.number);

const expandNumberRange = (
  ideas: NumberedIdea[],
  rangeMatch: RegExpExecArray
) => {
  const rangeEnds = [Number(rangeMatch[1]), Number(rangeMatch[2])];
  const lowest = Math.min(...rangeEnds);
  const highest = Math.max(...rangeEnds);
  const hasBothEnds = rangeEnds.every((end) =>
    ideas.some((idea) => idea.number === end)
  );
  if (!hasBothEnds) return [];
  return listIdeaNumbers(
    ideas.filter((idea) => idea.number >= lowest && idea.number <= highest)
  );
};

const expandPick = (ideas: NumberedIdea[], pick: string) => {
  const normalizedPick = pick.toLowerCase();
  if (normalizedPick === ALL_KEYWORD) return listIdeaNumbers(ideas);
  const rangeMatch = NUMBER_RANGE_PATTERN.exec(pick);
  if (rangeMatch) return expandNumberRange(ideas, rangeMatch);
  return listIdeaNumbers(
    ideas.filter(
      (idea) => idea.category === normalizedPick || String(idea.number) === pick
    )
  );
};

const resolvePicks = (ideas: NumberedIdea[], requestedPicks: string[]) => {
  const expandedPicks = requestedPicks.map((pick) => ({
    pick,
    numbers: expandPick(ideas, pick),
  }));
  const unknownPicks = expandedPicks
    .filter((expanded) => !expanded.numbers.length)
    .map((expanded) => expanded.pick);
  const pickedNumbers = new Set(
    expandedPicks.flatMap((expanded) => expanded.numbers)
  );
  const pickedIdeas = ideas.filter((idea) => pickedNumbers.has(idea.number));
  return { pickedIdeas, unknownPicks };
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const resolveProjectPath = (workingDirectory: string, requestedPath: string) =>
  requestedPath.startsWith("/")
    ? requestedPath
    : `${workingDirectory}/${requestedPath}`;

const readPlanFiles = (engine: EngineInterface): PlanFiles => ({
  read: (filePath) =>
    engine.fs.read(filePath).then(
      (fileText) => String(fileText),
      () => undefined
    ),
  list: (folder) =>
    engine.fs.list(folder).then(
      (entries) => entries.map((entry) => entry.name),
      () => []
    ),
});

const checkBrainstormPlanPath = async (
  engine: EngineInterface,
  requestedPath: string
) => {
  const problems = await checkPlan(
    readPlanFiles(engine),
    resolveProjectPath(await resolveBrainstormFolder(engine), requestedPath),
    await engine.session.cwd()
  );
  return problems.length ? problems.join("\n") : "OK";
};

const readStatusFiles = (engine: EngineInterface): StatusFiles => ({
  read: readPlanFiles(engine).read,
  write: async (filePath, fileText) => {
    await engine.fs.write(filePath, fileText);
  },
});

type PlanCard = { title: string; status: string; shortPath: string };

const planCards = new Map<string, PlanCard>();
const PLAN_CARD_CONTEXT_MINIMUM_COLUMNS = 60;
const PLAN_TITLE_PATTERN = /^# Plan:[ \t]*(.+)$/m;
let placedPlanCount = 0;

const placePlanCard = async (
  engine: EngineInterface,
  planFolderPath: string,
  status: string
) => {
  const planFolderName = readPlanFolderName(planFolderPath);
  const planText = await readPlanFiles(engine).read(
    `${planFolderPath.replace(/\/+$/, "")}/${PLAN_FILE_NAME}`
  );
  placedPlanCount += 1;
  const id = `plan-${Date.now().toString(36)}-${placedPlanCount}`;
  planCards.set(id, {
    title:
      PLAN_TITLE_PATTERN.exec(planText ?? "")?.[1]?.trim() ?? planFolderName,
    status,
    shortPath: `~/…/${planFolderName}/${PLAN_FILE_NAME}`,
  });
  const placed = await engine.ui.place({ id }).catch(() => undefined);
  if (!placed?.isPlaced) planCards.delete(id);
};

const submitPromptAfterReply = (engine: EngineInterface, prompt: string) => {
  engine.clock.after(0, () => void engine.prompt.submit({ text: prompt }));
};

const startBrainstorm = (engine: EngineInterface, focus: string) => {
  submitPromptAfterReply(engine, buildBrainstormPrompt(focus));
  return { text: "Brainstorming improvements for this project…" };
};

const describeUnknownPicks = (
  brainstorm: SavedBrainstorm,
  unknownPicks: string[],
  requestedPicksText: string
) =>
  [
    `The newest brainstorm has no idea ${unknownPicks.join(", ")}.`,
    `Pick numbers from 1 to ${brainstorm.ideas.length}, a range such as 2-5, a category (${listPresentCategories(brainstorm.ideas).join(", ")}) or ${ALL_KEYWORD}.`,
    `Run ${PLAN_INVOCATION} to list them.`,
    `To brainstorm with "${PLAN_MODE} ${requestedPicksText}" as a focus, put another word first.`,
  ].join(" ");

const startPlanning = async (
  engine: EngineInterface,
  requestedPicksText: string
) => {
  const brainstormFolder = await resolveBrainstormFolder(engine);
  const brainstorm = await loadNewestBrainstorm(engine, brainstormFolder);
  if (!brainstorm) {
    return {
      text: `No saved brainstorm in this project yet. Run /${BRAINSTORM_COMMAND} first.`,
    };
  }
  const requestedPicks = parseRequestedPicks(requestedPicksText);
  if (!requestedPicks.length) return { text: listIdeasToPick(brainstorm) };
  const { pickedIdeas, unknownPicks } = resolvePicks(
    brainstorm.ideas,
    requestedPicks
  );
  if (unknownPicks.length) {
    return {
      text: describeUnknownPicks(brainstorm, unknownPicks, requestedPicksText),
    };
  }
  const runFolderPath = `${brainstormFolder}/${PLANS_FOLDER_NAME}/plan-${formatFileStamp(await engine.clock.now())}`;
  submitPromptAfterReply(engine, buildPlanPrompt(pickedIdeas, runFolderPath));
  const pickedTitles = pickedIdeas
    .map((idea) => `#${idea.number} ${idea.title}`)
    .join(", ");
  return {
    text: `Planning ${pickedTitles} into the run folder ${runFolderPath}…`,
  };
};

const startBuild = async (engine: EngineInterface, requestedRuns: string) => {
  const plansFolder = `${await resolveBrainstormFolder(engine)}/${PLANS_FOLDER_NAME}`;
  submitPromptAfterReply(
    engine,
    buildImplementationPrompt(requestedRuns, plansFolder)
  );
  return {
    text: `Building ${requestedRuns || UNNAMED_RUN} with small-model implementers and a strong reviewer…`,
  };
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: BRAINSTORM_COMMAND,
      description: `Brainstorm ideas for this project, shown in the browser. "${PLAN_MODE} <picks>" turns picked ideas into small-step plans, and "${BUILD_MODE}" has small models build them and a strong model review the result`,
      argumentHint: `[focus] | ${PLAN_MODE} <picks> | ${BUILD_MODE} [runs]`,
    });
    await $.tool.register({
      name: TOOL_NAME,
      description:
        "Renders brainstormed project ideas as a self-contained, ADHD-friendly HTML page, saves it under ~/.claude/brainstorm/<project>/ and opens it in the browser. Call it once, with every idea, at the end of a /brainstorm.",
      inputSchema: RENDER_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: CHECK_TOOL_NAME,
      description:
        "Checks a brainstorm plan run folder against the plan format: index.md, each plan.md, the step files, and that every plan's status matches its index row. Replies OK, or one problem per line. Call it on the run folder after writing the plans, and fix every problem it lists.",
      inputSchema: CHECK_TOOL_SCHEMA,
      isDeferred: true,
    });
    await $.tool.register({
      name: STATUS_TOOL_NAME,
      description:
        "Sets one brainstorm plan's status in its plan.md and in its row of the run's index.md, so the two always match. Call it with the plan folder path each time a plan's status changes.",
      inputSchema: STATUS_TOOL_SCHEMA,
      isDeferred: true,
    });
    return next(e);
  });

  on("prompt.autocomplete", async (_, e, next) => {
    const isFirstBrainstormArgument =
      e.text.startsWith(BRAINSTORM_COMMAND_PREFIX) &&
      e.text.slice(BRAINSTORM_COMMAND_PREFIX.length, e.start).trim() === "";
    if (!isFirstBrainstormArgument) return next(e);
    const { suggestions } = await next(e);
    const matchingModes = BRAINSTORM_MODE_SUGGESTIONS.filter((mode) =>
      mode.text.startsWith(e.token)
    );
    return { suggestions: [...suggestions, ...matchingModes] };
  });

  on("command.run", { command: BRAINSTORM_COMMAND }, async ($, e) => {
    await moveLegacyBrainstormFolder($).catch(() => undefined);
    const commandArguments = e.args.trim();
    const [firstWord = ""] = commandArguments.split(/\s+/, 1);
    const wordsAfterFirst = commandArguments.slice(firstWord.length).trim();
    if (firstWord === PLAN_MODE) return startPlanning($, wordsAfterFirst);
    if (firstWord === BUILD_MODE) return startBuild($, wordsAfterFirst);
    return startBrainstorm($, commandArguments);
  });

  on("tool.call", { tool: QUALIFIED_TOOL_NAME }, async ($, e) => {
    const brainstorm = readBrainstorm(e, readIdea);
    if (!brainstorm) {
      return {
        deny: "The brainstorm needs at least one idea with a title and a nextStep.",
      };
    }
    try {
      const requestedFolder = readText(e.folder);
      const pagePath = await writeBrainstormPage(
        $,
        brainstorm,
        requestedFolder.startsWith("/") ? requestedFolder : ""
      );
      const isOpened = await openInBrowser($, pagePath);
      return {
        result: isOpened
          ? `Opened ${pagePath} in the browser.`
          : `Could not open the browser. The page is saved at ${pagePath}.`,
      };
    } catch (error) {
      return {
        deny: `Could not write the brainstorm page: ${describeError(error)}`,
      };
    }
  });

  on("ui.render", { component: "Placed" }, ($, e, next) => {
    const card =
      e.props.plugin === "brainstorm" ? planCards.get(e.props.id) : undefined;
    if (!card) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    const bodyColumns = (e.props as { bodyColumns?: number }).bodyColumns;
    const isContextShown =
      bodyColumns === undefined ||
      bodyColumns >= PLAN_CARD_CONTEXT_MINIMUM_COLUMNS;
    return h(
      Box,
      { flexDirection: "row", gap: "sm" },
      h(
        Box,
        { width: 7, flexShrink: 0 },
        h(
          Text,
          {
            backgroundColor: "planMode",
            color: "inverseText",
            weight: "semibold",
          },
          " PLAN "
        )
      ),
      h(
        Box,
        { flexGrow: 1, flexShrink: 1 },
        h(Text, { weight: "semibold", wrap: "truncate-end" }, card.title)
      ),
      ...(isContextShown
        ? [
            h(
              Box,
              { flexShrink: 0 },
              h(Text, { dimColor: true }, `${card.status}  ${card.shortPath}`)
            ),
          ]
        : [])
    ) as RenderElement;
  });

  on("tool.check", async ($, e, next) => {
    const verdict = await next(e);
    const filePath = readText((e.input as { file_path?: unknown })?.file_path);
    const isOwnRunFile =
      verdict.decision === "ask" &&
      RUN_FILE_TOOLS.includes(e.tool) &&
      isInsideFolder(filePath, await readBrainstormRoot($));
    return isOwnRunFile
      ? { decision: "allow", reason: OWN_FOLDER_REASON }
      : verdict;
  });

  on("tool.call", { tool: QUALIFIED_CHECK_TOOL_NAME }, async ($, e) => ({
    result: await checkBrainstormPlanPath($, readText(e.path)),
  }));

  on("tool.call", { tool: QUALIFIED_STATUS_TOOL_NAME }, async ($, e) => {
    const planFolderPath = resolveProjectPath(
      await resolveBrainstormFolder($),
      readText(e.path)
    );
    const status = readText(e.status);
    try {
      const problems = await setPlanStatus(
        readStatusFiles($),
        planFolderPath,
        status
      );
      if (!problems.length) await placePlanCard($, planFolderPath, status);
      return problems.length
        ? { deny: problems.join("\n") }
        : { result: `${readPlanFolderName(planFolderPath)}: ${status}` };
    } catch (error) {
      return {
        deny: `Could not write the plan status: ${describeError(error)}`,
      };
    }
  });
};
