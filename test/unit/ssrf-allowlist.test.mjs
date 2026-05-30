import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllowedDownloadHost } from "../../dist/replicate.js";

test("assertAllowedDownloadHost accepts replicate.delivery", () => {
  assert.doesNotThrow(() =>
    assertAllowedDownloadHost("https://replicate.delivery/xezq/abc/out.png"),
  );
});

test("assertAllowedDownloadHost accepts pbxt.replicate.delivery", () => {
  assert.doesNotThrow(() =>
    assertAllowedDownloadHost("https://pbxt.replicate.delivery/abc"),
  );
});

test("assertAllowedDownloadHost accepts tjzk.replicate.delivery", () => {
  assert.doesNotThrow(() =>
    assertAllowedDownloadHost("https://tjzk.replicate.delivery/abc"),
  );
});

test("assertAllowedDownloadHost accepts replicate.com", () => {
  assert.doesNotThrow(() =>
    assertAllowedDownloadHost("https://replicate.com/account"),
  );
});

test("assertAllowedDownloadHost rejects arbitrary hosts", () => {
  assert.throws(
    () => assertAllowedDownloadHost("https://evil.test/x"),
    /Refusing to download/,
  );
});

test("assertAllowedDownloadHost rejects localhost", () => {
  assert.throws(
    () => assertAllowedDownloadHost("http://localhost:8080/admin"),
    /Refusing to download/,
  );
});

test("assertAllowedDownloadHost rejects file:// URIs", () => {
  // file:// has empty hostname → not in allowlist → reject.
  assert.throws(
    () => assertAllowedDownloadHost("file:///etc/passwd"),
    /Refusing to download/,
  );
});

test("assertAllowedDownloadHost rejects invalid URLs", () => {
  assert.throws(
    () => assertAllowedDownloadHost("not a url"),
    /Refusing to download/,
  );
});

test("assertAllowedDownloadHost case-insensitive on host", () => {
  assert.doesNotThrow(() =>
    assertAllowedDownloadHost("https://REPLICATE.DELIVERY/abc"),
  );
});
