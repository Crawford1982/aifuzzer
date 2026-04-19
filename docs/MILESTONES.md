# Milestones — reference (do not lose)

Single source of truth for **delivery phases** and **exit criteria**. Implementation details live in code; this file tracks **what “done” means**.

**Tests (regression):** `npm test` → `test:plan`, `test:openapi`, `test:graph`, `test:chains`, `test:llm-plan` (all offline; no API keys). **Milestones A–C** on `main` are expected to pass this suite on every push. **B** in particular is covered by `test:chains` (stateful binding). **C** is covered by `test:llm-plan` (planner + `validatePlan` with mocked provider).

---

## Milestone A — Single source of truth (OpenAPI + CLI)

**Goal:** Spec-driven discovery, not only URL patterns.

**Done when:**

- [x] `--openapi <file>` loads **OpenAPI 3 JSON or YAML**.
- [x] `--target` acts as API **base URL** (overrides `servers[0]` when set).
- [x] Normalized operations feed **hypothesis expansion** (baseline, ID-like mutations, debug query, auth omission when secured).
- [x] **Typed execution plan** contract (`planSchema` / `planCompiler`) and **`--stub-plan`** prove compile → execute without LLM.

**Artifacts:** `src/openapi/`, `src/planner/planSchema.js`, `planCompiler.js`, `stubPlanner.js`.

---

## Milestone B — Stateful kernel (no LLM)

**Goal:** Valid **multi-step** behavior: producer → consumer with **live binding** from real responses.

**Done when:**

- [x] **Producer→consumer graph** inferred from paths (REST heuristics: collection **GET/POST** → **GET …/{id}**).
- [x] **Sequential executor** runs step 2 with **ids extracted** from step 1 (array-first or object `id`).
- [x] **Offline test** `test:chains`: mocked `fetch`, **`post_to_item`** chain (POST → GET with bound id).
- [x] Report includes **`dependencyGraph`**, mode **`openapi_stateful`**, **`replayCurl`**; **no** giant `fullBody` in saved JSON.

**Artifacts:** `src/state/`, `src/hypothesis/StatefulCampaignEngine.js`, `src/execution/SequenceExecutor.js`.

**Explicit non-goals (still):** nested `/a/{id}/b` chaining, auth-scoped handle stores, response-schema `$ref` resolution.

---

## Milestone C — Bounded LLM planner

**Goal:** Model proposes **only** `ExecutionPlan` JSON; **executor never calls the LLM**; invalid plans **never** reach `fetch` for the target API.

**Done when:**

- [x] `src/planner/llmEnv.js` reads **env-only** API config (no keys in repo).
- [x] `src/planner/llmPlanner.js` calls chat HTTP **only from this module**; returns validated `ExecutionPlan` or structured failure.
- [x] **`--plan-with-llm`** (requires **`--openapi`**) requests one plan, compiles, executes a **capped** slice, then continues with chains + flat expansion for remaining budget.
- [x] If no key or validation fails → **`llm_plan_skipped`** observation, run continues **without** LLM.
- [x] `scripts/test-llm-planner.mjs` mocks provider `fetch` (CI-safe).

**Environment (reference):**

| Variable | Purpose |
|----------|---------|
| `MYTHOS_LLM_API_KEY` | Bearer token for chat API (also accepts `OPENROUTER_API_KEY`). |
| `MYTHOS_LLM_BASE_URL` | Default `https://openrouter.ai/api/v1/chat/completions`. |
| `MYTHOS_LLM_MODEL` | Default `openai/gpt-4o-mini` (override per provider). |

**Non-goals:** agentic loops, tool use against target, storing secrets in reports.

---

## Milestone D — Verifier-first (hard evidence)

**Goal:** Deterministic replay, minimization, confidence scoring—not model opinions.

**Planned:**

- [ ] Minimize failing sequences; baseline diff; optional cross-session swap.
- [ ] Confidence score from deterministic signals only.
- [ ] Evidence pack export (HAR / structured replay bundle) beyond curl strings.

---

## Milestone E — Ops & memory (after D)

**Queues (Redis), vector memory, CI profile** — only after **D** proves signal quality.

---

## Cursor / agents

Repo rules: **`AGENTS.md`**, **`.cursor/rules/mythos-fuzzer.mdc`** — executor ≠ LLM; plans validated before HTTP.
