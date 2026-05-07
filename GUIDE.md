# Working Mind Guide

Terminal AI agent with a local knowledge graph. You build it -- entities, relations, research -- on your own disk. Your data, your structure, your graph.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Connecting to a Provider](#connecting-to-a-provider)
3. [Knowledge Graph](#knowledge-graph)
4. [Ingesting Documents](#ingesting-documents)
5. [MCP: Adding Tools](#mcp-adding-tools)
6. [The Prompt System](#the-prompt-system)
7. [Sessions](#sessions)
8. [Slash Commands Reference](#slash-commands-reference)
9. [Keyboard Shortcuts](#keyboard-shortcuts)
10. [Model Aliases & Tiers](#model-aliases--tiers)
11. [CLI Reference](#cli-reference)
12. [Configuration](#configuration)
13. [Workflows](#workflows)

---

## Getting Started

```bash
export OPENROUTER_API_KEY=sk-or-...     # Set any provider key
wmind                            # Launch
```

Or use the wizard:

```bash
wmind --configure                # Pick provider, model, enter key
wmind                            # Launch with saved config
```

That's it. Memory auto-connects. Start chatting. Your knowledge compounds across sessions.

### Credentials

API keys come from **environment variables only**. Set them in your shell profile:

```bash
export OPENROUTER_API_KEY=sk-or-...
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export BRAVE_API_KEY=BSA...
export FIRECRAWL_API_KEY=fc-...
```

When you enter a key via `/connect`, it works for the current session. Set the env var in your shell profile for persistence.

---

## Connecting to a Provider

```
/connect
```

1. **Select provider** -- arrow keys, Enter. Shows which have keys detected. Local Fast and Ollama auto-probe.
2. **Pick a model** -- curated list with pricing and context window.
3. **Enter API key** -- only if needed and not detected. Works this session; set env var for persistence.
4. **Validation** -- tests connection with `/models` request.
5. **Connected** -- saved as default for next startup.

### Quick Switch

```
/model sonnet               # Alias: Claude Sonnet
/model ollama/gemma4:27b    # Direct
/model                      # Show current
```

`/model` is session-only. `/connect` persists.

---

## Knowledge Graph

Session history is a flat transcript -- unstructured, unsearchable, invisible to reasoning. The knowledge graph is different: **your own file, on your own disk**, with structured entities, relations, and observations. You build it as you research. The agent reads from it, writes to it, searches it before doing new work. Your research compounds because you own the data.

### How It Compounds

```
Session 1:  "Explain RAG architectures"
  → Agent auto-saves 6 entities, 4 relations

Session 2:  "Compare GraphRAG vs vector RAG"
  → Agent searches memory, finds Session 1 knowledge
  → Only researches what's NEW
  → Graph: 14 entities, 9 relations

Session 5:  "Write a RAG survey"
  → 30+ entities accumulated across sessions
  → Produces output no single session could
```

### Commands

| Command | Description |
|---|---|
| `/memory` | Stats + help |
| `/memory stats` | Entity/relation/observation counts by type |
| `/memory save [topic]` | Extract entities from conversation into graph |
| `/memory graph` | ASCII relation list |
| `/memory graph tree` | Tree view grouped by entity type |
| `/memory graph tree React` | Tree filtered to "React" and neighbors |
| `/memory export mermaid` | Mermaid syntax to stdout |
| `/memory export dot` | Graphviz DOT to stdout |
| `/memory export mermaid --file g.mmd` | Write to file |
| `/memory switch <name>` | Switch to a different store |
| `/memory list` | List all stores |
| `/memory rename <old> <new>` | Rename a store |
| `/memory delete <name>` | Delete a store |

### Knowledge Index

After any memory write, Working Mind auto-rebuilds a **knowledge index** (markdown summary of all entities, relations, observations) and creates cross-link relations between entities that reference each other. The index is injected into the system prompt so the agent always has an up-to-date view.

### Privacy

100% local. `~/.wmind/memory.jsonl`. Nothing leaves your machine. With Local Fast (wmind-serve) or Ollama, even LLM queries stay local.

---

## Ingesting Documents

`/ingest` extracts structured knowledge from markdown files in your current directory and saves to the graph.

```
/ingest
```

1. Lists `.md` files in CWD
2. Asks for confirmation
3. Agent reads each file, extracts entities/relations/observations
4. Searches existing graph to avoid duplicates
5. Reports what was created/updated

**Constraints**: CWD only, `.md` only, no path traversal. Post-MVP: markitdown adds PDF/DOCX/PPTX support.

---

## MCP: Adding Tools

Working Mind uses MCP (Model Context Protocol) for tool access. The starter pack declares memory, Brave Search, and Firecrawl -- they auto-connect when API keys are available. Add more with:

```
/mcp-add
```

1. Choose mode: catalog, custom, or remove
2. Select server (Brave, GitHub, Postgres, etc.)
3. Enter API key if needed
4. Connected -- tools appear immediately

### Catalog

| Server | Tools | Requires |
|---|---|---|
| **Memory** | Knowledge graph (entities, relations, observations) | (none) |
| **Brave Search** | Web, image, video, news search | `BRAVE_API_KEY` |
| **Firecrawl** | Web scraping and content extraction | `FIRECRAWL_API_KEY` |
| **GitHub** | Repos, issues, PRs | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| **Filesystem** | Read/write local files | (none; specify dirs) |
| **PostgreSQL** | Query databases | `POSTGRES_CONNECTION_STRING` |
| **SQLite** | Read/write SQLite | (none) |
| **Google Maps** | Geocoding & directions | `GOOGLE_MAPS_API_KEY` |
| **Puppeteer** | Browser automation | (none) |
| **Sequential Thinking** | Step-by-step reasoning | (none) |
| **Slack** | Messaging & channels | `SLACK_BOT_TOKEN` |

### Custom Server

```
/mcp-add → Press 2 → Enter name → Local or remote → Enter command or URL
```

### Commands

| Command | What |
|---|---|
| `/mcp` | Show all servers + status |
| `/mcp-add` | Add from catalog or custom |
| `/mcp-connect <name>` | Connect or reconnect; prompts for missing keys |
| `/mcp-disconnect <name>` | Disconnect without removing |
| `/mcp-remove <name>` | Remove from config and disconnect |

---

## The Prompt System

| Command | Description |
|---|---|
| `/prompt` | View current system prompt |
| `/prompt set <text>` | Set prompt inline |
| `/prompt save <name>` | Save current prompt |
| `/prompt list` | List saved prompts |
| `/prompt <name>` | Use a saved prompt |

---

## Sessions

Working Mind auto-saves conversations on exit. Resume with `/session`:

```
/session → Press 1 → Select session → Resumes with all messages intact
/session → Press 2 → Type name → Fresh session
/session → Press 3 → Select session → Deletes it
```

Stored in `~/.wmind/sessions/`.

---

## Slash Commands Reference

### Core

| Command | Description |
|---|---|
| `/help` | All commands + shortcuts |
| `/clear` | Clear history, deactivate skills |
| `/compact` | Summarize to reduce context |
| `/undo` | Remove last exchange |
| `/cost` | Token usage estimate |
| `/model [spec]` | Show or change model |
| `/models [provider]` | List models |
| `/connect` | Switch provider/model (persists) |
| `/q` | Quit |

### Knowledge

| Command | Description |
|---|---|
| `/ingest` | Ingest .md files from CWD |
| `/memory` | Graph stats + help |
| `/memory save [topic]` | Extract entities from conversation |
| `/memory stats` | Counts by type |
| `/memory graph [tree] [filter]` | Visualize graph |
| `/memory export [mermaid\|dot]` | Export format |
| `/lint` | Audit graph for gaps/orphans/contradictions |

### Curation

| Command | Description |
|---|---|
| `/summarize` | Summarize conversation |
| `/export` | Export findings to `~/.wmind/research/` |

### MCP

| Command | Description |
|---|---|
| `/mcp` | Show server status |
| `/mcp-add` | Add server (wizard) |
| `/mcp-connect <name>` | Connect/reconnect |
| `/mcp-remove <name>` | Remove server |
| `/mcp-disconnect <name>` | Disconnect |

### Prompts & Packs

| Command | Description |
|---|---|
| `/prompt` / `/prompt set/save/list` | Manage system prompts |
| `/pack [name]` | Show pack info |
| `/skill <name>` | Activate a skill |
| `/skill off <name>` | Deactivate a skill |
| `/skill off-all` | Deactivate all |

---

## Keyboard Shortcuts

### Input

| Key | Action |
|---|---|
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `Ctrl+U` | Clear input |
| `Esc` | Clear or refocus |
| `Up/Down` | History (empty input) |

### Navigation

| Key | Action |
|---|---|
| `Tab` | Switch agent tab |
| `Ctrl+S` | Cycle sidebar width |
| `?` | Help overlay |

### Scrolling

| Key | Action |
|---|---|
| `Shift+Up/Down` | 3 lines |
| `PgUp/PgDn` | Full page |
| `Ctrl+Up/Down` | Top/bottom |
| Mouse wheel | 3 lines |

### Streaming

| Key | Action |
|---|---|
| `Ctrl+C` | Cancel request |
| `Ctrl+Y` | Copy last response |
| `Ctrl+E` | Expand/collapse tool output |

### Tool Confirmation

`y` = approve, `N` or `Enter` = deny.

---

## Model Aliases & Tiers

### Tiers

| Tier | Model | Why |
|---|---|---|
| `local` | `ollama/qwen3-coder` | No cloud (Ollama) |
| `local-fast` | `local-fast/gemma-3-4b-it-4bit` | No cloud (wmind-serve) |
| `fast` | `groq/llama-3.3-70b-versatile` | Lowest latency |
| `cheap` / `smart` | `deepseek/deepseek-v4-flash` | Lowest cost |
| `best` | `anthropic/claude-opus-4-7` | Highest quality |

### Popular Aliases

`sonnet` `opus` `haiku` `gpt5` `gpt5mini` `flash` `r1` `ds4` `o3` `o4mini` `llama4`

### Usage

```bash
wmind -m sonnet           # Alias
wmind -m best             # Tier
wmind -m ollama/gemma4    # Explicit
```

Or in TUI: `/model sonnet`

---

## CLI Reference

```bash
wmind [prompt] [options]

  -m, --model <spec>          Model (provider/model, alias, tier)
  -p, --prompt <spec>         System prompt (named, file, inline)
  --pack <name>               Pack to load (repeatable)
  --add-agent <persona>       Additional agent tab (repeatable)
  --api-key <key>             Override auto-detected key
  --base-url <url>            Override provider URL
  --auto-approve              Auto-approve tool calls
  --max-turns <n>             Max tool turns (default: 20)
  --no-thinking               Hide reasoning blocks
  --configure                 Setup wizard
  --list-providers            Show providers + keys
  --list-models [provider]    Show models
  --list-prompts              Show saved prompts
  --list-packs                Show packs
  --save-prompt <name>        Save current prompt to library
  --non-interactive           No TUI (CI/scripts)

wmind pack-install <url> [--tag <tag>]   Install pack from git
wmind pack-link <path>                   Link local pack directory
wmind pack-update <name>                 Update installed pack
wmind pack-remove <name>                 Remove installed pack
```

---

## Configuration

`~/.wmind/config.jsonc`:

```jsonc
{
  "defaultModel": "ollama/gemma4:27b",
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434/v1" },
    "openrouter": { "apiKey": "env:OPENROUTER_API_KEY" }
  },
  "systemPrompts": {
    "default": "You are Working Mind, a reasoning agent..."
  },
  "agents": { "maxTurns": 20 },
  "mcpServers": {
    "brave-search": {
      "type": "local",
      "command": ["npx", "-y", "@brave/brave-search-mcp-server"],
      "requiredEnvVars": [
        { "name": "BRAVE_API_KEY", "label": "Brave API Key", "required": true }
      ],
      "enabled": true
    }
  }
}
```

API keys use `env:VAR_NAME` -- never plaintext.

### Data Directory

`~/.wmind/`:

| Path | What |
|---|---|
| `config.jsonc` | Config |
| `memory.jsonl` | Knowledge graph |
| `knowledge-index.md` | Auto-generated index |
| `memories/` | Named stores |
| `sessions/` | Saved sessions |
| `research/` | Exports |

---

## Workflows

### First Session

```bash
export OPENROUTER_API_KEY=sk-or-...
wmind
# → Memory auto-connects, starter pack loads

❯ Explain the key approaches to RAG
# → Agent researches, auto-saves entities to memory

❯ /memory stats
# → 6 entities, 4 relations, 15 observations

❯ /memory graph tree
# → Visualize what you've learned
```

### Compounding Across Sessions

```
# Session 2 (days later)
❯ What's new in RAG since we last looked?
# → Agent searches memory, finds prior knowledge
# → Only researches what's new
# → Graph grows: 14 entities, 9 relations

# Session 5
❯ /memory stats
# → 30+ entities accumulated

❯ Write a survey of RAG methods
# → Produces output grounded in 5 sessions of knowledge
```

### Ingest Local Files

```
❯ /ingest
# → Lists .md files in CWD
# → You confirm
# → Agent extracts structured knowledge into graph
```

### Add Tools Mid-Session

```
/mcp-add → Select "PostgreSQL" → Enter connection string → Connected
# → 3 new tools available immediately
```

### Export Your Knowledge

```
/memory export mermaid --file rag-knowledge.mmd
# → Opens in GitHub, VS Code, any Mermaid renderer
```

### Context Management

```
/compact      → Summarize conversation to free tokens
/undo         → Remove last bad exchange
/clear        → Full reset
/cost         → Check token count
```

### Error Recovery

```
r             → Re-send last message (after error)
Ctrl+C        → Cancel hanging stream
/session      → Resume after crash
```
