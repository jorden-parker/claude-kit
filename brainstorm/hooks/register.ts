import type { EngineInterface, Register } from "claude-code";

const TOOL_NAME = "render_brainstorm";
const QUALIFIED_TOOL_NAME = `mcp__brainstorm__${TOOL_NAME}`;
const BRAINSTORM_FOLDER = ".claude/brainstorm";
const START_HERE_COUNT = 3;

const CATEGORIES = {
  security: { label: "Security", tone: "red", rank: 0 },
  "must-have": { label: "Must-have", tone: "amber", rank: 1 },
  "quick-win": { label: "Quick win", tone: "green", rank: 2 },
  performance: { label: "Performance", tone: "blue", rank: 3 },
  "developer-experience": { label: "Dev experience", tone: "teal", rank: 4 },
  creative: { label: "Creative", tone: "purple", rank: 5 },
  moonshot: { label: "Moonshot", tone: "pink", rank: 6 },
} as const;

const PRIORITIES = {
  now: { label: "Do now", rank: 0 },
  next: { label: "Next up", rank: 1 },
  later: { label: "Later", rank: 2 },
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

const renderCategoryBadge = (category: Category) =>
  `<span class="badge"><span class="dot tone-${CATEGORIES[category].tone}"></span>${CATEGORIES[category].label}</span>`;

const renderIdeaCard = (idea: NumberedIdea, cardKey: string) =>
  `<article class="card" data-category="${idea.category}" data-card="${cardKey}">
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
    <label class="toggle"><input type="checkbox" data-done="${cardKey}"> Done</label>
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
  const cards = matchingIdeas
    .map((idea) => renderIdeaCard(idea, `${priority}-${ideas.indexOf(idea)}`))
    .join("\n");
  return `<section class="priority"><h2>${PRIORITIES[priority].label} <span class="count">${matchingIdeas.length}</span></h2><div class="grid">${cards}</div></section>`;
};

const renderStats = (ideas: NumberedIdea[]) => {
  const countByPriority = (priority: Priority) =>
    ideas.filter((idea) => idea.priority === priority).length;
  const statCells = [
    ["Ideas", String(ideas.length)],
    [PRIORITIES.now.label, String(countByPriority("now"))],
    [PRIORITIES.next.label, String(countByPriority("next"))],
    [PRIORITIES.later.label, String(countByPriority("later"))],
  ]
    .map(
      ([statLabel, statValue]) =>
        `<div class="stat"><span class="muted">${statLabel}</span><strong>${statValue}</strong></div>`
    )
    .join("");
  return `<section class="stats">${statCells}<div class="stat"><span class="muted">Progress <button type="button" id="reset-done" class="link">Reset</button></span><strong class="progress-label"></strong><div class="progress"><div></div></div></div></section>`;
};

const renderToolbar = (ideas: Idea[]) => {
  const presentCategories = (Object.keys(CATEGORIES) as Category[]).filter(
    (category) => ideas.some((idea) => idea.category === category)
  );
  const categoryTabs = presentCategories
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
    if (pickedNumbers.length === planCheckboxes.length) return "all";
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
    planCommand.textContent = "/brainstorm-plan " + describePicks(pickedNumbers);
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

const listMatchingFiles = async (
  engine: EngineInterface,
  folder: string,
  fileNamePattern: RegExp
) => {
  const entries = await engine.fs.list(folder).catch(() => []);
  return entries
    .filter(
      (entry) => entry.kind === "file" && fileNamePattern.test(entry.name)
    )
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => `${folder}/${fileName}`);
};

const findNewestFile = async (
  engine: EngineInterface,
  folder: string,
  fileNamePattern: RegExp
) => (await listMatchingFiles(engine, folder, fileNamePattern)).at(-1);

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

const listPresentCategories = (ideas: Idea[]) =>
  (Object.keys(CATEGORIES) as Category[]).filter((category) =>
    ideas.some((idea) => idea.category === category)
  );

const listIdeasToPick = (brainstorm: SavedBrainstorm) => {
  const presentCategories = listPresentCategories(brainstorm.ideas);
  return [
    `Pick ideas by number or range, for example /${PLAN_COMMAND} 1 3 or /${PLAN_COMMAND} 2-5. /${PLAN_COMMAND} all picks every idea, and a category such as /${PLAN_COMMAND} ${presentCategories[0]} picks its ideas. Categories: ${presentCategories.join(", ")}.`,
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

<Commands the reviewer numberRanges on the finished work, each with its expected result.>

## Out of scope

<What the implementers must not touch.>`;

const listPickedNumbers = (pickedIdeas: NumberedIdea[]) => {
  const pickedNumbers = pickedIdeas.map((idea) => `#${idea.number}`);
  if (pickedNumbers.length < 2) return pickedNumbers.join("");
  return `${pickedNumbers.slice(0, -1).join(", ")} and ${pickedNumbers.at(-1)}`;
};

const buildPlanPrompt = (pickedIdeas: NumberedIdea[], planPath: string) =>
  `Write an implementation plan for these ideas from the project's brainstorm. Do not implement anything.

The user picked ideas ${listPickedNumbers(pickedIdeas)} on the brainstorm page and ran /${PLAN_COMMAND} with those numbers. Claude Code does not show a plugin command's arguments, so the numbers are listed here. Plan every picked idea. Do not ask the user to narrow the selection. If the ideas are too many for one plan, keep each step small and let the plan run long.

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

const ALL_KEYWORD = "all";
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
  if (normalizedPick in CATEGORIES) {
    return listIdeaNumbers(
      ideas.filter((idea) => idea.category === normalizedPick)
    );
  }
  const rangeMatch = NUMBER_RANGE_PATTERN.exec(pick);
  if (rangeMatch) return expandNumberRange(ideas, rangeMatch);
  return listIdeaNumbers(ideas.filter((idea) => String(idea.number) === pick));
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
  if (requestedPaths.length === 1 && requestedPaths[0] === ALL_KEYWORD) {
    return listMatchingFiles(
      engine,
      `${workingDirectory}/${PLANS_FOLDER}`,
      PLAN_FILE_PATTERN
    );
  }
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
      argumentHint: "<idea numbers, ranges, a category, or all>",
    });
    await $.command.register({
      name: BUILD_COMMAND,
      description:
        "Implement a brainstorm plan: small-model subagents do each step, a strong model reviews the result",
      argumentHint: "[plan file names or paths, or all]",
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
    const requestedPicks = parseRequestedPicks(e.args);
    if (!requestedPicks.length) return { text: listIdeasToPick(brainstorm) };
    const { pickedIdeas, unknownPicks } = resolvePicks(
      brainstorm.ideas,
      requestedPicks
    );
    if (unknownPicks.length) {
      return {
        text: `The newest brainstorm has no idea ${unknownPicks.join(", ")}. Pick numbers from 1 to ${brainstorm.ideas.length}, a range such as 2-5, a category (${listPresentCategories(brainstorm.ideas).join(", ")}) or ${ALL_KEYWORD}. Run /${PLAN_COMMAND} to list them.`,
      };
    }
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
