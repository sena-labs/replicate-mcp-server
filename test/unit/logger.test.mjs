import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const loggerPath = resolve(__dirname, "..", "..", "dist", "logger.js");

/** Run a tiny Node program that imports the logger, captures stderr.
 *  Done as subprocess so we can inject LOG_LEVEL cleanly and get the
 *  active-level binding at module load time. */
function runWithLevel(level, body) {
  const code = `
    import { logger, log } from "file://${loggerPath.replace(/\\/g, "/")}";
    ${body}
  `;
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      env: { ...process.env, LOG_LEVEL: level },
      encoding: "utf8",
    },
  );
  return { stderr: r.stderr, status: r.status };
}

test("logger emits valid JSON on stderr when level passes threshold", () => {
  const { stderr } = runWithLevel(
    "info",
    `logger.info("test_event", { foo: "bar", n: 42 });`,
  );
  const line = stderr.trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.event, "test_event");
  assert.equal(parsed.foo, "bar");
  assert.equal(parsed.n, 42);
  assert.ok(typeof parsed.ts === "string");
});

test("logger drops below-threshold calls (info active → debug silent)", () => {
  const { stderr } = runWithLevel(
    "info",
    `logger.debug("debug_event"); logger.info("info_event");`,
  );
  // Only the info line should be present.
  const lines = stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, "info_event");
});

test("logger debug level emits debug entries", () => {
  const { stderr } = runWithLevel(
    "debug",
    `logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e");`,
  );
  const lines = stderr.trim().split("\n");
  assert.equal(lines.length, 4);
});

test("logger error level emits only errors", () => {
  const { stderr } = runWithLevel(
    "error",
    `logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e");`,
  );
  const lines = stderr.trim().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, "e");
});

test("logger falls back to info on invalid LOG_LEVEL", () => {
  const { stderr } = runWithLevel(
    "potato",
    `logger.debug("d"); logger.info("i"); logger.warn("w");`,
  );
  // Info threshold → debug dropped, info+warn kept.
  const lines = stderr.trim().split("\n");
  assert.equal(lines.length, 2);
});
