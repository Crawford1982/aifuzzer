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
- **Verification / evidence**: `src/verify/` — triage heuristics + `evidencePack.js` (curl replay).

## Naming

Prefer **“typed plan” / “execution plan”** over vendor framework names. The operating model follows bounded workspace + structured outputs + replayable evidence — not an embeddable third-party “Mythos” product.

## Tests

- **`npm test`** — includes plan/openapi/graph/chains, verifier/checkers (`test:milestone-d`, `test:checker-engine`), campaign memory / namespace overlap / hierarchy guards, **`test:milestone-e`** (CI + queues), **`test:auth-refs`** — see **`package.json`** (default **no outbound HTTP**).
- When adding planner or compiler logic, extend **`scripts/verify-plan.mjs`** or add a focused script under **`scripts/`**.
