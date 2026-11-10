import type { EngineInterface, Register } from "claude-code";

const TOOL_NAME = "render_brainstorm";
const QUALIFIED_TOOL_NAME = `mcp__brainstorm__${TOOL_NAME}`;
const BRAINSTORM_FOLDER = ".claude/brainstorm";
const START_HERE_COUNT = 3;

const CATEGORIES = {
  security: { emoji: "🔒", label: "Security", rank: 0 },
  "must-have": { emoji: "✅", label: "Must-have", rank: 1 },
  "quick-win": { emoji: "⚡", label: "Quick win", rank: 2 },
  performance: { emoji: "🚀", label: "Performance", rank: 3 },
  "developer-experience": { emoji: "🛠️", label: "Dev experience", rank: 4 },
  creative: { emoji: "💡", label: "Creative", rank: 5 },
  moonshot: { emoji: "🌙", label: "Moonshot", rank: 6 },
} as const;

const PRIORITIES = {
  now: { emoji: "🔥", label: "Do now", rank: 0 },
  next: { emoji: "⏭️", label: "Next up", rank: 1 },
  later: { emoji: "🌱", label: "Later", rank: 2 },
} as const;

const EFFORTS = {
  small: { label: "S · under an hour", rank: 0 },
  medium: { label: "M · a day or so", rank: 1 },
  large: { label: "L · a project", rank: 2 },
} as const;

type Category = keyof typeof CATEGORIES;
type Priority = keyof typeof PRIORITIES;
type Effort = keyof typeof EFFORTS;

type Idea = {
  title: string;
  category: Category;
  priority: Priority;
  effort: Effort;
  why: string;
  nextStep: string;
  files: string[];
};

type Brainstorm = { project: string; summary: string; ideas: Idea[] };

type NumberedIdea = Idea & { number: number };

type SavedBrainstorm = {
  project: string;
  summary: string;
  ideas: NumberedIdea[];
};

const PLAN_COMMAND = "brainstorm-plan";
const BUILD_COMMAND = "brainstorm-build";
const IMPLEMENTER_AGENT = "brainstorm:step-implementer";
const REVIEWER_AGENT = "brainstorm:plan-reviewer";
const PLANS_FOLDER = `${BRAINSTORM_FOLDER}/plans`;
const SAVED_BRAINSTORM_PATTERN = /^brainstorm-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;
const PLAN_FILE_PATTERN = /^plan-\d{4}-\d{2}-\d{2}-\d{4}\.md$/;

const BRAINSTORM_INSTRUCTIONS = `Brainstorm improvements for the project in the current working directory.

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

When done, call the ${QUALIFIED_TOOL_NAME} tool once with every idea. It writes the page and opens it in the browser. Then reply with the page's path and the top three ideas in one line each.`;

const buildBrainstormPrompt = (focus: string) =>
  focus
    ? `${BRAINSTORM_INSTRUCTIONS}\n\nCenter the brainstorm on this focus, and keep the rest brief:\n<focus>\n${focus}\n</focus>`
    : BRAINSTORM_INSTRUCTIONS;

const RENDER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    project: { type: "string", description: "The project's name." },
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
          category: { type: "string", enum: Object.keys(CATEGORIES) },
          priority: { type: "string", enum: Object.keys(PRIORITIES) },
          effort: { type: "string", enum: Object.keys(EFFORTS) },
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

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const pickKey = <Options extends object>(
  options: Options,
  value: unknown,
  fallback: keyof Options
): keyof Options =>
  typeof value === "string" && value in options
    ? (value as keyof Options)
    : fallback;

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
    category: pickKey(CATEGORIES, fields.category, "creative"),
    priority: pickKey(PRIORITIES, fields.priority, "next"),
    effort: pickKey(EFFORTS, fields.effort, "medium"),
    files,
  };
};

const readBrainstorm = (input: Record<string, unknown>) => {
  const rawIdeas = Array.isArray(input.ideas) ? input.ideas : [];
  const ideas = rawIdeas
    .map(readIdea)
    .filter((idea): idea is Idea => idea !== undefined);
  if (ideas.length === 0) {
    return {
      failure:
        "The brainstorm needs at least one idea with a title and a nextStep.",
    };
  }
  const brainstorm: Brainstorm = {
    project: readText(input.project) || "This project",
    summary: readText(input.summary),
    ideas,
  };
  return { brainstorm };
};

const compareUrgency = (first: Idea, second: Idea) =>
  PRIORITIES[first.priority].rank - PRIORITIES[second.priority].rank ||
  CATEGORIES[first.category].rank - CATEGORIES[second.category].rank ||
  EFFORTS[first.effort].rank - EFFORTS[second.effort].rank;

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

const renderIdeaCard = (idea: NumberedIdea, cardKey: string) => {
  const category = CATEGORIES[idea.category];
  return `<article class="card cat-${idea.category}" data-category="${idea.category}" data-card="${cardKey}">
  <div class="card-top">
    <span class="tag"><span class="number">#${idea.number}</span> ${category.emoji} ${category.label}</span>
    <span class="effort">${EFFORTS[idea.effort].label}</span>
  </div>
  <h3>${escapeHtml(idea.title)}</h3>
  <p class="next"><strong>👉 Next step:</strong> ${escapeHtml(idea.nextStep)}</p>
  ${renderWhy(idea.why)}
  ${renderFiles(idea.files)}
  <div class="card-actions">
    <label class="done"><input type="checkbox" data-done="${cardKey}"> Done</label>
    <label class="plan"><input type="checkbox" data-plan="${idea.number}"> Plan</label>
  </div>
</article>`;
};

const renderStartHere = (ideas: Idea[]) => {
  const startHereSteps = ideas
    .slice(0, START_HERE_COUNT)
    .map(
      (idea, index) =>
        `<li><span class="step">${index + 1}</span><div><strong>${escapeHtml(idea.title)}</strong><br>${escapeHtml(idea.nextStep)}</div></li>`
    )
    .join("");
  return `<section id="start-here"><h2>🎯 Start here</h2><ol>${startHereSteps}</ol></section>`;
};

const renderPrioritySection = (priority: Priority, ideas: NumberedIdea[]) => {
  const matchingIdeas = ideas.filter((idea) => idea.priority === priority);
  if (!matchingIdeas.length) return "";
  const { emoji, label } = PRIORITIES[priority];
  const cards = matchingIdeas
    .map((idea) => renderIdeaCard(idea, `${priority}-${ideas.indexOf(idea)}`))
    .join("\n");
  return `<section class="priority"><h2>${emoji} ${label} <span class="count">${matchingIdeas.length}</span></h2><div class="grid">${cards}</div></section>`;
};

const renderFilterChips = (ideas: Idea[]) => {
  const presentCategories = (Object.keys(CATEGORIES) as Category[]).filter(
    (category) => ideas.some((idea) => idea.category === category)
  );
  const chips = presentCategories
    .map((category) => {
      const { emoji, label } = CATEGORIES[category];
      const count = ideas.filter((idea) => idea.category === category).length;
      return `<button type="button" class="chip" data-filter="${category}">${emoji} ${label} <span>${count}</span></button>`;
    })
    .join("");
  return `<nav class="chips"><button type="button" class="chip is-active" data-filter="all">All <span>${ideas.length}</span></button>${chips}</nav>`;
};

const PAGE_STYLE = `
:root{--bg:#f7f5f0;--panel:#fff;--text:#1d1b18;--muted:#6b665d;--line:#e4dfd4;--accent:#3b5bdb;--now:#e03131;--next:#f08c00;--later:#2f9e44;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#16171a;--panel:#1f2125;--text:#ecebe8;--muted:#a3a19b;--line:#33363c;--accent:#7b93ff;--now:#ff6b6b;--next:#ffb340;--later:#5fd17a;color-scheme:dark}}
*{checkbox-sizing:border-checkbox}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 80px}
header h1{margin:0;font-size:1.9rem}
header p{margin:4px 0 0;color:var(--muted)}
.progress{margin:18px 0 6px;height:10px;border-radius:99px;background:var(--line);overflow:hidden}
.progress div{height:100%;width:0;background:var(--later);transition:width .3s}
.progress-label{font-size:.9rem;color:var(--muted)}
#start-here{margin:24px 0;padding:18px 20px;border-radius:16px;background:var(--panel);border:2px solid var(--accent)}
#start-here h2{margin:0 0 10px}
#start-here ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}
#start-here li{display:flex;gap:12px;align-items:flex-start}
.step{flex:none;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px;position:sticky;top:0;padding:10px 0;background:var(--bg);z-index:1}
.chip{font:inherit;font-size:.92rem;padding:6px 12px;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer}
.chip span{color:var(--muted)}
.chip.is-active{background:var(--accent);border-color:var(--accent);color:#fff}
.chip.is-active span{color:#fff}
.priority h2{margin:28px 0 12px;font-size:1.35rem}
.count{font-size:.9rem;color:var(--muted);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-left:6px solid var(--accent);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.card.cat-security,.card.cat-must-have{border-left-color:var(--now)}
.card.cat-quick-win,.card.cat-performance,.card.cat-developer-experience{border-left-color:var(--next)}
.card.cat-creative,.card.cat-moonshot{border-left-color:var(--later)}
.card h3{margin:0;font-size:1.1rem;line-height:1.3}
.card-top{display:flex;justify-content:space-between;gap:8px;font-size:.85rem}
.tag{font-weight:600}
.effort{color:var(--muted)}
.next{margin:0}
details summary{cursor:pointer;color:var(--muted);font-size:.92rem}
details p{margin:6px 0 0}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files code{font-size:.8rem;padding:2px 6px;border-radius:6px;background:var(--bg);border:1px solid var(--line)}
.number{color:var(--muted);font-weight:700}
.card-actions{margin-top:auto;display:flex;justify-content:space-between;gap:8px}
.done,.plan{font-size:.92rem;color:var(--muted);cursor:pointer}
#plan-picker{position:sticky;bottom:12px;margin-top:24px;padding:12px 16px;border-radius:14px;background:var(--panel);border:2px solid var(--accent);display:flex;flex-wrap:wrap;align-items:center;gap:10px}
#plan-picker code{flex:1;font-size:1rem;user-select:all}
#plan-picker button{font:inherit;padding:6px 14px;border-radius:99px;border:0;background:var(--accent);color:#fff;cursor:pointer}
.card.is-done{opacity:.45}
.card.is-done h3{text-decoration:line-through}
.is-hidden{display:none}
`;

const PAGE_SCRIPT = `
(function(){
  var storageKey = "brainstorm:" + location.pathname;
  var doneCards = {};
  try { doneCards = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch (error) {}
  var doneCheckboxes = document.querySelectorAll("[data-done]");
  function refreshProgress(){
    var doneCount = 0;
    doneCheckboxes.forEach(function(checkbox){
      var card = checkbox.closest(".card");
      card.classList.toggle("is-done", checkbox.checked);
      if (checkbox.checked) doneCount++;
    });
    document.querySelector(".progress div").style.width = (doneCheckboxes.length ? doneCount / doneCheckboxes.length * 100 : 0) + "%";
    document.querySelector(".progress-label").textContent = doneCount + " of " + doneCheckboxes.length + " done";
  }
  doneCheckboxes.forEach(function(checkbox){
    checkbox.checked = Boolean(doneCards[checkbox.dataset.done]);
    checkbox.addEventListener("change", function(){
      doneCards[checkbox.dataset.done] = checkbox.checked;
      try { localStorage.setItem(storageKey, JSON.stringify(doneCards)); } catch (error) {}
      refreshProgress();
    });
  });
  document.querySelectorAll("[data-filter]").forEach(function(chip){
    chip.addEventListener("click", function(){
      var filter = chip.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(function(otherChip){ otherChip.classList.toggle("is-active", otherChip === chip); });
      document.querySelectorAll(".card").forEach(function(card){
        card.classList.toggle("is-hidden", filter !== "all" && card.dataset.category !== filter);
      });
      document.querySelectorAll("section.priority").forEach(function(section){
        section.classList.toggle("is-hidden", !section.querySelector(".card:not(.is-hidden)"));
      });
    });
  });
  var planPicker = document.getElementById("plan-picker");
  var planCommand = document.getElementById("plan-command");
  var planCheckboxes = document.querySelectorAll("[data-plan]");
  function refreshPlanPicker(){
    var pickedNumbers = [];
    planCheckboxes.forEach(function(checkbox){ if (checkbox.checked) pickedNumbers.push(Number(checkbox.dataset.plan)); });
    pickedNumbers.sort(function(first, second){ return first - second; });
    planCommand.textContent = "/brainstorm-plan " + pickedNumbers.join(" ");
    planPicker.classList.toggle("is-hidden", pickedNumbers.length === 0);
  }
  planCheckboxes.forEach(function(checkbox){ checkbox.addEventListener("change", refreshPlanPicker); });
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

const PLAN_PICKER = `<section id="plan-picker" class="is-hidden"><span>📝 Paste into Claude Code:</span><code id="plan-command"></code><button type="button" id="copy-plan">Copy</button></section>`;

const numberIdeasByUrgency = (ideas: Idea[]): NumberedIdea[] =>
  [...ideas]
    .sort(compareUrgency)
    .map((idea, index) => ({ ...idea, number: index + 1 }));

const renderBrainstormPage = ({
  project,
  summary,
  ideas: sortedIdeas,
}: SavedBrainstorm) => {
  const prioritySections = (Object.keys(PRIORITIES) as Priority[])
    .map((priority) => renderPrioritySection(priority, sortedIdeas))
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brainstorm · ${escapeHtml(project)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<header>
<h1>🧠 ${escapeHtml(project)}</h1>
<p>${escapeHtml(summary)}</p>
<div class="progress"><div></div></div>
<span class="progress-label"></span>
</header>
${renderStartHere(sortedIdeas)}
${renderFilterChips(sortedIdeas)}
${prioritySections}
${PLAN_PICKER}
</main>
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

const writeBrainstormPage = async (
  engine: EngineInterface,
  brainstorm: Brainstorm
) => {
  const brainstormFolder = `${await engine.session.cwd()}/${BRAINSTORM_FOLDER}`;
  const pathWithoutExtension = `${brainstormFolder}/brainstorm-${formatFileStamp(await engine.clock.now())}`;
  const pagePath = `${pathWithoutExtension}.html`;
  const savedBrainstorm: SavedBrainstorm = {
    ...brainstorm,
    ideas: numberIdeasByUrgency(brainstorm.ideas),
  };
  await engine.fs.write(`${brainstormFolder}/.gitignore`, "*\n");
  await engine.fs.write(
    `${pathWithoutExtension}.json`,
    `${JSON.stringify(savedBrainstorm, null, 2)}\n`
  );
  await engine.fs.write(pagePath, renderBrainstormPage(savedBrainstorm));
  return pagePath;
};

const findNewestFile = async (
  engine: EngineInterface,
  folder: string,
  fileNamePattern: RegExp
) => {
  const entries = await engine.fs.list(folder).catch(() => []);
  const newestName = entries
    .filter(
      (entry) => entry.kind === "file" && fileNamePattern.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return newestName ? `${folder}/${newestName}` : undefined;
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

const readSavedBrainstorm = async (
  engine: EngineInterface,
  savedPath: string
): Promise<SavedBrainstorm | undefined> => {
  try {
    const parsedBrainstorm = JSON.parse(
      String(await engine.fs.read(savedPath))
    );
    const rawIdeas: unknown[] = Array.isArray(parsedBrainstorm.ideas)
      ? parsedBrainstorm.ideas
      : [];
    const ideas = rawIdeas
      .map(readNumberedIdea)
      .filter((idea): idea is NumberedIdea => idea !== undefined);
    if (!ideas.length) return undefined;
    return {
      project: readText(parsedBrainstorm.project) || "This project",
      summary: readText(parsedBrainstorm.summary),
      ideas,
    };
  } catch {
    return undefined;
  }
};

const loadNewestBrainstorm = async (
  engine: EngineInterface,
  workingDirectory: string
) => {
  const savedPath = await findNewestFile(
    engine,
    `${workingDirectory}/${BRAINSTORM_FOLDER}`,
    SAVED_BRAINSTORM_PATTERN
  );
  return savedPath ? readSavedBrainstorm(engine, savedPath) : undefined;
};

const describeIdeaLine = (idea: NumberedIdea) =>
  `${idea.number}. ${idea.title} · ${CATEGORIES[idea.category].label} · ${EFFORTS[idea.effort].label}`;

const listIdeasToPick = (brainstorm: SavedBrainstorm) =>
  [
    `Pick ideas by number, for example /${PLAN_COMMAND} 1 3. Ideas from the newest brainstorm of ${brainstorm.project}:`,
    ...brainstorm.ideas.map(describeIdeaLine),
  ].join("\n");

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

const PLAN_TEMPLATE = `# Plan: <short title>

- Ideas: <#number title, for each idea>
- Written against: <git rev-parse --short HEAD> on <branch>
- Steps: <count>

## Goal

<Two or three sentences: what changes for the user when this is done.>

## Context

<What every implementer needs and cannot see otherwise: language, test command, formatter, conventions, and any rule from CLAUDE.md that applies. Under 15 lines.>

## Steps

### Step 1: <imperative title>

- Files: \`<exact path>\`
- Depends on: none
- Do:
  1. <one exact action>
  2. <one exact action>
- Check: \`<one command>\`, expect <exact result>

## Done criteria

<Commands the reviewer runs on the finished work, each with its expected result.>

## Out of scope

<What the implementers must not touch.>`;

const buildPlanPrompt = (pickedIdeas: NumberedIdea[], planPath: string) =>
  `Write an implementation plan for these ideas from the project's brainstorm. Do not implement anything.

${pickedIdeas.map(describeIdeaForPlanner).join("\n\n")}

Who reads the plan: /${BUILD_COMMAND} hands each step, alone, to a fresh subagent on a small, cheap model. That subagent sees only the plan's Context section and its own step. It cannot ask questions and it makes poor judgement calls. A strong model reviews the finished work against the plan.

1. Study the code each idea touches first. Read the real files. Drop an idea the code contradicts, and say why under Out of scope.
2. If a choice would change the plan materially, ask the user with AskUserQuestion before writing. Make every smaller decision yourself and write it down.
3. Write the plan to ${planPath} in exactly this format:

${PLAN_TEMPLATE}

Rules for steps:
- One small change per step: one file, or one test with the code it tests. Aim for under 40 changed lines.
- Name exact paths. To change existing code, quote the exact current text to find, then give the exact replacement. Give new code in full.
- Leave no judgement to the implementer. Never write "as appropriate", "if needed", "consider", "similar to", or "etc.".
- Repeat inside each step any convention or rule that step must follow. The implementer will not infer it.
- Where the project has tests, put the test step before the code step and say which failure to expect.
- End every step with one Check command and its exact expected result.
- Order steps so each one depends only on earlier ones.

When the file is written, reply with its path, one line per step, and: Run /${BUILD_COMMAND} to implement it.`;

const describePlansToImplement = (planPaths: string[]) =>
  planPaths.length === 1
    ? `Implement the plan at ${planPaths[0]}`
    : `Implement these plans one after another, in this order, finishing each one through its final review before starting the next:\n${planPaths.map((planPath, index) => `${index + 1}. ${planPath}`).join("\n")}\n\nWork through each plan`;

const buildImplementationPrompt = (planPaths: string[]) =>
  `${describePlansToImplement(planPaths)} by coordinating subagents. You coordinate. You do not write code yourself, and you keep your own context small: pass text between agents instead of reading source files.

1. Read the plan. If it is missing or has no steps, stop and say so. Run \`git rev-parse HEAD\` and \`git status --short\`. Record that commit as the base. If files the plan names already have uncommitted changes that this run did not make, stop and ask the user before going on.
2. For each step, in order, call the Agent tool with subagent_type "${IMPLEMENTER_AGENT}". Its prompt is the plan path, the plan's Context section verbatim, and that one step verbatim. Wait for each step before starting the next, because steps build on each other.
3. An implementer replies DONE or BLOCKED. On BLOCKED, call the Agent tool with subagent_type "${REVIEWER_AGENT}", passing the plan path, the step and the implementer's reply, and ask it to unblock the step. Give its replacement steps to new implementers. If a replacement is blocked too, stop and report.
4. When every step is DONE, call the Agent tool with subagent_type "${REVIEWER_AGENT}" for the final review, passing the plan path and the base commit. It replies APPROVED, or FIXES NEEDED with fix steps written in the plan's step format.
5. Give each fix step to a new "${IMPLEMENTER_AGENT}", in order, then ask the reviewer for a final review again. Stop after two rounds of fixes, even if fixes remain.
6. Do not commit. Reply with: the steps done, the reviewer's verdict, any fixes still open, and the output of \`git diff --stat\` against the base.`;

const parseRequestedNumbers = (args: string) =>
  args.split(/[\s,]+/).filter(Boolean);

const resolveRequestedPlanPath = (
  workingDirectory: string,
  requestedPath: string
) => {
  if (requestedPath.startsWith("/")) return requestedPath;
  const isBareFileName = !requestedPath.includes("/");
  return isBareFileName
    ? `${workingDirectory}/${PLANS_FOLDER}/${requestedPath}`
    : `${workingDirectory}/${requestedPath}`;
};

const resolvePlanPaths = async (
  engine: EngineInterface,
  workingDirectory: string,
  requestedPaths: string[]
) => {
  if (requestedPaths.length) {
    return requestedPaths.map((requestedPath) =>
      resolveRequestedPlanPath(workingDirectory, requestedPath)
    );
  }
  const newestPlanPath = await findNewestFile(
    engine,
    `${workingDirectory}/${PLANS_FOLDER}`,
    PLAN_FILE_PATTERN
  );
  return newestPlanPath ? [newestPlanPath] : [];
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "brainstorm",
      description:
        "Brainstorm creative ideas, must-haves and security fixes for this project, shown in the browser",
      argumentHint: "[focus]",
    });
    await $.command.register({
      name: PLAN_COMMAND,
      description:
        "Turn ideas from the newest brainstorm into a step-by-step plan simple enough for a small model",
      argumentHint: "<idea numbers>",
    });
    await $.command.register({
      name: BUILD_COMMAND,
      description:
        "Implement a brainstorm plan: small-model subagents do each step, a strong model reviews the result",
      argumentHint: "[plan file names or paths]",
    });
    await $.tool.register({
      name: TOOL_NAME,
      description:
        "Renders brainstormed project ideas as a self-contained, ADHD-friendly HTML page, saves it under .claude/brainstorm/ and opens it in the browser. Call it once, with every idea, at the end of a /brainstorm.",
      inputSchema: RENDER_TOOL_SCHEMA,
      isDeferred: false,
    });
    return next(e);
  });

  on("command.run", { command: "brainstorm" }, ($, e) => {
    const prompt = buildBrainstormPrompt(e.args.trim());
    $.clock.after(0, () => void $.prompt.submit({ text: prompt }));
    return { text: "Brainstorming improvements for this project…" };
  });

  on("command.run", { command: PLAN_COMMAND }, async ($, e) => {
    const workingDirectory = await $.session.cwd();
    const brainstorm = await loadNewestBrainstorm($, workingDirectory);
    if (!brainstorm) {
      return {
        text: "No saved brainstorm in this project yet. Run /brainstorm first.",
      };
    }
    const requestedNumbers = parseRequestedNumbers(e.args);
    if (!requestedNumbers.length) return { text: listIdeasToPick(brainstorm) };
    const unknownNumbers = requestedNumbers.filter(
      (requested) =>
        !brainstorm.ideas.some((idea) => String(idea.number) === requested)
    );
    if (unknownNumbers.length) {
      return {
        text: `The newest brainstorm has no idea ${unknownNumbers.join(", ")}. Pick numbers from 1 to ${brainstorm.ideas.length}, or run /${PLAN_COMMAND} to list them.`,
      };
    }
    const pickedIdeas = brainstorm.ideas.filter((idea) =>
      requestedNumbers.includes(String(idea.number))
    );
    const planPath = `${workingDirectory}/${PLANS_FOLDER}/plan-${formatFileStamp(await $.clock.now())}.md`;
    const prompt = buildPlanPrompt(pickedIdeas, planPath);
    $.clock.after(0, () => void $.prompt.submit({ text: prompt }));
    const pickedTitles = pickedIdeas
      .map((idea) => `#${idea.number} ${idea.title}`)
      .join(", ");
    return { text: `Planning ${pickedTitles}…` };
  });

  on("command.run", { command: BUILD_COMMAND }, async ($, e) => {
    const workingDirectory = await $.session.cwd();
    const requestedPaths = e.args.split(/\s+/).filter(Boolean);
    const planPaths = await resolvePlanPaths(
      $,
      workingDirectory,
      requestedPaths
    );
    if (!planPaths.length) {
      return {
        text: `No plan found in ${PLANS_FOLDER}. Run /${PLAN_COMMAND} first, or pass a plan's path.`,
      };
    }
    const prompt = buildImplementationPrompt(planPaths);
    $.clock.after(0, () => void $.prompt.submit({ text: prompt }));
    return {
      text: `Building ${planPaths.join(", ")} with small-model implementers and a strong reviewer…`,
    };
  });

  on("tool.call", { tool: QUALIFIED_TOOL_NAME }, async ($, e) => {
    const brainstormReading = readBrainstorm(
      e as unknown as Record<string, unknown>
    );
    if (!brainstormReading.brainstorm)
      return { deny: brainstormReading.failure };
    const pageWrite = await writeBrainstormPage(
      $,
      brainstormReading.brainstorm
    ).catch((error: unknown) => ({ failure: describeError(error) }));
    if (typeof pageWrite !== "string") {
      return {
        deny: `Could not write the brainstorm page: ${pageWrite.failure}`,
      };
    }
    const pagePath = pageWrite;
    const isOpened = await openInBrowser($, pagePath);
    const openOutcome = isOpened
      ? `Opened ${pagePath} in the browser.`
      : `Could not open the browser. The page is saved at ${pagePath}.`;
    return { result: openOutcome };
  });
};
