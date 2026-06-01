/**
 * Tool-response shaping for the MCP server.
 *
 * Turns a Replicate `PredictionResult` (or an error) into the `content` +
 * `structuredContent` shape MCP clients expect: inline image previews for
 * visual outputs, the model's reply for text outputs, and URL embed blocks so
 * the chat client can render media inline. Pure formatting — no I/O beyond
 * reading already-downloaded files for the base64 preview.
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  CHARACTER_LIMIT,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGES_TOTAL_BYTES,
} from "./constants.js";
import {
  buildIframeEmbed,
  buildImgEmbed,
  buildMarkdownEmbed,
  IMAGE_MIME_BY_EXT,
} from "./embed.js";
import type { PredictionResult } from "./replicate.js";

export type McpTextContent = { type: "text"; text: string };
export type McpImageContent = { type: "image"; data: string; mimeType: string };
export type McpContent = McpTextContent | McpImageContent;
export type ToolResponse = {
  content: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export async function buildInlineImageContent(
  localPaths: string[],
): Promise<McpImageContent[]> {
  // Read all files in parallel; multi-output generations (num_outputs > 1)
  // would otherwise serialise disk I/O on what is naturally an async I/O
  // bound batch.
  const settled = await Promise.all(
    localPaths.map((p) => readOneInlineImage(p)),
  );
  const candidates = settled.filter((x): x is McpImageContent => x !== null);
  // Enforce an aggregate cap so multi-output predictions can't push
  // tens of MB of base64 over a single stdio frame. Inline what fits;
  // surplus images still surface via local_paths + URL embed.
  const accepted: McpImageContent[] = [];
  let total = 0;
  for (const img of candidates) {
    const size = img.data.length;
    if (total + size > MAX_INLINE_IMAGES_TOTAL_BYTES) break;
    accepted.push(img);
    total += size;
  }
  return accepted;
}

async function readOneInlineImage(
  path: string,
): Promise<McpImageContent | null> {
  const mimeType = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mimeType) return null;
  try {
    const buf = await readFile(path);
    if (buf.length === 0 || buf.length > MAX_INLINE_IMAGE_BYTES) return null;
    return { type: "image", data: buf.toString("base64"), mimeType };
  } catch {
    // Unreadable file (deleted, permission denied, etc.) — URL still
    // surfaces via the caption text, so failure here is non-fatal.
    return null;
  }
}

export async function formatPrediction(
  result: PredictionResult,
): Promise<ToolResponse> {
  const structured = result as unknown as Record<string, unknown>;
  const images =
    result.status === "succeeded" && result.local_paths.length > 0
      ? await buildInlineImageContent(result.local_paths)
      : [];

  const content: McpContent[] = [];

  // Text-only predictions (LLM, vision, classifier) — surface the model's
  // reply as the primary content; no inline image and no embed scaffolding.
  if (
    images.length === 0 &&
    result.urls.length === 0 &&
    result.text_output &&
    result.text_output.length > 0
  ) {
    content.push({
      type: "text",
      text: truncate(renderTextOutput(result)),
    });
  } else if (images.length > 0) {
    // Visual prediction with an inline image — lead with the image, follow
    // with the embed caption. Full details remain in structuredContent.
    content.push(...images);
    content.push({ type: "text", text: renderSuccessCaption(result) });
  } else {
    content.push({ type: "text", text: truncate(renderFullSummary(result)) });
  }

  return {
    content,
    structuredContent: structured,
    isError: result.status === "failed",
  };
}

/** For LLM / vision / classifier predictions: show the model's reply as the
 *  main payload, with a one-line meta footer. */
function renderTextOutput(r: PredictionResult): string {
  const lines: string[] = [];
  const texts = r.text_output ?? [];
  // First element of text_output is the joined whole when streaming was
  // detected (multiple short segments). Prefer it when present.
  const primary = texts[0] ?? "";
  lines.push(primary);
  lines.push("");
  lines.push("---");
  const meta: string[] = [r.model];
  if (r.metrics?.predict_time_seconds != null) {
    meta.push(`${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  lines.push(`Model: ${meta.join(" · ")}`);
  return lines.join("\n");
}

function renderSuccessCaption(r: PredictionResult): string {
  const meta: string[] = [r.model];
  if (r.metrics?.predict_time_seconds != null) {
    meta.push(`${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  if (r.local_paths.length > 1) {
    meta.push(`${r.local_paths.length} outputs`);
  }
  const lines: string[] = [];
  lines.push(`Generated — ${meta.join(" · ")}`);
  // Surface Replicate-hosted URLs (expire ~24h) so the assistant can echo
  // them back in the chat. Three formats are provided so the chat UI can
  // pick the most powerful one it supports:
  //   1. HTML <iframe srcdoc=...> — sizes the image to the chat column
  //      width with the image's native aspect ratio (best UX when allowed).
  //   2. HTML <img> with responsive CSS — fallback when iframe is blocked.
  //   3. Markdown image — guaranteed to render in any markdown chat UI.
  if (r.urls.length > 0) {
    lines.push("");
    lines.push(
      r.urls.length === 1
        ? `Image URL: ${r.urls[0]}`
        : "Image URLs:\n" + r.urls.map((u) => `  - ${u}`).join("\n"),
    );
    lines.push("");
    lines.push(
      "To display the image inline in your reply, paste ONE of the following blocks verbatim (try them in order — use the first that renders in the chat UI):",
    );
    lines.push("");
    lines.push("--- Option 1: HTML iframe (responsive, native aspect ratio) ---");
    for (const u of r.urls) lines.push(buildIframeEmbed(u));
    lines.push("");
    lines.push("--- Option 2: HTML <img> (responsive fallback) ---");
    for (const u of r.urls) lines.push(buildImgEmbed(u));
    lines.push("");
    lines.push("--- Option 3: Markdown image (universal fallback) ---");
    for (const u of r.urls) lines.push(buildMarkdownEmbed(u));
  }
  return lines.join("\n");
}

function renderFullSummary(r: PredictionResult): string {
  const lines: string[] = [];
  lines.push(`Status: ${r.status}`);
  lines.push(`Prediction ID: ${r.prediction_id}`);
  lines.push(`Model: ${r.model}`);
  if (r.metrics?.predict_time_seconds != null) {
    lines.push(`Predict time: ${r.metrics.predict_time_seconds.toFixed(2)}s`);
  }
  if (r.pending) {
    lines.push(
      "Prediction did not finish within the timeout. Use replicate_get_prediction with the prediction ID above to retrieve the result later.",
    );
  }
  if (r.error) {
    lines.push(`Error: ${r.error}`);
  }
  if (r.urls.length > 0) {
    lines.push("");
    lines.push("Output URLs (expire ~24h):");
    for (const u of r.urls) lines.push(`  - ${u}`);
  }
  if (r.local_paths.length > 0) {
    lines.push("");
    lines.push("Downloaded files:");
    for (const p of r.local_paths) lines.push(`  - ${p}`);
  }
  if (r.logs_excerpt) {
    lines.push("");
    lines.push("Logs (tail):");
    lines.push(r.logs_excerpt);
  }
  return lines.join("\n");
}

export function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n[Response truncated at ${CHARACTER_LIMIT} chars. Full output available in structuredContent.]`
  );
}

export function formatError(err: unknown, hint?: string): ToolResponse {
  let message: string;
  if (err instanceof z.ZodError) {
    message =
      "Invalid input:\n" +
      err.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  if (hint) message += `\n\nHint: ${hint}`;
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
