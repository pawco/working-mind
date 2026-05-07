# Contributing to Working Mind

Thank you for your interest in contributing! Working Mind is open-source because we believe domain exploration should be accessible to everyone -- and we'd love your help making it better.

## Where We Need Help Most

**UI/TUI development.** The core engine -- pack loading, agent loop, MCP integration, memory, commands -- is our primary focus. The terminal UI (built with [OpenTUI](https://github.com/nicepkg/opentui) + React) needs passionate contributors who care about terminal UX: layout, scrolling, keyboard shortcuts, accessibility, and visual polish. If you love making CLIs feel great, this is the place.

## How to Contribute

### Bug Reports

1. Check [existing issues](https://github.com/pawco/working-brain/issues) to avoid duplicates
2. Open a new issue with:
   - Working Mind version (`wmind --version`)
   - OS and terminal emulator
   - Steps to reproduce
   - Expected vs actual behavior
   - Any relevant log output (run with `DEBUG=wmind:*` for verbose logs)

### Feature Requests

Open an issue with the `enhancement` label. Describe the use case, not just the feature. "I want to research legal cases" is better than "add a legal pack."

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with tests
4. Ensure all checks pass (see below)
5. Open a pull request

## Development Setup

### Prerequisites

- **Node.js >= 18**
- **Bun** (for dev mode -- OpenTUI requires top-level await)
- **Git**

### Install and Run

```bash
git clone https://github.com/pawco/working-brain.git
cd working-brain
npm install
```

Development mode (hot reload via Bun):

```bash
bun run src/index.ts
```

Production build:

```bash
npm run build
node dist/cli.cjs
```

### Checks

Run these before submitting a PR:

```bash
npm run typecheck    # TypeScript type checking
npm run lint         # Biome linting
npm test             # Vitest test suite
```

All three must pass cleanly.

## Coding Standards

- **TypeScript strict mode** -- no `any`, use proper types
- **Biome for formatting and linting** -- configuration in `biome.json`
- **No comments** -- code should be self-documenting; comments only when the "why" is non-obvious
- **Follow existing patterns** -- look at neighboring files before writing new code
- **No non-ASCII characters in `.ts` files** -- avoid `…` (U+2026), `—` (U+2014), etc. in template literals; they cause TS parse errors

## Testing

- Test framework: **Vitest**
- Tests live alongside source files: `src/foo.ts` -> `src/foo.test.ts`
- Run the full suite: `npm test`
- Run a single file: `npx vitest run src/pack-loader.test.ts`

### Test Expectations

- New features require tests
- Bug fixes should include a regression test
- Aim for meaningful coverage of behavior, not line-count targets

## Project Structure

```
working-brain/
  src/
    app-opentui.tsx     # Main TUI application (OpenTUI + React)
    loader.ts           # Pack loading orchestration
    pack-loader.ts      # Declarative pack loading
    command-registry.ts # Command registration and collision resolution
    command-loader.ts   # Command .md parsing
    system-prompt.ts    # System prompt assembly
    config.ts           # Configuration types
    sdk/                # LLM adapters, tool types, model discovery
    mcp/                # MCP registry, adapter, transport
    memory/             # Knowledge graph, auto-link, render
    builtins/           # Built-in slash commands
    ui2/                # OpenTUI components (React)
  packs/
    starter/            # Default free pack
    explorer/           # Research domain brain
    researcher/         # Academic research brain
    marketing/          # Marketing analysis brain
    builder/            # Content construction brain
  docs/                 # Design docs and architecture
  data/                 # Pack schema, seed data
```

## Creating a Pack

Packs are declarative: `pack.json` + markdown files. No code required. See [docs/architecture.md](docs/architecture.md) for the full pack system design, or look at `packs/starter/` for the simplest example.

Key files:

| File | Purpose |
|------|---------|
| `pack.json` | Manifest: name, version, prompt path, MCP servers, personas, commands |
| `prompt.md` | System prompt for the domain |
| `skills/*/SKILL.md` | Skill definitions (auto-discovered) |
| `commands/*.md` | Slash command definitions with YAML frontmatter |
| `curation/*.md` | Curation templates for summarize/export |

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

## Questions?

open an issue with the `question` label, or start a [discussion](https://github.com/pawco/working-brain/discussions).
