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

| Layer | Module prefix | Status |
|-------|----------------|--------|
| Surface reconnaissance | `src/surface/` | REST probes + templated `{id}` URLs |
| OpenAPI ingestion | `src/openapi/` | JSON/YAML → normalized operations |
| Stateful inference | `src/state/` | Producer→consumer edges + JSON id extraction |
| Semantic understanding | `src/semantic/` | **`SemanticModel`**: observation log; full timeline in report as **`semanticSnapshot.observations`** |
| Hypothesis generation | `src/hypothesis/` | Patterns, OpenAPI cases, small stateful chains |
| Typed execution plans | `src/planner/` | Schema + compiler + stub planner |
| Orchestration | `src/orchestrator/` | Single pipeline (chains sequential; flat cases pooled) |
| Execution | `src/execution/` | Concurrent pool + `SequenceExecutor` for binds |
| Feedback | `src/feedback/` | `ResponseIndex` novelty; **Milestone G**: `idHarvest.js` (live IDs from responses), `casePrioritizer.js` (memory rank + route novelty) |
| Verification | `src/verify/` | Heuristic triage + replay `curl` strings |

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
