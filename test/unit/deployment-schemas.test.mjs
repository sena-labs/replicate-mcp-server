import { test } from "node:test";
import assert from "node:assert/strict";

const {
  ListDeploymentsInputSchema,
  GetDeploymentInputSchema,
  RunDeploymentInputSchema,
} = await import("../../dist/schemas.js");

test("ListDeploymentsInputSchema — default limit 20, bounds enforced", () => {
  assert.equal(ListDeploymentsInputSchema.parse({}).limit, 20);
  assert.equal(ListDeploymentsInputSchema.parse({ limit: 1 }).limit, 1);
  assert.throws(() => ListDeploymentsInputSchema.parse({ limit: 0 }), /greater than or equal to 1/);
  assert.throws(() => ListDeploymentsInputSchema.parse({ limit: 101 }), /less than or equal to 100/);
});

test("GetDeploymentInputSchema — requires deployment", () => {
  assert.equal(
    GetDeploymentInputSchema.parse({ deployment: "me/dep" }).deployment,
    "me/dep",
  );
  assert.throws(() => GetDeploymentInputSchema.parse({ deployment: "" }), /at least 1/);
});

test("RunDeploymentInputSchema — defaults (download true, input {})", () => {
  const r = RunDeploymentInputSchema.parse({ deployment: "me/dep" });
  assert.equal(r.deployment, "me/dep");
  assert.equal(r.download, true);
  assert.deepEqual(r.input, {});
});

test("RunDeploymentInputSchema — accepts input + download + timeout", () => {
  const r = RunDeploymentInputSchema.parse({
    deployment: "me/dep",
    input: { prompt: "hi" },
    download: false,
    timeout_ms: 60_000,
  });
  assert.equal(r.input.prompt, "hi");
  assert.equal(r.download, false);
  assert.equal(r.timeout_ms, 60_000);
});

test("RunDeploymentInputSchema — rejects unknown keys (strict)", () => {
  assert.throws(() =>
    RunDeploymentInputSchema.parse({ deployment: "me/dep", bogus: 1 }),
  );
});

test("RunDeploymentInputSchema — rejects too-small timeout", () => {
  assert.throws(() =>
    RunDeploymentInputSchema.parse({ deployment: "me/dep", timeout_ms: 100 }),
  );
});
