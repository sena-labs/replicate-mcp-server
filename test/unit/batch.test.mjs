import { test } from "node:test";
import assert from "node:assert/strict";

const { createBatchJob, getBatchJob } = await import("../../dist/batch.js");

test("createBatchJob — correct initial state for 2-item batch", () => {
  const job = createBatchJob({
    items: [
      { model: "owner/model-a", input: { prompt: "hello" } },
      { model: "owner/model-b", input: { prompt: "world" } },
    ],
    concurrency: 3,
    download: true,
    timeoutMsPerItem: 60_000,
    ttlHours: 1,
  });

  assert.equal(job.total, 2);
  assert.equal(job.pending, 2);
  assert.equal(job.running, 0);
  assert.equal(job.succeeded, 0);
  assert.equal(job.failed, 0);
  assert.equal(job.overall_status, "running");
  assert.ok(typeof job.job_id === "string" && job.job_id.length > 0);
  assert.equal(job.items.length, 2);
  assert.equal(job.items[0].status, "pending");
  assert.equal(job.items[0].model, "owner/model-a");
  assert.equal(job.items[0].index, 0);
  assert.equal(job.items[1].model, "owner/model-b");
  assert.equal(job.items[1].index, 1);
});

test("createBatchJob — expires_at is ttlHours after created_at", () => {
  const before = Date.now();
  const job = createBatchJob({
    items: [{ model: "owner/model", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerItem: 5_000,
    ttlHours: 2,
  });
  const after = Date.now();

  const created = new Date(job.created_at).getTime();
  const expires = new Date(job.expires_at).getTime();
  const expectedDiff = 2 * 60 * 60 * 1000;

  assert.ok(created >= before && created <= after);
  assert.ok(Math.abs(expires - created - expectedDiff) < 100);
});

test("getBatchJob — returns job for valid id", () => {
  const job = createBatchJob({
    items: [{ model: "owner/model", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerItem: 5_000,
    ttlHours: 1,
  });

  const found = getBatchJob(job.job_id);
  assert.ok(found !== undefined);
  assert.equal(found.job_id, job.job_id);
});

test("getBatchJob — returns undefined for unknown job_id", () => {
  const result = getBatchJob("nonexistent-id-xyz-does-not-exist");
  assert.equal(result, undefined);
});

test("getBatchJob — returns undefined and removes expired job", () => {
  const job = createBatchJob({
    items: [{ model: "owner/model", input: {} }],
    concurrency: 1,
    download: false,
    timeoutMsPerItem: 5_000,
    ttlHours: 1,
  });

  job.expires_at = new Date(Date.now() - 1000).toISOString();

  const result = getBatchJob(job.job_id);
  assert.equal(result, undefined);

  const result2 = getBatchJob(job.job_id);
  assert.equal(result2, undefined);
});
