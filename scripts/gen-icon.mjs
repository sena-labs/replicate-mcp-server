#!/usr/bin/env node
/**
 * Generate the official project icon via Replicate, into assets/icon.png.
 *
 * This reproduces the icon chosen after a 4-round generation + multi-profile
 * agent review (brand / app-icon-UX / dev-marketing / minimalist critic):
 * a bold indigo->magenta "R" with a subtle 3D extrude on a near-black,
 * full-bleed field. See scripts/gen-icon-batch.mjs for the full candidate set.
 *
 * Token from REPLICATE_API_TOKEN (.env, gitignored) — never hardcode it here.
 * Run: node scripts/gen-icon.mjs
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import Replicate from "replicate";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const token = process.env.REPLICATE_API_TOKEN;
if (!token) {
  console.error("REPLICATE_API_TOKEN missing. Put it in .env (gitignored): REPLICATE_API_TOKEN=r8_...");
  process.exit(1);
}
const replicate = new Replicate({ auth: token });

// Winning prompt (round 4, candidate "n").
const prompt =
  "App icon, full-bleed square. The entire square frame is filled edge to edge " +
  "with a deep dark charcoal-navy background (no border, no canvas, no inner " +
  "badge). Centered on it, one bold geometric sans-serif capital letter R, " +
  "unmistakably an R, filled with a smooth gradient from deep indigo at top to " +
  "vivid magenta at bottom, generous padding around the letter. Completely flat, " +
  "NO gloss, NO bevel, NO highlight, NO sparkle, no other text. Crisp clean " +
  "edges, high contrast, premium minimal, 1:1.";

console.log("Generating icon via black-forest-labs/flux-1.1-pro …");
const out = await replicate.run("black-forest-labs/flux-1.1-pro", {
  input: { prompt, aspect_ratio: "1:1", output_format: "png" },
});

const item = Array.isArray(out) ? out[0] : out;
let buf;
if (item && typeof item.blob === "function") {
  buf = Buffer.from(await (await item.blob()).arrayBuffer());
} else {
  const url = typeof item === "string" ? item : item?.url?.() ?? String(item);
  buf = Buffer.from(await (await fetch(url)).arrayBuffer());
}

if (!existsSync("assets")) mkdirSync("assets");
writeFileSync("assets/icon.png", buf);
console.log(`Saved assets/icon.png (${(buf.length / 1024).toFixed(1)} KB)`);
