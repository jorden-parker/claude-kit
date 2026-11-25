const CLAUDE_LITE_PORTS = new Set(["11434", "8435"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function isClaudeLiteSession(baseAddress: string | undefined): boolean {
  if (baseAddress === undefined || !URL.canParse(baseAddress)) return false;
  const { hostname, port } = new URL(baseAddress);
  return LOOPBACK_HOSTS.has(hostname) && CLAUDE_LITE_PORTS.has(port);
}
