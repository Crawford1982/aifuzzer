# Architecture (Mythos-shaped, buildable)

This is the **target** shape. The code in `src/` names the same layers so you can grow into it without a second rewrite.

## End state (vision)

```
                    TARGET (API / binary / protocol)
                                |
        +-----------------------+-----------------------+
        |                       |                       |
   SURFACE                 DEEP SEMANTIC            (future)
   (recon)                 (graph + invariants)     (static/LLM)
        |                       |
        +-----------+-----------+
                      |
           HYPOTHESIS ENGINE
                      |
           MULTI-AGENT ORCHESTRATOR   ← v0.1: single coordinator + one HTTP agent
                      |
           FEEDBACK & ADAPTATION      ← v0.1: novelty index stub
                      |
           VERIFY / WEAPONIZE         ← v0.1: basic triage only
```

## What exists in code (truth table)

| Layer | Module prefix | Status (v0.1) |
|-------|----------------|----------------|
| Surface reconnaissance | `src/surface/` | REST only: probes + templated `{id}` URLs |
| Semantic understanding | `src/semantic/` | Stub graph: stores nodes/edges and observations |
| Hypothesis generation | `src/hypothesis/` | Pattern library + expand to concrete HTTP cases |
| Multi-agent orchestration | `src/orchestrator/` | Single pipeline (not concurrent agents yet) |
| Execution | `src/execution/` | HTTP agent with concurrency pool |
| Feedback | `src/feedback/` | Dedup + novelty score stub |
| Verification | `src/verify/` | Heuristic triage (not proof of exploitability) |

## Interfaces (contracts to preserve)

Keep these boundaries **stable** even when internals swap (LLM in, symbolic exec in, etc.).

1. **`SurfaceReport`** — what we observed without claiming “understanding.”
2. **`SemanticModel`** — mutable world model (stub now; later: invariants, roles, flows).
3. **`Hypothesis` / `FuzzCase`** — declarative intent + concrete HTTP request fields.
4. **`FuzzResult`** — reproducible artifact (request + response snapshot + hashes).
5. **`Finding`** — human-facing triage output (severity estimate is heuristic until verified).

## Non-goals (explicit)

- Replacing manual security review or legal authorization.
- “Finding zero-days” until deep layers exist and are validated offline.
- DoSing targets: **rate/concurrency caps are mandatory** for production use.
