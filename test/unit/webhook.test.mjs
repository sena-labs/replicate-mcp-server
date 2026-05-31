import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const {
  startWebhookReceiver,
  stopWebhookReceiver,
  awaitWebhook,
  cancelPendingWebhook,
  webhookEnabled,
} = await import("../../dist/webhook.js");

const PORT = 39517;
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

before(async () => {
  await startWebhookReceiver(HOST, PORT, BASE);
});

after(async () => {
  await stopWebhookReceiver();
});

function post(id, token, body) {
  return fetch(`${BASE}/webhook/${id}?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("webhook — enabled after start", () => {
  assert.equal(webhookEnabled(), true);
});

test("webhook — valid token + body resolves the awaited promise (204)", async () => {
  const id = randomUUID();
  const token = "tok-valid-123456";
  const p = awaitWebhook(id, token, 5000);
  const res = await post(id, token, JSON.stringify({ status: "succeeded", id }));
  assert.equal(res.status, 204);
  const body = await p;
  assert.equal(body.status, "succeeded");
  assert.equal(body.id, id);
});

test("webhook — wrong token is rejected with 401", async () => {
  const id = randomUUID();
  awaitWebhook(id, "the-real-token-xyz", 5000).catch(() => {});
  const res = await post(id, "wrong-token", "{}");
  assert.equal(res.status, 401);
  cancelPendingWebhook(id);
});

test("webhook — unknown correlation id returns 404", async () => {
  const res = await post(randomUUID(), "whatever", "{}");
  assert.equal(res.status, 404);
});

test("webhook — oversized body is rejected with 413", async () => {
  const id = randomUUID();
  const token = "tok-big-7890123456";
  awaitWebhook(id, token, 5000).catch(() => {});
  // > 1 MB body (MAX_WEBHOOK_BODY_BYTES)
  const big = "x".repeat(1_100_000);
  const res = await post(id, token, big);
  assert.equal(res.status, 413);
  cancelPendingWebhook(id);
});

test("webhook — GET /health returns ok", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});
