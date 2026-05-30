import { test } from "node:test";
import assert from "node:assert/strict";
import { tailLogs } from "../../dist/replicate.js";

test("tailLogs returns undefined for null/undefined/empty", () => {
  assert.equal(tailLogs(null), undefined);
  assert.equal(tailLogs(undefined), undefined);
  assert.equal(tailLogs(""), undefined);
  assert.equal(tailLogs("   \n\n  "), undefined);
});

test("tailLogs returns full content when fewer than LOG_TAIL_LINES lines", () => {
  assert.equal(tailLogs("only line"), "only line");
  assert.equal(tailLogs("line a\nline b"), "line a\nline b");
});

test("tailLogs keeps only the last 10 lines", () => {
  const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
  const tail = tailLogs(lines);
  // Last 10: line 15 .. line 24
  assert.ok(tail !== undefined);
  const tailLines = tail.split("\n");
  assert.equal(tailLines.length, 10);
  assert.equal(tailLines[0], "line 15");
  assert.equal(tailLines[9], "line 24");
});

test("tailLogs strips trailing whitespace before slicing", () => {
  const tail = tailLogs("a\nb\n\n\n");
  assert.equal(tail, "a\nb");
});

test("tailLogs handles single trailing newline", () => {
  assert.equal(tailLogs("a\n"), "a");
});

test("tailLogs handles exactly LOG_TAIL_LINES lines", () => {
  const lines = Array.from({ length: 10 }, (_, i) => `L${i}`).join("\n");
  const tail = tailLogs(lines);
  assert.equal(tail, lines);
});
