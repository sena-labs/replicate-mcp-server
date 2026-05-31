import { test } from "node:test";
import assert from "node:assert/strict";

const { predictionSucceeded } = await import("../../dist/replicate.js");

function result(over = {}) {
  return {
    status: "succeeded",
    prediction_id: "p1",
    model: "o/m",
    urls: [],
    local_paths: [],
    ...over,
  };
}

test("predictionSucceeded — true for status succeeded, not pending", () => {
  assert.equal(predictionSucceeded(result({ status: "succeeded" })), true);
});

test("predictionSucceeded — false for timed-out pending result", () => {
  // Timeout: status still in-progress, pending flag set
  assert.equal(
    predictionSucceeded(result({ status: "processing", pending: true })),
    false,
  );
  assert.equal(
    predictionSucceeded(result({ status: "starting", pending: true })),
    false,
  );
});

test("predictionSucceeded — false for canceled", () => {
  assert.equal(predictionSucceeded(result({ status: "canceled" })), false);
});

test("predictionSucceeded — false for failed", () => {
  assert.equal(predictionSucceeded(result({ status: "failed" })), false);
});

test("predictionSucceeded — false if succeeded but pending flag somehow set", () => {
  // Defensive: pending must never coexist with a real success
  assert.equal(
    predictionSucceeded(result({ status: "succeeded", pending: true })),
    false,
  );
});
