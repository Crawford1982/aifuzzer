# Roadmap — build order (not hype)

**Canonical milestone checklist:** [`docs/MILESTONES.md`](./MILESTONES.md)

Everything below assumes **tests on authorized targets**, caps on request volume, and **manual verification** of anything that matters.

## v0.1 (done in this repo)

- REST surface slice + pattern hypotheses + concurrent HTTP executor + JSON report.
- Stable module seams matching Mythos layers.

## v0.2 — Safety + signal quality

- Token bucket / global RPS (`--max-rps`).
- Scope file: allowed hosts/paths prefixes; deny redirects off-scope.
- Baseline-aware checks (authed vs unauthenticated diff) as first-class signals.
- Normalize responses for hashing (strip volatile headers).

## v0.3 — OpenAPI + stateful core

- [x] Parse OpenAPI 3 **JSON and YAML** via `--openapi <path>`; `--target` is the API base URL.
- [x] Spec-derived cases (baseline, ID-like path mutations, debug query, auth omission when `secured`).
- [x] Typed **execution plan** contract (`planSchema` + `planCompiler`) and **stub planner** (`--stub-plan`) — no LLM on the execution path.
- [x] Report includes **`results[].replayCurl`**; full response bodies are **not** written to disk (only `bodyPreview` + binding used in-process).
- [x] **Milestone B (v0)**: REST-style **producer→consumer** edges from the spec + **sequential** two-step runs with **live id binding** (e.g. `GET /collection` → first `id` → `GET /item/{id}`). See `src/state/`, `src/execution/SequenceExecutor.js`.
- [ ] Deeper graph: nested routes, explicit response-schema links, multi-step plans with more than two hops, auth-scoped handle store.

## v0.4 — Adaptive feedback (still no Mythos fantasies)

- Novelty scoring using structural diff (keys, arrays length, status buckets).
- Simple bandit / round-robin over hypothesis families that opened new buckets.

## Milestone C (bounded LLM planner) — **implemented (v1)**

Shipped:

- [x] `src/planner/llmEnv.js`, `src/planner/llmPlanner.js` — chat HTTP **only** in planner; **`MYTHOS_LLM_*`** env vars.
- [x] **`--plan-with-llm`** + **`--openapi`** — optional slice before chains + flat expansion; **`llm_plan_skipped`** when no key / failure.
- [x] **`npm run test:llm-plan`** — mocked provider (no network).

Iterate next: stronger prompts, redaction of response samples, tighter caps.

## v0.5 — LLM assistance (optional, bounded)

- Same capability as Milestone C; alias for roadmap readers.

## v1.0 — Multi-agent shape

- Separate coordinator processes or workers: Auth agent, IDOR agent, Logic agent—but **same** shared `SemanticModel` + append-only `FuzzResult` store.

## Later (binary / protocol)

Separate tracks (new agents, new surface modules). Do **not** block REST progress on binary.
