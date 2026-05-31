import { test } from "node:test";
import assert from "node:assert/strict";

const { toCuratedKey } = await import("../../dist/models.js");

test("toCuratedKey — returns short key unchanged when already a key", () => {
  assert.equal(toCuratedKey("audio", "riffusion"), "riffusion");
});

test("toCuratedKey — maps full owner/name id back to the curated key", () => {
  assert.equal(toCuratedKey("audio", "riffusion/riffusion"), "riffusion");
  assert.equal(toCuratedKey("video", "minimax/video-01"), "minimax-video");
});

test("toCuratedKey — strips :version suffix before matching", () => {
  assert.equal(toCuratedKey("audio", "riffusion/riffusion:abc123"), "riffusion");
});

test("toCuratedKey — returns input unchanged for an unknown model", () => {
  assert.equal(toCuratedKey("audio", "someone/unknown-model"), "someone/unknown-model");
});

test("toCuratedKey — works across new categories (lipsync, threed, voiceclone)", () => {
  assert.equal(toCuratedKey("lipsync", "cjwbw/sadtalker"), "sadtalker");
  assert.equal(toCuratedKey("threed", "camenduru/triposr"), "triposr");
  assert.equal(toCuratedKey("voiceclone", "lucataco/xtts-v2"), "xtts-v2");
});
