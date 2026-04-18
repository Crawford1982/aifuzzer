# Roadmap — build order (not hype)

Everything below assumes **tests on authorized targets**, caps on request volume, and **manual verification** of anything that matters.

## v0.1 (done in this repo)

- REST surface slice + pattern hypotheses + concurrent HTTP executor + JSON report.
- Stable module seams matching Mythos layers.

## v0.2 — Safety + signal quality

- Token bucket / global RPS (`--max-rps`).
- Scope file: allowed hosts/paths prefixes; deny redirects off-scope.
- Baseline-aware checks (authed vs unauthenticated diff) as first-class signals.
- Normalize responses for hashing (strip volatile headers).

## v0.3 — Semantic model (minimal, useful)

- Parse OpenAPI 3 JSON if supplied (`--openapi path`).
- Map endpoints → parameter graph; hypotheses reference **named** params instead of guessing paths only.

## v0.4 — Adaptive feedback (still no Mythos fantasies)

- Novelty scoring using structural diff (keys, arrays length, status buckets).
- Simple bandit / round-robin over hypothesis families that opened new buckets.

## v0.5 — LLM assistance (optional, bounded)

- Call LLM only with **redacted** samples + schema-constrained outputs.
- LLM proposes hypotheses; deterministic executor validates and runs them.

## v1.0 — Multi-agent shape

- Separate coordinator processes or workers: Auth agent, IDOR agent, Logic agent—but **same** shared `SemanticModel` + append-only `FuzzResult` store.

## Later (binary / protocol)

Separate tracks (new agents, new surface modules). Do **not** block REST progress on binary.
