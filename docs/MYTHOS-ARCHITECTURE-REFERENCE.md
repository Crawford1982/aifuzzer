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

| Layer | Vision | Today (v0.1 codebase) |
|-------|--------|-------------------------|
| Target input | Paste URL only | **You pass `--target`** (required). Optional `--auth`. |
| Surface RECON | Rich discovery | **REST slice:** a few derived paths + your URL / `{id}` templates. |
| Deep analysis | Static/dynamic depth | **Not implemented.** |
| Semantic graph | Real model | **Stub** (`SemanticModel`): stores observations, no inference. |
| Hypothesis engine | AI / constraints | **Fixed patterns only** (ID swaps, debug params, optional auth probes). **No LLM.** |
| Multi-agent orchestrator | Many agents | **Single pipeline**, one HTTP executor. |
| Feedback & adaptation | Coverage / novelty / learning | **Dedup/novelty stub only.** |
| Verification / exploit reasoning | Weaponized PoCs | **Heuristic triage** (`BasicTriage`), manual follow-up assumed. |

**Bottom line:** You can plug in a URL and the tool **runs a bounded, pattern-based campaign** and writes a JSON report. **AI does not “take over” yet**—there is no API key, no model calls, no automatic endpoint discovery beyond simple probes.

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
