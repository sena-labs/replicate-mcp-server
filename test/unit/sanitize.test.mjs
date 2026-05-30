import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize } from "../../dist/replicate.js";

test("alphanumeric kept as-is", () => {
  assert.equal(sanitize("abc123"), "abc123");
});

test("slashes replaced with underscore", () => {
  assert.equal(sanitize("owner/model"), "owner_model");
});

test("colons replaced with underscore", () => {
  assert.equal(sanitize("owner/model:version"), "owner_model_version");
});

test("dots and dashes preserved", () => {
  assert.equal(sanitize("foo-bar.baz_qux"), "foo-bar.baz_qux");
});

test("spaces replaced with underscore", () => {
  assert.equal(sanitize("hello world"), "hello_world");
});

test("special characters replaced", () => {
  assert.equal(sanitize("a@b#c$d"), "a_b_c_d");
});

test("empty string", () => {
  assert.equal(sanitize(""), "");
});

test("length capped at 60", () => {
  const input = "a".repeat(100);
  assert.equal(sanitize(input).length, 60);
});

test("unicode replaced", () => {
  assert.equal(sanitize("café"), "caf_");
});

test("path traversal slashes neutralized", () => {
  // Slashes are the dir-traversal vector. Dots alone are harmless within a
  // single path segment (the result is used as ONE segment via path.join).
  const out = sanitize("../../../etc/passwd");
  assert.ok(!out.includes("/"));
  assert.equal(out, ".._.._.._etc_passwd");
});
