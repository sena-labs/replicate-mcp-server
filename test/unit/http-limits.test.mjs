import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HTTP_LIMITS, HttpRateLimiter, clientIpResolver, httpLimitsFromEnv, normalizeIp } from "../../dist/http-limits.js";

test("HTTP limiter: per-IP burst, refill and Retry-After", () => {
  let now = 0;
  const limiter = new HttpRateLimiter({ ...DEFAULT_HTTP_LIMITS, ipPerMinute: 120, ipBurst: 2 }, () => now);
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("one"), 1);
  assert.equal(limiter.take("two"), 0);
  now = 500;
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("one"), 1);
});

test("HTTP limiter: global budget shared across IPs, denials don't drain other buckets", () => {
  let now = 0;
  const limiter = new HttpRateLimiter({ ...DEFAULT_HTTP_LIMITS, ipBurst: 1, globalBurst: 2, globalPerMinute: 60 }, () => now);
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("one"), 1);
  assert.equal(limiter.take("two"), 0);
  assert.equal(limiter.take("three"), 1);
  now = 1000;
  assert.equal(limiter.take("three"), 0);
});

test("HTTP limiter: bounded IP tracking fails closed and evicts replenished buckets", () => {
  let now = 0;
  const limiter = new HttpRateLimiter({ ...DEFAULT_HTTP_LIMITS, ipBurst: 1, ipPerMinute: 60 }, () => now, 2);
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("two"), 0);
  assert.equal(limiter.take("three"), 1);
  now = 1000;
  assert.equal(limiter.take("three"), 0);
});

test("HTTP limiter: globally rejected new IPs don't consume tracking capacity", () => {
  let now = 0;
  const limiter = new HttpRateLimiter({ ...DEFAULT_HTTP_LIMITS, globalBurst: 1, globalPerMinute: 60 }, () => now, 2);
  assert.equal(limiter.take("one"), 0);
  assert.equal(limiter.take("rejected"), 1);
  now = 1000;
  assert.equal(limiter.take("two"), 0);
});

test("proxy identity ignores spoofed headers from untrusted peers", () => {
  const request = { socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { "x-real-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.1" } };
  assert.equal(clientIpResolver()(request), "127.0.0.1");
  assert.equal(clientIpResolver(["10.0.0.0/8"])(request), "127.0.0.1");
  assert.equal(clientIpResolver(["127.0.0.1/32"])(request), "192.0.2.1");
  request.headers["x-real-ip"] = "192.0.2.1, 192.0.2.2";
  assert.equal(clientIpResolver(["127.0.0.1/32"])(request), "127.0.0.1");
});

test("proxy identity canonicalizes IPv6 and validates configured peers", () => {
  assert.equal(normalizeIp("2001:0db8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(normalizeIp("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeIp("not-an-address"), undefined);
  for (const peer of ["*", "example.com", "127.0.0.1/33", "::1/129", "127.0.0.1/nope"]) {
    assert.throws(() => clientIpResolver([peer]));
  }
});

test("HTTP limits are configurable and invalid environment values fail startup", () => {
  assert.deepEqual(httpLimitsFromEnv({}), DEFAULT_HTTP_LIMITS);
  assert.equal(httpLimitsFromEnv({ HTTP_RATE_LIMIT_PER_IP: "60", HTTP_MAX_SESSIONS: "50" }).maxSessions, 50);
  for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "99999999999999999999"]) {
    assert.throws(() => httpLimitsFromEnv({ HTTP_RATE_LIMIT_PER_IP: value }));
  }
  assert.throws(() => httpLimitsFromEnv({ HTTP_SESSION_IDLE_TIMEOUT_MS: "2147483648" }));
});
