import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTokenPool, loadTokenPoolFromEnv } from "../../dist/token-pool.js";

test("makeTokenPool: single token, repeated next() returns same", () => {
  const pool = makeTokenPool(["r8_abc"]);
  assert.equal(pool.size, 1);
  assert.equal(pool.next(), "r8_abc");
  assert.equal(pool.next(), "r8_abc");
  assert.equal(pool.next(), "r8_abc");
});

test("makeTokenPool: round-robin across multiple tokens", () => {
  const pool = makeTokenPool(["a", "b", "c"]);
  assert.equal(pool.size, 3);
  assert.equal(pool.next(), "a");
  assert.equal(pool.next(), "b");
  assert.equal(pool.next(), "c");
  assert.equal(pool.next(), "a"); // wraps
  assert.equal(pool.next(), "b");
});

test("makeTokenPool: empty array throws", () => {
  assert.throws(() => makeTokenPool([]), /zero tokens/);
});

test("makeTokenPool: all() exposes the source list", () => {
  const pool = makeTokenPool(["x", "y"]);
  assert.deepEqual(pool.all(), ["x", "y"]);
});

test("loadTokenPoolFromEnv: REPLICATE_API_TOKEN single", () => {
  const pool = loadTokenPoolFromEnv({ REPLICATE_API_TOKEN: "r8_one" });
  assert.equal(pool?.size, 1);
  assert.equal(pool?.next(), "r8_one");
});

test("loadTokenPoolFromEnv: REPLICATE_API_TOKEN_POOL csv", () => {
  const pool = loadTokenPoolFromEnv({
    REPLICATE_API_TOKEN_POOL: "a,b,c",
  });
  assert.equal(pool?.size, 3);
});

test("loadTokenPoolFromEnv: combines single + pool, dedupes", () => {
  const pool = loadTokenPoolFromEnv({
    REPLICATE_API_TOKEN: "a",
    REPLICATE_API_TOKEN_POOL: "b,c,a",
  });
  assert.equal(pool?.size, 3);
  assert.deepEqual(pool?.all(), ["a", "b", "c"]);
});

test("loadTokenPoolFromEnv: ignores empty / whitespace entries", () => {
  const pool = loadTokenPoolFromEnv({
    REPLICATE_API_TOKEN_POOL: "a, , b ,",
  });
  assert.equal(pool?.size, 2);
});

test("loadTokenPoolFromEnv: returns null when no tokens", () => {
  const pool = loadTokenPoolFromEnv({});
  assert.equal(pool, null);
});

test("loadTokenPoolFromEnv: trims whitespace around tokens", () => {
  const pool = loadTokenPoolFromEnv({
    REPLICATE_API_TOKEN_POOL: "  a  ,   b   ",
  });
  assert.deepEqual(pool?.all(), ["a", "b"]);
});
