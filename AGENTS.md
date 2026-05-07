# Build & Quality Commands

- Build JS bundle: `npm run build`
- Build platform binaries: `bun run scripts/build-binaries.mjs` (current platform) or `bun run scripts/build-binaries.mjs all`
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm test`
- Dev mode: `npm run dev` (requires Bun)

# Architecture

- Binary distribution via `bun build --compile` — standalone executables per platform
- npm fallback: `dist/cli.cjs` + `dist/index.mjs` (non-interactive mode works under Node.js; TUI shows error)
- Entry points:
  - `src/binary-entry.ts` — compiled binary entry (embeds data/pack files, extracts to `~/.wmind/embedded/vX.Y.Z/`)
  - `src/index.ts` — CLI app (Commander)
  - `src/app-opentui.tsx` — TUI component (requires Bun runtime for @opentui/core)
- `src/paths.ts` — resolves data/pack directories (checks `WMIND_EMBEDDED_DIR` env var for binary context)
- `src/version.ts` — version string (replaced at build time for binaries, falls back to `0.0.1-dev`)

# Release Flow

1. Bump version in `package.json`
2. `npm run build` (JS bundle for npm fallback)
3. `bun run scripts/build-binaries.mjs` (platform binaries)
4. `bun run scripts/publish-binaries.mjs` (publish platform packages, then main package)
5. Upload binaries to GitHub Release
