#!/usr/bin/env node
/**
 * Composite the abstract hero (assets/banner.png) into a promotional banner
 * with the TEXT as the dominant element and the node-graph as a supporting
 * backdrop: prominent logo + large title + tagline + capability row + stats +
 * distribution pills (Smithery / npm / GitHub). Output: assets/banner-ad.png
 *
 *   node scripts/compose-banner.mjs [srcBanner] [outFile]
 */
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { writeFileSync, existsSync } from "node:fs";

// Read the node-graph backdrop from a dedicated clean-background file when it
// exists so re-running never double-composites text. Falls back to the legacy
// assets/banner.png only if the dedicated bg is missing.
const SRC = process.argv[2] || (existsSync("assets/banner-bg.png") ? "assets/banner-bg.png" : "assets/banner.png");
const OUT = process.argv[3] || "assets/banner-ad.png";
const LOGO = "assets/icon.png";

for (const [path, name] of [
  ["C:/Windows/Fonts/segoeuib.ttf", "Segoe UI Bold"],
  ["C:/Windows/Fonts/seguisb.ttf", "Segoe UI Semibold"],
  ["C:/Windows/Fonts/segoeui.ttf", "Segoe UI"],
  ["C:/Windows/Fonts/arialbd.ttf", "Arial Bold"],
  ["C:/Windows/Fonts/arial.ttf", "Arial"],
]) { try { if (existsSync(path)) GlobalFonts.registerFromPath(path, name); } catch {} }
const HEAVY = GlobalFonts.has("Segoe UI Bold") ? "Segoe UI Bold" : (GlobalFonts.has("Arial Bold") ? "Arial Bold" : "sans-serif");
const SEMI = GlobalFonts.has("Segoe UI Semibold") ? "Segoe UI Semibold" : HEAVY;
const BODY = GlobalFonts.has("Segoe UI") ? "Segoe UI" : (GlobalFonts.has("Arial") ? "Arial" : "sans-serif");

const banner = await loadImage(SRC);
const logo = await loadImage(LOGO);
const W = banner.width, H = banner.height;          // 3136 x 1344
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Base black; node-graph enlarged and kept in the right ~48% as a backdrop so
// the (now larger) text owns the left + centre.
ctx.fillStyle = "#03040a";
ctx.fillRect(0, 0, W, H);
ctx.drawImage(banner, 0.55 * W, 0.10 * H, 0.45 * W, 0.80 * H, 0.52 * W, 0, 0.48 * W, H);

// Scrim over the graphic so the text clearly dominates.
ctx.fillStyle = "rgba(3,5,12,0.24)";
ctx.fillRect(0.50 * W, 0, 0.50 * W, H);

// Left panel darkening so the large text reads on a dark bed across left+centre.
const vg = ctx.createLinearGradient(0, 0, W * 0.58, 0);
vg.addColorStop(0, "rgba(2,4,10,0.97)");
vg.addColorStop(0.7, "rgba(2,4,10,0.6)");
vg.addColorStop(1, "rgba(2,4,10,0)");
ctx.fillStyle = vg;
ctx.fillRect(0, 0, W * 0.62, H);

const X = 200;

// --- Logo tile (+20%) ---
const ls = 322, lx = X, ly = 95, lr = 70;
ctx.save();
ctx.shadowColor = "rgba(168,85,247,0.55)";
ctx.shadowBlur = 96;
roundRectPath(lx, ly, ls, ls, lr);
ctx.fillStyle = "#0b1020";
ctx.fill();
ctx.restore();
ctx.save();
roundRectPath(lx, ly, ls, ls, lr);
ctx.clip();
ctx.drawImage(logo, lx, ly, ls, ls);
ctx.restore();
roundRectPath(lx, ly, ls, ls, lr);
ctx.strokeStyle = "rgba(255,255,255,0.12)";
ctx.lineWidth = 2;
ctx.stroke();

// --- Title (two lines, +20% = dominant) ---
ctx.textBaseline = "alphabetic";
ctx.save();
ctx.shadowColor = "rgba(0,0,0,0.6)";
ctx.shadowBlur = 30;
ctx.font = `187px "${HEAVY}"`;
ctx.fillStyle = "#FFFFFF";
ctx.fillText("Replicate", X, 676);
const t2 = "MCP Server";
const grad = ctx.createLinearGradient(X, 0, X + ctx.measureText(t2).width, 0);
grad.addColorStop(0, "#7C82F8");
grad.addColorStop(0.5, "#A855F7");
grad.addColorStop(1, "#EC4899");
ctx.fillStyle = grad;
ctx.fillText(t2, X, 882);
ctx.restore();

// --- Tagline (+20%) ---
ctx.font = `55px "${BODY}"`;
ctx.fillStyle = "#C8CCDC";
ctx.fillText("The entire Replicate AI catalog — for any MCP client.", X, 978);

// --- Capability row (+20%) ---
ctx.font = `41px "${SEMI}"`;
ctx.fillStyle = "#BE92F2";
try { ctx.letterSpacing = "3px"; } catch {}
ctx.fillText("IMAGE   ·   VIDEO   ·   AUDIO   ·   3D   ·   VOICE   ·   FINE-TUNE", X, 1062);
try { ctx.letterSpacing = "0px"; } catch {}

// --- Stats (+20%) ---
ctx.font = `36px "${BODY}"`;
ctx.fillStyle = "#8A90A7";
ctx.fillText("Waits + downloads · curated + smart routing · batch & pipelines · cost-aware", X, 1127);

// --- Distribution pills (+20%) ---
function pill(x, y, label, accent) {
  ctx.font = `34px "${SEMI}"`;
  const padX = 34, h = 70;
  const w = ctx.measureText(label).width + padX * 2;
  if (accent) {
    ctx.save();
    ctx.shadowColor = "rgba(168,85,247,0.5)";
    ctx.shadowBlur = 30;
    roundRectPath(x, y, w, h, h / 2);
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#6366F1");
    g.addColorStop(1, "#D6409F");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#FFFFFF";
  } else {
    roundRectPath(x, y, w, h, h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    roundRectPath(x, y, w, h, h / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#C8CCDC";
  }
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX, y + h / 2 + 2);
  ctx.textBaseline = "alphabetic";
  return x + w + 22;
}
let px = X;
const py = 1180;
px = pill(px, py, "Available on Smithery", true);
px = pill(px, py, "npm  replicate-mcp-server", false);
px = pill(px, py, "GitHub", false);

const png = canvas.toBuffer("image/png");
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${(png.length / 1024).toFixed(0)} KB, ${W}x${H})`);
console.log(`fonts -> heavy:${HEAVY} | semi:${SEMI} | body:${BODY}`);
