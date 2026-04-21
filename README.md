# Mythos Fuzzer (buildable core)

This repository is a **framework-shaped** security research tool: the same **layer names** as the long-term vision, but each layer is either **implemented**, **stubbed with a real interface**, or **not started**—see `docs/ARCHITECTURE.md`, **`docs/MYTHOS-ARCHITECTURE-REFERENCE.md`** (canonical diagram + “where we are”), and `docs/ROADMAP.md`.

**Non-negotiable:** only use on systems you are **authorized** to test.

## What runs today (core CLI)

- **Surface** — light path probes; status, size, content-type.
- **OpenAPI** — optional `--openapi` (JSON or YAML): spec-driven cases + `dependencyGraph` in the report.
- **Stateful chains (Milestone B)** — heuristics find `list → item` (and `create → item` when POST exists on the collection); the engine runs **sequential** steps and binds a real `id` from the first response into the second request. No LLM.
- **Typed plans** — `--stub-plan` compiles a fixed `ExecutionPlan` through the same path as a future LLM planner (validate → `FuzzCase` → execute).
- **Hypotheses** — pattern mode (no spec) or spec mode; both are deterministic.
- **Verification (light)** — heuristics + invariant checkers (including **Milestone H**: mass assignment reflection, privileged-route auth probes, shadow/inventory paths) + per-row **`replayCurl`** in the report.
- **Milestone G — feedback loops** — live IDs harvested from 2xx responses seed IDOR cases; **collection-list harvest** (`src/feedback/parentIdHarvest.js`) feeds **nested parent-swap** expansion when early runs include JSON array list responses; **`--campaign-memory`** biases flat-case order toward historically noisy routes; routes already hit by chains this run are deprioritized for coverage. See `src/feedback/idHarvest.js`, `src/feedback/parentIdHarvest.js`, `src/feedback/casePrioritizer.js`.
- **Output** — JSON under `./output/` (gitignored). Large `fullBody` capture is used in-memory for binding only, not stored in the report. **`semanticSnapshot.observations`** is the full timeline of pipeline events (OpenAPI summary, dependency graph, planner skips, Milestone G `live_id_harvest` / `case_prioritization`, etc.).

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

# Scope + rate limit (see fixtures/mythos-scope.example.yaml)
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --scope-file ./fixtures/mythos-scope.example.yaml --max-rps 5

# HAR + replay JSON next to mythos-report-*.json (same timestamp)
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --evidence-pack

# Optional: LLM suggests extra query/header probes (MYTHOS_LLM_API_KEY); hints validated vs spec
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --ai-mutation-hints

# Checker-backed expansion (capped): wordlist paths + schema body fuzz (enable mutations explicitly)
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --wordlist ./fixtures/sample-wordlist.txt --max-body-mutations-per-op 2

# Optional: alternate principal replay + tiny curated ID list + campaign memory file (see --help)
# npm start -- ... --auth TOKEN --auth-alt OTHER --namespace-replay-budget 16 --curated-wordlist --campaign-memory ./output/campaign-memory.json

# OpenAPI-driven (JSON or YAML)
npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json

# Stub typed plan (compiler smoke; needs same base as paths in stubPlanner.js)
npm start -- --target "https://jsonplaceholder.typicode.com" --stub-plan

# Tests (no network for default suite)
npm test
```

## Testing

Full catalog, CI notes, and feature ↔ test mapping: **`docs/TESTING.md`**.

| Script | What it checks |
|--------|------------------|
| `npm test` | Full suite below (CI-friendly, default **no outbound HTTP**). |
| `npm run validation:golden` | Same as **`npm test`** + success banner — use before shipping REST/triage changes (also run in **GitHub Actions** after `npm test`). |
| `npm run test:triage` | REST **`BasicTriage`** / **`triageHints`** (keyword + HTML 5xx classification). |
| `npm run test:plan` | Stub `ExecutionPlan` validates and compiles to `FuzzCase`s. |
| `npm run test:openapi` | Fixture **JSON + YAML** loads and normalizes. |
| `npm run test:graph` | `fixtures/minimal-posts.openapi.json` yields **list→item** and **POST→item** edges. |
| `npm run test:chains` | Mocked `fetch`: **POST `/posts`** → `{ id }` → **GET `/posts/{id}`** (offline). |
| `npm run test:llm-plan` | Mocked chat completions — **`llmPlanner`** → **`validatePlan`** (offline). |
| `npm run test:scope-policy` | Scope file load, host/path checks, redirect policy (offline). |
| `npm run test:milestone-d` | Baseline map, confidence scoring, minimization hints (offline). |
| `npm run test:evidence-export` | HAR + replay bundle builders (offline). |
| `npm run test:scoped-chain` | Nested path chain: list → `/posts/{id}/comments` (mocked `fetch`). |
| `npm run test:stats-signals` | Binomial route-level surprise for 5xx clusters (offline). |
| `npm run test:ai-advisor` | LLM mutation hints → validated `OPENAPI_AI_HINT` cases (mocked provider). |
| `npm run test:checker-engine` | Invariant checkers (leakage, delete, hierarchy) + pipeline (offline). |
| `npm run test:body-mutations` | Schema body mutation generator (offline). |
| `npm run test:wordlist-expand` | OpenAPI + `fixtures/sample-wordlist.txt` path injection (offline). |
| `npm run test:parent-swap` | Nested **`OPENAPI_PARENT_SWAP`** (schema alts + optional **`liveParentIdsByCollection`**) (offline). |
| `npm run test:parent-id-harvest` | Collection-scoped parent ID harvest from list GET bodies (offline). |
| `npm run test:pipeline-parent-harvest` | End-to-end harvest → **`expandFromOpenApi`** integration (offline). |
| `npm run test:session-memory` | Campaign memory merge + session summary (offline). |
| `npm run test:namespace-overlap` | Namespace / alt-auth overlap checker (offline). |
| `npm run test:hierarchy-trivial` | Hierarchy checker skips trivial public list shells (offline). |
| `npm run test:milestone-e` | CI profile, campaign job validation, file queue + stale recovery, route ranking (offline). |
| `npm run test:auth-refs` | Auth-by-env resolution for CLI/jobs (offline). |
| `npm run test:milestone-g` | Feedback loops: live ID harvest, case prioritization, route novelty ordering (offline). |
| `npm run test:milestone-h` | Milestone **H** OWASP checkers (mass assignment, authz paths, shadow endpoints); `scripts/test-milestone-h.mjs`. |
| `npm run test:llm-e2e` | Optional real LLM call — set **`MYTHOS_E2E_LLM=1`** + `MYTHOS_LLM_API_KEY`; **not** in `npm test`. |
| `npm run test:scope-lab-agent` | Optional integration with `cloud-brain-scope-lab` adapter (hits **jsonplaceholder** unless modified). |

Fixtures live under **`fixtures/`** — `minimal-posts.openapi.json` includes **`POST /posts`** (`createPost`) alongside list/get routes for **`post_to_item`** chains. Lab-oriented stubs: **`juiceshop-minimal.openapi.yaml`**, **`crapi-minimal.openapi.yaml`**, **`dvga-graphql.openapi.yaml`** (see **`docs/VALIDATION-BENCHMARKS.md`**).

**Milestone reference:** [`docs/MILESTONES.md`](docs/MILESTONES.md) through **Milestone G** (feedback loops: live ID harvest, case prioritization by campaign memory + route novelty).

**Milestone E — ops (optional):**

- **`MYTHOS_CI=1`** or **`--ci`** — conservative caps; requires **`--openapi` or `--stub-plan`** with **`--target`**. **`--ci-fail-on-findings`** exits **2** if `findings.length > 0`.
- **`MYTHOS_CI_REQUIRE_SCOPE=1`** or **`--ci-require-scope`** — when combined with **`--ci`**, refuses to run unless **`--scope-file`** is set (authorization is still on you; this pins *surface predictability*).
- **`--auth-env NAME`** / **`--auth-alt-env NAME`** — read Bearer material from env (same pattern for campaign jobs: **`authEnv`** / **`authAltEnv`** in JSON), so secrets stay out of job files and shell history where possible.
- **`npm run mythos:enqueue -- fixtures/mythos-campaign-job.example.json`** — push a validated job (see `MYTHOS_QUEUE_DIR`, default `.mythos-queue/`).
- **`MYTHOS_REDIS_URL=redis://...`** — Redis queue; successes append to **`mythos:campaign:jobs:done`** (trimmed list, cap **`MYTHOS_REDIS_DONE_CAP`**); worker startup **re-queues** orphaned **`processing`** entries after a crash.
- **`MYTHOS_STALE_PROCESSING_MS`** — file queue re-queues **`processing/*.json`** older than this threshold (default 30 minutes).
- **`npm run mythos:worker`** — drain queue (same HTTP pipeline as `npm start`). **`--once`** exits after one job or empty queue.

**Single-machine lab:** With no shared queue directory or Redis instance, exposure is mostly **your OS account** and **whatever URLs you aim at**. Still only test targets you’re allowed to hit; **`--scope-file`** + **`--ci-require-scope`** make accidental broad exploration harder.

**LLM planning (live API):** set `MYTHOS_LLM_API_KEY`, then e.g.  
`npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./fixtures/minimal-posts.openapi.json --plan-with-llm`

## Lab validation & benchmark logging

Use intentionally vulnerable apps (DVGA, crAPI, Juice Shop) or safe demos (**jsonplaceholder**) to validate **pipeline modes** and report shape—not every lab will produce **`findings`** with the current REST-oriented heuristics (e.g. **DVGA is GraphQL-heavy**; zero heuristic hits is often expected until GraphQL oracles exist).

**Scripts:**

- **`npm run validation:new -- --target dvga --label baseline`** — new folder under `data/validation-feedback/<run-id>/` with `run.md` + `findings.csv` templates.
- **`npm run validation:log`** — append one row to **`data/validation-feedback/SESSION-LOG.md`** from the latest `output/mythos-report-*.json` (or pass a specific report path after `--`).

Playbooks: **`data/validation-feedback/target-playbooks/`**. Expectations and dummy targets: **`docs/VALIDATION-BENCHMARKS.md`**. **Triage workflow (replay, TP/FP/FN):** **`docs/VALIDATION-TRIAGE.md`**. **REST roadmap (non-GraphQL):** **`docs/REST-LEVEL-UP-PLAN.md`**. **Where we stand (subjective ratings):** **`docs/PROJECT-RATINGS.md`**. Third-party synthesis + factual corrections: **`docs/EXTERNAL-ANALYSIS-SYNTHESIS.md`**.

## Repo layout

```
src/
  surface/       # Layer 1 (REST slice)
  openapi/       # Spec load + normalize
  state/         # Dependency edges + JSON handle extract
  semantic/      # Layer 2 — SemanticModel observations (also in report)
  hypothesis/    # Patterns, OpenAPI expansion, stateful campaigns
  planner/       # Typed execution plans (+ bounded LLM)
  orchestrator/  # Pipeline
  execution/     # HTTP pool + sequential chains
  feedback/      # Novelty index; Milestone G: idHarvest, casePrioritizer
  verify/        # Triage, checkers, stats, HAR / replay
  campaign/      # Session / campaign memory merge (deterministic)
  ops/           # Milestone E: CI profile, queues, worker, auth-by-env
data/            # bounty-signals.json, owasp mapping, curated wordlist slice
                 # validation-feedback/ — SESSION-LOG, lab playbooks, per-run CSV + run.md
docs/
  ARCHITECTURE.md
  ROADMAP.md
  MILESTONES.md             # milestone exit criteria + shipped checklist
  PROJECT-RATINGS.md           # subjective scorecard — engineering vs signal vs OWASP breadth
  EXTERNAL-ANALYSIS-SYNTHESIS.md  # independent review merged with maintainer errata ($ref, tests)
  VALIDATION-BENCHMARKS.md # lab logging, expected findings vs offline tests
  VALIDATION-TRIAGE.md      # replay-based TP/FP/FN — confirming findings without new features
  REST-LEVEL-UP-PLAN.md     # REST/OpenAPI/auth depth — phased roadmap
  TESTING.md                # npm scripts matrix, CI, feature ↔ test mapping
```


## Philosophy

Ship **narrow vertical slices** inside this skeleton. Expand agents and semantics when each slice is tested and stable—not before.

## Workspace boundaries

This repo root is the **Mythos fuzzer core** (`src/`, CLI, docs). Experimental scope UI and adapters live under **`cloud-brain-scope-lab/`**. Canonical folder roles and clone-specific paths are in **`docs/WORKSPACE-BOUNDARIES.md`**.
