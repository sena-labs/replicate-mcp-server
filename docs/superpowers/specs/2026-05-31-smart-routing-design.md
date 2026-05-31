# Smart Routing Sub-Project Design
**Date:** 2026-05-31
**Project:** replicate-mcp-server
**Scope:** Model recommendation engine — `replicate_recommend_model` tool
**Status:** Approved — pending implementation plan

---

## Background

The server has 62 curated models across 15 categories. Each category offers several
models with different speed/cost/quality trade-offs (e.g. image: flux-schnell is fast+cheap,
flux-2-max is slow+expensive+best). Today the caller must know which model to pick. Smart
routing adds an advisor that ranks the curated models in a category by a stated priority,
returning recommendations with reasoning and cost estimates.

**Design philosophy:** recommendation, not execution. The router advises; the existing
specialized generate tools execute. This keeps the router a pure, testable function with no
surprise spend and no duplication of per-category input-building logic.

---

## Component 1 — `src/router.ts` (pure scoring module)

### Exports
```typescript
export interface Recommendation {
  key: string;            // curated model key (e.g. "flux-schnell")
  model_id: string;       // full "owner/name"
  speed: "fast" | "medium" | "slow";
  est_cost_usd: number | null;  // null when pricing unknown
  score: number;          // 0–1 ranking score (higher = better fit)
  reason: string;         // human-readable justification
}

export function recommendModels(opts: {
  category: ModelCategory;
  priority: "speed" | "cost" | "quality" | "balanced";
  taskDescription?: string;
  maxCostUsd?: number;
  durationSeconds?: number;
}): Recommendation[];
```

### Algorithm
1. Enumerate all curated models in `REGISTRY[category]`.
2. For each model compute:
   - `speed_score`: `fast → 1.0`, `medium → 0.6`, `slow → 0.3`
   - `est_cost`: via `estimateCost(model_id, 1, durationSeconds)`. `null`/"unknown" basis → treated as unknown.
   - `cost_norm`: cost normalized to [0,1] across the category's known costs (max cost → 1.0). Unknown cost → 0.5.
   - `cost_score`: `1 − cost_norm` (cheaper → higher).
   - `quality_score`: `0.5·(1 − speed_score) + 0.5·cost_norm` (slower + pricier → higher quality proxy).
3. Apply keyword bias from `taskDescription` (case-insensitive, optional):
   - speed words (`draft`, `quick`, `fast`, `preview`, `rapid`, `iterate`) → `+0.15` to effective speed weight
   - quality words (`professional`, `best`, `high-res`, `hi-res`, `print`, `logo`, `polished`, `final`) → `+0.15` to effective quality weight
   - Bias only nudges the `balanced` blend; explicit `priority` always dominates.
4. Compute final `score` per priority:
   - `speed` → `speed_score` (tiebreak: lower cost)
   - `cost` → `cost_score` (tiebreak: higher speed_score)
   - `quality` → `quality_score` (tiebreak: higher cost)
   - `balanced` → `0.4·speed_score + 0.3·cost_score + 0.3·quality_score` (plus keyword bias adjustments)
5. Filter: drop models whose `est_cost` is known and `> maxCostUsd` (when `maxCostUsd` given). Unknown-cost models are kept.
6. Sort by `score` desc (with priority-specific tiebreak), return top 5.

### `reason` string
One line per recommendation, e.g.:
- `"Fastest option (fast, ~$0.0030/run)"`
- `"Best quality for the price (slow, ~$0.0400/run)"`
- `"Cheapest known option (~$0.0010/run)"`

### Dependencies
- `REGISTRY` and `ModelCategory` from `src/models.ts` (REGISTRY is module-private today — export it, or add a `getCategoryModels(category)` accessor). **Decision:** add `export function getCategoryModels(category: ModelCategory): Record<string, CuratedModel>` to `models.ts` to avoid exposing the whole REGISTRY object.
- `estimateCost` from `src/cost.ts`.

---

## Component 2 — `replicate_recommend_model` Tool

### Input schema (`RecommendModelInputSchema`)
```typescript
{
  category: enum(15 categories);     // required
  priority?: "speed" | "cost" | "quality" | "balanced";  // default "balanced"
  task_description?: string;         // optional, max 500 chars
  max_cost_usd?: number;             // optional, > 0
  duration_seconds?: number;         // optional, 1–600, for per-second models
}
```

### Behaviour
1. Validate input.
2. Call `recommendModels(...)`.
3. Return ranked list + plain-text summary.

### Return (`structuredContent`)
```typescript
{
  category: string;
  priority: string;
  recommendations: Recommendation[];   // top 5
  count: number;
}
```

### Annotations
`readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`. No spend, no I/O.

### Example
```
replicate_recommend_model({ category: "image", priority: "speed" })
→ 1. flux-schnell (fast, ~$0.0030/run) — Fastest option
  2. recraft-v3   (medium, ~$0.0400/run)
  ...
Then: replicate_generate_image({ prompt: "...", model: "flux-schnell" })
```

---

## Files Changed

| File | Action | Responsibility |
|------|--------|----------------|
| `src/models.ts` | **Modify** | Add `getCategoryModels(category)` accessor + export `CuratedModel` type if not already |
| `src/router.ts` | **Create** | Scoring engine, `recommendModels`, `Recommendation` type |
| `test/unit/router.test.mjs` | **Create** | Scoring unit tests (each priority, keyword bias, maxCost filter, unknown cost) |
| `src/schemas.ts` | **Modify** | Add `RecommendModelInputSchema` + `RecommendModelInput` type |
| `test/unit/router-schemas.test.mjs` | **Create** | Schema validation tests |
| `src/index.ts` | **Modify** | Register `replicate_recommend_model` tool |
| `test/stdio-test.mjs` | **Modify** | Expected tools 28→29 |
| `smithery.yaml` | **Modify** | Add tool (→29), update description |

---

## Out of Scope
- Auto-execution (`smart_generate`) — recommendation only; Claude calls the generate tool with the chosen `model`.
- Natural-language category classification — caller supplies the category.
- ML / learned ranking — heuristic scoring only.
- Cross-category recommendation — one category per call.

---

## Success Criteria
1. `recommendModels({ category: "image", priority: "speed" })` ranks `flux-schnell` (fast) first.
2. `priority: "cost"` ranks the cheapest known-cost model first.
3. `maxCostUsd` filters out models above the cap (keeps unknown-cost models).
4. Keyword bias nudges `balanced` results (e.g. "quick draft" surfaces faster models).
5. `replicate_recommend_model` returns ranked recommendations with cost + reasoning.
6. `npm test` passes with 29 tools registered.
