# External analysis synthesis

Consolidates an independent **deep-dive review** of this repo with **maintainer errata** so docs stay truthful as the codebase moves.

Use with **`docs/PROJECT-RATINGS.md`** (our internal scorecard) and **`docs/MILESTONES.md`** (delivery truth).

---

## Errata — facts about *this* tree (read first)

These correct common outdated assumptions:

| Claim | Correction |
|--------|------------|
| **“No `$ref` resolution — blocking”** | **Internal `#/components/...` refs** are expanded before normalize via **`src/openapi/resolveInternalRefs.js`** + **`OpenApiLoader`**. Fixture: **`fixtures/refs-parameters.openapi.yaml`**; locked by **`npm run test:openapi`**. **Cross-file / external URLs** are still not fetched — see Milestone **J** in **`docs/MILESTONES.md`**. |
| **“Tests have no assertion framework”** | Scripts use **`node:assert`** / **`strict as assert`** throughout (e.g. **`scripts/test-milestone-h.mjs`**, **`scripts/test-checker-engine.mjs`**). There is **no Jest/Vitest harness** — tradeoff is simplicity vs IDE UI, not absence of assertions. |
| **“~12 milestones; 7 done”** | Milestone letters go **A–L** in **`docs/MILESTONES.md`**; **H** (OWASP checkers) is **shipped** + **`npm run test:milestone-h`**. Progress is milestone-specific, not a single fraction. |
| **Orchestrator line count** | **`MythosOrchestrator.js`** length **drifts** with features — treat any cited line count as approximate. |

---

## Synthesis (external review)

**Overall rating stated in review: ~6.5 / 10** — useful as a **different lens** than **`PROJECT-RATINGS.md`** (~7.x research-core tilt).

### What it is

A modular API security testing framework progressing through staged milestones. Layered pipeline (surface → OpenAPI → graph → hypotheses → orchestrator → execution → feedback → verify → report) matches a **deterministic-first** philosophy: bounded automation, replayable evidence.

### Architecture (review: ~8/10)

- Clear separation of concerns; orchestrator composes stages with **lazy `import()`** where appropriate.
- **Budget caps** (`maxRequests`, `maxRps`, wordlist limits, namespace replay) are pervasive — appropriate for authorized testing.
- Checkers map to OWASP API themes (e.g. BOLA-style hierarchy, mass assignment, authz paths, shadow surfaces, leakage analogues).
- LLM planner path: **validate plans before HTTP** — aligns with repo rules.

### Strengths called out

- **Stateful chains** + **live ID harvest** → rare in OSS fuzzers; useful for binding and IDOR/BOLA-style exploration.
- **Campaign memory** — state across runs vs purely ephemeral fuzzing.
- **Auth**: env-based secrets (`--auth-env`), **dual-principal** replay paths for namespace-style issues.
- **Evidence**: HAR + structured replay bundles for manual verification.

### Gaps ranked (external review — largely still valid)

1. **`$ref` fidelity** — **Internal `#/` done**; **external / cross-file** refs remain the **enterprise-spec** pain point (Milestone **J** scope).
2. **Human-readable report** — primary artifact is JSON under **`output/`**; HTML/Markdown summarizers would improve team handoff (not yet first-class).
3. **Dynamic auth flows** — Bearer-focused CLI; OAuth2 flows, cookie jars, rotating API keys are **not** built in.
4. **LLM provider abstraction** — env keys and planner coupling; swapping providers today is manual.
5. **Adaptive rate limiting** — `maxRps` + token bucket exists; **retry-on-429** / **`Retry-After`** parsing not a full policy.
6. **Test harness** — bespoke **`npm run test:*`** scripts vs Jest/Vitest **runner** UI (assertions **are** present — see errata).
7. **Static typing** — JSDoc assists editors; **no enforced TS** — known ceiling for large teams.
8. **Milestone I** — LLM **response** analysis / follow-up probes — high leverage when shipped; still planned.

### External scorecard (verbatim dimensions)

| Dimension | Score | Notes |
|-----------|-------|--------|
| Architecture | 8/10 | Clean layers, safety-first |
| Completeness | 5/10 | Milestones partial; **refine with errata** on `$ref` |
| Code quality | 6/10 | Consistent; JSDoc ceiling |
| Test reliability | 4/10 | Scripts vs framework — **assertions exist**; “no harness” fair |
| Real-world utility | 6/10 | Strong on simpler APIs; enterprise specs need **external `$ref`** + auth story |
| AI integration | 6/10 | Planner + hints good; response analysis not yet |

---

## Ranked next steps (merged: external review + maintainer view)

1. **External / cross-file `$ref`** — observation log + graceful skip where unsafe (Milestone **J** remainder).
2. **Readable findings output** — HTML or Markdown summary from `findings[]` + replay links (small UX win).
3. **429 / Retry-After handling** — bounded backoff in executor or transport wrapper.
4. **Milestone I** — response analyst + validated follow-up probes within budget.
5. **LLM provider abstraction** — config-driven base URL / headers (optional).
6. **TypeScript (incremental)** — only if team size justifies migration cost.

---

## Related

- **`docs/PROJECT-RATINGS.md`** — internal subjective ratings.
- **`docs/MILESTONES.md`** — formal exit criteria (**H** checkers shipped; **J** updated for remaining `$ref` work).
- **`docs/TESTING.md`** — what actually runs in CI.
