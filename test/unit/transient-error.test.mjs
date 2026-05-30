import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpDownloadError,
  isTransientDownloadError,
} from "../../dist/replicate.js";

test("HttpDownloadError stores url + status + statusText", () => {
  const err = new HttpDownloadError("https://x.test/a", 502, "Bad Gateway");
  assert.equal(err.url, "https://x.test/a");
  assert.equal(err.status, 502);
  assert.equal(err.statusText, "Bad Gateway");
  assert.equal(err.name, "HttpDownloadError");
  assert.ok(err.message.includes("502"));
});

test("isTransientDownloadError: 5xx retried", () => {
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 500, "")),
    true,
  );
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 503, "")),
    true,
  );
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 599, "")),
    true,
  );
});

test("isTransientDownloadError: 4xx NOT retried", () => {
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 401, "")),
    false,
  );
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 403, "")),
    false,
  );
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 404, "")),
    false,
  );
  assert.equal(
    isTransientDownloadError(new HttpDownloadError("u", 422, "")),
    false,
  );
});

test("isTransientDownloadError: TypeError treated as connection error", () => {
  assert.equal(isTransientDownloadError(new TypeError("fetch failed")), true);
});

test("isTransientDownloadError: AbortError treated as transient", () => {
  const e = new Error("aborted");
  e.name = "AbortError";
  assert.equal(isTransientDownloadError(e), true);
});

test("isTransientDownloadError: ECONNRESET via cause.code", () => {
  const e = Object.assign(new Error("socket reset"), {
    cause: { code: "ECONNRESET" },
  });
  assert.equal(isTransientDownloadError(e), true);
});

test("isTransientDownloadError: ETIMEDOUT via cause.code", () => {
  const e = Object.assign(new Error("timeout"), {
    cause: { code: "ETIMEDOUT" },
  });
  assert.equal(isTransientDownloadError(e), true);
});

test("isTransientDownloadError: UND_ERR_SOCKET via cause.code", () => {
  const e = Object.assign(new Error("undici socket"), {
    cause: { code: "UND_ERR_SOCKET" },
  });
  assert.equal(isTransientDownloadError(e), true);
});

test("isTransientDownloadError: unknown error NOT retried", () => {
  assert.equal(isTransientDownloadError(new Error("???")), false);
  assert.equal(isTransientDownloadError("string"), false);
  assert.equal(isTransientDownloadError(null), false);
  assert.equal(isTransientDownloadError(undefined), false);
});

test("isTransientDownloadError: ENOTFOUND (bad host) NOT retried", () => {
  // We deliberately omit ENOTFOUND from the transient list — a missing
  // hostname is a configuration error, not a flaky network.
  const e = Object.assign(new Error("dns"), { cause: { code: "ENOTFOUND" } });
  assert.equal(isTransientDownloadError(e), false);
});
