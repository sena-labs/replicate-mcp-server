procedio# Ecosystem Sub-Project Design
**Date:** 2026-05-30  
**Project:** replicate-mcp-server  
**Scope:** CI/CD pipeline + `replicate_refresh_models` MCP tool  
**Status:** Approved — pending implementation plan

---

## Background

The project has a working server (v3.0.0, 22 tools, 62 curated models) hosted at
`github.com/sena-labs/replicate-mcp-server` (private). Two ecosystem gaps remain:

1. No automated test pipeline — regressions can slip through silently.
2. The curated model registry (`src/models.ts`) is manually maintained with no mechanism to discover newly popular models on Replicate.

---

## Component 1 — GitHub Actions CI

### File
`.github/workflows/ci.yml`

### Triggers
- Push to `main`
- All pull requests (any branch → main)

### Job: `test`

| Step | Command | Notes |
|------|---------|-------|
| Checkout | `actions/checkout@v4` | |
| Setup Node | `actions/setup-node@v4` | Matrix: **20.x** and **22.x** |
| Cache deps | `actions/cache` on `node_modules` keyed by `package-lock.json` hash | Skip reinstall on cache hit |
| Install | `npm ci` | Clean install from lockfile |
| Test | `npm test` | Runs: `tsc` build → unit tests → stdio smoke test |

### What `npm test` covers
- **Build:** TypeScript compilation (catches type errors)
- **Unit tests:** `test/unit/*.test.mjs` — 14 suites covering args, cost, denylist, embed, URL extraction, filename inference, logger, rate-limit, sanitize, SSRF allowlist, log tail, token pool, transient errors
- **Smoke test:** `test/stdio-test.mjs` — spawns the built server, sends `initialize` + `tools/list`, verifies 22 tools are registered

### No secrets required
All tests are fully offline — no Replicate API calls.

---

## Component 2 — `replicate_refresh_models` MCP Tool

### Purpose
Allow Claude (or any MCP client) to discover popular Replicate models not yet in the curated registry and surface them as actionable suggestions. Does **not** auto-modify `models.ts` — suggestions only; the user decides what to apply.

### Tool name
`replicate_refresh_models`

### Input schema
```typescript
{
  categories?: string[];       // subset of 15 categories; default: all
  min_run_count?: number;      // minimum run_count to surface a model; default: 1000
  limit_per_category?: number; // max suggestions per category; default: 5
}
```

### Algorithm
1. For each requested category, map to 1-2 Replicate search keywords:
   ```
   image       → "image generation"
   video       → "video generation"
   audio       → "music generation"
   tts         → "text to speech"
   llm         → "language model"
   vision      → "image captioning"
   upscale     → "image upscaling"
   bg          → "background removal"
   stt         → "speech recognition"
   inpaint     → "inpainting"
   segment     → "image segmentation"
   embed       → "text embeddings"
   voiceclone  → "voice cloning"
   threed      → "3d generation"
   lipsync     → "lip sync"
   ```
2. Call `replicate.models.search(keyword)` (existing `searchModels` helper).
3. Filter: `run_count >= min_run_count`.
4. Sort: descending by `run_count`.
5. Diff: exclude models whose `owner/name` already appears in the category's registry.
6. Take top `limit_per_category` per category.
7. Return structured list + plain-text summary.

### Output (structuredContent)
```typescript
{
  checked_at: string;          // ISO timestamp
  categories_checked: string[];
  suggestions: Array<{
    category: string;
    owner: string;
    name: string;
    model_id: string;          // "owner/name"
    run_count: number;
    description: string;
    replicate_url: string;
  }>;
  already_curated: number;     // count of models found but already in registry
  total_suggestions: number;
}
```

### Example interaction
```
User: "Check for new popular models"
→ replicate_refresh_models()

Tool returns:
  Found 3 suggestions (checked 15 categories, 2026-05-30):
    image: fal-ai/aura-flow — 2.1M runs
    tts:   suno-ai/bark — 890K runs
    video: wan-video/wan-2.1-turbo — 450K runs

User: "Add the image and tts ones"
→ Claude edits src/models.ts, runs npm test, commits
```

### Implementation location
- Schema: `src/schemas.ts` — `RefreshModelsInputSchema`
- Handler: `src/index.ts` — registered as `replicate_refresh_models`
- No new module needed; reuses existing `searchModels()` from `src/replicate.ts`

---

## Files Changed

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | **New** — CI pipeline |
| `src/schemas.ts` | Add `RefreshModelsInputSchema` + `RefreshModelsInput` type |
| `src/index.ts` | Register `replicate_refresh_models` tool |
| `smithery.yaml` | Add `replicate_refresh_models` to tools list (23 total) |

---

## Out of Scope
- npm publish (deferred)
- Auto-commit of model suggestions (intentionally excluded — human review required)
- Smithery submission (can be done manually after implementation)

---

## Success Criteria
1. Push to `main` triggers CI; `npm test` passes on Node 20 and 22.
2. Calling `replicate_refresh_models` from Claude Desktop returns a list of candidate models with run counts.
3. Suggestions exclude models already in `REGISTRY`.
4. Tool fails gracefully (returns empty suggestions, no error) when Replicate API is unreachable.
