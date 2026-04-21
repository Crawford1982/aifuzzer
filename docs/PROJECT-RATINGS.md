# Project ratings (where it matters)

Subjective scorecard for this **framework-shaped API fuzzer core** — useful for prioritizing work, not for marketing claims. **Heuristic tools trade recall for engineering cost**; interpret scores in that context.

**Last reviewed:** 2026-04 (post Milestone **H** checker ship).

## Scorecard (/10)

| Dimension | Score | Notes |
|-----------|-------|--------|
| **Engineering & structure** | **8.5** | Clear layering (spec → cases → execute → verify → report); executor isolation from LLMs; sane safety hooks (`scopePolicy`, CI profile). |
| **Tests & regression safety** | **8.5** | Large offline **`npm test`** chain, **`validation:golden`**, CI double-gate; gaps remain for behavior only observable on live targets. |
| **OpenAPI / execution depth** | **7.5** | Stateful chains, **`$ref`**, parent harvest → nested swaps, body mutations, evidence shrink — strong for a small core; not exhaustive OAS coverage. |
| **Signal quality (FP rate & actionability)** | **6.5** | Triage splits, hierarchy variants, namespace / Milestone **H** checkers improve signal; odd APIs still produce noisy **`findings`**. |
| **OWASP breadth (coverage *feel*)** | **6.5** | Milestone **H** lands API3 / API5 / API9 angles; Top 10 is **not** fully mirrored by first-class oracles elsewhere. |
| **Ops & lab fit** | **7.5** | Queues, auth-by-env, campaign memory, benchmarks — good for authorized lab runs; not a hosted scanner. |
| **Documentation** | **7.5** | **`docs/TESTING.md`**, milestones, validation triage — contributors can onboard; drift is avoided by checklist updates on ships. |
| **Real-world bug leverage** | **7.0** | Strong **exploration + replay evidence** with human triage — not automated verdict on arbitrary APIs. |
| **Product polish** | **4.0** | Intentionally not the product goal (no turnkey SaaS UX). |

## Summary

| Lens | Rough overall |
|------|----------------|
| **Research / lab-grade core** | **~7.2 / 10** |
| **Bug-finding leverage** (human in the loop) | **~7 / 10** |
| **Engineering & test discipline** | **~8 / 10** |

## How to improve scores

- Raise **signal quality**: calibration runs + **`SESSION-LOG`** / **`findings.csv`** TP-FP labeling (`docs/VALIDATION-TRIAGE.md`).
- Raise **OWASP breadth**: Milestone-style checkers + spec-aware probes (bounded).
- Raise **depth**: richer OpenAPI fidelity (external refs where safe), tighter request/response pairing for oracles.

Related: **`docs/MILESTONES.md`**, **`docs/REST-LEVEL-UP-PLAN.md`**, **`docs/TESTING.md`**.
