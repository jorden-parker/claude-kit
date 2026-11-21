const SECRET_PATTERNS = [
  { kind: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    kind: "GitHub token",
    pattern: /\b(?:gh[po]_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{22,})/,
  },
  { kind: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  {
    kind: "password or token assignment",
    pattern: /(?:\b|_)(?:password|token)\s*[=:]\s*["']?[^\s"'$<{]{12,}/i,
  },
];

export const findSecretKinds = (text: string) =>
  SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ kind }) => kind
  );
