# Public deployment — `replicate-mcp.sena-labs.dev`

Exposes the MCP server over public HTTPS so Smithery can scan it (tools +
prompts) and clients can connect, **without touching the host's existing
private nginx-proxy-manager**. A dedicated Caddy binds only the public IP.

The server runs **multi-tenant**: it carries no Replicate token of its own —
each user supplies their own via the Smithery session config
(`x-replicate-api-token` header, or `replicate_api_token` query param).

## Prerequisites (one-time, manual)

1. **DNS** (Namecheap → Advanced DNS): add an `A` record
   - Host `replicate-mcp` → Value `<PUBLIC_IP>` (e.g. `178.105.2.218`), TTL automatic.
2. **Hetzner Cloud Firewall** (console): ensure inbound TCP **80** and **443**
   are allowed (the in-box `ufw` rules are added by the deploy below).

## Deploy (on the VPS)

```bash
git clone https://github.com/sena-labs/replicate-mcp-server.git
cd replicate-mcp-server/deploy
cp .env.example .env && edit .env     # set PUBLIC_IP, MCP_DOMAIN, ACME_EMAIL

# Open the firewall for the dedicated Caddy (NPM stays on the Tailscale IP).
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp

docker compose up -d --build
docker compose logs -f replicate-mcp-caddy   # watch Let's Encrypt issue the cert
```

Caddy obtains the certificate automatically once DNS resolves and ports 80/443
are reachable. Verify:

```bash
curl -s https://replicate-mcp.sena-labs.dev/health      # {"status":"ok",...}
```

## Register on Smithery

Publish a **URL** connection (not a bundle) pointing at the live endpoint, with
the token delivered as a header for log hygiene:

```bash
npx @smithery/cli mcp publish https://replicate-mcp.sena-labs.dev/mcp \
  -n sena-labs/replicate-mcp-server \
  --config-schema '{"type":"object","required":["replicate_api_token"],"properties":{"replicate_api_token":{"type":"string","title":"Replicate API token","description":"Your Replicate API token (r8_...). Get one at https://replicate.com/account/api-tokens.","x-from":{"header":"x-replicate-api-token"}}}}'
```

Smithery's `SmitheryBot` then scans the live server (no token needed) and lists
all tools + prompts, raising the quality score.

## Notes

- `initialize` / `tools/list` / `prompts/list` work with no token (scan-safe);
  the token is only required when a tool is actually invoked.
- The server returns plain Replicate URLs (no server-side downloads) in hosted
  use, so disk/bandwidth on the box stay minimal.
- To update: `git pull && docker compose up -d --build`.
