import { test } from "node:test";
import assert from "node:assert/strict";
import { inferFilename, contentTypeToExt } from "../../dist/replicate.js";

test("URL with .png extension", () => {
  assert.equal(inferFilename("https://x.test/a.png", null, 0), "output-0.png");
});

test("URL with .webp extension", () => {
  assert.equal(inferFilename("https://x.test/out.webp", null, 1), "output-1.webp");
});

test("URL with .mp4 extension", () => {
  assert.equal(inferFilename("https://x.test/v.mp4", null, 0), "output-0.mp4");
});

test("URL with query string falls through to ext detection", () => {
  // pathname is /a.png — query string is ignored by URL.pathname
  assert.equal(inferFilename("https://x.test/a.png?foo=bar", null, 0), "output-0.png");
});

test("URL with no extension falls back to content-type", () => {
  assert.equal(
    inferFilename("https://x.test/data", "image/png", 0),
    "output-0.png",
  );
});

test("URL with no extension + no content-type returns .bin", () => {
  assert.equal(inferFilename("https://x.test/data", null, 0), "output-0.bin");
});

test("URL with overly long ext falls back to content-type", () => {
  // .extremelylongext > 6 chars → should fall through
  assert.equal(
    inferFilename("https://x.test/a.extremelylongext", "video/mp4", 0),
    "output-0.mp4",
  );
});

test("invalid URL falls back to content-type", () => {
  assert.equal(inferFilename("not a url", "audio/mpeg", 0), "output-0.mp3");
});

test("contentTypeToExt handles charset parameter", () => {
  assert.equal(contentTypeToExt("image/png; charset=binary"), ".png");
});

test("contentTypeToExt handles uppercase", () => {
  assert.equal(contentTypeToExt("IMAGE/JPEG"), ".jpg");
});

test("contentTypeToExt unknown returns .bin", () => {
  assert.equal(contentTypeToExt("application/x-custom"), ".bin");
});

test("contentTypeToExt null returns .bin", () => {
  assert.equal(contentTypeToExt(null), ".bin");
});

test("audio/wav and audio/x-wav both map to .wav", () => {
  assert.equal(contentTypeToExt("audio/wav"), ".wav");
  assert.equal(contentTypeToExt("audio/x-wav"), ".wav");
});

test("index is reflected in filename", () => {
  assert.equal(inferFilename("https://x.test/a.png", null, 7), "output-7.png");
});
