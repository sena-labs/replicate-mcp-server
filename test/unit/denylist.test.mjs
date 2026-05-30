import { test } from "node:test";
import assert from "node:assert/strict";
import { stripDenylistedKeys } from "../../dist/replicate.js";

test("stripDenylistedKeys removes webhook fields", () => {
  const out = stripDenylistedKeys({
    prompt: "hi",
    webhook: "https://evil.test/exfil",
  });
  assert.deepEqual(out, { prompt: "hi" });
});

test("stripDenylistedKeys removes all webhook variants", () => {
  const out = stripDenylistedKeys({
    prompt: "hi",
    webhook: "u1",
    webhook_completed: "u2",
    webhook_events_filter: ["start"],
    webhook_filter: "x",
  });
  assert.deepEqual(out, { prompt: "hi" });
});

test("stripDenylistedKeys case-insensitive", () => {
  const out = stripDenylistedKeys({ prompt: "hi", WEBHOOK: "u" });
  assert.deepEqual(out, { prompt: "hi" });
});

test("stripDenylistedKeys returns same reference when no denylist hit", () => {
  const input = { prompt: "hi", aspect_ratio: "1:1" };
  const out = stripDenylistedKeys(input);
  // Optimisation: no copy if nothing to strip.
  assert.equal(out, input);
});

test("stripDenylistedKeys preserves non-denylisted keys", () => {
  const out = stripDenylistedKeys({
    prompt: "hi",
    num_outputs: 2,
    seed: 42,
    nested: { webhook: "still allowed inside extras" },
  });
  assert.deepEqual(out, {
    prompt: "hi",
    num_outputs: 2,
    seed: 42,
    nested: { webhook: "still allowed inside extras" },
  });
});

test("stripDenylistedKeys with empty input", () => {
  assert.deepEqual(stripDenylistedKeys({}), {});
});
