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

const renderIdeaCard = (idea: Idea, cardKey: string) => {
  const category = CATEGORIES[idea.category];
  return `<article class="card cat-${idea.category}" data-category="${idea.category}" data-card="${cardKey}">
  <div class="card-top">
    <span class="tag">${category.emoji} ${category.label}</span>
    <span class="effort">${EFFORTS[idea.effort].label}</span>
  </div>
  <h3>${escapeHtml(idea.title)}</h3>
  <p class="next"><strong>👉 Next step:</strong> ${escapeHtml(idea.nextStep)}</p>
  ${renderWhy(idea.why)}
  ${renderFiles(idea.files)}
  <label class="done"><input type="checkbox" data-done="${cardKey}"> Done</label>
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

const renderPrioritySection = (priority: Priority, ideas: Idea[]) => {
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
.done{margin-top:auto;font-size:.92rem;color:var(--muted);cursor:pointer}
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
  refreshProgress();
})();
`;

const renderBrainstormPage = ({ project, summary, ideas }: Brainstorm) => {
  const sortedIdeas = [...ideas].sort(compareUrgency);
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
  const pagePath = `${brainstormFolder}/brainstorm-${formatFileStamp(await engine.clock.now())}.html`;
  await engine.fs.write(`${brainstormFolder}/.gitignore`, "*\n");
  await engine.fs.write(pagePath, renderBrainstormPage(brainstorm));
  return pagePath;
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
