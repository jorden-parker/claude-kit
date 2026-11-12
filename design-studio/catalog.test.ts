import { expect, test } from "bun:test";
import {
  buildCatalogPrompt,
  listStyleTokens,
  pickDesignMoves,
  pickLook,
  catalog,
  findSpecProblems,
  renderCatalogCss,
  renderSpecToHtml,
  renderStylesheet,
} from "./catalog";
import { readReplySpec } from "./variant-reply";

const THEME_TOKENS = [
  { name: "background", kind: "color", value: "#ffffff" },
  { name: "foreground", kind: "color", value: "#111827" },
  { name: "primary", kind: "color", value: "#0f766e" },
  { name: "primary-foreground", kind: "color", value: "#ffffff" },
  { name: "Font Sans", kind: "font", value: "system-ui, sans-serif" },
  { name: "font-heading", kind: "font", value: "Georgia, serif" },
  { name: "radius", kind: "radius", value: "8px" },
];

const FULL_SPEC = {
  root: "page",
  elements: {
    page: { type: "Page", props: {}, children: ["title", "card"] },
    title: { type: "Heading", props: { text: "Cook <tonight>", level: "1" } },
    card: { type: "Card", props: { tone: "accent" }, children: ["stat"] },
    stat: {
      type: "Stat",
      props: { label: "Recipes", value: "42", detail: "this week" },
    },
  },
};

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/i;

test("renderSpecToHtml renders a full spec as escaped markup", () => {
  const html = renderSpecToHtml(FULL_SPEC);
  expect(html.startsWith('<main class="page look-clean"><div class="page-inner page-wide spacing-normal">')).toBe(true);
  expect(html).toContain('<h1 class="heading heading-1">Cook &lt;tonight&gt;</h1>');
  expect(html).toContain('<section class="card card-accent">');
  expect(html).toContain('<strong class="stat-value">42</strong>');
});

test("renderSpecToHtml renders partial specs without throwing", () => {
  expect(renderSpecToHtml({})).toBe("");
  expect(renderSpecToHtml({ root: "page" })).toBe("");
  expect(renderSpecToHtml({ root: "page", elements: { page: { type: "Page", children: ["later"] } } })).toBe(
    '<main class="page look-clean"><div class="page-inner page-wide spacing-normal"></div></main>'
  );
  expect(renderSpecToHtml({ root: "constructor", elements: {} })).toBe("");
  expect(renderSpecToHtml({ root: "a", elements: { a: null as never } })).toBe("");
  expect(renderSpecToHtml({ root: "a", elements: { a: { type: "Stack", children: ["a"] } } })).toBe(
    '<main class="page look-clean"><div class="page-inner page-wide spacing-normal"></div></main>'
  );
});

test("renderSpecToHtml keeps the valid props of an element when one prop is wrong", () => {
  const html = renderSpecToHtml({
    root: "save",
    elements: { save: { type: "Button", props: { tone: "neon", label: "Save" } } },
  });
  expect(html).toContain('<button type="button" class="button button-secondary">Save</button>');
});

test("renderSpecToHtml reads numbers a model wrote for text options", () => {
  const html = renderSpecToHtml({
    root: "title",
    elements: { title: { type: "Heading", props: { level: 1, text: "Cook" } } },
  });
  expect(html).toContain('<h1 class="heading heading-1">Cook</h1>');
});

test("renderSpecToHtml flattens nested child lists and shows the children of an unknown component", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: [["tabs"], ["title"]] as never },
      tabs: { type: "Tabs", children: ["title"] },
      title: { type: "Heading", props: { text: "Cook" } },
    },
  });
  expect(html.split("Cook")).toHaveLength(3);
});

test("renderSpecToHtml wraps a root that is not a Page in a page", () => {
  expect(
    renderSpecToHtml({ root: "title", elements: { title: { type: "Heading", props: { text: "Cook" } } } })
  ).toBe('<main class="page look-clean"><div class="page-inner page-wide spacing-normal"><h2 class="heading heading-2">Cook</h2></div></main>');
});

test("renderSpecToHtml draws a chart as bars sized by their values and a table with its rows", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["chart", "table"] },
      chart: { type: "Chart", props: { title: "Revenue", labels: ["Jan", "Feb"], values: [50, 100] } },
      table: { type: "Table", props: { columns: ["Plan", "Seats"], rows: [["Pro", 12]] } },
    },
  });
  expect(html).toContain('style="height:50%"');
  expect(html).toContain('style="height:100%"');
  expect(html).toContain("<th scope=\"col\">Plan</th>");
  expect(html).toContain("<td>12</td>");
});

test("findSpecProblems accepts a full spec and small slips, and refuses a spec that shows next to nothing", () => {
  expect(findSpecProblems(FULL_SPEC)).toEqual([]);
  expect(
    findSpecProblems({
      ...FULL_SPEC,
      elements: { ...FULL_SPEC.elements, title: { type: "Heading", props: { level: "9", text: "Cook" } } },
    })
  ).toEqual([]);
  expect(findSpecProblems({ root: "page" })).toContainEqual(expect.stringContaining("/root"));
  expect(findSpecProblems({})).toContainEqual(expect.stringContaining("/root"));
  expect(
    findSpecProblems({ root: "page", elements: { page: { type: "Page", children: ["ghost"] } } })
  ).toContainEqual(expect.stringContaining("only 1"));
});

test("renderCatalogCss styles with the theme's variables and no raw colors", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  expect(css).toContain("var(--primary)");
  expect(css).toContain("var(--font-heading)");
  expect(css).toContain("var(--radius)");
  expect(css).not.toMatch(RAW_COLOR);
});

test("renderCatalogCss falls back to keywords for the roles the theme lacks", () => {
  const css = renderCatalogCss([{ name: "ink", kind: "color", value: "#111827" }]);
  expect(css).not.toContain("var(--primary)");
    expect(css).not.toMatch(RAW_COLOR);
});

test("renderStylesheet puts the theme tokens on :root before the catalog styles", () => {
  const stylesheet = renderStylesheet(THEME_TOKENS);
  expect(stylesheet.startsWith(":root{--background:#ffffff;--foreground:#111827;")).toBe(true);
  expect(stylesheet).toContain("--font-sans:system-ui, sans-serif");
  expect(stylesheet).toContain(renderCatalogCss(THEME_TOKENS));
});

test("the catalog holds the layout, content and data components", () => {
  expect(catalog.componentNames).toHaveLength(34);
  expect(catalog.componentNames).toContain("Chart");
});

test("buildCatalogPrompt lists the components and the reply shape, without json-render's state features", () => {
  const prompt = buildCatalogPrompt(THEME_TOKENS);
  expect(prompt).toContain("- Chart: {");
  expect(prompt).toContain("NAME: <two to four words>");
  expect(prompt).toContain('{"op":"add","path":"/root","value":"page"}');
  expect(prompt).toContain("primary, primary-foreground");
  expect(prompt).not.toContain("$state");
  expect(prompt).not.toContain("```");
  expect(prompt.length).toBeLessThan(16000);
});

test("the example spec in the prompt renders with no problems", () => {
  const exampleSpec = readReplySpec(buildCatalogPrompt(THEME_TOKENS).split("EXAMPLE")[1]!);
  expect(findSpecProblems(exampleSpec)).toEqual([]);
  expect(renderSpecToHtml(exampleSpec)).toContain("</table>");
});

test("renderSpecToHtml reads props a model wrote beside the type", () => {
  const looseSpec = {
    root: "title",
    elements: { title: { type: "Heading", level: "1", text: "Cook tonight", children: [] } },
  };
  expect(renderSpecToHtml(looseSpec)).toContain('<h1 class="heading heading-1">Cook tonight</h1>');
});

test("renderSpecToHtml leaves out a container that has nothing to show", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["empty-card", "title"] },
      "empty-card": { type: "Card", children: ["ghost"] },
      title: { type: "Heading", props: { text: "Cook" } },
    },
  });
  expect(html).not.toContain("card");
  expect(html).toContain("Cook");
});

test("renderSpecToHtml draws a hero with its actions and a plan with its features", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["hero", "plan"] },
      hero: { type: "Hero", props: { title: "Cook tonight", text: "Dinner in 20 minutes.", primaryAction: "Start" } },
      plan: {
        type: "Plan",
        props: { name: "Team", price: "$12", period: "per seat", features: ["Shared lists"], action: "Choose Team", badge: "Most popular" },
      },
    },
  });
  expect(html).toContain('<h1 class="heading heading-1">Cook tonight</h1>');
  expect(html).toContain('<button type="button" class="button button-primary">Start</button>');
  expect(html).not.toContain("button-secondary");
  expect(html).toContain('<section class="card plan card-accent">');
  expect(html).toContain('<span class="badge badge-accent">Most popular</span>');
  expect(html).toContain('<strong class="plan-price">$12</strong>');
  expect(html).toContain("<li class=\"list-item\"><span>Shared lists</span>");
});

test("renderSpecToHtml reads true and false a model wrote as text", () => {
  const html = renderSpecToHtml({
    root: "alerts",
    elements: { alerts: { type: "Toggle", props: { label: "Alerts", checked: "true" } } },
  });
  expect(html).toContain(" checked>");
});

test("renderSpecToHtml marks the page with the look it is given", () => {
  expect(renderSpecToHtml(FULL_SPEC, "sharp").startsWith('<main class="page look-sharp">')).toBe(true);
});

test("renderCatalogCss styles every look with the theme's variables only", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  for (const look of ["bold", "sharp", "editorial", "soft"]) expect(css).toContain(`.look-${look} `);
  expect(css).not.toMatch(RAW_COLOR);
});

test("pickLook follows a distinctive style, spreads plain styles over the looks, and gives each variant its own", () => {
  expect(pickLook("Brutalism raw, bold borders", "Recipe onboarding", 0)).toBe("sharp");
  expect(pickLook("Editorial magazine", "Recipe onboarding", 0)).toBe("editorial");
  const plainLooks = ["Recipe onboarding", "Bank login", "Pricing page", "Team admin", "Dog walking landing", "Checkout"].map(
    (brief) => pickLook("Minimalism clean", brief, 0)
  );
  expect(new Set(plainLooks).size).toBeGreaterThan(2);
  const variantLooks = [0, 1, 2, 3].map((variantIndex) => pickLook("Minimalism clean", "Recipe onboarding", variantIndex));
  expect(new Set(variantLooks).size).toBe(4);
});

test("listStyleTokens restyles the theme's heading font for a look that has its own, and nothing else", () => {
  expect(listStyleTokens(FULL_SPEC, "editorial", THEME_TOKENS)).toEqual([
    { name: "font-heading", value: expect.stringContaining("serif") },
  ]);
  expect(listStyleTokens(FULL_SPEC, "clean", THEME_TOKENS)).toEqual([]);
  expect(listStyleTokens(FULL_SPEC, "editorial", [{ name: "primary", kind: "color", value: "#123456" }])).toEqual([]);
});

test("the look, heading font and corners a model sets on the Page win over the studio's fallback", () => {
  const styledSpec = {
    root: "page",
    elements: {
      page: { type: "Page", props: { look: "soft", headingFont: "mono", corners: "square" }, children: ["title"] },
      title: { type: "Heading", props: { text: "Cook" } },
    },
  };
  expect(renderSpecToHtml(styledSpec, "editorial").startsWith('<main class="page look-soft corners-square">')).toBe(true);
  expect(listStyleTokens(styledSpec, "editorial", THEME_TOKENS)).toEqual([
    { name: "font-heading", value: expect.stringContaining("monospace") },
  ]);
});

test("renderSpecToHtml splits a hero that has a picture into copy and image", () => {
  const html = renderSpecToHtml({
    root: "hero",
    elements: { hero: { type: "Hero", props: { title: "Cook tonight", image: "A pan of shakshuka" } } },
  });
  expect(html).toContain('<header class="hero hero-split hero-image-right">');
  expect(html).toContain('aria-label="A pan of shakshuka"');
});

test("renderSpecToHtml draws the layout pieces: a section band, split columns, a banner, a quote, steps and features", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["how", "split", "banner"] },
      how: { type: "Section", props: { title: "How it works", tone: "muted" }, children: ["steps"] },
      steps: { type: "Steps", children: ["step-one"] },
      "step-one": { type: "Step", props: { title: "Pick a recipe", text: "From 200 dinners." } },
      split: { type: "Split", props: { ratio: "wide-left" }, children: ["feature", "quote"] },
      feature: { type: "Feature", props: { icon: "clock", title: "Fast", text: "20 minutes." } },
      quote: { type: "Quote", props: { text: "Dinner is solved.", name: "Dana Ortiz", role: "Home cook" } },
      banner: { type: "Banner", props: { title: "Cook tonight", text: "Free for a month.", action: "Start" } },
    },
  });
  expect(html).toContain('<section class="section section-muted section-start">');
  expect(html).toContain('<h2 class="heading heading-2">How it works</h2>');
  expect(html).toContain('<ol class="steps"><li class="step">');
  expect(html).toContain('<div class="split split-wide-left items-start">');
  expect(html).toContain('<div class="feature"><span class="feature-icon"><svg');
  expect(html).toContain("<blockquote class=\"quote\"><p>Dinner is solved.</p>");
  expect(html).toContain('<aside class="banner banner-accent">');
});

test("renderSpecToHtml lets a card span two columns of a grid", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["grid"] },
      grid: { type: "Grid", children: ["big"] },
      big: { type: "Card", props: { span: "2" }, children: ["title"] },
      title: { type: "Heading", props: { text: "Cook" } },
    },
  });
  expect(html).toContain('<section class="span-2 card card-plain">');
});

test("renderSpecToHtml places any element with the span, place, text align and width a model gives it", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", props: { spacing: "airy" }, children: ["title"] },
      title: { type: "Heading", props: { text: "Cook", rowSpan: "2", place: "end", textAlign: "center", maxWidth: "md" } },
    },
  });
  expect(html).toContain('<h2 class="row-span-2 place-end text-align-center max-width-md heading heading-2">Cook</h2>');
  expect(html).toContain("spacing-airy");
});

test("renderSpecToHtml draws a logo mark from the shape and the letter or icon a model picks", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["nav", "logo", "plain"] },
      nav: { type: "Nav", props: { brand: "Paw & Path", logo: "hexagon", logoIcon: "leaf" } },
      logo: { type: "Logo", props: { name: "Ember", shape: "diamond", tagline: "Small batch coffee" } },
      plain: { type: "Nav", props: { brand: "Plain" } },
    },
  });
  expect(html).toContain('<span class="nav-brand"><svg class="logo-mark logo-hexagon"');
  expect(html).toContain('<path d="M5 19c0-8');
  expect(html).toContain('<div class="logo logo-md"><svg class="logo-mark logo-diamond"');
  expect(html).toContain('<text class="logo-letter" x="20" y="21" text-anchor="middle" dominant-baseline="central">E</text>');
  expect(html).toContain('<span class="logo-tagline">Small batch coffee</span>');
  expect(html).toContain('<span class="nav-brand">Plain</span>');
});

test("renderSpecToHtml draws generated artwork for an image or a hero when a model names an art", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["hero", "art", "photo"] },
      hero: { type: "Hero", props: { title: "Cook", image: "Hills at dawn", imageArt: "hills" } },
      art: { type: "Image", props: { alt: "Sound waves", art: "waves", ratio: "square" } },
      photo: { type: "Image", props: { alt: "A loaf", art: "nonsense" } },
    },
  });
  expect(html).toContain('<div class="image image-art ratio-wide" role="img" aria-label="Hills at dawn"><svg class="graphic art-hills"');
  expect(html).toContain('<div class="image image-art ratio-square" role="img" aria-label="Sound waves"><svg class="graphic art-waves"');
  expect(html).toContain('<div class="image ratio-wide" role="img" aria-label="A loaf"><svg viewBox="0 0 24 24"');
});

test("renderSpecToHtml draws a graphic from the shapes a model places, and forgives bad shape values", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["drawing"] },
      drawing: {
        type: "Graphic",
        props: {
          alt: "A record",
          background: "accent",
          ratio: "square",
          shapes: [
            { shape: "circle", x: 50, y: 50, size: 80, tone: "ink" },
            { shape: "ring", x: "50", y: 50, size: 40, tone: "surface", rotate: 30 },
            { shape: "spiral", x: 900, tone: "pink" },
            "oops",
          ],
        },
      },
    },
  });
  expect(html).toContain('<div class="image image-art graphic-accent ratio-square" role="img" aria-label="A record"><svg class="graphic" viewBox="0 0 100 100"');
  expect(html).toContain('<g transform="translate(50 50) rotate(0)" class="tone-ink"><circle r="40"/></g>');
  expect(html).toContain('<g transform="translate(50 50) rotate(30)" class="tone-surface outline"><circle r="20" stroke-width="5"/></g>');
  expect(html).toContain('<g transform="translate(50 50) rotate(0)" class="tone-accent"><circle r="15"/></g>');
  expect(html.match(/<g /g)).toHaveLength(3);
});

test("renderSpecToHtml draws a standalone icon, and a known icon for an unknown name", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["icon", "unknown"] },
      icon: { type: "Icon", props: { icon: "bolt", size: "lg", tone: "accent" } },
      unknown: { type: "Feature", props: { icon: "no-such-icon", title: "Fast" } },
    },
  });
  expect(html).toContain('<span class="icon icon-lg icon-accent"><svg');
  expect(html).toContain('<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>');
  expect(html).toContain('<span class="feature-icon"><svg');
  expect(html).toContain('<path d="M5 12l5 5 9-10"/>');
});

test("the stylesheet colors drawn shapes from the theme, and the prompt lists the icons once", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  expect(css).toContain(".graphic .tone-accent{");
  expect(css).toContain(".graphic .outline{fill:none}");
  const prompt = buildCatalogPrompt(THEME_TOKENS);
  expect(prompt.match(/ICONS: check, star/g)).toHaveLength(1);
  expect(prompt).toContain("ARTWORK");
});

test("pickDesignMoves draws a mood, an opening, a body and an asset idea, and differs with the numbers drawn", () => {
  const firstMoves = pickDesignMoves(() => 0);
  const lastMoves = pickDesignMoves(() => 0.99);
  expect(firstMoves.split("\n")).toHaveLength(6);
  expect(firstMoves).toContain("- Header: ");
  expect(firstMoves).toContain("- Mood: ");
  expect(firstMoves).toContain("- Opening: ");
  expect(firstMoves).toContain("- Body: ");
  expect(firstMoves).toContain("- Artwork: ");
  const sharedLines = firstMoves.split("\n").slice(1).filter((line) => lastMoves.includes(line));
  expect(sharedLines).toEqual([]);
});

test("the example in the prompt sets no look, font or corners, so a model does not copy them", () => {
  const exampleText = buildCatalogPrompt(THEME_TOKENS).split("EXAMPLE of the format")[1]!;
  expect(exampleText).not.toContain('"look"');
  expect(exampleText).not.toContain('"headingFont"');
  expect(exampleText).not.toContain('"corners"');
});

test("renderSpecToHtml shows no caption for a picture a model described with a link", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", children: ["photo"] },
      photo: { type: "Image", props: { alt: "https://images.example.com/photo-1?w=2600" } },
    },
  });
  expect(html).not.toContain("images.example.com");
  expect(html).toContain('aria-label="Picture"');
});

test("a narrow page widens when a model fills it with a nav, hero, grid or split", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  expect(css).toContain(".page-narrow:has(.nav,.hero,.grid,.split,.section){max-width:1120px}");
  expect(css).toContain(".page-inner>.image-art{max-height:280px}");
  expect(pickDesignMoves(() => 0.7)).not.toContain("narrow centered column");
});

test("a picture beside text stays a sensible height, and details on a filled card stay readable", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  expect(css).toContain(".hero-split .image,.split .image{max-height:420px}");
  expect(css).toContain(".look-bold .card-accent .list-detail");
});

test("renderSpecToHtml shows a block once when a model wrote the same block again beside it", () => {
  const html = renderSpecToHtml({
    root: "page",
    elements: {
      page: { type: "Page", props: {}, children: ["grid", "stars"] },
      grid: { type: "Grid", props: {}, children: ["first", "second", "third"] },
      first: { type: "Card", props: {}, children: ["firstTitle"] },
      second: { type: "Card", props: {}, children: ["secondTitle"] },
      third: { type: "Card", props: {}, children: ["thirdTitle"] },
      firstTitle: { type: "Heading", props: { text: "Open Mic Night" } },
      secondTitle: { type: "Heading", props: { text: "Open Mic Night" } },
      thirdTitle: { type: "Heading", props: { text: "Jazz Brunch" } },
      stars: { type: "Row", props: {}, children: ["firstStar", "secondStar"] },
      firstStar: { type: "Icon", props: { icon: "star" } },
      secondStar: { type: "Icon", props: { icon: "star" } },
    },
  });
  expect(html.split("Open Mic Night")).toHaveLength(2);
  expect(html).toContain("Jazz Brunch");
  expect(html.split('class="icon').length).toBe(3);
});

test("the moods between them name every look, so a model is steered to all of them", () => {
  const moods = Array.from({ length: 50 }, (_, drawIndex) => pickDesignMoves(() => drawIndex / 50).split("\n")[1]!);
  for (const look of ["clean", "bold", "sharp", "editorial", "soft"]) {
    expect(moods.some((mood) => mood.includes(`look "${look}"`))).toBe(true);
  }
  for (const corners of ["square", "rounded", "pill"]) {
    expect(moods.some((mood) => mood.includes(`corners "${corners}"`))).toBe(true);
  }
});

const renderOne = (type: string, props: Record<string, unknown>) =>
  renderSpecToHtml({ root: "only", elements: { only: { type, props } } });

test("a model shapes the Nav: its layout, its style, its links and the size of the brand", () => {
  const html = renderOne("Nav", {
    brand: "Loaf",
    items: ["Menu"],
    layout: "split",
    style: "floating",
    links: "pill",
    brandSize: "xl",
  });
  expect(html).toContain('<nav class="nav nav-split nav-style-floating nav-links-pill">');
  expect(html).toContain('<span class="nav-brand nav-brand-xl">');
  expect(renderOne("Nav", { brand: "Loaf" })).toContain('<nav class="nav nav-spread"><span class="nav-brand">');
  for (const layout of ["stacked", "left"]) expect(renderOne("Nav", { layout })).toContain(`nav-${layout}`);
});

test("a model shapes a Heading: its size, weight and style, and a small label above it", () => {
  const html = renderOne("Heading", { text: "Fresh daily", size: "xl", weight: "light", style: "bar", eyebrow: "Our bread" });
  expect(html).toContain(
    '<p class="eyebrow">Our bread</p><h2 class="heading heading-2 heading-style-bar heading-size-xl heading-weight-light">Fresh daily</h2>'
  );
});

test("a model shapes the Hero: its tone, the size and style of its title, and a picture above or below", () => {
  const html = renderOne("Hero", {
    title: "Bread at seven",
    tone: "muted",
    titleSize: "xl",
    titleStyle: "uppercase",
    image: "A loaf",
    imageSide: "below",
  });
  expect(html).toContain('<header class="hero hero-split hero-image-below hero-tone-muted">');
  expect(html).toContain('<h1 class="heading heading-1 heading-style-uppercase heading-size-xl">');
  expect(renderOne("Hero", { title: "Bread", align: "end", tone: "accent" })).toContain('class="hero hero-end hero-tone-accent"');
});

test("a model shapes a Section: a label above the title, the title's style, and the title beside the content", () => {
  const html = renderSpecToHtml({
    root: "band",
    elements: {
      band: { type: "Section", props: { title: "Events", eyebrow: "02", titleStyle: "underline", layout: "side" }, children: ["note"] },
      note: { type: "Text", props: { text: "Readings every Friday." } },
    },
  });
  expect(html).toContain(
    '<section class="section section-plain section-start section-side"><div class="section-header"><p class="eyebrow">02</p><h2 class="heading heading-2 heading-style-underline">Events</h2></div><div class="section-body">'
  );
  expect(renderOne("Banner", { title: "Join", layout: "centered", titleStyle: "accent" })).toContain(
    '<aside class="banner banner-accent banner-centered">'
  );
});

test("the stylesheet styles every header and title option, and the prompt tells a model to use them", () => {
  const css = renderCatalogCss(THEME_TOKENS);
  for (const selector of [
    ".nav-stacked{", ".nav-split{", ".nav-left .button{", ".nav-style-filled{", ".nav-style-boxed{", ".nav-style-floating{",
    ".nav-links-underline a{", ".nav-links-pill a{", ".nav-links-uppercase a{", ".nav-brand-xl{",
    ".heading-size-xl{", ".heading-weight-black{", ".heading-style-bar{", ".heading-style-underline{", ".eyebrow{",
    ".hero>.badge{align-self:auto}", ".hero-end{", ".hero-image-below", ".hero-tone-outline{", ".section-side{", ".banner-centered{",
  ]) {
    expect(css).toContain(selector);
  }
  expect(buildCatalogPrompt(THEME_TOKENS)).toContain("HEADERS AND TITLES");
});

test("the icons cover real subjects, so a bakery, a bookshop or a bike shop gets its own picture", () => {
  const fallbackIcon = renderOne("Icon", { icon: "no-such-icon" });
  for (const icon of ["bread", "coffee", "book", "bike", "mountain", "music", "home", "camera", "cart", "dumbbell", "mic", "tree"]) {
    expect(renderOne("Icon", { icon })).not.toBe(fallbackIcon);
    expect(buildCatalogPrompt(THEME_TOKENS)).toContain(`, ${icon}`);
  }
});

test("a logo is by default its icon alone, and a geometric shape around it stays a choice", () => {
  const plainLogo = renderOne("Logo", { name: "Loaf", icon: "bread" });
  expect(plainLogo).toContain('<svg class="logo-mark logo-plain"');
  expect(plainLogo).toContain("M5 11a4 4");
  expect(renderOne("Logo", { name: "Loaf", icon: "bread", shape: "hexagon" })).toContain("logo-hexagon");
  expect(renderOne("Nav", { brand: "Loaf", logo: "plain", logoIcon: "bread" })).toContain("logo-plain");
  expect(renderCatalogCss(THEME_TOKENS)).toContain(".logo-plain .logo-icon{");
});

test("an icon name works as a picture's art and as a shape of a Graphic", () => {
  const picture = renderOne("Image", { alt: "A loaf", art: "bread" });
  expect(picture).toContain('<svg class="graphic art-icon"');
  expect(picture).toContain("M5 11a4 4");
  expect(renderOne("Hero", { title: "Bread", image: "A loaf", imageArt: "bread" })).toContain("art-icon");
  const graphic = renderOne("Graphic", { alt: "Ride", shapes: [{ shape: "bike", x: 50, y: 50, size: 60 }, { shape: "no-such-shape" }] });
  expect(graphic).toContain('class="tone-accent outline"><g transform="scale(2.5) translate(-12 -12)"');
  expect(graphic).toContain('<circle r="15"/>');
});

test("the prompt asks for pictures of the subject, with geometric shapes as one choice among them", () => {
  const prompt = buildCatalogPrompt(THEME_TOKENS);
  expect(prompt).toContain("show what this product is");
  expect(prompt).not.toContain("a ring around a star");
  const artworkIdeas = Array.from({ length: 40 }, (_, drawIndex) => pickDesignMoves(() => drawIndex / 40).split("\n").at(-1)!);
  expect(artworkIdeas.filter((idea) => /subject|product/.test(idea)).length).toBe(artworkIdeas.length);
});

test("renderSpecToHtml shows a plan once when a model wrote the same plan again, even with another highlight", () => {
  const starter = { name: "Starter", price: "$0", features: ["SSO", "Audit logs"], action: "Get started" };
  const html = renderSpecToHtml({
    root: "grid",
    elements: {
      grid: { type: "Grid", props: {}, children: ["first", "second", "pro"] },
      first: { type: "Plan", props: starter },
      second: { type: "Plan", props: { ...starter, featured: true } },
      pro: { type: "Plan", props: { ...starter, name: "Pro", price: "$12" } },
    },
  });
  expect(html.split("Starter")).toHaveLength(2);
  expect(html).toContain("Pro");
});

test("an icon is found by a common other name for it", () => {
  expect(renderOne("Icon", { icon: "microphone" })).toBe(renderOne("Icon", { icon: "mic" }));
  expect(renderOne("Logo", { name: "Spoke", icon: "Bicycle" })).toBe(renderOne("Logo", { name: "Spoke", icon: "bike" }));
  expect(renderOne("Image", { alt: "Dog", art: "dog" })).toContain("art-icon");
});
