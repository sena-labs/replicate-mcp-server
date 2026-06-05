# Smithery — Remote (URL) publishing

This converts the Smithery listing from **stdio-hosted** (Smithery runs `npx` on
`*.run.tools`) to **external/remote**: the Smithery gateway proxies to our own VPS
at `https://replicate-mcp.sena-labs.dev/mcp`, and forwards each user's Replicate
token to it.

## Why

- The server is **multi-tenant**: `parseSessionConfig` (src/http-server.ts) reads
  the caller's token per-request from the `x-replicate-api-token` header (preferred)
  or `?replicate_api_token=` query param. No server-side env token needed.
- Smithery's `x-from` config-transport feeds each user's token in as that header.
- Direct VPS access is unaffected — clients can always bypass Smithery and connect
  straight to `https://replicate-mcp.sena-labs.dev/mcp` with their own header.

## Token flow (after publish)

```
user (smithery config form: replicateApiToken)
  -> Smithery gateway  (x-from: header x-replicate-api-token)
  -> https://replicate-mcp.sena-labs.dev/mcp   header: x-replicate-api-token: r8_...
  -> parseSessionConfig() -> requestContext -> Replicate API
```

## Publish command

Requires the Smithery CLI authenticated to the `sena-labs` namespace.

```bash
npx -y @smithery/cli mcp publish "https://replicate-mcp.sena-labs.dev/mcp" \
  -n sena-labs/replicate-mcp-server \
  --config-schema "$(cat smithery-config-schema.json)"
```

(Windows PowerShell: `--config-schema (Get-Content smithery-config-schema.json -Raw)`)

## Requirements (already met)

- Streamable HTTP transport at `/mcp` ✅ (server v3.2.0)
- Public server returns 200 on `initialize` so Smithery auto-scan completes ✅
- No OAuth wall (token is per-call config, not connection auth) ✅

## Verify after publish

```bash
# gateway should proxy to the VPS and forward the token header
curl -s https://server.smithery.ai/sena-labs/replicate-mcp-server/mcp ...
# or just connect a client to the smithery URL with replicateApiToken set
```

## Notes

- `smithery.yaml` still describes the old stdio `commandFunction`. The CLI
  external publish above creates a new **external** release that supersedes it.
  Leave stdio config only if you also want a downloadable local bundle.
- Direct-VPS client config (no Smithery):

  ```json
  "replicate": {
    "type": "http",
    "url": "https://replicate-mcp.sena-labs.dev/mcp",
    "headers": { "x-replicate-api-token": "r8_USER_KEY" }
  }
  ```
