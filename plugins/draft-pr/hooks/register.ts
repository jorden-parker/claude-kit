import type { EngineInterface, Register } from "claude-code";
import {
  COMMENT_LABEL_NAMES,
  readConventionalComment,
  STANDARD_DECORATION_NAMES,
} from "./conventional-comment";
import {
  parseDiff,
  readCommentContext,
  type DiffSide,
  type FileDiff,
} from "./diff-lines";
import {
  renderDraftPage,
  REVIEW_EVENT_NAMES,
  type Draft,
  type PullRequestDraft,
  type ReviewCommentDraft,
  type ReviewDraft,
  type ReviewEvent,
} from "./draft-page";
import {
  DEFAULT_PR_TEMPLATE,
  findMissingTemplateParts,
  findPrTemplates,
  listTemplateHeadings,
  type PrTemplate,
  type TemplateFiles,
} from "./pr-template";

const PR_TOOL_NAME = "render_pr_draft";
const QUALIFIED_PR_TOOL_NAME = `mcp__draft-pr__${PR_TOOL_NAME}`;
const REVIEW_TOOL_NAME = "render_pr_review_draft";
const QUALIFIED_REVIEW_TOOL_NAME = `mcp__draft-pr__${REVIEW_TOOL_NAME}`;

const DRAFT_FOLDER = ".claude/draft-pr";
const POST_BRIDGE_SCRIPT = "server/draft-server.mjs";
const POST_BRIDGE_TIMEOUT_MILLISECONDS = 10000;
const LOOPBACK_URL_PREFIX = "http://127.0.0.1:";
const DETACHED_HEAD = "HEAD";
const OPEN_STATE = "OPEN";
const APPROVE_EVENT: ReviewEvent = "APPROVE";
const DEFAULT_EVENT: ReviewEvent = "COMMENT";
const PULL_REQUEST_URL_PATTERN =
  /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/\d+/;

declare module "claude-code" {
  interface McpToolInputs {
    [QUALIFIED_PR_TOOL_NAME]: Record<string, unknown>;
    [QUALIFIED_REVIEW_TOOL_NAME]: Record<string, unknown>;
  }
}

const PR_TOOL_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "The PR title: one line, under 72 characters.",
    },
    body: {
      type: "string",
      description:
        "The PR body in Markdown. It keeps every heading and checklist item of the project's PR template, in the template's order.",
    },
    base: { type: "string", description: "The branch the PR merges into." },
    templatePath: {
      type: "string",
      description:
        "The PR template the body follows, relative to the project. Needed only when the project has several.",
    },
    isDraft: {
      type: "boolean",
      description: "True to open the PR as a draft PR when the user posts it.",
    },
  },
  required: ["title", "body", "base"],
};

const REVIEW_TOOL_SCHEMA = {
  type: "object",
  properties: {
    number: { type: "integer", description: "The PR's number." },
    summary: {
      type: "string",
      description: "The review's overall comment, in Markdown. May be empty.",
    },
    event: {
      type: "string",
      enum: REVIEW_EVENT_NAMES,
      description: `The review type the page starts on. ${DEFAULT_EVENT} unless the user asked for another.`,
    },
    comments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "The file the comment is on, relative to the repository. Leave out for a comment on the whole PR.",
          },
          line: {
            type: "integer",
            description:
              "The line the comment is on, or the last line of a range. It must be a line the PR's diff shows.",
          },
          startLine: {
            type: "integer",
            description:
              "The first line of a range, in the same diff hunk as line.",
          },
          side: {
            type: "string",
            enum: ["RIGHT", "LEFT"],
            description:
              "RIGHT (the default) numbers lines in the new file, LEFT in the old file, for a removed line.",
          },
          label: { type: "string", enum: COMMENT_LABEL_NAMES },
          decorations: {
            type: "array",
            items: { type: "string" },
            description: `Zero or more of ${STANDARD_DECORATION_NAMES.join(", ")}, or another lowercase hyphenated word such as security or test.`,
          },
          subject: {
            type: "string",
            description: "The comment's main message, in one sentence.",
          },
          discussion: {
            type: "string",
            description:
              "The reasoning and the suggested next step, in Markdown. May be empty.",
          },
        },
        required: ["label", "subject"],
      },
    },
  },
  required: ["number", "comments"],
};

type CommandOutcome = { isSuccessful: boolean; output: string; error: string };

const readText = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const readFields = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const readPositiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

const parseJsonFields = (jsonText: string) => {
  try {
    return readFields(JSON.parse(jsonText));
  } catch {
    return {};
  }
};

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const runHostCommand = async (
  engine: EngineInterface,
  argv: string[],
  timeoutMs?: number
): Promise<CommandOutcome> => {
  try {
    const { exitCode, stdout, stderr } = await engine.process.run(
      argv,
      timeoutMs === undefined ? {} : { timeoutMs }
    );
    return {
      isSuccessful: exitCode === 0,
      output: stdout.trim(),
      error: stderr.trim(),
    };
  } catch (error) {
    return { isSuccessful: false, output: "", error: describeError(error) };
  }
};

const padTwoDigits = (value: number) => String(value).padStart(2, "0");

const formatFileStamp = (milliseconds: number) => {
  const stampDate = new Date(milliseconds);
  const datePart = [
    stampDate.getUTCFullYear(),
    padTwoDigits(stampDate.getUTCMonth() + 1),
    padTwoDigits(stampDate.getUTCDate()),
  ].join("-");
  const timePart = [
    stampDate.getUTCHours(),
    stampDate.getUTCMinutes(),
    stampDate.getUTCSeconds(),
  ]
    .map(padTwoDigits)
    .join("");
  return `${datePart}-${timePart}`;
};

const BROWSER_OPENERS = [
  (pageLocation: string) => ["open", pageLocation],
  (pageLocation: string) => ["xdg-open", pageLocation],
  (pageLocation: string) => ["cmd", "/c", "start", "", pageLocation],
];

const openInBrowser = async (engine: EngineInterface, pageLocation: string) => {
  for (const buildOpener of BROWSER_OPENERS) {
    const opening = await runHostCommand(engine, buildOpener(pageLocation));
    if (opening.isSuccessful) return true;
  }
  return false;
};

const startPostBridge = async (engine: EngineInterface, draftPath: string) => {
  const launch = await runHostCommand(
    engine,
    ["node", `${engine.plugin.root}/${POST_BRIDGE_SCRIPT}`, draftPath],
    POST_BRIDGE_TIMEOUT_MILLISECONDS
  );
  const bridgeUrl = readText(parseJsonFields(launch.output).url);
  return launch.isSuccessful && bridgeUrl.startsWith(LOOPBACK_URL_PREFIX)
    ? bridgeUrl
    : undefined;
};

const openDraftPage = async (
  engine: EngineInterface,
  draft: Draft,
  draftName: string
) => {
  const draftFolder = `${draft.cwd}/${DRAFT_FOLDER}`;
  const draftPath = `${draftFolder}/${draft.draftId}.json`;
  const pagePath = `${draftFolder}/${draft.draftId}.html`;
  await engine.fs.write(`${draftFolder}/.gitignore`, "*\n");
  await engine.fs.write(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  await engine.fs.write(pagePath, renderDraftPage(draft));
  const pageLocation = (await startPostBridge(engine, draftPath)) ?? pagePath;
  const isOpened = await openInBrowser(engine, pageLocation);
  return isOpened
    ? `Opened the ${draftName} in the browser.`
    : `Could not open the browser. The ${draftName} is at ${pageLocation}`;
};

const readTemplateFiles = (engine: EngineInterface): TemplateFiles => ({
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

type TemplateChoice =
  | { template: PrTemplate; problem?: undefined }
  | { template?: undefined; problem: string };

const chooseTemplate = (
  templates: PrTemplate[],
  requestedPath: string
): TemplateChoice => {
  if (!templates.length) {
    return { template: { path: "", text: DEFAULT_PR_TEMPLATE } };
  }
  const requestedTemplate = templates.find(
    (template) => template.path === requestedPath
  );
  if (requestedTemplate) return { template: requestedTemplate };
  const onlyTemplate = templates.length === 1 ? templates[0] : undefined;
  if (onlyTemplate) return { template: onlyTemplate };
  return {
    problem: `This project has several PR templates: ${templates.map((template) => template.path).join(", ")}. Pass the one this PR follows as templatePath.`,
  };
};

const describeTemplateMismatch = (
  template: PrTemplate,
  missingParts: string[]
) => {
  const templateName = template.path || "the default layout";
  const defaultLayout = template.path
    ? ""
    : `\n\nThe project has no PR template, so the default layout applies:\n\n${DEFAULT_PR_TEMPLATE}`;
  return `The body does not follow ${templateName}. Missing: ${missingParts.join(", ")}. Keep every heading and checklist item of the template, in the template's order, then call the tool again.${defaultLayout}`;
};

const readOpenPullRequest = async (engine: EngineInterface, head: string) => {
  const viewing = await runHostCommand(engine, [
    "gh",
    "pr",
    "view",
    head,
    "--json",
    "number,url,state",
  ]);
  const fields = viewing.isSuccessful ? parseJsonFields(viewing.output) : {};
  const existingNumber =
    fields.state === OPEN_STATE ? readPositiveInteger(fields.number) : null;
  return {
    existingNumber,
    existingUrl: existingNumber === null ? "" : readText(fields.url),
  };
};

const readPullRequestText = (input: Record<string, unknown>) => {
  const title = readText(input.title);
  const body = typeof input.body === "string" ? input.body : "";
  const base = readText(input.base);
  return title && body.trim() && base ? { title, body, base } : undefined;
};

const findTemplateProblem = (template: PrTemplate, body: string) => {
  const missingParts = findMissingTemplateParts(template.text, body);
  return missingParts.length
    ? describeTemplateMismatch(template, missingParts)
    : undefined;
};

const readHeadBranch = async (engine: EngineInterface) => {
  const branchReading = await runHostCommand(engine, [
    "git",
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const head = branchReading.isSuccessful ? branchReading.output : "";
  return head === DETACHED_HEAD ? "" : head;
};

const readRepository = async (engine: EngineInterface) => {
  const repositoryReading = await runHostCommand(engine, [
    "gh",
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  return repositoryReading.isSuccessful ? repositoryReading.output : "";
};

const draftPullRequest = async (
  engine: EngineInterface,
  input: Record<string, unknown>
) => {
  const pullRequestText = readPullRequestText(input);
  if (!pullRequestText) {
    return { deny: "A PR draft needs a title, a body and a base branch." };
  }
  const cwd = await engine.session.cwd();
  const templateChoice = chooseTemplate(
    await findPrTemplates(readTemplateFiles(engine), cwd),
    readText(input.templatePath)
  );
  if (templateChoice.problem !== undefined) {
    return { deny: templateChoice.problem };
  }
  const { template } = templateChoice;
  const templateProblem = findTemplateProblem(template, pullRequestText.body);
  if (templateProblem) return { deny: templateProblem };
  const head = await readHeadBranch(engine);
  if (!head) {
    return {
      deny: "Could not read the current branch. Check out the branch the PR is for.",
    };
  }
  const draft: PullRequestDraft = {
    kind: "pr",
    draftId: `pr-${formatFileStamp(await engine.clock.now())}`,
    cwd,
    repository: await readRepository(engine),
    head,
    ...pullRequestText,
    isDraft: input.isDraft === true,
    ...(await readOpenPullRequest(engine, head)),
    templatePath: template.path,
    templateHeadings: listTemplateHeadings(template.text),
  };
  return { result: await openDraftPage(engine, draft, "PR draft") };
};

type CommentPlace = Pick<
  ReviewCommentDraft,
  "path" | "side" | "line" | "startLine" | "context"
>;

type PlaceReading =
  | { place: CommentPlace; problem?: undefined }
  | { place?: undefined; problem: string };

const WHOLE_PR_PLACE: CommentPlace = {
  path: "",
  side: "RIGHT",
  line: null,
  startLine: null,
  context: [],
};

const describeLines = (line: number, startLine: number | null) =>
  startLine === null ? `line ${line}` : `lines ${startLine}-${line}`;

const readLinePlace = (
  fileDiffs: FileDiff[],
  path: string,
  line: number,
  fields: Record<string, unknown>
): PlaceReading => {
  const requestedStartLine = readPositiveInteger(fields.startLine);
  const startLine = requestedStartLine === line ? null : requestedStartLine;
  const side: DiffSide = fields.side === "LEFT" ? "LEFT" : "RIGHT";
  const context = readCommentContext(fileDiffs, {
    path,
    side,
    line,
    ...(startLine === null ? {} : { startLine }),
  });
  return context
    ? { place: { path, side, line, startLine, context } }
    : {
        problem: `${path} ${describeLines(line, startLine)} (${side}) is not in the diff of the PR; comment on lines one diff hunk shows, or leave out the path and line`,
      };
};

const readCommentPlace = (
  fields: Record<string, unknown>,
  fileDiffs: FileDiff[]
): PlaceReading => {
  const path = readText(fields.path);
  const line = readPositiveInteger(fields.line);
  if (path && line !== null)
    return readLinePlace(fileDiffs, path, line, fields);
  if (line !== null) return { problem: "a comment with a line needs a path" };
  if (path) {
    return {
      problem:
        "a comment on a file needs a line; leave out the path for a comment on the whole PR",
    };
  }
  return { place: WHOLE_PR_PLACE };
};

type CommentReading = {
  comment: ReviewCommentDraft | undefined;
  problems: string[];
};

const readReviewComment = (
  rawComment: unknown,
  fileDiffs: FileDiff[]
): CommentReading => {
  const { comment, problems } = readConventionalComment(rawComment);
  const placeReading = readCommentPlace(readFields(rawComment), fileDiffs);
  if (placeReading.problem !== undefined) {
    return {
      comment: undefined,
      problems: [...problems, placeReading.problem],
    };
  }
  return {
    comment: comment && { ...comment, ...placeReading.place },
    problems,
  };
};

const readReviewEvent = (requestedEvent: unknown) => {
  if (requestedEvent === undefined || requestedEvent === "") {
    return DEFAULT_EVENT;
  }
  return REVIEW_EVENT_NAMES.find((eventName) => eventName === requestedEvent);
};

const EVENT_NAMES_AS_TEXT = `${REVIEW_EVENT_NAMES.slice(0, -1).join(", ")} or ${REVIEW_EVENT_NAMES.at(-1)}`;

type ReviewedPullRequest =
  | {
      pullRequest: Record<string, unknown>;
      fileDiffs: FileDiff[];
      problem?: undefined;
    }
  | { problem: string };

const readReviewedPullRequest = async (
  engine: EngineInterface,
  number: number
): Promise<ReviewedPullRequest> => {
  const viewing = await runHostCommand(engine, [
    "gh",
    "pr",
    "view",
    String(number),
    "--json",
    "number,title,url,headRefOid,headRefName,baseRefName,author",
  ]);
  if (!viewing.isSuccessful) {
    return { problem: `Could not read PR #${number}: ${viewing.error}` };
  }
  const diffReading = await runHostCommand(engine, [
    "gh",
    "pr",
    "diff",
    String(number),
  ]);
  if (!diffReading.isSuccessful) {
    return {
      problem: `Could not read the diff of PR #${number}: ${diffReading.error}`,
    };
  }
  return {
    pullRequest: parseJsonFields(viewing.output),
    fileDiffs: parseDiff(diffReading.output),
  };
};

const readReviewText = (
  input: Record<string, unknown>,
  fileDiffs: FileDiff[]
) => {
  const rawComments: unknown[] = Array.isArray(input.comments)
    ? input.comments
    : [];
  const commentReadings = rawComments.map((rawComment) =>
    readReviewComment(rawComment, fileDiffs)
  );
  const event = readReviewEvent(input.event);
  const summary = readText(input.summary);
  const hasNothingToSay =
    !summary && !rawComments.length && event !== APPROVE_EVENT;
  const problems = [
    ...commentReadings.flatMap((commentReading, commentIndex) =>
      commentReading.problems.map(
        (problem) => `comments[${commentIndex}]: ${problem}`
      )
    ),
    ...(event ? [] : [`event must be ${EVENT_NAMES_AS_TEXT}`]),
    ...(hasNothingToSay ? ["The review has no summary and no comments."] : []),
  ];
  const comments = commentReadings
    .map((commentReading) => commentReading.comment)
    .filter((comment): comment is ReviewCommentDraft => comment !== undefined);
  return { summary, event, comments, problems };
};

const describePullRequest = (pullRequest: Record<string, unknown>) => {
  const url = readText(pullRequest.url);
  const urlMatch = PULL_REQUEST_URL_PATTERN.exec(url);
  return {
    repository: urlMatch?.[2] ?? "",
    host: urlMatch?.[1] ?? "",
    title: readText(pullRequest.title),
    url,
    author: readText(readFields(pullRequest.author).login),
    base: readText(pullRequest.baseRefName),
    head: readText(pullRequest.headRefName),
    headSha: readText(pullRequest.headRefOid),
  };
};

const draftReview = async (
  engine: EngineInterface,
  input: Record<string, unknown>
) => {
  const number = readPositiveInteger(input.number);
  if (number === null) return { deny: "A review draft needs the PR's number." };
  const reviewedPullRequest = await readReviewedPullRequest(engine, number);
  if (reviewedPullRequest.problem !== undefined) {
    return { deny: reviewedPullRequest.problem };
  }
  const { summary, event, comments, problems } = readReviewText(
    input,
    reviewedPullRequest.fileDiffs
  );
  if (problems.length || !event) return { deny: problems.join("\n") };
  const draft: ReviewDraft = {
    kind: "review",
    draftId: `review-${number}-${formatFileStamp(await engine.clock.now())}`,
    cwd: await engine.session.cwd(),
    number,
    ...describePullRequest(reviewedPullRequest.pullRequest),
    summary,
    event,
    comments,
  };
  return { result: await openDraftPage(engine, draft, "review draft") };
};

const describeFailure = (draftName: string, error: unknown) => ({
  deny: `Could not write the ${draftName}: ${describeError(error)}`,
});

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.tool.register({
      name: PR_TOOL_NAME,
      description:
        "Opens a drafted pull request as an editable page in the browser, after checking that the body keeps the project's PR template. Posts nothing: the page posts to GitHub only when the user clicks its button. Call it once, at the end of the draft-pr skill.",
      inputSchema: PR_TOOL_SCHEMA,
      isDeferred: false,
    });
    await $.tool.register({
      name: REVIEW_TOOL_NAME,
      description:
        "Opens a drafted pull request review as an editable page in the browser, after checking that every comment is a Conventional Comment on a line of the PR's diff. Posts nothing: the page posts to GitHub only when the user clicks its button. Call it once, at the end of the draft-pr-review skill.",
      inputSchema: REVIEW_TOOL_SCHEMA,
      isDeferred: false,
    });
    return next(e);
  });

  on("tool.call", { tool: QUALIFIED_PR_TOOL_NAME }, async ($, e) => {
    try {
      return await draftPullRequest($, e);
    } catch (error) {
      return describeFailure("PR draft", error);
    }
  });

  on("tool.call", { tool: QUALIFIED_REVIEW_TOOL_NAME }, async ($, e) => {
    try {
      return await draftReview($, e);
    } catch (error) {
      return describeFailure("review draft", error);
    }
  });
};
