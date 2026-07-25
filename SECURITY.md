# Security Policy

## Supported Versions

Security fixes are applied to the latest `3.x` release line. Older majors are
not maintained — please upgrade before reporting.

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

Always run the newest published version (`npm view replicate-mcp-server version`)
before filing a report.

## Reporting a Vulnerability

**Do not open a public issue for security problems.**

Report privately, either way:

1. **GitHub Security Advisories** (preferred) — the repository's **Security**
   tab → [**Report a vulnerability**](https://github.com/sena-labs/replicate-mcp-server/security/advisories/new).
2. **Email** — [ivan.sena@sena-labs.dev](mailto:ivan.sena@sena-labs.dev).

Please include:

- Affected version (`replicate-mcp-server` and Node.js version).
- Transport in use (stdio or HTTP/SSE) and relevant configuration.
- Step-by-step reproduction, proof-of-concept, or a failing request.
- Impact assessment (what an attacker can read, write, or trigger).

A proof of concept helps but is not required to report.

### Response targets

| Stage                     | Target                     |
| ------------------------- | -------------------------- |
| Acknowledgement           | within 72 hours            |
| Triage & severity         | within 7 days              |
| Fix or mitigation         | depends on severity        |

We follow **coordinated disclosure**. Please give us a reasonable window to ship
a fix before any public disclosure. Reporters are credited in the advisory and
`CHANGELOG.md` unless anonymity is requested.

## Security Model & Scope

This server brokers access to the [Replicate](https://replicate.com) API on
behalf of an MCP client. Keep the following in mind.

### Credentials

- The server authenticates with **Replicate API tokens** supplied via
  environment variables (`REPLICATE_API_TOKEN`, or a comma-separated pool).
  Never hard-code tokens or commit them to source control.
- Tokens grant full access to your Replicate account (billing included). Treat
  them as secrets, scope them where possible, and rotate any token that may have
  leaked.
- The process holds tokens in memory only; it does not persist them to disk, and
  never writes a token value to a log. Log records carry counts and booleans
  (`token_present`, `token_count`) only.

### Transports

- **stdio** is the default and is only as trusted as the local client that
  launches it.
- **HTTP/SSE** exposes a network endpoint. Do **not** expose it to untrusted
  networks without your own authentication, TLS termination, and rate limiting
  in front of it. It binds `127.0.0.1` unless you pass `--host`; keep it that way
  unless you have deliberately secured it.
- When `--api-key` is set, the comparison is constant-time
  (`crypto.timingSafeEqual`).
- In multi-tenant/hosted mode the server carries no token of its own — each
  caller supplies one per request, preferably via the `x-replicate-api-token`
  header rather than the query-param fallback, so it stays out of access logs.

### In scope

A break in any of the following is a valid report:

- Leaking a caller's Replicate API token — through logs, error messages, tool
  output, or responses returned to the MCP client.
- Bypassing the host allowlist that restricts outbound fetches and downloads to
  Replicate hosts (SSRF). The allowlist is re-checked after every redirect.
- Path traversal or arbitrary write via download directories or inferred
  filenames.
- Authentication bypass on the HTTP transport when `--api-key` is set.
- Webhook signature or token verification bypass.
- Cross-tenant token or data leakage in multi-tenant HTTP mode.

### Out of scope

- Vulnerabilities in the upstream Replicate API or in models hosted on
  Replicate — report those to Replicate.
- Issues that require a malicious local operator who already controls the host
  or the environment the server runs in.
- Missing hardening on an HTTP endpoint that the operator intentionally exposed
  without the recommended controls above.
- Cost or quota consumption caused by your own token being used as configured.

## Dependencies

Dependency advisories are tracked with `npm audit` and Dependabot. The CI
`Security audit` gate runs `npm audit --omit=dev --audit-level=high` on every
change. If you spot an unpatched advisory in a production dependency, a PR
bumping the lockfile is welcome.
