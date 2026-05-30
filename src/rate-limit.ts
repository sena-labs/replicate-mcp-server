/**
 * Helpers for honouring HTTP rate-limit signals from upstream servers.
 *
 * Replicate (and its CDN) signals back-pressure via the `Retry-After`
 * header on 429 / 503 responses. The value is either:
 *   - a number of seconds to wait, or
 *   - an HTTP date string at which it's safe to retry.
 *
 * We clamp the resulting sleep to a sensible upper bound so a buggy
 * upstream can't pin the server forever.
 */

const DEFAULT_FALLBACK_MS = 1000;
const MAX_SLEEP_MS = 60_000;

/** Parse a `Retry-After` header value into a millisecond delay.
 *  Returns the fallback when the header is missing or unparseable. */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  fallbackMs: number = DEFAULT_FALLBACK_MS,
  now: number = Date.now(),
): number {
  if (!headerValue) return clamp(fallbackMs);

  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return clamp(fallbackMs);

  // Numeric form — interpreted as seconds.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return clamp(Math.round(seconds * 1000));
    }
    return clamp(fallbackMs);
  }

  // HTTP-date form — Date.parse() handles RFC 7231 date formats.
  const targetMs = Date.parse(trimmed);
  if (Number.isFinite(targetMs)) {
    const delta = targetMs - now;
    return clamp(delta > 0 ? delta : 0);
  }

  return clamp(fallbackMs);
}

/** True when the HTTP response indicates the client should back off and
 *  retry (rate-limit or transient service unavailability). */
export function isRateLimitedResponse(status: number): boolean {
  return status === 429 || status === 503;
}

function clamp(ms: number): number {
  if (ms < 0) return 0;
  if (ms > MAX_SLEEP_MS) return MAX_SLEEP_MS;
  return ms;
}
