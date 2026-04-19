# Mythos Fuzzer (buildable core)

This repository is a **framework-shaped** security research tool: the same **layer names** as the long-term vision, but each layer is either **implemented**, **stubbed with a real interface**, or **not started**—see `docs/ARCHITECTURE.md`, **`docs/MYTHOS-ARCHITECTURE-REFERENCE.md`** (canonical diagram + “where we are”), and `docs/ROADMAP.md`.

**Non-negotiable:** only use on systems you are **authorized** to test.

## What runs today (core CLI)

- **Surface** — light path probes; status, size, content-type.
- **OpenAPI** — optional `--openapi` (JSON or YAML): spec-driven cases + `dependencyGraph` in the report.
- **Stateful chains (Milestone B)** — heuristics find `list → item` (and `create → item` when POST exists on the collection); the engine runs **sequential** steps and binds a real `id` from the first response into the second request. No LLM.
- **Typed plans** — `--stub-plan` compiles a fixed `ExecutionPlan` through the same path as a future LLM planner (validate → `FuzzCase` → execute).
- **Hypotheses** — pattern mode (no spec) or spec mode; both are deterministic.
- **Verification (light)** — heuristics + per-row **`replayCurl`** in the report.
- **Output** — JSON under `./output/` (gitignored). Large `fullBody` capture is used in-memory for binding only, not stored in the report.

`cloud-brain-scope-lab/` is a separate UI/scope experiment; the **fuzzer engine** is the `src/` tree + `npm start`.

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

# OpenAPI-driven (JSON or YAML)
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json

# Stub typed plan (compiler smoke; needs same base as paths in stubPlanner.js)
npm start -- --target "https://jsonplaceholder.typicode.com" --stub-plan

# Tests (no network for default suite)
npm test
```

## Testing

| Script | What it checks |
|--------|------------------|
| `npm test` | Full suite below (CI-friendly, default **no outbound HTTP**). |
| `npm run test:plan` | Stub `ExecutionPlan` validates and compiles to `FuzzCase`s. |
| `npm run test:openapi` | Fixture **JSON + YAML** loads and normalizes. |
| `npm run test:graph` | `fixtures/minimal-posts.openapi.json` yields **list→item** and **POST→item** edges. |
| `npm run test:chains` | Mocked `fetch`: **POST `/posts`** → `{ id }` → **GET `/posts/{id}`** (offline). |
| `npm run test:llm-plan` | Mocked chat completions — **`llmPlanner`** → **`validatePlan`** (offline). |
| `npm run test:scope-lab-agent` | Optional integration with `cloud-brain-scope-lab` adapter (hits **jsonplaceholder** unless modified). |

Fixtures live under **`fixtures/`** — `minimal-posts.openapi.json` includes **`POST /posts`** (`createPost`) alongside list/get routes for **`post_to_item`** chains.

**Milestone reference:** [`docs/MILESTONES.md`](docs/MILESTONES.md).

**LLM planning (live API):** set `MYTHOS_LLM_API_KEY`, then e.g.  
`npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --plan-with-llm`

## Repo layout

```
src/
  surface/       # Layer 1 (REST slice)
  openapi/       # Spec load + normalize
  state/         # Dependency edges + JSON handle extract
  semantic/      # Layer 2 (observations stub)
  hypothesis/    # Patterns, OpenAPI expansion, stateful campaigns
  planner/       # Typed execution plans (stub; LLM later)
  orchestrator/  # Pipeline
  execution/     # HTTP pool + sequential chains
  feedback/      # Response novelty / indexing
  verify/        # Triage + replay curl evidence
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
