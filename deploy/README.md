# Public deployment (self-hosted HTTPS endpoint)

Exposes the MCP server over public HTTPS so remote clients — and the Smithery
scanner — can reach it. A dedicated Caddy instance binds **only** the host's
public IP, so any reverse proxy already running on the box (bound to a
different address) is left untouched.

The server runs **multi-tenant**: it carries no Replicate token of its own —
each user supplies their own via the session config (`x-replicate-api-token`
header, or `replicate_api_token` query param).

This is an intentionally public BYOK endpoint, not an authenticated private
gateway. A supplied Replicate token is checked by Replicate when an API operation
uses it; its presence in a request does not prove a successful generation. Never
configure `REPLICATE_API_TOKEN` or `REPLICATE_API_TOKEN_POOL` on a public instance.
For private installations, set `HTTP_API_KEY` and send it as `Authorization: Bearer`.

## Credential-safe logging

The supplied Caddyfile filters **both access and runtime logs**: request headers
are removed and URI query strings are stripped before JSON encoding. Ordinary
`format json` does not hide `X-Replicate-Api-Token`; Caddy's built-in sensitive
header list does not cover this custom header. Header transport alone is not a
redaction policy. Application HTTP error logs retain only the URI path.

When updating an existing host, merge these filters into its current configuration
and validate/reload Caddy. Do not replace a host-specific Caddyfile containing
other services with this single-host example. Send a dummy header/query canary
and verify it is absent from access **and runtime** logs.

If an older configuration logged tokens, first stop further logging and preserve
evidence under restricted administrator access before any cleanup or container
recreation. Establish which credentials were involved and who could access the
logs; internal retention does not itself prove third-party disclosure or abuse.
Consider precautionary rotation of still-valid affected credentials at
https://replicate.com/account/api-tokens, coordinating with their owners as
appropriate. Do not assume every supplied header was a valid provider credential.
Once evidence-retention decisions are made, sanitize operational archives.
Recreating the Caddy container removes its Docker-managed log history (including
rotated files); external collectors and backups require separate review. Never
edit active Docker log files behind the logging driver.

All host-specific values (`PUBLIC_IP`, `MCP_DOMAIN`, `ACME_EMAIL`) live in
`deploy/.env`, which is gitignored. `deploy/.env.example` ships placeholders
only.

## Continuous monitoring (systemd host)

The optional host-side timer runs every five minutes and after boot. It checks
HTTPS health, container state/restart changes, stack overflows and credential
patterns in recent application/Caddy logs. It records only counters and state,
never raw log payloads or credentials. A failed check exits nonzero and produces
an `alert` event in the systemd journal; a subsequent healthy check records
`recovered`. No external notification channel is configured automatically.

```bash
sudo install -d -m 755 /usr/local/lib/replicate-mcp-monitor
sudo install -m 644 scripts/monitor_hosted.py /usr/local/lib/replicate-mcp-monitor/
sudo install -m 644 deploy/replicate-mcp-monitor.service deploy/replicate-mcp-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now replicate-mcp-monitor.timer
sudo systemctl start replicate-mcp-monitor.service
sudo systemctl status replicate-mcp-monitor.timer
sudo journalctl -u replicate-mcp-monitor.service -n 10 --no-pager
sudo cat /var/lib/replicate-mcp-monitor/state.json
```

Defaults target `replicate-mcp.sena-labs.dev` and containers `replicate-mcp` /
`replicate-mcp-caddy`. Other hosts can set `REPLICATE_MONITOR_URL` (health URL)
and `REPLICATE_MONITOR_CONTAINERS` (comma-separated names) in
`/etc/replicate-mcp-monitor.env`. The service needs host Docker access; do not
mount the Docker socket into the public MCP container. An outage exceeding
15 minutes is explicitly reported as a monitoring gap; log catch-up is bounded.

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
