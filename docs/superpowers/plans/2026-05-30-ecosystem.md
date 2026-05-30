# Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Actions CI and a `replicate_refresh_models` MCP tool that discovers popular Replicate models not yet in the curated registry.

**Architecture:** CI runs `npm test` (build + unit tests + stdio smoke) on push/PR across Node 20+22. The refresh tool reuses the existing `searchModels()` helper, diffs results against the in-memory REGISTRY, and returns suggestions as structured output without modifying any files.

**Tech Stack:** GitHub Actions, Node.js 20/22, TypeScript, Zod, Replicate Node SDK

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `.github/workflows/ci.yml` | **Create** | Run `npm test` on push/PR, Node 20+22 matrix |
| `test/stdio-test.mjs` | **Modify** | Fix expected tool list (19→23→24) |
| `src/schemas.ts` | **Modify** | Add `RefreshModelsInputSchema` + `RefreshModelsInput` type |
| `src/index.ts` | **Modify** | Register `replicate_refresh_models` tool handler |
| `smithery.yaml` | **Modify** | Add `replicate_refresh_models` to tools list (→24) |

---

## Task 1: Fix broken stdio smoke test (19→23 tools)

The smoke test still lists 19 tools; the server now registers 23
(`replicate_clone_voice`, `replicate_generate_3d`, `replicate_lipsync`,
`replicate_upload_file` were added but never reflected in the test).

**Files:**
- Modify: `test/stdio-test.mjs`

- [ ] **Step 1.1: Run the current test suite to confirm it fails**

```bash
npm test 2>&1 | tail -30
```

Expected: failure mentioning `unexpected tools: replicate_clone_voice,...`

- [ ] **Step 1.2: Update the expected tool list in the smoke test**

In `test/stdio-test.mjs`, replace the `expected` array (lines ~93-113) with:

```javascript
    const expected = [
      "replicate_cancel_prediction",
      "replicate_chat",
      "replicate_clone_voice",
      "replicate_embed_text",
      "replicate_estimate_cost",
      "replicate_generate_3d",
      "replicate_generate_audio",
      "replicate_generate_image",
      "replicate_generate_speech",
      "replicate_generate_video",
      "replicate_get_model_schema",
      "replicate_get_prediction",
      "replicate_inpaint",
      "replicate_lipsync",
      "replicate_list_predictions",
      "replicate_remove_background",
      "replicate_run_model",
      "replicate_search_models",
      "replicate_segment",
      "replicate_transcribe_audio",
      "replicate_upload_file",
      "replicate_upscale_image",
      "replicate_vision",
    ];
```

Also update the count log message from `19` to `23`:

```javascript
    if (!missing.length && !extra.length) ok(`tools/list -> 23 tools registered`);
```

- [ ] **Step 1.3: Run tests to confirm they pass**

```bash
npm test 2>&1 | tail -20
```

Expected: all unit tests pass, smoke test shows `tools/list -> 23 tools registered`.

- [ ] **Step 1.4: Commit**

```bash
git add test/stdio-test.mjs
git commit -m "fix: sync stdio smoke test with current 23 tools"
```

---

## Task 2: Add RefreshModels schema (TDD — write test first)

**Files:**
- Create: `test/unit/refresh-models.test.mjs`
- Modify: `src/schemas.ts`

- [ ] **Step 2.1: Write the failing unit test**

Create `test/unit/refresh-models.test.mjs`:

```javascript
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Import from built dist (tests run after tsc)
const { RefreshModelsInputSchema } = await import("../../dist/schemas.js");

test("RefreshModelsInputSchema — defaults applied when fields omitted", () => {
  const result = RefreshModelsInputSchema.parse({});
  assert.equal(result.min_run_count, 1000);
  assert.equal(result.limit_per_category, 5);
  assert.equal(result.categories, undefined);
});

test("RefreshModelsInputSchema — accepts valid full input", () => {
  const result = RefreshModelsInputSchema.parse({
    categories: ["image", "video"],
    min_run_count: 500,
    limit_per_category: 3,
  });
  assert.deepEqual(result.categories, ["image", "video"]);
  assert.equal(result.min_run_count, 500);
  assert.equal(result.limit_per_category, 3);
});

test("RefreshModelsInputSchema — rejects limit_per_category = 0", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ limit_per_category: 0 }),
    /greater than or equal to 1/,
  );
});

test("RefreshModelsInputSchema — rejects limit_per_category > 20", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ limit_per_category: 21 }),
    /less than or equal to 20/,
  );
});

test("RefreshModelsInputSchema — rejects negative min_run_count", () => {
  assert.throws(
    () => RefreshModelsInputSchema.parse({ min_run_count: -1 }),
    /greater than or equal to 0/,
  );
});
```

- [ ] **Step 2.2: Run to confirm failure**

```bash
npm run build 2>&1 | tail -5 && node --test test/unit/refresh-models.test.mjs 2>&1
```

Expected: build succeeds; test fails with `SyntaxError` or `RefreshModelsInputSchema is not exported`.

- [ ] **Step 2.3: Add the schema to `src/schemas.ts`**

At the end of `src/schemas.ts`, before the `/* ---------- Inferred types ---------- */` section, add:

```typescript
/* ---------- Model refresh / discovery ---------- */

export const RefreshModelsInputSchema = z
  .object({
    categories: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Categories to check. Default: all 15 (image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync).",
      ),
    min_run_count: z
      .number()
      .int()
      .min(0)
      .default(1000)
      .describe("Minimum run_count to surface a model. Default: 1000."),
    limit_per_category: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Max suggestions per category (1–20). Default: 5."),
  })
  .strict();
```

And at the very end of the file, after the existing `export type UploadFileInput = ...` line, add:

```typescript
export type RefreshModelsInput = z.infer<typeof RefreshModelsInputSchema>;
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
npm run build 2>&1 | tail -5 && node --test test/unit/refresh-models.test.mjs 2>&1
```

Expected: 5 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/schemas.ts test/unit/refresh-models.test.mjs
git commit -m "feat: add RefreshModelsInputSchema with tests"
```

---

## Task 3: Implement `replicate_refresh_models` tool (TDD — update smoke test first)

**Files:**
- Modify: `test/stdio-test.mjs`
- Modify: `src/index.ts`

- [ ] **Step 3.1: Add `replicate_refresh_models` to smoke test expected list**

In `test/stdio-test.mjs`, insert `"replicate_refresh_models",` into the `expected` array (keep sorted):

```javascript
    const expected = [
      "replicate_cancel_prediction",
      "replicate_chat",
      "replicate_clone_voice",
      "replicate_embed_text",
      "replicate_estimate_cost",
      "replicate_generate_3d",
      "replicate_generate_audio",
      "replicate_generate_image",
      "replicate_generate_speech",
      "replicate_generate_video",
      "replicate_get_model_schema",
      "replicate_get_prediction",
      "replicate_inpaint",
      "replicate_lipsync",
      "replicate_list_predictions",
      "replicate_refresh_models",
      "replicate_remove_background",
      "replicate_run_model",
      "replicate_search_models",
      "replicate_segment",
      "replicate_transcribe_audio",
      "replicate_upload_file",
      "replicate_upscale_image",
      "replicate_vision",
    ];
```

Update count message from `23` to `24`:

```javascript
    if (!missing.length && !extra.length) ok(`tools/list -> 24 tools registered`);
```

- [ ] **Step 3.2: Run to confirm smoke test now fails**

```bash
npm test 2>&1 | grep -E "missing|unexpected|FAIL|24 tools"
```

Expected: `missing tools: replicate_refresh_models`

- [ ] **Step 3.3: Add imports to `src/index.ts`**

In the imports from `"./schemas.js"`, add two lines after `UploadFileInputSchema,` / `type UploadFileInput,`:

```typescript
  RefreshModelsInputSchema,
  type RefreshModelsInput,
```

- [ ] **Step 3.4: Add the tool handler to `src/index.ts`**

Add the following block immediately before the `/* ---------- Run ---------- */` comment at the bottom of `src/index.ts`:

```typescript
/* ---------- Tool: refresh_models ---------- */

/** Maps each curated category to a Replicate search keyword. */
const REFRESH_CATEGORY_KEYWORDS: Record<string, string> = {
  image: "image generation",
  video: "video generation",
  audio: "music generation",
  tts: "text to speech",
  llm: "language model",
  vision: "image captioning",
  upscale: "image upscaling",
  bg: "background removal",
  stt: "speech recognition",
  inpaint: "inpainting",
  segment: "image segmentation",
  embed: "text embeddings",
  voiceclone: "voice cloning",
  threed: "3d generation",
  lipsync: "lip sync",
};

server.registerTool(
  "replicate_refresh_models",
  {
    title: "Discover New Popular Replicate Models",
    description: `Search Replicate for popular models NOT yet in the curated registry. Returns suggestions only — does not modify code.

Use this to find new models worth adding. Then ask Claude to edit src/models.ts with the ones you want.

Args:
  - categories (string[], optional): Which categories to check. Default: all 15 (image, video, audio, tts, llm, vision, upscale, bg, stt, inpaint, segment, embed, voiceclone, threed, lipsync).
  - min_run_count (integer, optional): Minimum run_count threshold. Default: 1000.
  - limit_per_category (integer, optional): Max suggestions per category (1-20). Default: 5.

Returns structuredContent:
  {
    "checked_at": string,
    "categories_checked": string[],
    "suggestions": [{ category, owner, name, model_id, run_count, description, replicate_url }],
    "already_curated": number,
    "total_suggestions": number
  }

Examples:
  - "Check for new popular models" → all categories, min 1000 runs
  - categories=["image","video"], min_run_count=10000 → only top-tier image/video models`,
    inputSchema: RefreshModelsInputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params: RefreshModelsInput): Promise<ToolResponse> => {
    try {
      const targetCategories =
        params.categories ?? Object.keys(REFRESH_CATEGORY_KEYWORDS);

      // Build flat set of all curated model IDs for O(1) diff lookup.
      const allRegistries = [
        IMAGE_MODELS, VIDEO_MODELS, AUDIO_MUSIC_MODELS, TTS_MODELS,
        LLM_MODELS, VISION_MODELS, UPSCALE_MODELS, BG_REMOVAL_MODELS,
        STT_MODELS, INPAINT_MODELS, SEGMENT_MODELS, EMBED_MODELS,
        VOICE_CLONE_MODELS, THREED_MODELS, LIPSYNC_MODELS,
      ];
      const curatedIds = new Set(
        allRegistries.flatMap((r) => Object.values(r).map((m) => m.id)),
      );

      const suggestions: Array<{
        category: string;
        owner: string;
        name: string;
        model_id: string;
        run_count: number;
        description: string;
        replicate_url: string;
      }> = [];
      let alreadyCurated = 0;

      for (const cat of targetCategories) {
        const keyword = REFRESH_CATEGORY_KEYWORDS[cat];
        if (!keyword) continue;

        let models: Awaited<ReturnType<typeof searchModels>>;
        try {
          models = await searchModels(keyword);
        } catch {
          // Skip category when Replicate API is unreachable — graceful degradation.
          continue;
        }

        let added = 0;
        for (const m of models) {
          const modelId = `${m.owner}/${m.name}`;
          if (curatedIds.has(modelId)) {
            alreadyCurated++;
            continue;
          }
          const runCount = m.run_count ?? 0;
          if (runCount < params.min_run_count) continue;
          if (added >= params.limit_per_category) break;

          suggestions.push({
            category: cat,
            owner: m.owner,
            name: m.name,
            model_id: modelId,
            run_count: runCount,
            description: m.description ?? "",
            replicate_url: m.url,
          });
          added++;
        }
      }

      const summary =
        suggestions.length === 0
          ? `No new popular models found (min_run_count=${params.min_run_count}, checked: ${targetCategories.join(", ")}).`
          : `Found ${suggestions.length} suggestion(s) not in registry (${alreadyCurated} already curated):\n\n` +
            suggestions
              .map(
                (s) =>
                  `  ${s.category}: ${s.model_id} — ${s.run_count.toLocaleString()} runs\n    ${s.description}`,
              )
              .join("\n\n");

      const result = {
        checked_at: new Date().toISOString(),
        categories_checked: targetCategories,
        suggestions,
        already_curated: alreadyCurated,
        total_suggestions: suggestions.length,
      };

      return {
        content: [{ type: "text", text: truncate(summary) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return formatError(err);
    }
  },
);
```

- [ ] **Step 3.5: Build and run full test suite**

```bash
npm test 2>&1 | tail -25
```

Expected: all unit tests pass (including new refresh-models suite), smoke test shows `tools/list -> 24 tools registered`.

- [ ] **Step 3.6: Commit**

```bash
git add src/index.ts test/stdio-test.mjs
git commit -m "feat: add replicate_refresh_models tool — discover popular uncurated models"
```

---

## Task 4: Create GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 4.1: Create the workflows directory and CI file**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: Test (Node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: ["20.x", "22.x"]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build and test
        run: npm test
```

- [ ] **Step 4.2: Verify the file looks correct**

```bash
cat .github/workflows/ci.yml
```

Expected: YAML as written above, no tabs, no trailing spaces.

- [ ] **Step 4.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow — Node 20+22 matrix"
```

---

## Task 5: Update smithery.yaml and push everything

**Files:**
- Modify: `smithery.yaml`

- [ ] **Step 5.1: Add `replicate_refresh_models` to smithery.yaml tools list**

In `smithery.yaml`, replace the comment and tools list:

```yaml
# 24 tools registered. Keep this in sync with src/index.ts.
tools:
  - replicate_generate_image
  - replicate_generate_video
  - replicate_generate_audio
  - replicate_generate_speech
  - replicate_chat
  - replicate_vision
  - replicate_upscale_image
  - replicate_remove_background
  - replicate_transcribe_audio
  - replicate_inpaint
  - replicate_segment
  - replicate_embed_text
  - replicate_clone_voice
  - replicate_generate_3d
  - replicate_lipsync
  - replicate_refresh_models
  - replicate_list_predictions
  - replicate_cancel_prediction
  - replicate_estimate_cost
  - replicate_run_model
  - replicate_search_models
  - replicate_get_model_schema
  - replicate_get_prediction
  - replicate_upload_file
```

- [ ] **Step 5.2: Run final full test to confirm nothing broken**

```bash
npm test 2>&1 | tail -15
```

Expected: clean pass on all tests.

- [ ] **Step 5.3: Commit and push**

```bash
git add smithery.yaml
git commit -m "chore: update smithery.yaml to 24 tools"
git push
```

Expected: push succeeds; GitHub Actions CI run triggers on the `main` branch push.

- [ ] **Step 5.4: Verify CI triggered on GitHub**

Open: `https://github.com/sena-labs/replicate-mcp-server/actions`

Expected: a workflow run appears, turns green within ~3 minutes.

---

## Self-Review

**Spec coverage:**
- ✓ CI workflow on push + PR, Node 20+22 — Task 4
- ✓ `replicate_refresh_models` tool with categories/min_run_count/limit_per_category — Task 3
- ✓ Diff against REGISTRY, graceful API failure → empty suggestions — Task 3 step 3.4
- ✓ No auto-modify of models.ts — tool returns text only — Task 3 step 3.4
- ✓ smithery.yaml updated — Task 5

**Placeholder scan:** None found.

**Type consistency:**
- `RefreshModelsInput` defined in Task 2, used in Task 3 ✓
- `RefreshModelsInputSchema.shape` used in `registerTool` — `.strict()` without `.refine()` so `.shape` exists ✓
- `searchModels` return type used in Task 3 matches `src/replicate.ts` exported shape ✓
- `VOICE_CLONE_MODELS`, `THREED_MODELS`, `LIPSYNC_MODELS` imported in `index.ts` from Task (previous session) ✓
