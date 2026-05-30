import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeUrlForHtmlAttr,
  buildImgEmbed,
  buildIframeEmbed,
  buildViewerHtml,
  buildMarkdownEmbed,
  IMAGE_MIME_BY_EXT,
} from "../../dist/embed.js";

test("encodeUrlForHtmlAttr escapes & first to avoid double-encoding", () => {
  assert.equal(encodeUrlForHtmlAttr("a&b"), "a&amp;b");
  // Ensure already-encoded entities don't get re-encoded incorrectly:
  // input "a&amp;b" → "a&amp;amp;b" (single pass, & is doubled — that's
  // the safe behaviour, not the broken one).
  assert.equal(encodeUrlForHtmlAttr("a&amp;b"), "a&amp;amp;b");
});

test("encodeUrlForHtmlAttr escapes <, >, \", '", () => {
  assert.equal(encodeUrlForHtmlAttr("<"), "&lt;");
  assert.equal(encodeUrlForHtmlAttr(">"), "&gt;");
  assert.equal(encodeUrlForHtmlAttr('"'), "&quot;");
  assert.equal(encodeUrlForHtmlAttr("'"), "&#39;");
});

test("encodeUrlForHtmlAttr preserves clean URLs unchanged", () => {
  const url = "https://replicate.delivery/xezq/abc123/out-0.webp";
  assert.equal(encodeUrlForHtmlAttr(url), url);
});

test("encodeUrlForHtmlAttr handles all metachars together", () => {
  const out = encodeUrlForHtmlAttr(`a<b>"c'&d`);
  assert.equal(out, "a&lt;b&gt;&quot;c&#39;&amp;d");
});

test("buildImgEmbed produces a self-closing img with the encoded URL", () => {
  const html = buildImgEmbed("https://x.test/a.png");
  assert.ok(html.startsWith("<img "));
  assert.ok(html.includes(`src="https://x.test/a.png"`));
  assert.ok(html.includes("max-width:100%"));
});

test("buildImgEmbed escapes a URL containing a double quote", () => {
  const html = buildImgEmbed(`https://x.test/a".png`);
  // The double quote must be entity-encoded so it doesn't terminate
  // the src attribute.
  assert.ok(html.includes("&quot;"));
  assert.ok(!html.includes(`a".png"`));
});

test("buildIframeEmbed wraps a <details>/<summary>/<iframe srcdoc> structure", () => {
  const html = buildIframeEmbed("https://x.test/a.png");
  assert.ok(html.includes("<details>"));
  assert.ok(html.includes("<summary>"));
  assert.ok(html.includes("<iframe srcdoc='"));
  assert.ok(html.includes("</iframe>"));
  assert.ok(html.includes("</details>"));
});

test("buildIframeEmbed escapes ' inside the srcdoc payload", () => {
  // A URL with a single quote must not break the surrounding srcdoc='...'.
  const html = buildIframeEmbed("https://x.test/a'.png");
  assert.ok(!html.includes("a'.png'"));
  // encodeUrlForHtmlAttr converts ' → &#39;; the & is then double-encoded
  // for the srcdoc attribute (outer HTML parser decodes &amp; → &, so the
  // inner document sees &#39; which it decodes to '). Raw &#39; in the
  // srcdoc attribute value would be decoded to ' by the outer parser — the
  // correct form for surviving two parse rounds is &amp;#39;.
  assert.ok(html.includes("&amp;#39;"));
});

test("buildIframeEmbed does NOT contain any inline event handlers", () => {
  // Critical security property: no onclick=, onload=, onerror=, etc.
  const html = buildIframeEmbed("https://x.test/a.png");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "found inline event handler in embed HTML");
});

test("buildIframeEmbed does NOT contain <script> tags", () => {
  const html = buildIframeEmbed("https://x.test/a.png");
  assert.ok(!/<script\b/i.test(html));
});

test("buildViewerHtml provides CSS-only zoom toggle via :target", () => {
  const html = buildViewerHtml("https://x.test/a.png");
  assert.ok(html.includes("#zoom:target"));
  assert.ok(html.includes("zoom-in"));
  assert.ok(html.includes("zoom-out"));
  // No JS handlers.
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
});

test("buildViewerHtml includes Save and Open buttons with the encoded URL", () => {
  const url = "https://x.test/a.png";
  const html = buildViewerHtml(url);
  assert.ok(html.includes(`href="${url}" download`));
  assert.ok(html.includes(`target="_blank" rel="noopener"`));
});

test("buildMarkdownEmbed produces standard markdown image syntax", () => {
  assert.equal(
    buildMarkdownEmbed("https://x.test/a.png"),
    "![generated image](https://x.test/a.png)",
  );
});

test("IMAGE_MIME_BY_EXT covers the inlining-supported extensions", () => {
  assert.equal(IMAGE_MIME_BY_EXT[".webp"], "image/webp");
  assert.equal(IMAGE_MIME_BY_EXT[".png"], "image/png");
  assert.equal(IMAGE_MIME_BY_EXT[".jpg"], "image/jpeg");
  assert.equal(IMAGE_MIME_BY_EXT[".jpeg"], "image/jpeg");
  assert.equal(IMAGE_MIME_BY_EXT[".gif"], "image/gif");
  assert.equal(IMAGE_MIME_BY_EXT[".mp4"], undefined);
});
