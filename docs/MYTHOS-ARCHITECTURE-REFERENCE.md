# Mythos framework — architecture reference map

Canonical visual for planning and docs. Implementation status is separate; see **Where we are now** at the bottom.

---

## AI Fuzzer Framework — Mythos level (reference)

```
┌─────────────────────────────────────────────────────────────┐
│                    TARGET (API/Binary/Protocol)              │
└────────────────────────────┬────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐         ┌──────────┐        ┌──────────┐
   │ SURFACE │         │   DEEP   │        │ SEMANTIC │
   │ RECON   │         │ ANALYSIS │        │  GRAPH   │
   └────┬────┘         └────┬─────┘        └────┬─────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │   HYPOTHESIS GENERATION ENGINE        │
        │   (What vulnerabilities might exist?) │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │    MULTI-AGENT FUZZING ORCHESTRATOR   │
        │   (Specialized agents per vuln class) │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │   FEEDBACK LOOP & ADAPTATION          │
        │   (Learn from each attempt, adjust) │
        └───────────────────┬───────────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │   EXPLOIT REASONING & VERIFICATION    │
        │   (Is this real? Can we weaponize?)   │
        └───────────────────────────────────────┘
```

---

## Target experience: “plug in a URL, AI takes over”

That means, without you hand-writing endpoints or payloads:

1. **Surface** — discover or infer what exists (paths, params, auth shape).
2. **Deep + semantic** — build a useful model (roles, IDs, invariants)—even partial.
3. **Hypotheses** — propose tests from that model (not only static lists).
4. **Orchestration** — run specialized strategies, adapt based on feedback.
5. **Verification** — separate signal from noise and produce reproducible PoC-grade steps.

**AI** typically enters at **hypothesis generation**, **semantic summarization**, and/or **finding triage**—with deterministic execution and hard safety caps underneath.

---

## Where this repo is now (honest snapshot)

| Layer | Vision | Today (this repo) |
|-------|--------|----------------------|
| Target input | Paste URL | CLI: **`--target`**, optional **`--openapi`**, optional **`--stub-plan`**, `--auth`. |
| Surface | Rich discovery | **REST slice** + **OpenAPI 3 JSON/YAML** normalization. |
| Deep / state | Static + live API truth | **Producer→consumer graph** (heuristic) + **sequential chains** with **live `id` binding** (list→item, create→item). **No LLM.** |
| Semantic graph | Real model | **Stub** (`SemanticModel`): observations only. |
| Hypotheses | AI + rules | **Deterministic:** pattern mode, spec expansion, stateful campaigns, **typed `ExecutionPlan` + compiler**; **stub planner** only. |
| Orchestrator | Many agents | **One pipeline**; chains run **sequentially**, flat spec cases **pooled**. |
| Feedback | Learning | **Novelty index** (light). |
| Verification | Provable | **Heuristic triage** + per-row **`replayCurl`**. |
| Tests | CI | **`npm test`**: plan schema, OpenAPI load, dependency graph, **mocked `post_to_item` chain** (no network). |

**Bottom line:** The **engine and proof plumbing** (spec, graph, bind, validate plan, execute, replay) are in place. **Milestone C** = add a **bounded LLM** that only fills `ExecutionPlan` (plus redaction, retries, and no direct `fetch` in the planner module).

---

## Path from here → “AI takes over the rest”

Roughly (see also `docs/ROADMAP.md`):

1. **Safety first** — rate limits, scope allowlists, max requests (so automation is responsible).
2. **Better surface** — OpenAPI import and/or crawler with strict scope (still deterministic).
3. **LLM integration (bounded)** — send **redacted** samples + structured prompts; LLM outputs **hypotheses or triage**, executor stays **deterministic**.
4. **Semantic depth** — optional: embed responses, cluster behaviors, simple invariants before claiming “understanding.”
5. **Multi-agent** — split workers by vuln family **after** one agent path is stable.

---

## Related docs

- `docs/ARCHITECTURE.md` — module layout and truth table vs this map.
- `docs/ROADMAP.md` — phased delivery (v0.2, v0.3, …).

---

*Reference map preserved for planning; update this file only when the architecture picture changes.*
