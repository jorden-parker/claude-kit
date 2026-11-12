import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { startPlugin, TARGET_NAMES, type TargetName } from "../testing";

const DESIGN_FOLDER = ".claude/ui-design";
const THEME_TOOL = "save_design_theme";
const DESIGN_TOOL = "render_design";
const AUDIT_TOOL = "render_design_audit";
const SKILL_PATH = ["skills", "ui-design", "SKILL.md"];

const PROJECT_FILES: Record<string, string> = {
  "src/app/globals.css":
    ":root{\n--primary: #2563EB;\n--font-sans: Inter, sans-serif;\n}",
  "src/ui/button.tsx":
    'const buttonStyle = { color: "#2563eb", background: "#f0f" };',
};

const THEME_INPUT = {
  tokens: [
    {
      name: "primary",
      kind: "color",
      value: "#2563eb",
      source: "src/app/globals.css:2",
    },
    {
      name: "font-sans",
      kind: "font",
      value: "Inter, sans-serif",
      source: "src/app/globals.css:3",
    },
  ],
  components: [
    { name: "Button", path: "src/ui/button.tsx", variants: ["primary"] },
  ],
};

const FIRST_VARIANT = {
  name: "Single card",
  rationale: "One centered card.",
  html: '<main class="page">Order #123</main>',
  css: ".page{font-family:var(--font-sans);color:var(--primary)}",
  kept: ["Every field"],
  changed: ["The sidebar is gone"],
};

const DESIGN_INPUT = {
  project: "acme-notes",
  mode: "redesign",
  subject: "src/app/settings/page.tsx",
  variants: [FIRST_VARIANT, { ...FIRST_VARIANT, name: "Two columns" }],
};

const AUDIT_INPUT = {
  project: "acme-notes",
  files: ["src/ui/button.tsx", "src/app/globals.css"],
  findings: [
    {
      category: "typography",
      severity: "warning",
      title: "Three heading sizes",
      detail: "Page titles use 24px, 28px and 32px.",
      fix: "Pick one size for page titles.",
      file: "src/ui/button.tsx",
      line: 1,
    },
  ],
};

const startProject = async (target: TargetName) => {
  const plugin = await startPlugin(target, "ui-design");
  for (const [relativePath, text] of Object.entries(PROJECT_FILES)) {
    const filePath = join(plugin.workingDirectory, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, text);
  }
  return plugin;
};

const listDesignFiles = (
  workingDirectory: string,
  prefix: string,
  extension: string
) =>
  readdir(join(workingDirectory, DESIGN_FOLDER))
    .then((fileNames) =>
      fileNames.filter(
        (fileName) =>
          fileName.startsWith(`${prefix}-`) && fileName.endsWith(extension)
      )
    )
    .catch(() => []);

const openedPagePath = (replyText: string) => {
  const pagePath = replyText.match(/^Opened (.+?) in the browser\./)?.[1];
  expect(pagePath).toBeDefined();
  return pagePath!;
};

for (const target of TARGET_NAMES) {
  test(`${target}: save_design_theme saves the theme and opens nothing`, async () => {
    const plugin = await startProject(target);
    try {
      const reply = await plugin.callTool(THEME_TOOL, THEME_INPUT);

      expect(reply).toMatchObject({ isError: false });
      expect(reply.text).toMatch(/^Saved 2 tokens to .+theme\.json\.$/);
      const savedTheme = JSON.parse(
        await readFile(
          join(plugin.workingDirectory, DESIGN_FOLDER, "theme.json"),
          "utf8"
        )
      );
      expect(savedTheme.tokens.map((token: { name: string }) => token.name))
        .toEqual(["primary", "font-sans"]);
      expect(
        await readFile(join(plugin.workingDirectory, DESIGN_FOLDER, ".gitignore"), "utf8")
      ).toBe("*\n");
      expect(await plugin.readCommandLog()).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: save_design_theme refuses a token whose source file is missing and saves nothing`, async () => {
    const plugin = await startProject(target);
    try {
      const reply = await plugin.callTool(THEME_TOOL, {
        tokens: [
          {
            name: "ghost",
            kind: "color",
            value: "#000000",
            source: "src/app/missing.css:1",
          },
        ],
      });

      expect(reply).toMatchObject({ isError: true });
      expect(reply.text).toContain(
        'Token "ghost": src/app/missing.css does not exist.'
      );
      expect(existsSync(join(plugin.workingDirectory, DESIGN_FOLDER, "theme.json")))
        .toBe(false);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_design writes the design page, saves its json and opens the page`, async () => {
    const plugin = await startProject(target);
    try {
      await plugin.callTool(THEME_TOOL, THEME_INPUT);

      const reply = await plugin.callTool(DESIGN_TOOL, DESIGN_INPUT);

      expect(reply).toMatchObject({ isError: false });
      const pagePath = openedPagePath(reply.text);
      expect(existsSync(pagePath)).toBe(true);
      const pageText = await readFile(pagePath, "utf8");
      expect(pageText).toContain('<p class="eyebrow">Redesign</p>');
      expect(pageText).toContain("--primary:#2563eb");
      expect(pageText).toContain("Single card");
      const [savedJsonName] = await listDesignFiles(plugin.workingDirectory, "design", ".json");
      const savedDesign = JSON.parse(
        await readFile(join(plugin.workingDirectory, DESIGN_FOLDER, savedJsonName!), "utf8")
      );
      expect(savedDesign).toMatchObject({
        project: "acme-notes",
        mode: "redesign",
        variants: [
          { name: "Single card" },
          { name: "Two columns" },
        ],
      });
      expect(await plugin.readCommandLog()).toEqual([`open ${pagePath}`]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_design refuses a variant with a raw color and writes no page`, async () => {
    const plugin = await startProject(target);
    try {
      await plugin.callTool(THEME_TOOL, THEME_INPUT);

      const reply = await plugin.callTool(DESIGN_TOOL, {
        ...DESIGN_INPUT,
        variants: [{ ...FIRST_VARIANT, css: ".page{color:#fff}" }],
      });

      expect(reply).toMatchObject({ isError: true });
      expect(reply.text).toContain(
        "Variant A: raw color #fff in its css. Use var(--token)."
      );
      expect(await listDesignFiles(plugin.workingDirectory, "design", ".html"))
        .toEqual([]);
      expect(await plugin.readCommandLog()).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_design_audit scans the project, writes the audit page and opens it`, async () => {
    const plugin = await startProject(target);
    try {
      await plugin.callTool(THEME_TOOL, THEME_INPUT);

      const reply = await plugin.callTool(AUDIT_TOOL, AUDIT_INPUT);

      expect(reply).toMatchObject({ isError: false });
      expect(reply.text).toMatch(
        / in the browser\. 3 findings: 2 hardcoded, 1 typography\.$/
      );
      const pagePath = openedPagePath(reply.text);
      const pageText = await readFile(pagePath, "utf8");
      expect(pageText).toContain("<title>Design audit · acme-notes</title>");
      expect(pageText).toContain("Hardcoded color #f0f");
      const [savedJsonName] = await listDesignFiles(plugin.workingDirectory, "audit", ".json");
      const savedAudit = JSON.parse(
        await readFile(join(plugin.workingDirectory, DESIGN_FOLDER, savedJsonName!), "utf8")
      );
      expect(
        savedAudit.findings.map((finding: { title: string }) => finding.title)
      ).toEqual([
        "Hardcoded color #2563eb",
        "Hardcoded color #f0f",
        "Three heading sizes",
      ]);
      expect(await plugin.readCommandLog()).toEqual([`open ${pagePath}`]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: render_design_audit refuses a file that does not exist and writes no page`, async () => {
    const plugin = await startProject(target);
    try {
      await plugin.callTool(THEME_TOOL, THEME_INPUT);

      const reply = await plugin.callTool(AUDIT_TOOL, {
        ...AUDIT_INPUT,
        files: ["src/ui/button.tsx", "src/ui/gone.tsx"],
      });

      expect(reply).toMatchObject({ isError: true });
      expect(reply.text).toContain("src/ui/gone.tsx does not exist.");
      expect(await listDesignFiles(plugin.workingDirectory, "audit", ".html"))
        .toEqual([]);
      expect(await plugin.readCommandLog()).toEqual([]);
    } finally {
      await plugin.stop();
    }
  });

  test(`${target}: the design skill is installed and names exactly the tools the plugin exposes`, async () => {
    const plugin = await startPlugin(target, "ui-design");
    try {
      const skillText = await readFile(
        join(plugin.installedFolder, ...SKILL_PATH),
        "utf8"
      );
      const mentionedToolNames = [
        ...new Set(
          [...skillText.matchAll(/mcp__ui-design__(\w+)/g)].map((match) => match[1]!)
        ),
      ];
      expect(mentionedToolNames.sort()).toEqual(
        (await plugin.listToolNames()).sort()
      );
      if (target === "pi") {
        const manifest = JSON.parse(
          await readFile(join(plugin.installedFolder, "package.json"), "utf8")
        );
        expect(manifest.pi.skills).toEqual(["./skills"]);
      } else {
        const mcpConfig = JSON.parse(
          await readFile(join(plugin.installedFolder, ".mcp.json"), "utf8")
        );
        expect(Object.keys(mcpConfig.mcpServers)).toEqual(["ui-design"]);
      }
    } finally {
      await plugin.stop();
    }
  });
}
