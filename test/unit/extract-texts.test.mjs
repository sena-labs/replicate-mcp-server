import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOutputTexts } from "../../dist/replicate.js";

test("extractOutputTexts returns [] for null/undefined/empty input", () => {
  assert.deepEqual(extractOutputTexts(null), []);
  assert.deepEqual(extractOutputTexts(undefined), []);
  assert.deepEqual(extractOutputTexts(""), []);
});

test("extractOutputTexts returns single-element array for one string", () => {
  assert.deepEqual(extractOutputTexts("Hello"), ["Hello"]);
});

test("extractOutputTexts joins short streamed tokens without separator", () => {
  // Average chunk length 3 — treat as a token stream.
  const out = extractOutputTexts(["Hel", "lo ", "wor", "ld"]);
  assert.equal(out[0], "Hello world");
  assert.deepEqual(out.slice(1), ["Hel", "lo ", "wor", "ld"]);
});

test("extractOutputTexts joins sentence-length chunks with newline", () => {
  // Average chunk length 33 — too long to be a token stream; join with \n
  // so words don't collide ('Hello'+'world' problem).
  const a = "This is a complete sentence one.";
  const b = "This is another complete sentence.";
  const out = extractOutputTexts([a, b]);
  assert.equal(out[0], `${a}\n${b}`);
  assert.deepEqual(out.slice(1), [a, b]);
});

test("extractOutputTexts excludes URLs", () => {
  const out = extractOutputTexts(["text only", "https://x.test/a.png"]);
  // One non-URL string → returned as single-element array.
  assert.deepEqual(out, ["text only"]);
});

test("extractOutputTexts walks nested objects", () => {
  const out = extractOutputTexts({ reply: "answer", role: "assistant" });
  // Two strings collected; both short (≤32) → streaming join with no
  // separator. Order is not specified by JS Object.values, so assert the
  // joined string equals the concatenation of the segments in order
  // returned.
  assert.equal(out.length, 3); // joined + 2 raw
  assert.equal(out[0], out[1] + out[2]);
});

test("extractOutputTexts excludes empty strings", () => {
  const out = extractOutputTexts(["valid", ""]);
  assert.deepEqual(out, ["valid"]);
});

test("extractOutputTexts ignores non-string primitives", () => {
  assert.deepEqual(extractOutputTexts(42), []);
  assert.deepEqual(extractOutputTexts(true), []);
  assert.deepEqual(extractOutputTexts({ count: 5 }), []);
});

test("extractOutputTexts surfaces text when mixed with URL in object", () => {
  const out = extractOutputTexts({
    image_url: "https://x.test/a.png",
    description: "a red apple",
  });
  assert.deepEqual(out, ["a red apple"]);
});

test("extractOutputTexts handles LLM word-stream array", () => {
  const tokens = ["The ", "quick ", "brown ", "fox"];
  const out = extractOutputTexts(tokens);
  assert.equal(out[0], "The quick brown fox");
  assert.equal(out.length, 5);
});
