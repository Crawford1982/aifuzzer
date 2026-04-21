# Agent / contributor rules — mythos-fuzzer

These rules prevent architectural drift when using AI assistants in Cursor.

## Non-negotiable boundaries

1. **Executor never imports LLM clients** (`openai`, `@anthropic-ai/sdk`, Gemini SDK, etc.). HTTP execution lives under `src/execution/`. **Chat completions** live only in **`src/planner/llmPlanner.js`** (plus env in **`llmEnv.js`**).
2. **Planners emit only typed plans** — JSON matching `validatePlan()` in `src/planner/planSchema.js`. No free-form attack instructions consumed by the executor.
3. **Plans are compiled, not trusted** — `src/planner/planCompiler.js` maps a validated plan to `FuzzCase[]` and rejects out-of-scope or malformed steps before any network I/O.
4. **Scope and safety** — **`scopePolicy`** gates hosts/paths (`--scope-file`); do not add “scan the whole internet” defaults. **`src/ops/`** wraps the same **`runMythosPipeline`** for CI/queues — workers must not bypass compilation or scope.

## Layering

- **Ingestion**: `src/openapi/`, surface probes in `src/surface/`.
- **State / graph**: `src/state/` — producer→consumer inference and JSON handle extraction; **no network**.
- **Hypotheses**: `src/hypothesis/` (patterns + OpenAPI + stateful chain builder). No model calls here.
- **Orchestration**: `src/orchestrator/MythosOrchestrator.js` wires modes; keeps execution deterministic.
- **Feedback (Milestone G)**: `src/feedback/` — ID harvest (`idHarvest.js`), **collection-scoped parent ID harvest** (`parentIdHarvest.js`) for nested BOLA parent swaps, + case prioritization (no LLM); report includes `semanticSnapshot.observations` (including `parent_id_harvest` when list bodies yield IDs).
- **Verification / evidence**: `src/verify/` — triage heuristics + `evidencePack.js` (curl replay).

## Naming

Prefer **“typed plan” / “execution plan”** over vendor framework names. The operating model follows bounded workspace + structured outputs + replayable evidence — not an embeddable third-party “Mythos” product.

## Tests

- **`npm test`** — includes plan/openapi/graph/chains (incl. **`post_to_list_get`**), verifier/checkers (`test:milestone-d`, `test:checker-engine` with flat + nested hierarchy), **`test:parent-swap`**, **`test:parent-id-harvest`**, **`test:pipeline-parent-harvest`** (harvest → expand integration), **`test:milestone-h`** (mass_assignment, function_level_authz, shadow_endpoint), campaign memory / namespace overlap / hierarchy guards, **`test:milestone-e`** (CI + queues), **`test:auth-refs`**, **`test:milestone-g`** (feedback: ID harvest + case prioritization) — see **`package.json`** and **`docs/TESTING.md`** (default **no outbound HTTP**).
- **`npm run validation:golden`** — wrapper around **`npm test`**; CI runs **`npm test`** then **`validation:golden`** on **`main`**.
- When adding planner or compiler logic, extend **`scripts/verify-plan.mjs`** or add a focused script under **`scripts/`**, then document it in **`docs/TESTING.md`**.

## Lab validation (human benchmarks)

- Rolling run index: **`data/validation-feedback/SESSION-LOG.md`** (`npm run validation:log`). Narrative expectations: **`docs/VALIDATION-BENCHMARKS.md`**.
- Confirming **`findings[]`** vs ground truth (replay, TP/FP/FN): **`docs/VALIDATION-TRIAGE.md`**.
- REST depth roadmap (GraphQL excluded): **`docs/REST-LEVEL-UP-PLAN.md`**.
