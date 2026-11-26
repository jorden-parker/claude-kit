import {
  canRewriteInput,
  deny,
  rewriteInput,
  type HookEvent,
  type HookResult,
} from "./types.ts";

const COMMAND_PREFIX = String.raw`(?:(?:\w+=\S*|env|command)\s+)*`;
export const COMMAND_START = String.raw`(?:^|[;&|(\n\`]\s*)${COMMAND_PREFIX}`;
const SEGMENT_BODY = String.raw`[^;&|)\n\`]*`;
const BOUNDED_FILTER = String.raw`\|\s*(?:head|tail|wc|grep|sed\s+-n)\b`;
const PIPE_STAGE = String.raw`\|(?!\|)${SEGMENT_BODY}`;
const NOT_BOUNDED = `(?!${SEGMENT_BODY}(?:${PIPE_STAGE})*${BOUNDED_FILTER})`;
export const GIT_OPTIONS = String.raw`(?:(?:--no-pager|--paginate|-p|-P|-c\s+\S+|-C\s+\S+|--git-dir=\S+|--work-tree=\S+)\s+)*`;
const QUOTED_TEXT = /'[^']*'|"(?:[^"\\$`]|\\.)*"/g;
const QUOTED_SEPARATOR = /[;&|()\n`]/;
const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "bun.lock",
];

const unbounded = (command: string, boundingFlags: string[]) =>
  new RegExp(
    `${COMMAND_START}${command}\\b(?!${SEGMENT_BODY}(?:${boundingFlags.join("|")}))${SEGMENT_BODY}${NOT_BOUNDED}`
  );

const MAX_LINES = 150;
const OUTPUT_CAP = `| head -n ${MAX_LINES}`;
const UNSAFE_TO_CAP =
  /[<>#]|\s-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/;

type Rule = { pattern: RegExp; reason: string; isCappable: boolean };

const RULES: Rule[] = [
  {
    pattern: unbounded(`git\\s+${GIT_OPTIONS}log`, [
      String.raw`\s-n\s*\d`,
      String.raw`\s-\d+`,
      "--max-count",
    ]),
    reason: "Unbounded git log. Use: git log --oneline -n 20",
    isCappable: true,
  },
  {
    pattern: unbounded(`git\\s+${GIT_OPTIONS}diff`, [
      String.raw`--stat`,
      String.raw`--name-only`,
      String.raw`--shortstat`,
    ]),
    reason:
      "Unbounded git diff. Use --stat or --name-only first, or add | head -50",
    isCappable: true,
  },
  {
    pattern: unbounded("find", [String.raw`-maxdepth`]),
    reason: "Unbounded find. Add -maxdepth N or | head -50.",
    isCappable: true,
  },
  {
    pattern: new RegExp(
      `${COMMAND_START}(?:cat|less|more|bat)\\s${SEGMENT_BODY}\\b(?:${LOCKFILES.map((lockfileName) => lockfileName.replace(/\./g, "\\.")).join("|")})\\b${NOT_BOUNDED}`
    ),
    reason: "Lockfiles are huge. Grep for the package you need instead.",
    isCappable: false,
  },
];

export const withoutQuotedText = (command: string) =>
  command.replace(QUOTED_TEXT, (match) =>
    QUOTED_SEPARATOR.test(match) ? "''" : match
  );

function endsTheCommand(stripped: string, pattern: RegExp): boolean {
  const match = pattern.exec(stripped);
  if (!match || UNSAFE_TO_CAP.test(match[0])) return false;
  return stripped.slice(match.index + match[0].length).trim() === "";
}

export function decide(event: HookEvent): HookResult {
  const input = event.tool_input ?? {};
  const command: string = input.command ?? "";
  const stripped = withoutQuotedText(command);
  const rule = RULES.find(({ pattern }) => pattern.test(stripped));
  if (!rule) return null;
  const isCapped =
    rule.isCappable &&
    canRewriteInput(event) &&
    endsTheCommand(stripped, rule.pattern);
  if (!isCapped) return deny(rule.reason);
  return rewriteInput(
    { ...input, command: `${command} ${OUTPUT_CAP}` },
    `bash-guard capped this output with ${OUTPUT_CAP}. Bound it yourself (-n, --stat, --name-only, -maxdepth) to see a different part.`
  );
}
