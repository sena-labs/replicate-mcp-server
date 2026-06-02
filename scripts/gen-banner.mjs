#!/usr/bin/env node
/**
 * Generate README hero-banner candidates via Replicate (wide 21:9).
 * Token from REPLICATE_API_TOKEN (.env, gitignored). Out: assets/banner-candidates/.
 *   node scripts/gen-banner.mjs
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
if (!token) { console.error("REPLICATE_API_TOKEN missing (.env)"); process.exit(1); }
const replicate = new Replicate({ auth: token });

const FLUX = "black-forest-labs/flux-1.1-pro";
const RECRAFT = "recraft-ai/recraft-v3";

const specs = [
  { id: "b1_flow", model: FLUX, input: {
    prompt: "Ultra-wide hero banner, deep dark charcoal-navy background, a luminous gradient sweeping from indigo to vivid magenta, abstract generative motifs suggesting image, video and audio synthesis — soft light particles, flowing waveform ribbons, faint frame shapes — premium cinematic modern tech aesthetic, generous dark negative space on the left, no text, no letters, no words.",
    aspect_ratio: "21:9", output_format: "png" } },
  { id: "b2_pipeline", model: FLUX, input: {
    prompt: "Wide tech hero banner, near-black background, an elegant glowing node-graph pipeline of connected circular nodes flowing left to right, lit with an indigo-to-magenta gradient and thin clean connectors, representing an AI orchestration toolbox, minimal premium clean, lots of negative space, no text, no letters.",
    aspect_ratio: "21:9", output_format: "png" } },
  { id: "b3_burst", model: FLUX, input: {
    prompt: "Wide premium product banner, dark charcoal background, on the left a glowing indigo-to-magenta orb/spark emitting a burst of fine multicolor light particles that spread rightward and dissolve into the dark, cinematic depth and glow, suggests generative AI creation, no text, no letters.",
    aspect_ratio: "21:9", output_format: "png" } },
  { id: "b4_recraft", model: RECRAFT, input: {
    prompt: "Wide banner, dark background with an indigo to magenta gradient glow, abstract flowing shapes hinting at image, video and audio generation, minimal premium tech, plenty of dark negative space, no text.",
    size: "1820x1024", style: "digital_illustration" } },
];

const dir = "assets/banner-candidates";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

async function toBuf(out) {
  const item = Array.isArray(out) ? out[0] : out;
  if (item && typeof item.blob === "function") return Buffer.from(await (await item.blob()).arrayBuffer());
  const url = typeof item === "string" ? item : item?.url?.() ?? String(item);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

for (const s of specs) {
  process.stdout.write(`[${s.id}] ${s.model} … `);
  try {
    const buf = await toBuf(await replicate.run(s.model, { input: s.input }));
    writeFileSync(`${dir}/${s.id}.png`, buf);
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}
console.log(`\nReview: ${dir}/`);
