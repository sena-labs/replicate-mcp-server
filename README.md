# Replicate MCP Server

An [MCP](https://modelcontextprotocol.io) server that gives Claude native access to the full [Replicate](https://replicate.com) catalog: image generation, video, music, speech, upscaling, segmentation, LLMs — anything Replicate hosts.

Once installed in Claude Desktop, you can simply ask:

> _"Generate a cinematic shot of a lighthouse in a storm, 21:9"_
> _"Write a 30-second synthwave track"_
> _"Make a 5-second video of a paper airplane flying through a city"_
> _"Read this paragraph in a British male voice"_
> _"Upscale this image 4x"_

…and Claude calls the right Replicate model, waits for the result, and downloads the output to your machine.

---

## What's inside

19 tools, designed to be both ergonomic for common cases and fully open-ended for everything else:

### Curated generation tools

| Tool | Purpose |
|---|---|
| `replicate_generate_image` | Text → image. Curated: Flux Schnell / Dev / Pro, SD 3.5, Recraft v3, Ideogram v2, Imagen 3. |
| `replicate_generate_video` | Text (or image) → video. Curated: Kling Pro, Minimax, Hunyuan, Luma Ray, Wan 2.2. |
| `replicate_generate_audio` | Text → music / songs. Curated: MusicGen, ACE-Step (full songs with lyrics), Riffusion. |
| `replicate_generate_speech` | Text → speech (TTS). Curated: Kokoro, Minimax Speech, Chatterbox (voice cloning). |
| `replicate_chat` | Text → text via LLM. Curated: Llama 3.1 405B / 70B / 8B, Mistral Large, Mixtral 8x7B, DeepSeek-R1. |
| `replicate_vision` | Image → text. Curated: LLaVA 13B / 1.6 34B, BLIP-2, Qwen2-VL. |
| `replicate_upscale_image` | Image → higher-res image. Curated: Real-ESRGAN, Clarity Upscaler, SwinIR, GFPGAN. |
| `replicate_remove_background` | Image → transparent PNG. Curated: rembg, BiRefNet, BRIA RMBG. |
| `replicate_transcribe_audio` | Audio/video → text (Whisper, Distil-Whisper, WhisperX with diarization). |
| `replicate_inpaint` | Mask-based image edit. Curated: Flux Fill Pro, SD inpaint, Ideogram v2 edit. |
| `replicate_segment` | Image → mask. Curated: SAM 2, Grounded-SAM (text-prompt). |
| `replicate_embed_text` | Text(s) → vector embeddings. Curated: BGE, Jina v3, MPNet. |

### Prediction management + cost

| Tool | Purpose |
|---|---|
| `replicate_list_predictions` | Recent prediction history (id, model, status, timestamps). |
| `replicate_cancel_prediction` | Cancel an in-progress async job by id. |
| `replicate_estimate_cost` | Pre-call USD estimate from a curated price table (40+ models). |

### Generic / discovery tools

| Tool | Purpose |
|---|---|
| `replicate_run_model` | Run **any** Replicate model with arbitrary inputs (escape hatch for embeddings, segmentation, depth, ControlNet, 3D, speech-to-text, code, ...). |
| `replicate_search_models` | Free-text search across the Replicate catalog. |
| `replicate_get_model_schema` | Get the OpenAPI input schema for any model. |
| `replicate_get_prediction` | Poll a long-running prediction (videos, long songs). |

Outputs:
- **Image / video / audio**: downloaded to `~/Downloads/replicate-mcp/<model>/<prediction_id>/` (configurable). Local paths and original Replicate URLs are both returned. For images, the response also includes an **inline base64 preview** plus three embed snippets (`<details>`-wrapped iframe viewer with Save button, responsive `<img>`, or markdown image) so the chat client can render the result inline at full size.
- **Text** (LLM, vision, classifier): the model's reply is surfaced in `text_output` and printed at the top of the tool response so Claude can read it directly.

---

## Prerequisites

- **Node.js ≥ 20** (uses native `fetch` and Web Streams)
- A **Replicate account** with an API token: https://replicate.com/account/api-tokens
- **Claude Desktop** (macOS, Windows, or Linux)

---

## Installation

### 1. Clone and build

```bash
git clone <this-repo> replicate-mcp-server
cd replicate-mcp-server
npm install
npm run build
```

This produces `dist/index.js`, which is the server entry point.

### 2. Get your Replicate API token

1. Go to https://replicate.com/account/api-tokens
2. Click **Create token**
3. Copy the token (starts with `r8_...`)

### 3. Wire it up in Claude Desktop

Find your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the `replicate` entry (merge with anything already there):

```json
{
  "mcpServers": {
    "replicate": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/replicate-mcp-server/dist/index.js"],
      "env": {
        "REPLICATE_API_TOKEN": "r8_your_token_here"
      }
    }
  }
}
```

> ⚠️ Use the **absolute** path to `dist/index.js`. Tildes (`~`) and relative paths don't work in this config.

Optional: set a custom download directory:

```json
"env": {
  "REPLICATE_API_TOKEN": "r8_...",
  "REPLICATE_DOWNLOAD_DIR": "/Users/you/my-replicate-outputs"
}
```

### 4. Restart Claude Desktop

Fully quit and reopen Claude Desktop. You should see "replicate" listed in the tools panel (the hammer icon at the bottom of the chat).

---

## Usage examples

Once installed, just talk to Claude naturally:

**Images**
> Generate an origami fox in a misty forest, 16:9 aspect ratio.

**High-quality images with text**
> Make a logo for a coffee shop called "Crema" — use Recraft.

**Video**
> Create a 5-second video of a paper airplane gliding through a neon-lit city. Use Kling Pro.
>
> _(Videos take 1–5 minutes. If the call times out, Claude will automatically poll with `replicate_get_prediction`.)_

**Music**
> Write a 20-second instrumental synthwave loop with a heavy bassline.

**Songs with lyrics**
> Use the ACE-Step model to generate a sad indie-folk song with these lyrics: [...]

**Speech**
> Read this paragraph in a British female voice: [...]

**Chat with an LLM**
> Ask Llama 3 70B to explain quantum entanglement in two sentences.

**Image understanding**
> Look at this photo [URL] and tell me what objects are in the foreground.

**Upscale**
> Upscale this image 4x with Real-ESRGAN: [URL]

**Background removal**
> Cut the background out of this product photo: [URL]

**Anything else**
> Search Replicate for "speech to text", then transcribe this audio: [URL]
>
> _(Claude picks Whisper via `replicate_search_models` → `replicate_run_model`.)_

---

## How async predictions work

Image generation usually finishes in seconds. Video, long music, and some heavy models can take minutes. The server handles this transparently:

1. You call `replicate_generate_video`.
2. The server waits up to `timeout_ms` (default 5 minutes) by polling Replicate every 2 seconds.
3. If it finishes in time → you get URLs and local paths.
4. If it doesn't → you get back `pending: true` and a `prediction_id`. Claude can call `replicate_get_prediction` later to retrieve the result.

You can bump `timeout_ms` up to 30 minutes if you want to wait inline:

> Generate a 10-second Hunyuan video. Wait up to 20 minutes.

---

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `REPLICATE_API_TOKEN` | _(required)_ | Your Replicate API token. |
| `REPLICATE_DOWNLOAD_DIR` | `~/Downloads/replicate-mcp` | Where to save generated files. |

---

## Costs

Replicate charges per second of compute, varying by model. Approximate costs:

- Flux Schnell image: ~$0.003
- Flux Dev image: ~$0.025
- Flux 1.1 Pro image: ~$0.04
- Kling 1.6 Pro 5-second video: ~$0.45
- MusicGen 30-second clip: ~$0.05
- Kokoro TTS: ~$0.001 per request
- Llama 3 70B chat: ~$0.001 per 1K tokens
- LLaVA 13B vision: ~$0.001 per image
- Real-ESRGAN 4x upscale: ~$0.003 per image

See https://replicate.com/pricing for current rates and your billing dashboard for usage.

---

## Troubleshooting

**"REPLICATE_API_TOKEN environment variable is not set"**
You haven't put the token in the `env` block of your Claude Desktop config. Double-check the JSON and restart Claude Desktop.

**"Server disconnected" in Claude Desktop**
Usually a path problem. Make sure the path to `dist/index.js` is absolute and the file exists. Test it manually:
```bash
REPLICATE_API_TOKEN=r8_... node /ABSOLUTE/PATH/dist/index.js
```
You should see `replicate-mcp-server v1.0.0 ready. API token detected.` on stderr. Press Ctrl+C to quit.

**A model isn't in the curated list**
Just use its full identifier: `model: "stability-ai/sdxl"` works the same way. Or use `replicate_search_models` to find one.

**Need a specific version of a model**
Use the `owner/name:version_hash` form: `model: "black-forest-labs/flux-schnell:bf53bdb93d739c9c915091cfa5f49ca662d11273a5eb30e7a2ec1939bcf27a00"`.

**Downloaded files are missing**
Check `REPLICATE_DOWNLOAD_DIR`. Files are organised as `<dir>/<sanitized-model>/<prediction-id>/output-N.<ext>`.

---

## Deploy as platform (v3.0+)

Beyond personal Claude Desktop use, v3.0 supports running the server as a
**multi-user platform** — HTTP transport, multi-token pool, webhook-driven
async completion, Docker, npm distribution.

### HTTP / SSE transport

Run the server as an HTTP service instead of stdio:

```bash
# Local-only, no auth — for development.
node dist/index.js --http --port 8088

# LAN-exposed with Bearer auth — behind a private network.
node dist/index.js --http --host 0.0.0.0 --port 8088 --api-key your-shared-secret
```

Clients POST JSON-RPC to `http://host:port/mcp` with:

```
Authorization: Bearer your-shared-secret
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Session-Id: <set by server on initialize, echoed on follow-ups>
```

Health probe (no auth): `GET /health` → `{"status": "ok"}`.

### npm install (when published)

```bash
npx replicate-mcp-server --http --port 8088 --api-key SECRET
# or as a Claude Desktop launcher:
npx replicate-mcp-server
```

### Docker

```bash
docker build -t replicate-mcp-server .
docker run --rm \
  -e REPLICATE_API_TOKEN=r8_... \
  -e LOG_LEVEL=info \
  -p 8088:8088 \
  replicate-mcp-server
```

The default `CMD` starts in HTTP mode on `0.0.0.0:8088`. Add `--api-key`
via `docker run ... replicate-mcp-server --http --api-key SECRET` if you
expose the port beyond a private network.

### Multi-token round-robin pool

For team / multi-tenant deployments, give the server multiple Replicate
accounts to spread rate-limit headroom:

```bash
REPLICATE_API_TOKEN_POOL=r8_account_a,r8_account_b,r8_account_c \
  node dist/index.js --http --port 8088
```

Each Replicate API call rotates through the pool. Falls back to single
`REPLICATE_API_TOKEN` if only one configured.

### Webhook receiver (event-driven completion)

If the server is reachable from the public internet, you can replace
polling with webhook callbacks:

```bash
REPLICATE_WEBHOOK_PUBLIC_URL=https://your.domain/webhook \
REPLICATE_WEBHOOK_PORT=8089 \
  node dist/index.js --http --port 8088
```

Replicate POSTs prediction completion to the public URL; the server
resolves the awaiting tool call without polling. Per-prediction random
token authenticates each callback.

### Smithery listing

`smithery.yaml` is included for one-click install via
[smithery.ai](https://smithery.ai/new):

1. Push the repo to GitHub.
2. Submit at <https://smithery.ai/new>.
3. Smithery generates the user-facing config UI from `smithery.yaml`'s
   `configSchema` (token, optional pool, log level, download dir).

### claude.ai web Connector

For listing as a Connector inside the claude.ai web app:

1. Deploy the server publicly with HTTPS (Render / Fly.io / Cloudflare /
   bare VPS behind a TLS-terminating reverse proxy).
2. Register the MCP HTTP endpoint at
   <https://console.anthropic.com/settings/connectors>.
3. Users add it from claude.ai → Settings → Connectors → Add custom.

Anthropic's Connector review is manual — provide the OAuth flow / API key
input form they require, plus the public `/mcp` URL.

---

## Architecture

```
src/
├── index.ts        # MCP server, tool registration, response formatting (handler factory)
├── replicate.ts    # API client, polling, output extraction (URLs + text), file download with retry
├── schemas.ts      # Zod schemas for tool inputs (with .strict())
├── models.ts       # Curated model registry per category (8 categories)
└── constants.ts    # Shared constants (timeouts, paths, character limits)

test/
├── stdio-test.mjs       # End-to-end MCP handshake + tool registration test (response correlation)
└── unit/                # node:test unit suites for pure helpers
    ├── extract-urls.test.mjs
    ├── extract-texts.test.mjs
    ├── infer-filename.test.mjs
    └── sanitize.test.mjs
```

The server uses the **stdio transport** (standard for local Claude Desktop integrations) and the modern `registerTool` API of the MCP TypeScript SDK. All tool inputs are validated by Zod schemas with `.strict()` enforcement — no unknown parameters slip through.

The 8 curated generation tools share a single `makeGenerationHandler` factory; each tool only declares how it maps its specific input fields onto the Replicate request body. Output URLs are extracted by recursively walking the prediction's `output` field, which can be a string, an array, a nested object, or any combination. Text outputs (from LLM / vision / classifier models) are surfaced through the same walker so non-URL strings appear in the response. Files are streamed to disk using Node's `stream/promises.pipeline()` so multi-GB videos don't blow up memory. Downloads retry once on transient failures (network error or 5xx) with exponential backoff; 4xx errors fail fast.

### Testing

```bash
npm run build
node --test test/unit/*.test.mjs    # 43 unit tests on pure helpers
node test/stdio-test.mjs            # End-to-end MCP handshake + tool/list + tool/call sanity check
```

---

## License

MIT
