# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.0.x   | Yes       |
| < 0.0   | No        |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Report via:

1. **GitHub Security Advisories** (preferred) -- [Report a Vulnerability](https://github.com/pawco/working-brain/security/advisories/new)
2. **Email** -- security@elgap.dev (PGP key at https://elgap.dev/pgp.asc)

### Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix or mitigation | Within 10 business days |

## Threat Model

### Local-First = Small Attack Surface

Working Mind runs in your terminal. No inbound HTTP server. No marketplace. No auto-install of remote servers. No OAuth. No browser. MCP servers communicate over stdio (local process pipes), not network. This is a single-user local POC -- no tenants, no attack surface to speak of.

This eliminates entire CVE categories: DNS rebinding, SSRF, CORS misconfiguration, marketplace supply chain, OAuth token theft -- all require HTTP endpoints that don't exist here.

### In Scope

| Threat | Mitigation |
|--------|------------|
| **Prompt injection** via web pages, files, MCP responses | Agent uses declared tools only; destructive actions need human approval |
| **MCP supply chain** (malicious server) | User explicitly connects each server; no auto-install |
| **Pack supply chain** (malicious pack) | Pack commands are markdown, not code; `allowedTools` restricts, never expands |
| **Data exfiltration** via tool calls | `destructive` flag on write tools; `readonly` persona; `ask` permission mode |
| **Filesystem escape** | MCP filesystem validates paths against allowed directories |
| **Credential exposure** | Filesystem MCP restricted to `$CWD` or user-specified dir; no `$HOME` by default |
| **Goal hijacking** via indirect injection | System prompt immutable during session; tool results marked untrusted |

### Out of Scope

| Category | Why |
|----------|-----|
| OS compromise | If your machine is pwned, the agent is pwned |
| LLM provider compromise | No client-side defense against a malicious provider |
| Network MITM on stdio | No network -- stdio is local process pipes |
| Physical access | Standard physical security |

## Credential Security

API keys come from **environment variables only**. No OS keychain. Config files never contain plaintext keys.

Resolution chain (`provider-resolve.ts`):

1. In-memory cache (session-only)
2. Config `env:` prefix (e.g., `"apiKey": "env:OPENAI_API_KEY"`)
3. `process.env` (shell environment)

Config files never contain plaintext keys. `writeUserConfig()` sets `chmod 0o600` on every write. `stripSensitiveEnvVars()` removes MCP env vars marked `sensitive: true` before persisting.

### Known Gap

MCP child processes inherit full `process.env` -- every server can read all your env vars. Fix: construct minimal env with only declared vars. Planned.

## Pack Security

Packs are **declarative** -- markdown files, not code. They cannot spawn processes, read env vars, make network requests, or access the filesystem. They can only instruct the LLM agent, which uses permission-gated tools.

All MCP servers in packs must be `"required": false` -- packs degrade gracefully without them. No "install this server or the pack breaks" pressure.

## Security Roadmap

| Priority | Item | Status |
|----------|------|--------|
| P0 | Minimal env for MCP processes (no full `process.env`) | Planned |
| P0 | Per-tool destructive flag from MCP metadata | Planned |
| P1 | `.env` file for credential persistence | Planned |
| Medium | Signed pack manifests | Planned |
| Low | Tool call audit log | Planned |
