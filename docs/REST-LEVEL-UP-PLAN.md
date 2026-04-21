# REST level-up roadmap (GraphQL out of scope)

Dedicated GraphQL tooling stays separate. This repo focuses on **REST/OpenAPI**, **auth-aware replay**, **heuristic quality**, and **evidence**.

## Phase 1 — Triage signal quality (landed)

- **`src/verify/triageHints.js`** — deterministic hints:
  - **`isLikelyPublicChallengeCatalogUrl`** — downgrades keyword hits on `/api/Challenges`-style paths (Juice Shop catalog noise).
  - **`classifyHtmlServerError`** — **500 + HTML** labeled as **medium** “HTML error page” with guidance (misroute vs JSON API error — crAPI `/orders` lesson).
- **`src/verify/BasicTriage.js`** — wires hints into `triageResults`.
- **`npm run test:triage`** — locks behavior.

Run full offline anchor: **`npm run validation:golden`** (wraps **`npm test`**). See **`docs/TESTING.md`** for the full script matrix and CI alignment.

## Phase 2 — REST/OpenAPI depth (next)

- [x] **`fixtures/crapi-minimal.openapi.yaml`** — **`POST /workshop/api/shop/orders`** added (place order + list via `/orders/all`).
- [x] **post→list chains** (`post_to_list_get`) — **`dependencyGraph`** + **`SequenceExecutor`** (`POST` collection → **`GET`** same path or **`…/all`**).
- [x] Internal **`#/components/...` `$ref`** resolution before normalize (**`resolveInternalRefs.js`** + **`loadOpenApi`**).
- [x] **`--namespace-replay-budget`** defaults to **40** when alternate principal is resolved and the flag was not passed explicitly (`main.js` / **`parseArgv`**).

## Phase 3 — Checker / oracle depth

- [x] **BOLA / hierarchy** — schema-aware **`OPENAPI_PARENT_SWAP`** cases on nested routes (first parent param, **`schemaAwareParentSwapAlts`**, merged with **live list harvest** via **`harvestParentIdsByCollection`** + **`liveParentIdsByCollection`**, cap **4**/op) in **`SpecHypothesisEngine`** / **`MythosOrchestrator`**; **`nested_resource_hierarchy_cross_parent`** checker for **≥2** dynamic path segments vs flat **`resource_hierarchy_cross_parent`**.
- [x] **`broken_collection_list_path`** checker — bare list route **5xx** vs sibling **`…/all`** **200** (routing/BOLA-adjacent signal).
- [x] Gate **keyword** heuristics using **`spec:<operationId>:`** prefixes (**`isLikelyBenignCatalogOperationFromCaseId`**).

## Phase 4 — Evidence & ops

- [x] Shrink **replay bundles** / HAR (**dedupe** replay curls + **tail cap**) when **`--evidence-pack`** is set.
- [x] CI runs **`npm run validation:golden`** after **`npm test`** (`.github/workflows/ci.yml`).

## Discipline

After meaningful runs: **`npm run validation:log`**, **`findings.csv`** TP/FP/N/A — see **`docs/VALIDATION-TRIAGE.md`**.
