/**
 * HTML embed builders for image-output tool responses.
 *
 * The MCP server emits three embed blocks per image URL so the chat client
 * can pick the most powerful one it supports:
 *
 *   1. <details>-wrapped iframe with a self-contained viewer (Save + Open +
 *      CSS-only zoom toggle). Renders the image at the chat-column width
 *      with the native aspect ratio.
 *   2. Plain responsive <img> as a fallback when iframe is blocked.
 *   3. Markdown image as the universal last resort.
 *
 * All builders are pure string functions over the source URL. URLs go
 * through {@link encodeUrlForHtmlAttr} (full HTML entity encoding) before
 * interpolation so they cannot escape the attribute or srcdoc context even
 * if the upstream URL ever contained HTML metacharacters.
 */

/** Full HTML entity encoding for any string interpolated into HTML — both
 *  attribute values and text nodes. Defends against accidental structural
 *  breaks if a URL ever contains an HTML metacharacter (Replicate URLs are
 *  alphanumeric in practice, but treat them as untrusted input anyway). */
export function encodeUrlForHtmlAttr(url: string): string {
  return url
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Embed wrapped in a <details> disclosure so the chat shows a compact
 *  "📷 Open viewer" trigger; clicking it expands an iframe whose srcdoc
 *  renders a self-contained viewer with Save / Open / zoom controls. */
export function buildIframeEmbed(url: string): string {
  const urlAttr = encodeUrlForHtmlAttr(url);
  const inner = buildViewerHtml(urlAttr);
  // srcdoc is an attribute value. The outer HTML parser decodes entities
  // before handing the string to the inner document parser, so '&amp;' in
  // the inner HTML would become bare '&' in the parsed attribute value.
  // Double-encode '&' first so it survives the outer parse as '&amp;',
  // then escape single-quotes to stay inside the single-quoted attribute.
  const srcdoc = inner.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
  return (
    `<details>` +
    `<summary>📷 Open image viewer</summary>` +
    `<iframe srcdoc='${srcdoc}' style="width:100%;max-width:100%;height:80vh;border:0;border-radius:8px;margin-top:8px;" loading="lazy"></iframe>` +
    `</details>`
  );
}

/** Self-contained HTML viewer for one image. CSS-only zoom toggle via
 *  `:target` (no inline JavaScript). The viewer offers Save (HTML
 *  `download` attribute) and Open-in-new-tab links, plus a fit/zoom
 *  toggle that flips the image between max-width:100% and natural size. */
export function buildViewerHtml(urlAttr: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>` +
    `html,body{margin:0;padding:0;background:#0a0a0a;color:#eee;font-family:system-ui,sans-serif;min-height:100%;}` +
    `.bar{position:sticky;top:0;display:flex;gap:8px;padding:8px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);z-index:1;}` +
    `.btn{background:rgba(255,255,255,.12);color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:14px;line-height:1;}` +
    `.btn:hover{background:rgba(255,255,255,.22);}` +
    `.wrap{display:flex;align-items:center;justify-content:center;padding:8px;}` +
    `#img{display:block;max-width:100%;height:auto;border-radius:4px;}` +
    `#zoom:target ~ .wrap #img{max-width:none;max-height:none;width:auto;height:auto;}` +
    `#zoom:target ~ .bar .zoom-in{display:none;}` +
    `.zoom-out{display:none;}` +
    `#zoom:target ~ .bar .zoom-out{display:inline-block;}` +
    `</style></head>` +
    `<body>` +
    `<a id="zoom"></a>` +
    `<div class="bar">` +
    `<a class="btn" href="${urlAttr}" download>⬇ Save</a>` +
    `<a class="btn" href="${urlAttr}" target="_blank" rel="noopener">↗ Open full</a>` +
    `<a class="btn zoom-in" href="#zoom">🔍 Zoom</a>` +
    `<a class="btn zoom-out" href="#">↩ Fit</a>` +
    `</div>` +
    `<div class="wrap"><img id="img" src="${urlAttr}" alt="generated image" /></div>` +
    `</body></html>`
  );
}

/** Plain responsive <img> — most chat clients render this even when iframe
 *  is blocked for security. */
export function buildImgEmbed(url: string): string {
  return `<img src="${encodeUrlForHtmlAttr(url)}" alt="generated image" style="max-width:100%;height:auto;display:block;" />`;
}

/** Markdown image — universal last resort. */
export function buildMarkdownEmbed(url: string): string {
  // Encode '(' ')' '[' ']' so a URL containing them can't prematurely close
  // the link target or the alt-text bracket of ![alt](url).
  const safeUrl = url.replace(
    /[()[\]]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `![generated image](${safeUrl})`;
}

/** Map of file extensions to MIME types we support inlining as base64
 *  image content in MCP responses. */
export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};
