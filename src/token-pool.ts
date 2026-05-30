/**
 * Replicate API token pool.
 *
 * Single-tenant default reads `REPLICATE_API_TOKEN`. Multi-tenant or
 * shared-server deployments can supply a comma-separated list of tokens
 * via `REPLICATE_API_TOKEN_POOL` to spread load across multiple accounts
 * (each account has its own rate limit on Replicate).
 *
 * Tokens are dispensed round-robin. The pool exposes a `next()` method
 * the Replicate client wrapper calls before every API operation so each
 * request runs under a (potentially) different account.
 */

import { logger } from "./logger.js";

export interface TokenPool {
  /** Number of tokens currently in the pool. */
  size: number;
  /** Returns the next token to use, advancing the round-robin cursor. */
  next(): string;
  /** Returns the next non-rate-limited token. Falls back to the token that
   *  unblocks soonest when all tokens are currently rate-limited. */
  nextAvailable(): string;
  /** Returns all tokens (for diagnostics — never log them). */
  all(): readonly string[];
  /** Mark a token as rate-limited for `retryAfterMs` milliseconds so
   *  `nextAvailable` skips it until the window expires. */
  markRateLimited(token: string, retryAfterMs: number): void;
}

/** Build a token pool from environment variables. Returns null if no
 *  tokens are configured — caller must surface an actionable error. */
export function loadTokenPoolFromEnv(env: NodeJS.ProcessEnv = process.env): TokenPool | null {
  const tokens: string[] = [];

  const single = env["REPLICATE_API_TOKEN"];
  if (single && single.trim().length > 0) {
    tokens.push(single.trim());
  }

  const pool = env["REPLICATE_API_TOKEN_POOL"];
  if (pool && pool.trim().length > 0) {
    for (const raw of pool.split(",")) {
      const t = raw.trim();
      if (t.length > 0 && !tokens.includes(t)) tokens.push(t);
    }
  }

  if (tokens.length === 0) return null;

  logger.info("token_pool_loaded", { token_count: tokens.length });
  return makeTokenPool(tokens);
}

/** Build a token pool from an explicit list. Useful for tests. */
export function makeTokenPool(tokens: readonly string[]): TokenPool {
  if (tokens.length === 0) {
    throw new Error("makeTokenPool: cannot build a pool with zero tokens");
  }
  let cursor = 0;
  const blockedUntil = new Map<string, number>();

  function isBlocked(token: string): boolean {
    const until = blockedUntil.get(token);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      blockedUntil.delete(token);
      return false;
    }
    return true;
  }

  return {
    size: tokens.length,
    next() {
      const t = tokens[cursor % tokens.length]!;
      cursor++;
      return t;
    },
    nextAvailable() {
      const n = tokens.length;
      // Linear scan from current cursor — find the first non-blocked token.
      for (let i = 0; i < n; i++) {
        const t = tokens[(cursor + i) % n]!;
        if (!isBlocked(t)) {
          cursor = (cursor + i + 1) % n;
          return t;
        }
      }
      // All tokens are blocked — return the one whose window expires soonest
      // so the caller wastes the least time waiting.
      let best = tokens[0]!;
      let bestUntil = blockedUntil.get(best) ?? 0;
      for (const t of tokens.slice(1)) {
        const u = blockedUntil.get(t) ?? 0;
        if (u < bestUntil) {
          best = t;
          bestUntil = u;
        }
      }
      cursor = (tokens.indexOf(best) + 1) % n;
      logger.warn("all_tokens_rate_limited", { count: n });
      return best;
    },
    all() {
      return tokens;
    },
    markRateLimited(token: string, retryAfterMs: number): void {
      blockedUntil.set(token, Date.now() + Math.max(0, retryAfterMs));
      logger.warn("token_rate_limited", { retryAfterMs });
    },
  };
}
