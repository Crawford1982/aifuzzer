# Mythos Fuzzer (buildable core)

This repository is a **framework-shaped** security research tool: the same **layer names** as the long-term vision, but each layer is either **implemented**, **stubbed with a real interface**, or **not started**—see `docs/ARCHITECTURE.md`, **`docs/MYTHOS-ARCHITECTURE-REFERENCE.md`** (canonical diagram + “where we are”), and `docs/ROADMAP.md`.

**Non-negotiable:** only use on systems you are **authorized** to test.

## What runs today (v0.1)

- **Layer: Surface (REST only)** — probe a small set of paths, record status, size, headers.
- **Layer: Semantic graph** — minimal in-memory stub (stores observations; no inference yet).
- **Layer: Hypotheses** — pattern-driven candidate tests (IDOR-ish path swaps, missing auth replay, debug query params)—not LLM-generated.
- **Orchestrator** — wires surface → hypotheses → concurrent HTTP execution → naive triage.
- **Output** — JSON report under `./output/` (timestamped).

No LLM, no binary/protocol agents, no exploit generation.

## Requirements

- **Node.js 18+** (uses built-in `fetch`).

## Usage

```bash
npm start
# Enter a real https:// URL from your API docs, or type help
# Dynatrace labs shortcuts (when authorized): sprint2:YOUR-ENV  or  sprint3:YOUR-ENV

# or non-interactive:
npm start -- --target "https://jsonplaceholder.typicode.com/posts/1"

# Template URL (same host/path pattern as your target)
npm start -- --target "https://jsonplaceholder.typicode.com/posts/{id}"

# Auth header (Bearer automatically prefixed if omitted)
npm start -- --target "https://api.example.com/me" --auth "YOUR_TOKEN"

# Tune concurrency / cap
npm start -- --target "URL" --concurrency 3 --max-requests 80
```

## Repo layout

```
src/
  surface/       # Layer 1 (REST slice)
  semantic/      # Layer 2 (stub graph)
  hypothesis/    # Layer 3 (pattern engine)
  orchestrator/  # Layer 4 (single coordinator for now)
  execution/     # HTTP fuzz agent
  feedback/      # Response novelty / indexing
  verify/        # Basic triage
docs/
  ARCHITECTURE.md
  ROADMAP.md
```

## Philosophy

Ship **narrow vertical slices** inside this skeleton. Expand agents and semantics when each slice is tested and stable—not before.

## Workspace boundaries

- `C:\Users\Admin\Desktop\cloud brain` = your original chat app baseline.
- `C:\Users\Admin\Desktop\AI-guided REST API fuzzer\cloud-brain-scope-lab` = the fork for scope URL ingestion + targeting workflow experiments.
- `C:\Users\Admin\Desktop\AI-guided REST API fuzzer` = Mythos fuzzer core (CLI + architecture docs).

Use `docs/WORKSPACE-BOUNDARIES.md` as the source of truth for where to edit.
