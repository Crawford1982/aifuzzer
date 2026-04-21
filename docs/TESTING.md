# Testing guide

This repo’s default suite is **offline** (mocked `fetch` or pure functions). Use it before merging REST/OpenAPI, triage, feedback-loop, or checker changes.

## Commands

| Command | Purpose |
|--------|---------|
| **`npm test`** | Full regression chain (see table below). **No outbound HTTP** by default. |
| **`npm run validation:golden`** | Runs **`npm test`** then prints a success banner — same workload as CI’s offline gate. |
| **`npm run test:triage`** | Fast slice: **`BasicTriage`** + **`triageHints`**. |

Run individual scripts with **`npm run test:<name>`** (see **`package.json`** `scripts`).

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs **`npm ci`**, **`npm test`**, then **`npm run validation:golden`** on pushes/PRs to **`main`**.

## What `npm test` covers (ordered)

| Script | Focus |
|--------|--------|
| `test:plan` | Stub **`ExecutionPlan`** validates + compiles to **`FuzzCase`**. |
| `test:openapi` | JSON/YAML OpenAPI load, **`$ref`** resolution fixture. |
| `test:graph` | **`dependencyGraph`** edges (list→item, POST→item, nested scoped, **crAPI `post_to_list_get`**). |
| `test:chains` | Mocked **`fetch`**: **`post_to_item`** + **`post_to_list_get`** stateful chains. |
| `test:scoped-chain` | Nested GET chain (list → scoped sub-resource). |
| `test:llm-plan` | **`llmPlanner`** with mock provider. |
| `test:scope-policy` | **`scopePolicy`** load + checks. |
| `test:triage` | REST triage (keyword noise, HTML 5xx, **`operationId`** catalog hints). |
| `test:milestone-d` | Baselines, confidence, minimization hints. |
| `test:evidence-export` | HAR + replay bundle (incl. dedupe / tail cap options). |
| `test:stats-signals` | Route-level surprise / stats. |
| `test:ai-advisor` | AI mutation hints → validated cases (mocked LLM). |
| `test:checker-engine` | Invariant checkers + registry (leak-after-create, delete, **broken list sibling**, flat + **nested** hierarchy, namespace overlap). |
| `test:body-mutations` | Schema body mutation generator. |
| `test:wordlist-expand` | Path wordlist injection. |
| `test:parent-swap` | Nested **`OPENAPI_PARENT_SWAP`** + schema alts + **`liveParentIdsByCollection`** (`SpecHypothesisEngine`). |
| `test:parent-id-harvest` | **`harvestParentIdsByCollection`**, path keys, **`collectionBaseForNestedOp`**. |
| `test:pipeline-parent-harvest` | **Integration**: synthetic list GET → harvest → **`expandFromOpenApi`** (matches orchestrator wiring). |
| `test:session-memory` | Campaign memory merge. |
| `test:namespace-overlap` | Alt-auth namespace checker. |
| `test:hierarchy-trivial` | Hierarchy FP guards (flat vs nested checkers). |
| `test:milestone-e` | CI profile, jobs, file queue, Redis hooks (mostly offline). |
| `test:auth-refs` | **`resolveAuthFields`** / env auth. |
| `test:milestone-g` | Live ID harvest + case prioritization (feedback loops). |
| `test:milestone-h` | Milestone **H** OWASP checkers: **mass_assignment**, **function_level_authz**, **shadow_endpoint** (`scripts/test-milestone-h.mjs`). |

## Optional / network tests (not in `npm test`)

| Script | Notes |
|--------|--------|
| **`npm run test:llm-e2e`** | Real LLM call — requires **`MYTHOS_E2E_LLM=1`** and API keys. |
| **`npm run test:scope-lab-agent`** | May hit **jsonplaceholder** unless pointed elsewhere. |

## Feature ↔ test mapping (REST level-up)

- **Internal `$ref`**: `test:openapi` (`fixtures/refs-parameters.openapi.yaml`).
- **`post_to_list_get` chains**: `test:graph`, `test:chains`.
- **Parent ID harvest + nested parent swap**: `test:parent-id-harvest`, `test:parent-swap`, `test:pipeline-parent-harvest`.
- **Milestone H**: `test:milestone-h` (mass assignment reflection, privileged path + omit_auth / alt-auth, shadow surfaces).
- **Triage / keyword gating**: `test:triage`.
- **Evidence shrink**: `test:evidence-export`; orchestrator passes shrink opts when **`--evidence-pack`**.

## When something fails

1. Re-run the failing script alone: **`npm run test:<name>`**.
2. For OpenAPI/harvest regressions, inspect **`src/feedback/parentIdHarvest.js`**, **`src/hypothesis/SpecHypothesisEngine.js`**, **`src/orchestrator/MythosOrchestrator.js`**.
3. See **`docs/REST-LEVEL-UP-PLAN.md`** for REST roadmap context and **`docs/VALIDATION-TRIAGE.md`** for lab triage workflow.

## Quality bar (subjective)

For a frank assessment of strengths and gaps (engineering vs signal vs OWASP breadth), see **`docs/PROJECT-RATINGS.md`**.
