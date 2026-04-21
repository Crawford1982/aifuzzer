# Milestones — reference (do not lose)

Single source of truth for **delivery phases** and **exit criteria**. Implementation details live in code; this file tracks **what “done” means**.

**Tests (regression):** `npm test` — see `package.json` (offline; no API keys). **A–G** on `main` are expected to pass. **F** adds `test:checker-engine`, `test:body-mutations`, `test:wordlist-expand`. **E** adds `test:milestone-e`, **`test:auth-refs`**. **G** adds **`test:milestone-g`** (feedback loops). Optional live LLM: `MYTHOS_E2E_LLM=1 npm run test:llm-e2e`.

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

**F+ shipped:** optional **`--campaign-memory`** merge file; **`--auth-alt`** + **`--namespace-replay-budget`**; **`--curated-wordlist`** tiny in-repo slice. **Hierarchy heuristic refinement:** `resource_hierarchy_cross_parent` compares **`canonicalUrlForHierarchyCompare`** (strips Mythos probe-only query keys: `debug`, `trace`, `verbose`, `__debug`) so identical bodies on the same path with vs without those probes are **not** treated as distinct URLs — reduces false positives on public/demo APIs. **Milestone E** adds CI profile, validated jobs, file/Redis queues, worker/enqueue (`docs/MILESTONES.md` §E).

---

## Milestone E — Ops & memory (after F foundations)

**Goal:** Bounded campaigns at scale — **queues**, **recall**, **CI gates** — without bypassing checkers or turning Mythos into an unscoped scanner.

**Done when (v0 shipped in-repo):**

- [x] **CI profile** — `MYTHOS_CI=1` or **`--ci`**: tight caps, no LLM planner / AI hints / evidence-pack churn; **`--ci-fail-on-findings`** → exit **2** if any findings. Requires **`--openapi` or `--stub-plan`** + **`--target`** (non-interactive). See `src/ops/ciProfile.js`.
- [x] **Campaign job envelope** — validated JSON (`version`, `target`, `openapiPath` or `useStubPlan`, caps) — `src/ops/campaignJob.js`, example `fixtures/mythos-campaign-job.example.json`.
- [x] **Job queue** — default **filesystem** queue under **`MYTHOS_QUEUE_DIR`** (default `.mythos-queue/`); optional **Redis** when **`MYTHOS_REDIS_URL`** is set (`src/ops/fileQueue.js`, `redisQueue.js`, `queueFactory.js`).
- [x] **Worker + enqueue CLIs** — `npm run mythos:enqueue -- <job.json>`, `npm run mythos:worker` (see `src/ops/enqueue.js`, `worker.js`); workers call the same **`runMythosPipeline`** via **`runCampaignJob`**.
- [x] **Route recall (deterministic)** — **`rankRoutesFromCampaignMemory`** for prioritization from merged campaign memory JSON (no embedding vendor in v0) — `src/ops/routeMemoryRank.js`.

**Also shipped (E hardening):**

- [x] **Auth by reference** — campaign jobs may use **`authEnv`** / **`authAltEnv`** (uppercase env names); CLI **`--auth-env`** / **`--auth-alt-env`**. Inline **`auth`** / **`authAlt`** remains valid but cannot mix with env refs (`src/ops/authRefs.js`).
- [x] **Redis durability** — jobs tracked in **`mythos:campaign:jobs:processing`** hash until complete/fail; **`mythos:campaign:jobs:done`** list stores success metadata (LRANGE inspectable); **`recoverProcessing()`** on worker start re-queues orphans.
- [x] **File-queue recovery** — **`recoverStaleProcessing(ms)`** returns stuck **`processing/`** JSON to **`pending/`** (default threshold 30m, override **`MYTHOS_STALE_PROCESSING_MS`**).
- [x] **CI scope gate (optional)** — **`MYTHOS_CI_REQUIRE_SCOPE`** / **`--ci-require-scope`** with **`--ci`**: fails if no **`--scope-file`** (predictable surface; not a substitute for legal authorization).

**Later (E+):** blocking Redis consumer, embedding-backed ranker, hosted object store for full reports.

---

## Milestone G — Close the feedback loops

**Goal:** Connect the three built-but-disconnected signals — campaign memory ranking, response novelty, and live ID harvesting — so every run is smarter than the last.

**Done when:**

- [x] **Live ID harvesting** — after chains + LLM cases execute, extract numeric IDs and UUIDs from 2xx response bodies (`src/feedback/idHarvest.js`); merge harvested IDs into the wordlist seed pool for subsequent flat IDOR cases (`harvestIdsFromResults`). No hardcoded IDs required for targets that leak them naturally.
- [x] **Collection-scoped parent harvest** — from early GETs whose pathname has no embedded id/uuid segments and whose body is a JSON array, bucket IDs by collection path (`src/feedback/parentIdHarvest.js`); merged into **`liveParentIdsByCollection`** for nested **`OPENAPI_PARENT_SWAP`** cases (`semanticSnapshot.observations` includes **`parent_id_harvest`** when buckets exist). Offline: **`npm run test:parent-id-harvest`**, **`npm run test:pipeline-parent-harvest`**.
- [x] **Case prioritization from campaign memory** — when `--campaign-memory` is loaded, `rankRoutesFromCampaignMemory` output drives the sort order of flat cases so high-signal routes from previous runs are tested first within budget (`src/feedback/casePrioritizer.js`).
- [x] **Route novelty ordering** — routes already hit by chains / LLM slice this run are deprioritized in the flat expansion; unseen routes are preferred, maximizing coverage within the request budget.
- [x] **SemanticModel observations** — `live_id_harvest` and `case_prioritization` observation kinds record what was harvested/reordered for the report.
- [x] **Offline tests** — `npm run test:milestone-g` covers ID extraction from collections/resources/UUIDs, harvest filtering (2xx-only), priority ordering (ranked-first, unseen-first), cap enforcement.

**Artifacts:** `src/feedback/idHarvest.js`, `src/feedback/parentIdHarvest.js`, `src/feedback/casePrioritizer.js`; wiring in `src/orchestrator/MythosOrchestrator.js`. Regression catalog: **`docs/TESTING.md`**.

---

## Milestone H — Three new OWASP checkers

**Goal:** Cover the largest gaps in the OWASP API Top 10 (2023) — mass assignment, function-level authz, shadow/inventory endpoints — with deterministic oracles.

**Done when:**

- [x] **`mass_assignment` checker** — `bodyfuzz:extra_prop` case returns 2xx; a later GET (same run) has `__mythosUnexpected` in the body preview (API3:2023). In live runs, requires **`--max-body-mutations-per-op > 0`** so `extra_prop` cases are generated.
- [x] **`function_level_authz` checker** — path heuristics for **admin / internal / private / …** — flags **`AUTH_BYPASS` + `omit_auth`** on those paths with 2xx and a non-trivial body, and **`NAMESPACE_AUTH_REPLAY` + `:authAlt`** on the same (API5:2023).
- [x] **`shadow_endpoint` checker** — GET 200 on paths suggesting **swagger/actuator/graphql/metrics/debug/trace** etc., or **legacy/beta/internal-api** style segments, with JSON-like bodies (API9:2023).
- [x] Checker IDs and OWASP mappings in `src/verify/checkerRegistry.js`; implementations in `src/verify/invariantCheckers.js`.
- [x] **`npm run test:milestone-h`** covers all three checkers offline (`scripts/test-milestone-h.mjs`).

---

## Milestone I — LLM response analyst

**Goal:** Close the last LLM feedback gap — after execution, the model sees redacted evidence of *interesting* responses and proposes targeted follow-up probes, validated before any new HTTP.

**Done when:**

- [ ] **`src/planner/responseAnalysisAdvisor.js`** — collects top-N most interesting results (5xx, auth-bypass successes, body fingerprint novelty); sends truncated, redacted previews to the LLM; validates suggested probes against spec (same pattern as `aiMutationAdvisor`); capped budget; graceful skip when no key.
- [ ] **`--response-analysis-hints`** CLI flag — optional, requires `--openapi`; runs after first-pass execution; follow-up cases execute within `remaining` budget.
- [ ] LLM never sees auth tokens, full URL paths with sensitive params, or full response bodies — only shape/status/preview metadata.
- [ ] `npm run test:milestone-i` mocks provider; tests hint validation and case generation offline.

---

## Milestone J — Spec fidelity (`$ref` resolution)

**Goal:** Real-world OpenAPI specs (Dynatrace, enterprise APIs) use `$ref` extensively; silently skipping them leaves parameters and body schemas empty.

**Done when:**

- [ ] **Local `$ref` resolution** in `src/openapi/OpenApiLoader.js` — resolve `#/components/schemas/…` and `#/components/parameters/…` refs inline during normalization.
- [ ] External / cross-file `$ref`s skipped gracefully with an observation log entry (not thrown).
- [ ] Existing `test:openapi` fixture updated with a `$ref`-using spec; test confirms parameters are resolved.
- [ ] No changes to `NormalizedOperation` or `NormalizedSpec` types — resolution is transparent to all downstream consumers.

---

## Milestone K — Richer mutation corpus

**Goal:** Go beyond 4 body mutation templates to semantically meaningful variations that hit real validation paths.

**Done when:**

- [ ] `buildSchemaBodyMutationVariants` expanded with: negative integers, zero for required numeric fields, unicode boundary strings (`\u0000`, `\uFFFF`), injection probes (`'`, `"`, `<script>`, `--`), boundary values (`2^31-1`, `0`, `-1`), `null` for required fields.
- [ ] **String-format-aware mutations** — schema `format: uuid` → try a non-UUID string, `null`, and a path traversal string; `format: date` → try invalid date strings and integers.
- [ ] Cap still enforced (`--max-body-mutations-per-op`); new variants only expand within the same cap.
- [ ] `npm run test:body-mutations` extended to cover new variants.

---

## Milestone L — Adaptive two-pass campaign

**Goal:** Within a single `npm start` run, execute a targeted second pass on high-interest routes identified in the first pass — making a single invocation behave like a bounded autonomous campaign.

**Done when:**

- [ ] After first-pass execution, `buildRouteInterestScores` (already in `src/campaign/sessionMemory.js`) identifies routes with elevated error/5xx rate.
- [ ] Second pass runs additional IDOR + body mutation cases on those routes only, using live-harvested IDs from pass one; total budget still bounded by `--max-requests`.
- [ ] **`--two-pass`** CLI flag enables this explicitly (off by default; CI mode always single-pass).
- [ ] Report includes `pass1` and `pass2` result blocks for transparency.
- [ ] `npm run test:milestone-l` tests the pass split and budget enforcement offline.

---

## Cursor / agents

Repo rules: **`AGENTS.md`**, **`.cursor/rules/mythos-fuzzer.mdc`** — executor ≠ LLM; plans validated before HTTP.
