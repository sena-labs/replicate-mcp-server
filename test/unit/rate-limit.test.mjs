import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRetryAfter,
  isRateLimitedResponse,
} from "../../dist/rate-limit.js";

test("parseRetryAfter: numeric seconds → ms", () => {
  assert.equal(parseRetryAfter("5"), 5000);
  assert.equal(parseRetryAfter("0.5"), 500);
  assert.equal(parseRetryAfter("30"), 30_000);
});

test("parseRetryAfter: HTTP date → delta to now", () => {
  const future = new Date(Date.now() + 10_000).toUTCString();
  const ms = parseRetryAfter(future, 1000, Date.now());
  // Allow ±1s tolerance for date-second rounding.
  assert.ok(ms >= 9000 && ms <= 11_000, `expected ~10s, got ${ms}`);
});

test("parseRetryAfter: past date → 0", () => {
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(parseRetryAfter(past, 1000, Date.now()), 0);
});

test("parseRetryAfter: missing header → fallback", () => {
  assert.equal(parseRetryAfter(null, 2000), 2000);
  assert.equal(parseRetryAfter(undefined, 2000), 2000);
  assert.equal(parseRetryAfter("", 2000), 2000);
});

test("parseRetryAfter: garbage → fallback", () => {
  assert.equal(parseRetryAfter("not-a-date", 1500), 1500);
});

test("parseRetryAfter: clamps absurd values to 60s ceiling", () => {
  assert.equal(parseRetryAfter("999999"), 60_000);
});

test("parseRetryAfter: negative numbers fall through to date parser", () => {
  // "-5" isn't matched by the seconds regex; Date.parse may treat it as
  // year -5 (past) → returns 0. Either way result is non-negative.
  const out = parseRetryAfter("-5");
  assert.ok(out >= 0);
});

test("isRateLimitedResponse: 429 + 503 only", () => {
  assert.equal(isRateLimitedResponse(429), true);
  assert.equal(isRateLimitedResponse(503), true);
  assert.equal(isRateLimitedResponse(200), false);
  assert.equal(isRateLimitedResponse(404), false);
  assert.equal(isRateLimitedResponse(500), false);
  assert.equal(isRateLimitedResponse(502), false);
});
