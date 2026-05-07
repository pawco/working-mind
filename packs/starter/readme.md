# Starter Pack

**Version:** 0.1.0 | **Author:** Working Mind | **License:** MIT | **Min Version:** 0.0.1

Free starter pack -- chat with persistent memory, web search and scraping (with API keys), summarize and export your sessions.

---

## What It Does

The Starter pack gives you a conversational AI assistant with persistent memory. It is the default pack loaded when you start wmind. It handles general Q&A, remembers your preferences across sessions, and can summarize or export conversations.

---

## MCP Servers

| Server | Capability | Required? | API Key Needed? |
|--------|-----------|-----------|----------------|
| memory | Persistent knowledge graph | No | No |
| brave-search | Web search for fact-checking | No | Yes (`BRAVE_API_KEY`) |
| firecrawl | Web scraping from URLs | No | Yes (`FIRECRAWL_API_KEY`) |

When the memory server is connected, the agent automatically saves and recalls information across sessions. Web search and scraping are optional -- set API keys to enable them.

---

## Features

### Persistent Memory

The agent proactively uses the knowledge graph to:
- Remember your preferences, projects, and context across sessions
- Recall past conversations and conclusions
- Build a personal knowledge base over time

### Curation

| Command | Description |
|---------|------------|
| `/summarize` | Summarize the current conversation as structured notes |
| `/export [topic]` | Export the session as a self-contained markdown document to `~/.wmind/exports/` |

---

## Usage

```
# Start wmind (Starter is the default pack)
wmind

# Ask questions, the agent uses memory automatically
> What were we discussing last time about the product roadmap?

# Summarize the session
/summarize

# Export the session for later reference
/export product-roadmap-notes
```
