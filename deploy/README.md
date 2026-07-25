# Public deployment (self-hosted HTTPS endpoint)

Exposes the MCP server over public HTTPS so remote clients — and the Smithery
scanner — can reach it. A dedicated Caddy instance binds **only** the host's
public IP, so any reverse proxy already running on the box (bound to a
different address) is left untouched.

The server runs **multi-tenant**: it carries no Replicate token of its own —
each user supplies their own via the session config (`x-replicate-api-token`
header, or `replicate_api_token` query param).

All host-specific values (`PUBLIC_IP`, `MCP_DOMAIN`, `ACME_EMAIL`) live in
`deploy/.env`, which is gitignored. `deploy/.env.example` ships placeholders
only.

## Prerequisites (one-time, manual)

1. **DNS** — at your DNS provider, add an `A` record pointing your chosen
   hostname at the host's public IPv4, TTL automatic.
2. **Cloud firewall** — if your provider has a network-level firewall in front
   of the instance, allow inbound TCP **80** and **443**.
3. **Docker's `DOCKER-USER` chain** — optional, and only if your host restricts
   Docker-published ports at the iptables level (a common hardening pattern is
   a blanket `-A DOCKER-USER -i eth0 -j DROP` so containers are reachable only
   over a private overlay network). In that case insert one ACCEPT *before* the
   DROP so **80/443 and nothing else** are exposed on the public NIC, then
   persist it:
   ```bash
   iptables -I DOCKER-USER 1 -i eth0 -p tcp -m conntrack --ctstate NEW \
     -m multiport --dports 80,443 -j ACCEPT
   netfilter-persistent save
   ```
   Every other Docker-published port keeps whatever restriction it had.

## Deploy (on the VPS)

```bash
git clone https://github.com/sena-labs/replicate-mcp-server.git
cd replicate-mcp-server/deploy
cp .env.example .env && edit .env     # set PUBLIC_IP, MCP_DOMAIN, ACME_EMAIL

# Open the host firewall for the dedicated Caddy.
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp

docker compose up -d --build
docker compose logs -f replicate-mcp-caddy   # watch Let's Encrypt issue the cert
```

Caddy obtains the certificate automatically once DNS resolves and ports 80/443
are reachable. Verify:

```bash
curl -s https://"$MCP_DOMAIN"/health      # {"status":"ok",...}
```

## Register on Smithery

Publish a **URL** connection (not a bundle) pointing at the live endpoint, with
the token delivered as a header for log hygiene:

```bash
npx @smithery/cli mcp publish https://"$MCP_DOMAIN"/mcp \
  -n <your-org>/replicate-mcp-server \
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
