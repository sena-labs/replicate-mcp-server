# Replicate MCP Server

<p align="center">
  <img src="assets/banner.png" alt="Replicate MCP Server — universal MCP for the full Replicate catalog" width="100%">
</p>

[![smithery badge](https://smithery.ai/badge/sena-labs/replicate-mcp-server?refresh=20260602)](https://smithery.ai/servers/sena-labs/replicate-mcp-server)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20this%20project-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/senalabs)

A universal, cross-platform [MCP](https://modelcontextprotocol.io) server that gives **any MCP client** — Claude Desktop, the claude.ai web app (Connectors), Cursor, Cline / Continue in VS Code, or your own application — native access to the full [Replicate](https://replicate.com) catalog: image generation, video, music, speech, upscaling, segmentation, LLMs, voice cloning, 3D, lipsync — anything Replicate hosts.

It speaks both transports: **stdio** (the standard for local desktop/editor integrations) and **HTTP/SSE** (for remote/web clients and your own services).

Once connected to your MCP client, you can simply ask:

> _"Generate a cinematic shot of a lighthouse in a storm, 21:9"_
> _"Write a 30-second synthwave track"_
> _"Make a 5-second video of a paper airplane flying through a city"_
> _"Read this paragraph in a British male voice"_
> _"Upscale this image 4x"_

…and the assistant calls the right Replicate model, waits for the result, and (on local/stdio setups) downloads the output to your machine.

---

## Install

**Fastest — one-click via [Smithery](https://smithery.ai/server/sena-labs/replicate-mcp-server)** ([![smithery badge](https://smithery.ai/badge/sena-labs/replicate-mcp-server?refresh=20260603)](https://smithery.ai/servers/sena-labs/replicate-mcp-server)): open the [server page](https://smithery.ai/server/sena-labs/replicate-mcp-server) and copy the **Install** snippet for your client (Claude, Cursor, VS Code, Cline, Windsurf, …). It wires the server in and prompts for your Replicate token. _(Routes through Smithery's hosted gateway — easiest, zero local setup.)_

**Token-private — npm + stdio** (your Replicate token never leaves your machine):

```bash
npx -y replicate-mcp-server
```

…or drop it into any MCP client's config (full walkthrough under [Installation](#installation)).

**Claude Desktop one-file install:** download the latest [`.mcpb` from Releases](https://github.com/sena-labs/replicate-mcp-server/releases/latest) and drag it onto Claude Desktop.

**Already running (bring your own token):** `https://replicate-mcp.sena-labs.dev/mcp` — HTTP/SSE, multi-tenant; pass your token in the `x-replicate-api-token` header.

Once connected, try the [example prompts](#try-it) below.

---

## Try it

Once your client is connected, ask in plain language — the assistant picks the right tool, **waits for the result, and downloads the output locally**:

> _"Generate a cinematic shot of a lighthouse in a storm, 21:9"_
> _"Which is the cheapest model for a 5-second video? Then use it."_ — recommend → generate
> _"Make 4 logo variations of a fox, flat vector style"_ — batch (concurrent)
> _"Transcribe this audio, summarise it, then read the summary aloud"_ — DAG pipeline
> _"Upscale this image 4×"_ · _"Write a 30-second synthwave track"_ · _"Read this in a British male voice"_
> _"Kick off a Flux LoRA fine-tune on my dataset and tell me when it's done"_ — training

Discovery tools (`replicate_recommend_model`, `replicate_search_models`, `replicate_estimate_cost`) and the 5 built-in workflow prompts help it chain multi-step jobs without you naming models.

---

## What's inside

36 tools and 63 curated models, designed to be both ergonomic for common cases and fully open-ended for everything else. Every generate/run tool **waits for completion and auto-downloads the outputs** to your machine — you ask once and get back local files, not a job id to babysit:

### Curated generation tools

| Tool | Purpose |
|---|---|
| `replicate_generate_image` | Text → image. Curated: Flux Schnell / Dev / Pro / 2-Max, SD 3.5, Recraft v3 / v4.1, Seedream, Ideogram v2, Imagen 3. |
| `replicate_generate_video` | Text (or image) → video. Curated: Kling Pro, Minimax, Hunyuan, Luma Ray, Wan 2.2, Grok Video, Seedance. |
| `replicate_generate_audio` | Text → music / songs. Curated: MusicGen, ACE-Step (full songs with lyrics), Riffusion, MiniMax Music. |
| `replicate_generate_speech` | Text → speech (TTS). Curated: Kokoro, Minimax Speech, Chatterbox, Gemini TTS, Grok TTS. |
| `replicate_chat` | Text → text via LLM. Curated: Llama 3.1 405B, Llama 3 70B / 8B, Mistral 7B, Mixtral 8x7B, DeepSeek-R1. |
| `replicate_vision` | Image → text. Curated: LLaVA 13B / 1.6 34B, BLIP-2, Qwen2-VL. |
| `replicate_upscale_image` | Image → higher-res image. Curated: Real-ESRGAN, Clarity Upscaler, Clarity Pro, SwinIR, GFPGAN. |
| `replicate_remove_background` | Image → transparent PNG. Curated: rembg, BiRefNet, BRIA RMBG. |
| `replicate_transcribe_audio` | Audio/video → text. Curated: Whisper, Distil-Whisper, WhisperX (diarization), ElevenLabs Scribe. |
| `replicate_inpaint` | Mask-based image edit. Curated: Flux Fill Pro, SD inpaint, Ideogram v2 edit. |
| `replicate_segment` | Image → mask. Curated: SAM 2, Grounded-SAM (text-prompt). |
| `replicate_embed_text` | Text(s) → vector embeddings. Curated: BGE, Jina v3, MPNet. |

### Voice, 3D, and avatar tools

| Tool | Purpose |
|---|---|
| `replicate_clone_voice` | Text + reference sample → speech in a cloned voice. Curated: XTTS v2, OpenVoice v2. |
| `replicate_generate_3d` | Text or image → 3D mesh (GLB/OBJ). Curated: Hunyuan 3D, Rodin, TripoSR. |
| `replicate_lipsync` | Portrait + text/audio → lip-synced talking video. Curated: Video Avatar, SadTalker. |

### Orchestration tools

| Tool | Purpose |
|---|---|
| `replicate_batch_start` / `replicate_batch_status` | Run up to 50 predictions concurrently as a background job; poll progress + results. |
| `replicate_pipeline_start` / `replicate_pipeline_status` | Run a DAG of predictions — independent steps in parallel, downstream steps wired via `"$stepId.urls[0]"` template refs. |
| `replicate_recommend_model` | Rank curated models in a category by priority (speed / cost / quality / balanced) with cost estimates — advises which model to use. |
| `replicate_refresh_models` | Discover popular Replicate models not yet in the curated registry. |

### Fine-tuning (trainings)

| Tool | Purpose |
|---|---|
| `replicate_create_training` | Kick off a fine-tune / training run on a trainable base model (e.g. a Flux LoRA) with your dataset + parameters. |
| `replicate_get_training` | Poll a training by id (status, logs, resulting model version). |
| `replicate_list_trainings` | List your recent training runs (id, model, status, timestamps). |
| `replicate_cancel_training` | Cancel an in-progress training run by id. |

### Deployments

| Tool | Purpose |
|---|---|
| `replicate_list_deployments` | List your Replicate deployments (owner/name, current model + version). |
| `replicate_get_deployment` | Inspect one deployment (model, version, hardware, autoscaling min/max). |
| `replicate_run_deployment` | Run a prediction against a deployment — **waits for completion and auto-downloads** the outputs, same as the curated generate tools. |

### Prediction management + cost

| Tool | Purpose |
|---|---|
| `replicate_list_predictions` | Recent prediction history (id, model, status, timestamps). |
| `replicate_cancel_prediction` | Cancel an in-progress async job by id. |
| `replicate_estimate_cost` | Pre-call USD estimate from a curated price table. |

### Generic / discovery tools

| Tool | Purpose |
|---|---|
| `replicate_run_model` | Run **any** Replicate model with arbitrary inputs (escape hatch for anything not covered by a curated tool). |
| `replicate_search_models` | Free-text search across the Replicate catalog. |
| `replicate_get_model_schema` | Get the OpenAPI input schema for any model. |
| `replicate_get_prediction` | Poll a long-running prediction (videos, long songs). |
| `replicate_upload_file` | Upload a file to Replicate storage (by local `file_path` **or** `base64_data` / data URI); returns a URL to feed into other tools. |

Outputs:
- **Image / video / audio**: downloaded to `~/Downloads/replicate-mcp/<model>/<prediction_id>/` (configurable). Local paths and original Replicate URLs are both returned. For images, the response also includes an **inline base64 preview** (sized to stay under Claude Desktop's 1 MB tool-result limit; larger images fall back to the URL embed) plus three embed snippets (`<details>`-wrapped iframe viewer with Save button, responsive `<img>`, or markdown image) so the chat client can render the result inline at full size.
- **Text** (LLM, vision, classifier): the model's reply is surfaced in `text_output` and printed at the top of the tool response so Claude can read it directly.

### Editing an image you have on hand

The editing tools (`replicate_upscale_image`, `replicate_inpaint`, `replicate_remove_background`, `replicate_vision`, image-to-video, lipsync, 3D-from-image) all take a **URL**. To turn a file into a URL, use `replicate_upload_file`:

- **You have a local path** (Claude Desktop): `replicate_upload_file({ file_path: "C:/Users/you/photo.jpg" })` → URL → pass to the editing tool. If an image is dragged/pasted into the chat, save it to disk first — the server cannot read chat attachments directly, and Claude Desktop cannot reproduce a large image's exact bytes as a tool argument.
- **You have the bytes in memory** (claude.ai web with a code container): read the uploaded file in the container, base64-encode it, then `replicate_upload_file({ base64_data: "data:image/png;base64,..." })` → URL → editing tool. `base64_data` accepts a bare base64 string or a full `data:<mime>;base64,...` URI.
- **You already have a URL**: pass it straight to the editing tool — no upload needed.

---

## Why this over the official Replicate MCP?

Replicate ships its own [official MCP](https://replicate.com/docs/reference/mcp) (`replicate-mcp` on npm, hosted at `mcp.replicate.com`). It's a great, free, always-up-to-date **1:1 bridge to the REST API** — Stainless-generated from Replicate's OpenAPI spec, ~37 generic tools that mirror each endpoint (account, collections, deployments, files, hardware, models, predictions, trainings, webhooks), plus a `--tools=dynamic` mode and a Deno "Code Mode" sandbox.

This server is built for a different job. The official MCP is a **thin, generic API bridge**: to make an image you call `create_predictions` with a raw model id and raw input JSON, and the LLM has to look up each model's input schema itself; it returns `starting` and does **not** wait or download (you opt into `Prefer: wait`, capped at 60s, then poll manually). This server is a **batteries-included creative studio**: task-oriented tools with sane defaults, a curated model registry, built-in orchestration, and cost awareness — every generate/run tool **waits for completion and auto-downloads** the outputs locally.

| Axis | Official Replicate MCP | This server (sena-labs) |
|---|---|---|
| Philosophy | Thin generic API bridge (1:1 REST) | Task-oriented creative studio |
| Tools | ~37 generic REST tools (+ dynamic/code modes) | 36 task tools (`generate_image/video/audio/speech/3d`, `clone_voice`, `lipsync`, `upscale`, `inpaint`, `segment`, `remove_background`, `transcribe`, `vision`, `chat`, `embed`) |
| Media helpers | None — raw `predictions.create` + raw input JSON | Purpose-built tools with sane defaults (aspect ratio, etc.) |
| Run UX | Returns `starting`; opt-in `Prefer: wait` (≤60s) then **manual poll** | **Waits for completion AND auto-downloads** outputs locally |
| Model curation | None — you supply the model + look up its schema yourself | 60+ curated models + `recommend_model` + smart routing + `search_models` + `get_model_schema` |
| Orchestration | None | Async batch (`batch_start/status`) + DAG pipelines (`pipeline_start/status`) |
| Cost | None | `estimate_cost` pre-flight USD estimate |
| Fine-tuning + deployments | Yes (generic REST) | Yes — `create/get/list/cancel_training` + `list/get/run_deployment` (run waits + downloads) |
| Extras | OAuth, auto-sync to API | 5 workflow prompts + 2 MCP resources (catalog + capabilities) |
| REST breadth | Broader raw coverage (collections, files, hardware, webhooks, account) | Focused on creative tasks + the orchestration/cost layer on top |
| Hosted / official | Official, free, hosted at `mcp.replicate.com` with OAuth, auto-synced | Self-hostable, multi-tenant (per-user token), stdio + HTTP/SSE |

**In short:** the official MCP is the right tool if you want exhaustive, always-current raw REST access (and a free hosted endpoint with OAuth). This server is the right tool if you want a curated, orchestrated, cost-aware creative workflow where you describe what you want and get finished files back — no schema lookups, no manual polling, no manual downloads. They're complementary: use the official one for full-surface API plumbing, use this one for getting creative work done.

---

## Prerequisites

- **Node.js ≥ 20** (uses native `fetch` and Web Streams)
- A **Replicate account** with an API token: https://replicate.com/account/api-tokens
- **An MCP client** — e.g. Claude Desktop (macOS/Windows/Linux), the claude.ai web app, Cursor, Cline / Continue (VS Code), or any custom MCP host. The walkthrough below uses Claude Desktop as the example; the same `command` / `args` / `env` block works in any client's MCP config. For remote/web clients, see [HTTP / SSE transport](#http--sse-transport).

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

### 3. Connect it to your MCP client (Claude Desktop shown)

The MCP `command` / `args` / `env` block below is identical across clients — only the location of the config file differs (Cursor: `~/.cursor/mcp.json`; Cline/Continue: the extension's MCP settings; custom hosts: your own launcher). For Claude Desktop, find your config file:

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

## VS Code (native MCP)

VS Code has built-in MCP support. This repo ships a ready-to-use [`.vscode/mcp.json`](.vscode/mcp.json) that runs the published npm package locally and prompts for your token (stored masked, never written to the file):

```json
{
  "inputs": [
    { "type": "promptString", "id": "replicate_token", "description": "Replicate API token", "password": true }
  ],
  "servers": {
    "replicate": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "replicate-mcp-server"],
      "env": { "REPLICATE_API_TOKEN": "${input:replicate_token}" }
    }
  }
}
```

Open the file in VS Code and click **Start** above the `replicate` server (or run _MCP: List Servers_). VS Code asks for the token once.

> **Note on the Smithery "One-Click Install":** it wires VS Code to Smithery's **hosted** gateway (`mcp.smithery.run`), which runs the server on Smithery's infrastructure and would route your personal Replicate token through it on every call. For a personal API token, prefer the **local stdio** config above — the token never leaves your machine.

---

## Usage examples

Once connected, just talk to your assistant naturally (examples use Claude phrasing, but any MCP-capable assistant works):

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

Beyond a single local stdio client, the server also runs as a
**multi-user platform** — HTTP/SSE transport (for claude.ai web Connectors,
remote editors, and custom apps), multi-token pool, webhook-driven async
completion, Docker, npm distribution.

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

This server is **live on Smithery**: [smithery.ai/server/sena-labs/replicate-mcp-server](https://smithery.ai/server/sena-labs/replicate-mcp-server) — scanned (36 tools, 5 prompts, 2 resources) and one-click installable into Claude, Cursor, VS Code, Cline, Windsurf, and other MCP clients. `smithery.yaml` defines the install-time config UI (token, optional pool, log level, download dir).

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

## Support

If this project is useful to you, consider supporting its development:

☕ [**ko-fi.com/senalabs**](https://ko-fi.com/senalabs)

---

## Trademarks & disclaimer

This is an independent, community-built project. It is **not affiliated with, endorsed by, sponsored by, or officially connected to Replicate, Inc. or Anthropic, PBC.**

- **"Replicate"** and the Replicate logo are trademarks of **Replicate, Inc.** This server is an interoperability client for Replicate's public HTTP API; the name is used descriptively (nominative fair use) to indicate compatibility — not to imply origin or endorsement. For Replicate's own official MCP server, see [replicate.com/docs/reference/mcp](https://replicate.com/docs/reference/mcp).
- **"Model Context Protocol"** and **"MCP"** are trademarks of **Anthropic, PBC.**
- Model names referenced (FLUX, Recraft, Whisper, Llama, etc.) are trademarks of their respective owners and are used only to identify the models you can run.

You are responsible for complying with [Replicate's Terms of Service](https://replicate.com/terms) and the license of each model you invoke. Bundled third-party open-source components and their licenses are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). The banner/logo use the [Inter](https://rsms.me/inter/) typeface (SIL Open Font License 1.1).

---

## License

MIT — see [LICENSE](LICENSE).
