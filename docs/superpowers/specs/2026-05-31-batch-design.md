# Batch Sub-Project Design
**Date:** 2026-05-31
**Project:** replicate-mcp-server
**Scope:** Async background batch execution — `replicate_batch_start` + `replicate_batch_status`
**Status:** Approved — pending implementation plan

---

## Background

The server currently runs one prediction at a time per tool call. Users want to process
multiple inputs in parallel — e.g. generate 10 image variants, upscale a folder of images,
or run the same prompt through several models for comparison. Predictions are slow (seconds
to minutes), so a blocking approach only works for small batches.

This sub-project adds two tools: one to start an async batch job (returns immediately with
a `job_id`), and one to poll its status and retrieve results.

---

## Component 1 — `replicate_batch_start` Tool

### Input schema
```typescript
{
  items: Array<{
    model: string;          // curated key or "owner/name[:version]"
    input: Record<string, unknown>;
  }>;                       // 1–50 items
  concurrency?: number;     // 1–10, default 3
  download?: boolean;       // download outputs locally, default true
  timeout_ms_per_item?: number; // per-prediction timeout, default 300000 (5min)
  ttl_hours?: number;       // how long to keep job in memory, 1–72, default 1
}
```

### Behaviour
1. Validates items (1–50), concurrency (1–10), TTL (1–72h).
2. Creates `BatchJob` in the in-memory `jobs` Map with `overall_status: "running"`.
3. Fires `void runBatchWorker(job)` — background, non-blocking.
4. Returns `{ job_id, total, message }` immediately.

### Return
```typescript
{
  job_id: string;       // UUID, use with replicate_batch_status
  total: number;        // number of items queued
  message: string;      // e.g. "Batch of 8 started. Poll replicate_batch_status."
}
```

---

## Component 2 — `replicate_batch_status` Tool

### Input schema
```typescript
{
  job_id: string;
  include_results?: boolean; // include full PredictionResult per item, default true
}
```

### Behaviour
1. Look up job by `job_id`.
2. If expired or not found: return structured error `{ error: "Job not found or expired" }`.
3. Run GC check: delete job if `expires_at < now`.
4. Return current snapshot of job state.

### Return (`structuredContent`)
```typescript
{
  job_id: string;
  overall_status: "running" | "completed" | "partial";
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
  created_at: string;
  expires_at: string;
  items: Array<{
    index: number;
    model: string;
    status: "pending" | "running" | "succeeded" | "failed";
    prediction_id?: string;
    result?: PredictionResult;   // only when include_results=true
    error?: string;
    started_at?: string;
    completed_at?: string;
  }>;
}
```

---

## Component 3 — `src/batch.ts` Module

Owns all state and logic. Keeps `src/index.ts` clean.

### Types
```typescript
interface BatchItem {
  index: number;
  model: string;
  status: "pending" | "running" | "succeeded" | "failed";
  prediction_id?: string;
  result?: PredictionResult;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

interface BatchJob {
  job_id: string;
  overall_status: "running" | "completed" | "partial";
  created_at: string;
  expires_at: string;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
  items: BatchItem[];
}
```

### Exports
```typescript
export function createBatchJob(opts: {
  items: Array<{ model: string; input: Record<string, unknown> }>;
  concurrency: number;
  download: boolean;
  timeoutMsPerItem: number;
  ttlHours: number;
}): BatchJob;

export function getBatchJob(jobId: string): BatchJob | undefined;

export function startGC(): void; // call once at server startup
```

### Worker (`runBatchWorker`)
- Internal async function, called via `void runBatchWorker(job, opts)`.
- `runWithConcurrency` is private to `src/replicate.ts` — `batch.ts` implements its own
  identical worker-pool pattern (~20 lines, no change to `replicate.ts` needed).
- Per item: set `status: "running"`, call `runPrediction(...)`, set result or error, update counters.
- Budget check (`checkBudget`) per item before firing — budget failures recorded as `failed`.
- On worker completion: set `overall_status` to `"completed"` or `"partial"`.

### GC
- **On-demand:** `getBatchJob` checks `expires_at`, deletes and returns `undefined` if expired.
- **Background:** `setInterval` every 10 minutes scans all entries, deletes expired jobs.
- `startGC()` registers the interval (called once from `src/index.ts` at startup).

---

## Files Changed

| File | Action | Responsibility |
|------|--------|---------------|
| `src/batch.ts` | **Create** | Job state, worker, GC |
| `src/schemas.ts` | **Modify** | Add `BatchStartInputSchema`, `BatchStatusInputSchema`, types |
| `src/index.ts` | **Modify** | Import batch module, register 2 tools, call `startGC()` |
| `test/unit/batch.test.mjs` | **Create** | Unit tests for batch.ts logic |
| `test/stdio-test.mjs` | **Modify** | Update expected tools 24→26 |
| `smithery.yaml` | **Modify** | Add 2 tools (→26) |

---

## Out of Scope
- Persistence across server restarts (in-memory only by design)
- Webhook-based completion notification (can be added later)
- Per-batch spend cap (per-item budget check is sufficient)

---

## Success Criteria
1. `replicate_batch_start` returns `job_id` within 200ms regardless of batch size.
2. `replicate_batch_status` reflects real-time progress as predictions complete.
3. Failed items do not abort the batch — all items reach a terminal status.
4. Jobs are purged from memory after `ttl_hours` expires.
5. `npm test` passes with 26 tools registered.
