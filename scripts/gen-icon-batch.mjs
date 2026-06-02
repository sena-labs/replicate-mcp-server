#!/usr/bin/env node
/**
 * Generate a batch of icon candidates via Replicate, for visual review.
 *
 * Token from REPLICATE_API_TOKEN (.env, gitignored). Round selectable:
 *   node scripts/gen-icon-batch.mjs            # round 1 (all concepts)
 *   node scripts/gen-icon-batch.mjs r2         # round 2 (refined finalists)
 *
 * Out: assets/candidates/<id>.png
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

const RECRAFT = "recraft-ai/recraft-v3";
const FLUX = "black-forest-labs/flux-1.1-pro";

// Shared design constraints: app icon, single emblem, no text, 1:1.
const base =
  "modern app icon, single centered emblem, flat vector, crisp clean edges, " +
  "bold high-contrast silhouette, rounded-square badge, subtle depth, " +
  "no text, no letters, no words, 1:1, professional product icon";

const ROUNDS = {
  r1: [
    // Concept A — generative spark / orb (media synthesis)
    { id: "a_recraft_icon", model: RECRAFT, input: {
      prompt: `${base}. Emblem: a glowing generative spark bursting into pixels and light rays, indigo to magenta gradient, conveys AI image/video/audio generation.`,
      size: "1024x1024", style: "digital_illustration" } },
    // Concept B — Replicate "R" monogram, geometric
    { id: "b_recraft_mono", model: RECRAFT, input: {
      prompt: `${base}. Emblem: a bold geometric monogram letter R formed from layered media shapes, deep violet and electric pink gradient, minimal, iconic.`,
      size: "1024x1024", style: "digital_illustration/2d_art_poster" } },
    // Concept C — unified media triad (play + image + waveform)
    { id: "c_recraft_triad", model: RECRAFT, input: {
      prompt: `${base}. Emblem: a play-triangle, a mountain image-frame, and a sound waveform fused into one cohesive abstract mark, cyan-violet-magenta gradient, clever negative space.`,
      size: "1024x1024", style: "digital_illustration" } },
    // Concept D — DAG / pipeline nodes (orchestration)
    { id: "d_recraft_dag", model: RECRAFT, input: {
      prompt: `${base}. Emblem: an elegant connected node graph / pipeline of 3-4 nodes flowing into one, suggesting a multimodal orchestration toolbox, teal to purple gradient, balanced, refined.`,
      size: "1024x1024", style: "digital_illustration/handmade_3d" } },
    // Concept E — flux richer take on the spark/orb
    { id: "e_flux_spark", model: FLUX, input: {
      prompt: `${base}. Emblem: a luminous orb emitting a burst of multicolor particles forming image, video and audio symbols, premium 3D-ish gradient indigo magenta on near-black, dribbble, polished.`,
      aspect_ratio: "1:1", output_format: "png" } },
    // Concept F — flux monogram
    { id: "f_flux_mono", model: FLUX, input: {
      prompt: `${base}. Emblem: minimalist abstract letterform R built from a flowing ribbon of light, vibrant violet-to-pink gradient, glossy, on dark background, app store quality.`,
      aspect_ratio: "1:1", output_format: "png" } },
  ],
  r2: [
    // f refined — the Replicate "R", glossy gradient, dark squircle (best from r1)
    { id: "f2_R", model: FLUX, input: {
      prompt: `${base}. Emblem: a single bold rounded sans-serif letter R, sculpted from a glossy smooth gradient flowing violet-blue at top to vivid magenta-pink at bottom, centered on a dark charcoal rounded-square (squircle) badge, soft inner light, premium glassy finish, Apple App Store quality, minimal, no extra glow artifacts.`,
      aspect_ratio: "1:1", output_format: "png" } },
    { id: "f2b_R", model: FLUX, input: {
      prompt: `Premium app icon, dark squircle badge, one clean geometric letter R made of a flowing liquid-chrome gradient (indigo to magenta), subtle 3D bevel, crisp, centered, lots of padding, no text besides the R, on near-black background, dribbble, polished product icon, 1:1.`,
      aspect_ratio: "1:1", output_format: "png" } },
    // e refined — generative spark/orb, cleaner
    { id: "e2_orb", model: FLUX, input: {
      prompt: `${base}. Emblem: a luminous spherical core emitting a clean radial burst of fine light filaments and a few colored particles, indigo core to magenta edges, on a dark charcoal squircle badge, premium glassy depth, balanced and not noisy, app store quality.`,
      aspect_ratio: "1:1", output_format: "png" } },
    // g — node graph / pipeline, premium vector on dark (unique to this server)
    { id: "g_dag", model: FLUX, input: {
      prompt: `${base}. Emblem: an elegant minimal node-graph of four glowing circular nodes connected by smooth lines, flowing left-to-right into a single output node, nodes lit with an indigo-to-magenta gradient, thin clean connectors, on a dark charcoal squircle badge, premium tech aesthetic, represents an AI orchestration pipeline, crisp, balanced.`,
      aspect_ratio: "1:1", output_format: "png" } },
    // h — R fused with a node/spark (identity + function)
    { id: "h_R_node", model: FLUX, input: {
      prompt: `${base}. Emblem: a bold gradient letter R whose leg terminates in a glowing connection node with a small spark, fusing brand identity with generation, violet-to-magenta gradient on a dark charcoal squircle badge, premium glassy, minimal, clever, app store quality.`,
      aspect_ratio: "1:1", output_format: "png" } },
  ],
  r3: [
    // Consensus target: bold unambiguous geometric R, FLAT (no gloss/bevel/sparkle),
    // strict indigo->magenta, dark squircle, generous padding, crisp at small size.
    { id: "i_R_flat", model: FLUX, input: {
      prompt: "Minimal modern app icon. A single bold geometric sans-serif capital letter R, unmistakably an R, filled with a smooth vertical gradient from deep indigo at top to vivid magenta at bottom, centered on a dark charcoal rounded-square (squircle) badge with generous padding. Completely flat design, NO gloss, NO bevel, NO highlights, NO sparkles, NO extra decoration, no text other than the R. High contrast, crisp clean edges, premium minimal product icon, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    { id: "j_R_inverse", model: FLUX, input: {
      prompt: "Minimal modern app icon. A dark charcoal squircle badge whose entire background is a subtle indigo-to-magenta gradient; centered on it, one bold geometric sans-serif capital letter R cut out in clean off-white/light, generous padding, perfectly legible. Flat design, NO gloss, NO bevel, NO sparkle, no other text. Crisp, high contrast, premium, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    // Hybrid: R whose leg terminates in a clean small node (orchestration hint), no glow.
    { id: "k_R_node_clean", model: FLUX, input: {
      prompt: "Minimal modern app icon. A bold geometric capital letter R in an indigo-to-magenta gradient on a dark charcoal squircle; the diagonal leg of the R cleanly terminates in a small solid circular node, a single thin connector hinting at a pipeline, integrated into the letterform. Flat vector, NO glow, NO sparkle, NO bevel, generous padding, crisp, premium, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    // Recraft crisp flat-vector take on the bold R.
    { id: "l_R_recraft", model: RECRAFT, input: {
      prompt: "Flat minimal app icon: one bold geometric sans-serif capital letter R filled with an indigo-to-magenta gradient, centered on a dark charcoal rounded-square badge, generous padding, no gloss, no sparkle, no extra text, crisp clean vector, premium product icon.",
      size: "1024x1024", style: "digital_illustration" } },
    { id: "m_R_recraft_poster", model: RECRAFT, input: {
      prompt: "Minimal modern tech app icon, dark rounded-square badge, a single bold geometric capital letter R in a clean indigo to magenta gradient, lots of padding, flat, high contrast, no gloss, no sparkles, no words besides R, premium.",
      size: "1024x1024", style: "digital_illustration/2d_art_poster" } },
  ],
  r4: [
    // Finalize i_R_flat direction as FULL-BLEED (dark fills the whole frame edge-to-edge).
    { id: "n_R_fullbleed", model: FLUX, input: {
      prompt: "App icon, full-bleed square. The entire square frame is filled edge to edge with a deep dark charcoal-navy background (no border, no canvas, no inner badge). Centered on it, one bold geometric sans-serif capital letter R, unmistakably an R, filled with a smooth gradient from deep indigo at top to vivid magenta at bottom, generous padding around the letter. Completely flat, NO gloss, NO bevel, NO highlight, NO sparkle, no other text. Crisp clean edges, high contrast, premium minimal, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    { id: "o_R_fullbleed", model: FLUX, input: {
      prompt: "Premium minimal app icon, the whole square filled edge-to-edge with near-black dark charcoal. A single bold modern geometric capital letter R centered, filled with an indigo-to-magenta vertical gradient, lots of padding. Pure flat design, no gloss, no bevel, no sparkle, no extra elements, no words besides R. Very high contrast, crisp, ownable, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    // Hybrid finalize: clean R with an integrated node terminal, full-bleed, no glow.
    { id: "p_R_node_fullbleed", model: FLUX, input: {
      prompt: "App icon, full-bleed square filled edge-to-edge with deep dark charcoal-navy. Centered: one bold geometric capital letter R in a smooth indigo-to-magenta gradient; the diagonal leg of the R cleanly ends in a small solid circular node connected by one short straight segment, a subtle nod to a pipeline, fully integrated into the letterform and still clearly an R. Flat design, NO glow, NO bevel, NO sparkle, generous padding, crisp, premium, 1:1.",
      aspect_ratio: "1:1", output_format: "png" } },
    { id: "q_R_recraft_fullbleed", model: RECRAFT, input: {
      prompt: "Full-bleed flat app icon, entire square is a deep dark charcoal background, a single bold geometric sans-serif capital letter R centered, filled with a clean indigo-to-magenta gradient, generous padding, no gloss, no sparkle, no extra text, crisp vector, premium.",
      size: "1024x1024", style: "digital_illustration" } },
  ],
};

const round = process.argv[2] || "r1";
const specs = ROUNDS[round];
if (!specs) { console.error(`Unknown round '${round}'. Have: ${Object.keys(ROUNDS).join(", ")}`); process.exit(1); }

const dir = "assets/candidates";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

async function toBuffer(out) {
  const item = Array.isArray(out) ? out[0] : out;
  if (item && typeof item.blob === "function") return Buffer.from(await (await item.blob()).arrayBuffer());
  const url = typeof item === "string" ? item : item?.url?.() ?? String(item);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

for (const s of specs) {
  process.stdout.write(`[${s.id}] ${s.model} … `);
  try {
    const out = await replicate.run(s.model, { input: s.input });
    const buf = await toBuffer(out);
    writeFileSync(`${dir}/${s.id}.png`, buf);
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}
console.log(`\nDone. Review: ${dir}/`);
