/**
 * Tiny argv parser for the server entry point.
 *
 * Supported flags (all optional):
 *   --http              Enable HTTP/SSE transport instead of stdio.
 *   --port <n>          HTTP listen port (default 8088).
 *   --host <ip>         HTTP listen host (default 127.0.0.1 — change to
 *                       0.0.0.0 to expose on LAN).
 *   --api-key <key>     Required Bearer token for HTTP requests. If
 *                       omitted, HTTP mode runs UNAUTHENTICATED (only
 *                       safe behind a private network / reverse proxy).
 *   --webhook-port <n>  Optional separate port for Replicate webhook
 *                       callbacks. If absent, polling is used (default).
 *   --webhook-host <h>  Webhook receiver host (default 0.0.0.0 — must be
 *                       publicly reachable for Replicate to POST to it).
 *
 * Anything else is ignored so we don't break on unknown extensions.
 */

export interface ServerArgs {
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
  httpApiKey?: string;
  webhookPort?: number;
  webhookHost: string;
  listModels: boolean;
}

const DEFAULT_ARGS: ServerArgs = {
  transport: "stdio",
  httpPort: 8088,
  httpHost: "127.0.0.1",
  webhookHost: "0.0.0.0",
  listModels: false,
};

export function parseServerArgs(argv: readonly string[] = process.argv.slice(2)): ServerArgs {
  const out: ServerArgs = { ...DEFAULT_ARGS };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--http":
        out.transport = "http";
        break;
      case "--port":
        out.httpPort = nextNumber(argv, i, "port");
        i++;
        break;
      case "--host":
        out.httpHost = nextString(argv, i, "host");
        i++;
        break;
      case "--api-key":
        out.httpApiKey = nextString(argv, i, "api-key");
        i++;
        break;
      case "--webhook-port":
        out.webhookPort = nextNumber(argv, i, "webhook-port");
        i++;
        break;
      case "--webhook-host":
        out.webhookHost = nextString(argv, i, "webhook-host");
        i++;
        break;
      case "--list-models":
        out.listModels = true;
        break;
      default:
        // Unknown / positional — ignore. Lets the launcher script pass
        // through harmless arguments without breaking startup.
        break;
    }
  }

  // Validate API key length if provided — short keys are trivially guessable.
  if (out.httpApiKey !== undefined && out.httpApiKey.length < 16) {
    throw new Error("--api-key is too short (minimum 16 characters).");
  }

  return out;
}

function nextString(argv: readonly string[], i: number, name: string): string {
  const v = argv[i + 1];
  if (!v) throw new Error(`--${name} requires a value`);
  return v;
}

function nextNumber(argv: readonly string[], i: number, name: string): number {
  const raw = nextString(argv, i, name);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`--${name} must be an integer port in [1, 65535], got "${raw}"`);
  }
  return n;
}
