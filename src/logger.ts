/**
 * Lightweight structured-logging utility for the MCP server.
 *
 * Writes one-line JSON entries to stderr only (stdout is reserved for the
 * MCP protocol framing). Active level is set once at module load from
 * `LOG_LEVEL` (default "info"); below-threshold calls are no-ops.
 *
 * The shape is intentionally minimal — a downstream log aggregator can
 * key on `ts`, `level`, `event`, plus any caller-supplied fields.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  return raw in LEVEL_RANK ? (raw as LogLevel) : "info";
}

const ACTIVE_LEVEL = resolveLevel();
const ACTIVE_RANK = LEVEL_RANK[ACTIVE_LEVEL];

/** Emit a structured log line if `level` meets the active threshold. */
export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_RANK[level] < ACTIVE_RANK) return;
  const line: Record<string, unknown> = {
    ...fields,
    ts: new Date().toISOString(),
    level,
    event,
  };
  try {
    process.stderr.write(JSON.stringify(line) + "\n");
  } catch {
    // Logging must never throw into the caller. Drop silently if stderr
    // is closed (rare in long-running stdio servers, but possible during
    // ungraceful shutdown).
  }
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) =>
    log("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) =>
    log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) =>
    log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) =>
    log("error", event, fields),
  /** Currently active log level (read once at module load). */
  level: ACTIVE_LEVEL,
};
