# Pipeline Sub-Project Design
**Date:** 2026-05-31
**Project:** replicate-mcp-server
**Scope:** DAG pipeline executor — `replicate_pipeline_start` + `replicate_pipeline_status`
**Status:** Approved — pending implementation plan

---

## Background

The server can run individual predictions and parallel batches, but has no way to chain
model outputs as inputs to subsequent models. A pipeline connects predictions into a
directed acyclic graph (DAG): step outputs are referenced by downstream steps via template
strings, and independent steps execute concurrently.

Example use case: generate an image → upscale it AND remove its background in parallel →
inpaint the no-background version. Three model calls, two of which run concurrently, zero
manual coordination.

---

## Component 1 — `replicate_pipeline_start` Tool

### Input schema
```typescript
{
  steps: Array<{
    id: string;                     // unique step name within this pipeline
    model: string;                  // "owner/name[:version]" — full Replicate id required
    input: Record<string, unknown>; // may contain "$stepId.field[n]" template references
    depends_on?: string[];          // explicit deps (optional — inferred from $refs if omitted)
  }>;                               // 1–20 steps
  concurrency?: number;             // max parallel steps, 1–5, default 3
  download?: boolean;               // download outputs locally, default true
  timeout_ms_per_step?: number;     // per-step timeout ms, default 300000
  ttl_hours?: number;               // 1–72h, default 1
}
```

### Behaviour
1. Validate: unique step IDs, no unknown `depends_on` references, 1–20 steps.
2. Build `depends_on` for each step: explicit `depends_on` wins; otherwise scan `input` for `"$stepId.*"` patterns.
3. Detect cycles via Kahn's algorithm — reject immediately if cycle found.
4. Create `Pipeline` in the in-memory `pipelines` Map.
5. Fire `void runPipelineWorker(pipeline, opts)` — background, non-blocking.
6. Return `{ pipeline_id, total, message }` immediately.

### Return
```typescript
{ pipeline_id: string; total: number; message: string; }
```

---

## Component 2 — `replicate_pipeline_status` Tool

### Input schema
```typescript
{
  pipeline_id: string;
  include_outputs?: boolean;   // include full PredictionResult per step, default true
}
```

### Behaviour
1. Look up pipeline by `pipeline_id`.
2. If expired or not found: return `{ error: "Pipeline not found or expired" }`.
3. Return current snapshot.

### Return (`structuredContent`)
```typescript
{
  pipeline_id: string;
  overall_status: "running" | "completed" | "partial" | "failed";
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  running: number;
  pending: number;
  created_at: string;
  expires_at: string;
  steps: Array<{
    id: string;
    model: string;
    status: StepStatus;
    prediction_id?: string;
    result?: PredictionResult;       // only when include_outputs=true
    error?: string;
    skip_reason?: string;
    started_at?: string;
    completed_at?: string;
  }>;
}
```

---

## Component 3 — `src/pipeline.ts` Module

### Types
```typescript
type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

interface PipelineStep {
  id: string;
  model: string;
  input: Record<string, unknown>;   // raw (pre-resolution)
  depends_on: string[];
  status: StepStatus;
  prediction_id?: string;
  result?: PredictionResult;
  error?: string;
  skip_reason?: string;
  started_at?: string;
  completed_at?: string;
}

interface Pipeline {
  pipeline_id: string;
  overall_status: "running" | "completed" | "partial" | "failed";
  created_at: string;
  expires_at: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  running: number;
  pending: number;
  steps: PipelineStep[];
}
```

### Exports
```typescript
export function createPipeline(opts: {
  steps: Array<{ id: string; model: string; input: Record<string, unknown>; depends_on?: string[] }>;
  concurrency: number;
  download: boolean;
  timeoutMsPerStep: number;
  ttlHours: number;
}): Pipeline | { error: string };   // returns error string on cycle/validation failure

export function getPipeline(pipelineId: string): Pipeline | undefined;

export function startPipelineGC(): void;
```

### DAG Execution (`runPipelineWorker`)

**Algorithm (Kahn's + concurrency pool):**

```
1. Build in-degree map from depends_on arrays
2. Enqueue all steps with in-degree = 0 into `ready` queue
3. Maintain active set (steps currently running, capped at concurrency)
4. Loop:
   a. While active.size < concurrency and ready is non-empty:
      - Dequeue step from ready
      - Resolve $ref template strings in its input using completed step results
      - Fire runPrediction() for the step (async, tracked in active set)
   b. Await the next active prediction to settle (Promise.race over active set)
   c. Update step status (succeeded/failed), update counters
   d. For each successor of the settled step:
      - If settled step succeeded: decrement successor's in-degree; if 0 → enqueue to ready
      - If settled step failed: recursively mark successor and its descendants as "skipped"
   e. Continue until ready empty and active empty
5. Set pipeline.overall_status
```

### Template String Resolution

Resolved immediately before firing each step. Supported patterns:

| Template | Resolves to |
|----------|-------------|
| `"$stepId.urls[0]"` | `results[stepId].urls[0]` |
| `"$stepId.urls"` | `results[stepId].urls` (full array) |
| `"$stepId.local_paths[0]"` | `results[stepId].local_paths[0]` |
| `"$stepId.text_output[0]"` | `results[stepId].text_output?.[0]` |

Resolution walks every value in the step's `input` object recursively (supports nested objects and arrays). Non-string values pass through unchanged.

### Failed Step Propagation

When step A fails: collect all transitive dependents of A, set each to `status: "skipped"`, `skip_reason: "dependency 'A' failed"`. These steps are never submitted to Replicate.

### GC

Own `setInterval` every 10 minutes, `.unref()`. `getPipeline` performs lazy expiry check and deletion. `startPipelineGC()` called once from `src/index.ts` `main()`.

---

## Files Changed

| File | Action | Responsibility |
|------|--------|---------------|
| `src/pipeline.ts` | **Create** | Pipeline state, DAG executor, template resolver, GC |
| `test/unit/pipeline.test.mjs` | **Create** | Unit tests for pipeline module (cycle detection, dep inference, template resolution) |
| `src/schemas.ts` | **Modify** | Add `PipelineStartInputSchema`, `PipelineStatusInputSchema`, types |
| `test/unit/pipeline-schemas.test.mjs` | **Create** | Unit tests for new schemas |
| `src/index.ts` | **Modify** | Import pipeline, register 2 tools, call `startPipelineGC()` |
| `test/stdio-test.mjs` | **Modify** | Update expected tools 26→28 |
| `smithery.yaml` | **Modify** | Add 2 tools (→28) |

---

## Out of Scope
- Streaming step outputs to downstream steps before completion (step must fully finish first)
- Conditional branching (if step A fails, run step B instead)
- Loops / iteration over arrays of outputs
- Persisting pipeline definitions for reuse

---

## Success Criteria
1. `replicate_pipeline_start` returns `pipeline_id` within 200ms.
2. Independent steps execute concurrently; dependent steps wait for deps.
3. Failed step marks all transitive dependents as `"skipped"`.
4. `"$stepId.urls[0]"` template strings resolve correctly to prior step outputs.
5. Cycle detection rejects invalid pipelines at start time with a clear error.
6. `npm test` passes with 28 tools registered.
