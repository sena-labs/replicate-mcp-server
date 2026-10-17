import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SERVER_VERSION } from "../../dist/constants.js";

test("release version matches runtime, lockfile, MCP registry and Desktop manifest", async () => {
  const load = async path => JSON.parse(await readFile(new URL("../../" + path, import.meta.url), "utf8"));
  const [pkg, lock, registry, desktop] = await Promise.all([
    load("package.json"), load("package-lock.json"), load("server.json"), load("mcpb/manifest.json"),
  ]);
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(registry.version, pkg.version);
  assert.equal(registry.packages.find(p => p.registryType === "npm").version, pkg.version);
  assert.equal(desktop.version, pkg.version);
});
