# Milestones — reference (do not lose)

Single source of truth for **delivery phases** and **exit criteria**. Implementation details live in code; this file tracks **what “done” means**.

**Tests (regression):** `npm test` — see `package.json` (offline; no API keys). **A–F** on `main` are expected to pass. **F** adds `test:checker-engine`, `test:body-mutations`, `test:wordlist-expand`. Optional live LLM: `MYTHOS_E2E_LLM=1 npm run test:llm-e2e`.

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

**Nested sub-resources (incremental):** `list_to_scoped_subresource`, `post_to_scoped_subresource`, `item_to_scoped_subresource` edges for paths like `/posts/{id}/comments` (see `dependencyGraph.js`). Still **non-goals:** auth-scoped handle stores, full `$ref` expansion, >2-hop chains in one compile.

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

**Goal:** Deterministic replay hints, baseline diff, confidence scoring—not model opinions.

**Done when:**

- [x] **Baseline fingerprints** per canonical route from first `OPENAPI_BASELINE` / `BASELINE` successes (`src/verify/baseline.js`).
- [x] **Confidence** from signals only — status, severity, baseline body hash diff, redirect policy (`src/verify/confidence.js`); attached to report `findings[]`.
- [x] **Minimization hints** — query-noise stripping suggestions where applicable (`src/verify/minimize.js`).
- [x] **Evidence export** — HAR 1.2 + structured replay JSON (`src/verify/evidenceExport.js`); CLI **`--evidence-pack`** writes files next to the report (same timestamp); response bodies are preview-sized unless chain capture expanded them.

**Related:** CI runs `npm test` on PRs to `main` (`.github/workflows/ci.yml`).

---

## Milestone F — Checker oracles & bounty-shaped signals

**Goal:** Named bug buckets (RESTler-style **architecture**, Mythos implementations), deterministic matchers, bounded expansion — **LLMs stay downstream** of checkers.

**Done when:**

- [x] **Checker registry** — `checkerRegistry.js`: `checkerId`, precondition text, OWASP mapping, bounty tier hint; report includes **`checkerRegistry`** + **`checkersFired`** with evidence case IDs + optional HAR path hint.
- [x] **Invariant checkers** — create/list leakage (4xx mutating → list still populated), delete→GET still readable, hierarchy / identical body across parents (`invariantCheckers.js`).
- [x] **Bounty battery** — `data/bounty-signals.json`: regex/status matchers on **response previews only** (`bountyBattery.js`).
- [x] **OWASP mapping artifact** — `data/owasp-api-mapping.json` (reference links to themes, not full OWASP text).
- [x] **Optional wordlist path injection** — `--wordlist` + caps (`--max-wordlist-injections`, hard ceiling in expander).
- [x] **Schema-aware body mutations** — omit required / wrong type / extra prop / long string; **`--max-body-mutations-per-op`** (default **0** to keep CI stable).

**Next (F+ / E):** Redis/queues, campaign memory, deeper RESTler parity checkers (namespace replay), import curated SecLists slices by path only.

---

## Milestone E — Ops & memory (after F foundations)

**Queues (Redis), vector memory, CI profile** — bounded campaigns and recall without bypassing checkers.

---

## Cursor / agents

Repo rules: **`AGENTS.md`**, **`.cursor/rules/mythos-fuzzer.mdc`** — executor ≠ LLM; plans validated before HTTP.
