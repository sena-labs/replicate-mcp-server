import { test } from "node:test";
import assert from "node:assert/strict";

const { AUDIO_MUSIC_MODELS } = await import("../../dist/models.js");

// refresh_models diffs the catalog-search results (bare "owner/name") against
// the curated registry. A version-pinned curated id (e.g. ace-step) must be
// matched by its bare form, otherwise it would be wrongly surfaced as a "new"
// suggestion and not counted as already-curated. This guards that the curated
// ids whose pin we rely on still normalise to the bare id a search returns.
function bareModelId(id) {
  const colon = id.indexOf(":");
  return colon >= 0 ? id.slice(0, colon) : id;
}

test("ace-step curated id is version-pinned and normalises to its bare owner/name", () => {
  const id = AUDIO_MUSIC_MODELS["ace-step"].id;
  assert.ok(id.includes(":"), "ace-step is expected to be version-pinned");
  assert.equal(bareModelId(id), "lucataco/ace-step");
});

test("bareModelId leaves an unpinned id unchanged", () => {
  assert.equal(bareModelId("riffusion/riffusion"), "riffusion/riffusion");
});
