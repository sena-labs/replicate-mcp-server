import { test } from "node:test";
import assert from "node:assert/strict";

// uploadBase64 calls the Replicate SDK after decoding. We can't hit the network
// here, but we CAN verify the decode/validation logic by checking that bad
// input throws BEFORE any client call, and that good input gets far enough to
// attempt the upload (which then fails on the missing token / network — a
// different, later error than the validation errors we assert on).
const { uploadBase64 } = await import("../../dist/replicate.js");

test("uploadBase64 — rejects empty data", async () => {
  await assert.rejects(() => uploadBase64({ data: "" }), /empty|Invalid|zero/i);
});

test("uploadBase64 — rejects data URI with empty payload", async () => {
  await assert.rejects(
    () => uploadBase64({ data: "data:image/png;base64," }),
    /empty|zero/i,
  );
});

test("uploadBase64 — decodes a valid data URI past validation (fails later, not on decode)", async () => {
  // 1x1 transparent PNG
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  try {
    await uploadBase64({ data: png });
    // If it somehow succeeded (token present), that's fine too.
  } catch (err) {
    // Must NOT be a decode/validation error — those mean we rejected good data.
    assert.doesNotMatch(
      String(err.message),
      /Invalid base64|empty|zero bytes/i,
      `good base64 was wrongly rejected: ${err.message}`,
    );
  }
});

test("uploadBase64 — accepts bare base64 (no data URI prefix)", async () => {
  const bare = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  try {
    await uploadBase64({ data: bare, mimeType: "image/png" });
  } catch (err) {
    assert.doesNotMatch(String(err.message), /Invalid base64|empty|zero bytes/i);
  }
});

test("uploadBase64 — handles data URI with extra mediatype parameters", async () => {
  // data URI carrying a charset param before ;base64 — must still parse.
  const png =
    "data:image/png;charset=binary;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  try {
    await uploadBase64({ data: png });
  } catch (err) {
    assert.doesNotMatch(
      String(err.message),
      /Invalid base64|empty|zero bytes|Only base64|Malformed/i,
      `param data URI wrongly rejected: ${err.message}`,
    );
  }
});

test("uploadBase64 — rejects a non-base64 data URI", async () => {
  await assert.rejects(
    () => uploadBase64({ data: "data:text/plain,Hello%20World" }),
    /Only base64 data URIs/i,
  );
});

test("uploadBase64 — rejects a data URI with no comma", async () => {
  await assert.rejects(
    () => uploadBase64({ data: "data:image/png;base64" }),
    /Malformed data URI/i,
  );
});
