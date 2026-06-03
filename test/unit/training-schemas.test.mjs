import { test } from "node:test";
import assert from "node:assert/strict";

const {
  CreateTrainingInputSchema,
  GetTrainingInputSchema,
  ListTrainingsInputSchema,
  CancelTrainingInputSchema,
} = await import("../../dist/schemas.js");

test("CreateTrainingInputSchema — defaults + minimal valid input", () => {
  const r = CreateTrainingInputSchema.parse({
    model: "ostris/flux-dev-lora-trainer",
    version: "abc123",
    destination: "me/my-lora",
  });
  assert.equal(r.model, "ostris/flux-dev-lora-trainer");
  assert.equal(r.destination, "me/my-lora");
  assert.deepEqual(r.input, {}); // default {}
});

test("CreateTrainingInputSchema — accepts inline version + input object", () => {
  const r = CreateTrainingInputSchema.parse({
    model: "ostris/flux-dev-lora-trainer:abc123",
    destination: "me/my-lora",
    input: { input_images: "https://x/data.zip", steps: 1000 },
  });
  assert.equal(r.input.steps, 1000);
});

test("CreateTrainingInputSchema — rejects empty model", () => {
  assert.throws(
    () => CreateTrainingInputSchema.parse({ model: "", destination: "me/x" }),
    /at least 1|Invalid/,
  );
});

test("CreateTrainingInputSchema — rejects missing destination", () => {
  assert.throws(() =>
    CreateTrainingInputSchema.parse({ model: "owner/name", version: "v" }),
  );
});

test("CreateTrainingInputSchema — rejects unknown keys (strict)", () => {
  assert.throws(() =>
    CreateTrainingInputSchema.parse({
      model: "owner/name",
      version: "v",
      destination: "me/x",
      bogus: true,
    }),
  );
});

test("GetTrainingInputSchema — requires training_id", () => {
  assert.equal(GetTrainingInputSchema.parse({ training_id: "t1" }).training_id, "t1");
  assert.throws(() => GetTrainingInputSchema.parse({ training_id: "" }), /at least 1/);
});

test("CancelTrainingInputSchema — requires training_id", () => {
  assert.equal(
    CancelTrainingInputSchema.parse({ training_id: "t1" }).training_id,
    "t1",
  );
  assert.throws(() => CancelTrainingInputSchema.parse({}));
});

test("ListTrainingsInputSchema — default limit 10, bounds enforced", () => {
  assert.equal(ListTrainingsInputSchema.parse({}).limit, 10);
  assert.equal(ListTrainingsInputSchema.parse({ limit: 50 }).limit, 50);
  assert.throws(() => ListTrainingsInputSchema.parse({ limit: 0 }), /greater than or equal to 1/);
  assert.throws(() => ListTrainingsInputSchema.parse({ limit: 101 }), /less than or equal to 100/);
});
