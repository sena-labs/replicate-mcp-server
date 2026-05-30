import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOutputUrls } from "../../dist/replicate.js";

test("string URL returns one URL", () => {
  assert.deepEqual(extractOutputUrls("https://x.test/a.png"), ["https://x.test/a.png"]);
});

test("non-URL string returns empty", () => {
  assert.deepEqual(extractOutputUrls("hello world"), []);
});

test("array of URLs returns all", () => {
  const out = extractOutputUrls(["https://x.test/a.png", "https://x.test/b.png"]);
  assert.deepEqual(out, ["https://x.test/a.png", "https://x.test/b.png"]);
});

test("nested arrays flattened", () => {
  const out = extractOutputUrls([["https://a.test/1"], ["https://b.test/2"]]);
  assert.deepEqual(out, ["https://a.test/1", "https://b.test/2"]);
});

test("object with media keys returns nested URLs", () => {
  const out = extractOutputUrls({
    audio: "https://x.test/a.mp3",
    video: "https://x.test/v.mp4",
    image: "https://x.test/i.png",
  });
  assert.equal(out.length, 3);
  assert.ok(out.includes("https://x.test/a.mp3"));
  assert.ok(out.includes("https://x.test/v.mp4"));
  assert.ok(out.includes("https://x.test/i.png"));
});

test("null/undefined returns empty", () => {
  assert.deepEqual(extractOutputUrls(null), []);
  assert.deepEqual(extractOutputUrls(undefined), []);
});

test("mixed URL and non-URL strings", () => {
  const out = extractOutputUrls(["https://x.test/a", "plain text", "http://b.test/c"]);
  assert.deepEqual(out, ["https://x.test/a", "http://b.test/c"]);
});

test("only http(s) scheme accepted", () => {
  assert.deepEqual(extractOutputUrls("ftp://x.test/a"), []);
  assert.deepEqual(extractOutputUrls("file:///etc/passwd"), []);
  assert.deepEqual(extractOutputUrls("javascript:alert(1)"), []);
});

test("numbers and booleans ignored", () => {
  assert.deepEqual(extractOutputUrls(42), []);
  assert.deepEqual(extractOutputUrls(true), []);
});

test("deeply nested mixed structure", () => {
  const out = extractOutputUrls({
    result: {
      images: [
        { url: "https://a.test/1.png" },
        { url: "https://b.test/2.png" },
      ],
      meta: { id: "abc", count: 2 },
    },
  });
  assert.deepEqual(out, ["https://a.test/1.png", "https://b.test/2.png"]);
});
