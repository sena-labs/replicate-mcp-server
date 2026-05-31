# Smart Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `replicate_recommend_model` tool that ranks curated models in a category by a stated priority (speed/cost/quality/balanced), returning recommendations with cost estimates and reasoning.

**Architecture:** A pure `src/router.ts` module scores models from the registry using speed tiers and `estimateCost`. The tool is a thin wrapper. No model execution, no I/O — fully unit-testable offline. Recommendation only; the caller runs the chosen model via the existing specialized tools.

**Tech Stack:** TypeScript, Zod, existing `estimateCost` (cost.ts), `getCategoryModels` (new accessor in models.ts).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/models.ts` | **Modify** | Add `getCategoryModels(category)` accessor |
| `src/router.ts` | **Create** | `recommendModels`, `Recommendation` type, scoring |
| `test/unit/router.test.mjs` | **Create** | Scoring unit tests |
| `src/schemas.ts` | **Modify** | Add `RecommendModelInputSchema` + type |
| `test/unit/router-schemas.test.mjs` | **Create** | Schema tests |
| `src/index.ts` | **Modify** | Register `replicate_recommend_model` |
| `test/stdio-test.mjs` | **Modify** | Expected tools 28→29 |
| `smithery.yaml` | **Modify** | Add tool (→29), update description |

---

## Task 1: Create `src/router.ts` + accessor (TDD)

**Files:**
- Modify: `src/models.ts`
- Create: `test/unit/router.test.mjs`
- Create: `src/router.ts`

- [ ] **Step 1.1: Add `getCategoryModels` accessor to `src/models.ts`**

At the end of `src/models.ts` (after the `getDefaultInput` function), add:

```typescript
/** Accessor for the curated models in a category. Used by the router
 *  to score/rank without exposing the whole REGISTRY object. */
export function getCategoryModels(
  category: ModelCategory,
): Record<string, CuratedModel> {
  return REGISTRY[category];
}
```

- [ ] **Step 1.2: Write the failing unit test**

Create `test/unit/router.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

const { recommendModels } = await import("../../dist/router.js");

test("recommendModels — speed priority ranks a fast model first (image)", () => {
  const recs = recommendModels({ category: "image", priority: "speed" });
  assert.ok(recs.length > 0);
  assert.equal(recs[0].speed, "fast");
  // flux-schnell is the curated fast image model
  assert.equal(recs[0].key, "flux-schnell");
});

test("recommendModels — cost priority ranks cheapest known-cost model first (image)", () => {
  const recs = recommendModels({ category: "image", priority: "cost" });
  assert.ok(recs.length > 0);
  // Every later rec with a known cost must be >= the first's cost
  const first = recs[0];
  assert.ok(first.est_cost_usd !== null);
  for (const r of recs) {
    if (r.est_cost_usd !== null) {
      assert.ok(r.est_cost_usd >= first.est_cost_usd, `${r.key} cheaper than top`);
    }
  }
});

test("recommendModels — returns at most 5 recommendations", () => {
  const recs = recommendModels({ category: "image", priority: "balanced" });
  assert.ok(recs.length <= 5);
});

test("recommendModels — each rec has key, model_id, speed, score, reason", () => {
  const recs = recommendModels({ category: "tts", priority: "balanced" });
  for (const r of recs) {
    assert.ok(typeof r.key === "string" && r.key.length > 0);
    assert.ok(typeof r.model_id === "string" && r.model_id.includes("/"));
    assert.ok(["fast", "medium", "slow"].includes(r.speed));
    assert.ok(typeof r.score === "number");
    assert.ok(typeof r.reason === "string" && r.reason.length > 0);
    assert.ok(r.est_cost_usd === null || typeof r.est_cost_usd === "number");
  }
});

test("recommendModels — maxCostUsd filters out expensive known-cost models", () => {
  const all = recommendModels({ category: "image", priority: "cost" });
  const capped = recommendModels({ category: "image", priority: "cost", maxCostUsd: 0.01 });
  // Every capped rec with a known cost is <= 0.01
  for (const r of capped) {
    if (r.est_cost_usd !== null) assert.ok(r.est_cost_usd <= 0.01);
  }
  // Capping cannot produce more results than the unfiltered set
  assert.ok(capped.length <= all.length);
});

test("recommendModels — quality priority ranks a non-fast model at or near top (image)", () => {
  const recs = recommendModels({ category: "image", priority: "quality" });
  assert.ok(recs.length > 0);
  // Top quality pick should not be the fastest/cheapest flux-schnell
  assert.notEqual(recs[0].key, "flux-schnell");
});

test("recommendModels — speed keyword bias favors faster models in balanced mode", () => {
  const plain = recommendModels({ category: "image", priority: "balanced" });
  const draft = recommendModels({
    category: "image",
    priority: "balanced",
    taskDescription: "just a quick draft preview",
  });
  // The draft (speed-biased) top pick should be at least as fast as the plain top pick
  const speedRank = { fast: 0, medium: 1, slow: 2 };
  assert.ok(speedRank[draft[0].speed] <= speedRank[plain[0].speed]);
});

test("recommendModels — unknown category-free model keeps null cost without crashing", () => {
  // segment models may lack price entries — must not throw, cost may be null
  const recs = recommendModels({ category: "segment", priority: "balanced" });
  assert.ok(Array.isArray(recs));
  assert.ok(recs.length > 0);
});
```

- [ ] **Step 1.3: Run to confirm failure**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm run build 2>&1 | tail -5 && node --test test/unit/router.test.mjs 2>&1 | tail -5
```

Expected: build succeeds; test fails with `ERR_MODULE_NOT_FOUND` (router.js not built yet).

- [ ] **Step 1.4: Create `src/router.ts`**

Create `src/router.ts` with this exact content:

```typescript
import { estimateCost } from "./cost.js";
import {
  getCategoryModels,
  type ModelCategory,
  type CuratedModel,
} from "./models.js";

export type Priority = "speed" | "cost" | "quality" | "balanced";

export interface Recommendation {
  key: string;
  model_id: string;
  speed: "fast" | "medium" | "slow";
  est_cost_usd: number | null;
  score: number;
  reason: string;
}

const SPEED_SCORE: Record<"fast" | "medium" | "slow", number> = {
  fast: 1.0,
  medium: 0.6,
  slow: 0.3,
};

const SPEED_WORDS = ["draft", "quick", "fast", "preview", "rapid", "iterate"];
const QUALITY_WORDS = [
  "professional",
  "best",
  "high-res",
  "hi-res",
  "print",
  "logo",
  "polished",
  "final",
];

interface Row {
  key: string;
  model: CuratedModel;
  speedScore: number;
  estCost: number | null;
}

export function recommendModels(opts: {
  category: ModelCategory;
  priority: Priority;
  taskDescription?: string;
  maxCostUsd?: number;
  durationSeconds?: number;
}): Recommendation[] {
  const models = getCategoryModels(opts.category);

  const rows: Row[] = Object.entries(models).map(([key, model]) => {
    const est = estimateCost(model.id, 1, opts.durationSeconds);
    const estCost = est.pricing_basis === "unknown" ? null : est.estimated_usd;
    return { key, model, speedScore: SPEED_SCORE[model.speed], estCost };
  });

  const knownCosts = rows
    .map((r) => r.estCost)
    .filter((c): c is number => c !== null);
  const maxCost = knownCosts.length > 0 ? Math.max(...knownCosts) : 0;

  function costNorm(c: number | null): number {
    if (c === null) return 0.5;
    if (maxCost <= 0) return 0;
    return c / maxCost;
  }

  const desc = (opts.taskDescription ?? "").toLowerCase();
  const speedBias = SPEED_WORDS.some((w) => desc.includes(w)) ? 0.15 : 0;
  const qualityBias = QUALITY_WORDS.some((w) => desc.includes(w)) ? 0.15 : 0;

  interface Scored extends Row {
    costScore: number;
    qualityScore: number;
    score: number;
  }

  let scored: Scored[] = rows.map((r) => {
    const cn = costNorm(r.estCost);
    const costScore = 1 - cn;
    const qualityScore = 0.5 * (1 - r.speedScore) + 0.5 * cn;
    let score: number;
    switch (opts.priority) {
      case "speed":
        score = r.speedScore;
        break;
      case "cost":
        score = costScore;
        break;
      case "quality":
        score = qualityScore;
        break;
      case "balanced":
      default: {
        const wSpeed = 0.4 + speedBias;
        const wQuality = 0.3 + qualityBias;
        const wCost = 0.3;
        const total = wSpeed + wQuality + wCost;
        score =
          (wSpeed * r.speedScore + wCost * costScore + wQuality * qualityScore) /
          total;
        break;
      }
    }
    return { ...r, costScore, qualityScore, score };
  });

  if (opts.maxCostUsd !== undefined) {
    const cap = opts.maxCostUsd;
    scored = scored.filter((s) => s.estCost === null || s.estCost <= cap);
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    switch (opts.priority) {
      case "speed":
        return (a.estCost ?? Infinity) - (b.estCost ?? Infinity);
      case "cost":
        return b.speedScore - a.speedScore;
      case "quality":
        return (b.estCost ?? 0) - (a.estCost ?? 0);
      default:
        return b.speedScore - a.speedScore;
    }
  });

  return scored.slice(0, 5).map((s) => ({
    key: s.key,
    model_id: s.model.id,
    speed: s.model.speed,
    est_cost_usd: s.estCost,
    score: Number(s.score.toFixed(3)),
    reason: buildReason(s.model.speed, s.estCost, opts.priority),
  }));
}

function buildReason(
  speed: "fast" | "medium" | "slow",
  estCost: number | null,
  priority: Priority,
): string {
  const costStr =
    estCost === null ? "price unknown" : `~$${estCost.toFixed(4)}/run`;
  switch (priority) {
    case "speed":
      return `${speed} speed (${costStr})`;
    case "cost":
      return estCost === null
        ? `Price unknown (${speed})`
        : `Low cost ${costStr} (${speed})`;
    case "quality":
      return `Quality pick (${speed}, ${costStr})`;
    case "balanced":
    default:
      return `Balanced choice (${speed}, ${costStr})`;
  }
}
```

- [ ] **Step 1.5: Build and run unit tests**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm run build 2>&1 | tail -5 && node --test test/unit/router.test.mjs 2>&1 | tail -8
```

Expected: build succeeds, all 8 tests pass.

If TypeScript errors occur, fix them without weakening logic. Then verify full suite:
```bash
npm test 2>&1 | tail -8
```

- [ ] **Step 1.6: Commit**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && git add src/models.ts src/router.ts test/unit/router.test.mjs && git commit -m "feat: add router.ts — model recommendation scoring engine"
```

---

## Task 2: Add `RecommendModelInputSchema` (TDD)

**Files:**
- Create: `test/unit/router-schemas.test.mjs`
- Modify: `src/schemas.ts`

- [ ] **Step 2.1: Write the failing unit test**

Create `test/unit/router-schemas.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";

const { RecommendModelInputSchema } = await import("../../dist/schemas.js");

test("RecommendModelInputSchema — defaults priority to balanced", () => {
  const result = RecommendModelInputSchema.parse({ category: "image" });
  assert.equal(result.category, "image");
  assert.equal(result.priority, "balanced");
});

test("RecommendModelInputSchema — accepts full valid input", () => {
  const result = RecommendModelInputSchema.parse({
    category: "video",
    priority: "quality",
    task_description: "cinematic hero shot",
    max_cost_usd: 0.5,
    duration_seconds: 6,
  });
  assert.equal(result.category, "video");
  assert.equal(result.priority, "quality");
  assert.equal(result.task_description, "cinematic hero shot");
  assert.equal(result.max_cost_usd, 0.5);
  assert.equal(result.duration_seconds, 6);
});

test("RecommendModelInputSchema — rejects unknown category", () => {
  assert.throws(() => RecommendModelInputSchema.parse({ category: "hologram" }));
});

test("RecommendModelInputSchema — rejects unknown priority", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "image", priority: "cheapest" }),
  );
});

test("RecommendModelInputSchema — rejects max_cost_usd <= 0", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "image", max_cost_usd: 0 }),
    /greater than 0/,
  );
});

test("RecommendModelInputSchema — rejects duration_seconds > 600", () => {
  assert.throws(
    () => RecommendModelInputSchema.parse({ category: "video", duration_seconds: 601 }),
    /less than or equal to 600/,
  );
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm run build 2>&1 | tail -3 && node --test test/unit/router-schemas.test.mjs 2>&1 | tail -5
```

Expected: build succeeds; test fails (schema not exported).

- [ ] **Step 2.3: Add schema to `src/schemas.ts`**

Insert this block BEFORE the `/* ---------- Inferred types ---------- */` comment (after the `PipelineStatusInputSchema` block):

```typescript
/* ---------- Smart routing / recommendation ---------- */

export const RecommendModelInputSchema = z
  .object({
    category: z
      .enum([
        "image",
        "video",
        "audio",
        "tts",
        "llm",
        "vision",
        "upscale",
        "bg",
        "stt",
        "inpaint",
        "segment",
        "embed",
        "voiceclone",
        "threed",
        "lipsync",
      ])
      .describe("Which model category to recommend within."),
    priority: z
      .enum(["speed", "cost", "quality", "balanced"])
      .default("balanced")
      .describe(
        "Optimization target. speed=fastest, cost=cheapest, quality=best, balanced=weighted blend. Default: balanced.",
      ),
    task_description: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Optional task description. Keyword hints (e.g. 'quick draft' or 'professional logo') nudge balanced-mode ranking.",
      ),
    max_cost_usd: z
      .number()
      .gt(0)
      .optional()
      .describe("Optional cap — exclude models whose estimated cost exceeds this."),
    duration_seconds: z
      .number()
      .min(1)
      .max(600)
      .optional()
      .describe(
        "For per-second-priced categories (video, audio), the expected duration used in cost estimation.",
      ),
  })
  .strict();
```

Add this line at the end of the file, after `export type PipelineStatusInput = ...`:

```typescript
export type RecommendModelInput = z.infer<typeof RecommendModelInputSchema>;
```

- [ ] **Step 2.4: Run tests to confirm 6 pass**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm run build 2>&1 | tail -3 && node --test test/unit/router-schemas.test.mjs 2>&1 | tail -6
```

Expected: 6 tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && git add src/schemas.ts test/unit/router-schemas.test.mjs && git commit -m "feat: add RecommendModelInputSchema with tests"
```

---

## Task 3: Register `replicate_recommend_model` (TDD — smoke test first)

**Files:**
- Modify: `test/stdio-test.mjs`
- Modify: `src/index.ts`

- [ ] **Step 3.1: Update smoke test expected list to 29 tools**

In `test/stdio-test.mjs`, add `"replicate_recommend_model",` to the `expected` array (keep sorted — it goes between `replicate_pipeline_status` and `replicate_refresh_models`):

```javascript
      "replicate_pipeline_start",
      "replicate_pipeline_status",
      "replicate_recommend_model",
      "replicate_refresh_models",
```

Update the count message from `28` to `29`:

```javascript
    if (!missing.length && !extra.length) ok(`tools/list -> 29 tools registered`);
```

- [ ] **Step 3.2: Confirm smoke test fails**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm test 2>&1 | grep -E "missing|FAIL|29 tools"
```

Expected: `missing tools: replicate_recommend_model`

- [ ] **Step 3.3: Add imports to `src/index.ts`**

In the imports from `"./schemas.js"`, add after the `PipelineStatusInputSchema,` / `type PipelineStatusInput,` lines:

```typescript
  RecommendModelInputSchema,
  type RecommendModelInput,
```

Add a new import line after `import { createPipeline, getPipeline, startPipelineGC } from "./pipeline.js";`:

```typescript
import { recommendModels } from "./router.js";
```

- [ ] **Step 3.4: Add the tool handler to `src/index.ts`**

Add this block immediately BEFORE the `/* ---------- Tool: pipeline_start ---------- */` comment:

```typescript
/* ---------- Tool: recommend_model ---------- */

server.registerTool(
  "replicate_recommend_model",
  {
    title: "Recommend the Best Model for a Task",
    description: `Rank the curated models in a category by a priority (speed, cost, quality, or balanced) and return recommendations with cost estimates and reasoning. This does NOT run anything — it advises which model to use.

Workflow: call this to pick a model, then call the matching generate tool (e.g. replicate_generate_image) with model set to the recommended key.

Args:
  - category (required): One of image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync.
  - priority (default "balanced"): "speed" (fastest), "cost" (cheapest), "quality" (best), or "balanced" (weighted).
  - task_description (optional): Free text. Keyword hints like "quick draft" or "professional logo" nudge balanced ranking.
  - max_cost_usd (optional): Exclude models estimated above this cost.
  - duration_seconds (optional, 1–600): For per-second-priced categories (video, audio), used in cost estimation.

Returns structuredContent:
  {
    category, priority,
    recommendations: [{ key, model_id, speed, est_cost_usd, score, reason }],  // top 5
    count
  }

Examples:
  - category="image", priority="speed" → flux-schnell first
  - category="image", priority="quality" → highest-fidelity model first
  - category="video", priority="cost", duration_seconds=5 → cheapest per-5s clip`,
    inputSchema: RecommendModelInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: RecommendModelInput): Promise<ToolResponse> => {
    try {
      const recommendations = recommendModels({
        category: params.category,
        priority: params.priority ?? "balanced",
        taskDescription: params.task_description,
        maxCostUsd: params.max_cost_usd,
        durationSeconds: params.duration_seconds,
      });

      const summary =
        recommendations.length === 0
          ? `No models found for category "${params.category}".`
          : `Top ${recommendations.length} ${params.category} models for priority "${params.priority ?? "balanced"}":\n\n` +
            recommendations
              .map(
                (r, i) =>
                  `${i + 1}. ${r.key} (${r.model_id})\n   ${r.reason} · score ${r.score}`,
              )
              .join("\n");

      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: {
          category: params.category,
          priority: params.priority ?? "balanced",
          recommendations,
          count: recommendations.length,
        },
      };
    } catch (err) {
      return formatError(err);
    }
  },
);
```

- [ ] **Step 3.5: Build and run full test suite**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm test 2>&1 | tail -20
```

Expected: ALL CHECKS PASSED, `tools/list -> 29 tools registered`. Fix any TS errors.

- [ ] **Step 3.6: Commit**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && git add src/index.ts test/stdio-test.mjs && git commit -m "feat: register replicate_recommend_model tool"
```

---

## Task 4: Update `smithery.yaml` and Push

**Files:**
- Modify: `smithery.yaml`

- [ ] **Step 4.1: Update smithery.yaml**

In `smithery.yaml`, change the comment `# 28 tools registered.` to `# 29 tools registered.` and add `  - replicate_recommend_model` to the tools list (after `  - replicate_pipeline_status`):

```yaml
  - replicate_pipeline_start
  - replicate_pipeline_status
  - replicate_recommend_model
  - replicate_list_predictions
```

Also update the `description:` field — change `28 tools` to `29 tools`.

- [ ] **Step 4.2: Run final test**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && npm test 2>&1 | tail -5
```

Expected: ALL CHECKS PASSED.

- [ ] **Step 4.3: Commit and push**

```bash
cd "C:\WorkSpace\Project\github.com\replicate-mcp-server" && git add smithery.yaml && git commit -m "chore: update smithery.yaml to 29 tools" && GIT_TERMINAL_PROMPT=0 git push 2>&1 | tail -2
```

---

## Self-Review

**Spec coverage:**
- ✓ `recommendModels` pure scoring (speed/cost/quality/balanced) — Task 1 step 1.4
- ✓ `getCategoryModels` accessor — Task 1 step 1.1
- ✓ speed_score tiers, cost normalization, quality heuristic — Task 1 step 1.4
- ✓ keyword bias (speed/quality words) on balanced — Task 1 step 1.4
- ✓ maxCostUsd filter (keeps unknown-cost) — Task 1 step 1.4
- ✓ top-5 ranked with reason — Task 1 step 1.4
- ✓ `RecommendModelInputSchema` — Task 2
- ✓ `replicate_recommend_model` tool, readOnly — Task 3
- ✓ smoke test 28→29 — Task 3 step 3.1
- ✓ smithery 29 — Task 4

**Placeholder scan:** None.

**Type consistency:**
- `Recommendation` type defined Task 1, used in handler Task 3 ✓
- `recommendModels` signature: `{category, priority, taskDescription?, maxCostUsd?, durationSeconds?}` — Task 1 def matches Task 3 call ✓
- `RecommendModelInput` type defined Task 2, used Task 3 ✓
- `RecommendModelInputSchema.shape` — `.strict()` without `.refine()`, `.shape` exists ✓
- `getCategoryModels` exported Task 1.1, imported by router Task 1.4 ✓
- `params.priority ?? "balanced"` — defensive default matches schema default ✓
- category enum (15) matches `ModelCategory` union ✓
