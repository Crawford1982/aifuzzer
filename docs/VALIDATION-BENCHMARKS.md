# Validation benchmarks — logging & what to expect

Use this when calibrating Mythos against **known labs** or **safe public demos**. It complements `docs/MILESTONES.md` (feature checklist) by answering: *did the run exercise the right pipeline mode, and are zero findings normal?*

## Where logging lives

| Artifact | Purpose |
| -------- | ------- |
| **`output/mythos-report-*.json`** | Full run: `mode`, `openapiPath`, `limits`, `executed`, `findings`, `semanticSnapshot`, checker registry, evidence paths. Gitignored. |
| **`data/validation-feedback/SESSION-LOG.md`** | Append-only **table** — one row per recorded run (UTC time, report filename, mode, OpenAPI path, executed count, findings count, target). |
| **`npm run validation:log`** | Appends a row from the **newest** `output/mythos-report-*.json`, or pass an explicit path: `npm run validation:log -- ./output/mythos-report-….json`. |
| **`npm run validation:new -- --target <name> --label <label>`** | Creates a timestamped folder with `run.md` + `findings.csv` templates for narrative + TP/FP/FN scoring. |
| **`data/validation-feedback/target-playbooks/*.md`** | Copy/paste commands per lab (DVGA, crAPI, Juice Shop). |

Deep narrative (operator notes, ground-truth checklist, follow-ups) belongs in each run folder’s **`run.md`** and **`findings.csv`**, not only in `SESSION-LOG.md`.

## Are “zero findings” on DVGA / labs expected?

Often **yes**, for two separate reasons:

1. **Oracle mismatch (DVGA)** — DVGA is **GraphQL-centric** (introspection, depth, authz on fields). Mythos’s shipped **heuristic checkers** and triage paths are aimed primarily at **REST-shaped** behavior (collections, DELETE semantics, dual-principal replay, hierarchy overlap, etc.). Hitting `/graphql` with a minimal OpenAPI stub proves **OpenAPI → hypothesis → executor** wiring; it does **not** yet mean GraphQL-specific weaknesses will appear as `findings[]`.

2. **Benign public APIs** — **`jsonplaceholder.typicode.com`** is the usual **safe traffic** demo: it exercises surface probes, OpenAPI expansion, and stateful chains. It is **not** a vulnerability playground, so **empty `findings`** is normal there too.

Use **labs** to validate *coverage and reports*; use **`npm test`** (and checker unit tests) to validate that *finding-shaped signals* fire under controlled mocks.

## “Dummy” or controlled ways to see the tool behave

### Offline (no network) — proves pipeline + checkers

- **`npm test`** — Full suite; default **no outbound HTTP**.
- **`npm run test:checker-engine`** — Checker invariants (leak-after-failed-create, delete-still-readable, hierarchy overlap, namespace overlap, etc.) against **fixtures**, not live servers.
- Other `test:*` scripts — See the **Testing** table in the root **`README.md`**.

These are the **authoritative** “does the fuzzer brain fire on synthetic signals?” checks.

### Live but safe — proves HTTP stack + OpenAPI path

- **`https://jsonplaceholder.typicode.com`** + **`fixtures/minimal-posts.openapi.json`** — Canonical demo for **OpenAPI-driven** runs and chains. Expect **traffic and structured reports**; expect **few or no** heuristic findings because the API is not designed to be vulnerable.

### Local Docker labs — better alignment with REST-style heuristics than DVGA

When Docker is running, **crAPI** and **OWASP Juice Shop** (playbooks under `data/validation-feedback/target-playbooks/`) expose **REST** flaws (IDOR, broken auth patterns, etc.) that match the **current** verifier vocabulary better than raw GraphQL introspection games.

### Optional scope-lab integration

- **`npm run test:scope-lab-agent`** — Optional adapter that talks to **`cloud-brain-scope-lab`** and hits **jsonplaceholder** unless you change the target (see script). Useful for adapter smoke, not for “many findings.”

## Quick workflow

1. Start an authorized lab or safe demo.
2. Run Mythos with `--scope-file` when using local numeric hosts (`127.0.0.1`); avoid bare `localhost` as `--target` (URL resolver requires a dotted hostname — see `src/util/resolveTargetUrl.js`).
3. After the run: **`npm run validation:log`**.
4. Fill **`findings.csv`** with TP / FP / FN once you know ground truth from the lab docs.

For DVGA-specific Docker and Mythos flags, see **`data/validation-feedback/target-playbooks/dvga.md`**.

## Confirming findings (ground truth / TP vs FP)

Do **not** treat every `findings[]` row as a vulnerability. Follow **`docs/VALIDATION-TRIAGE.md`**: replay **`replayCurl`**, compare to official lab documentation, classify **TP / FP / FN / N/A** in **`findings.csv`**.

### Recommended lab order (calibration, not features)

1. **`npm test`** — baseline that code paths still match fixtures.
2. **Juice Shop** — REST + rich text responses; keyword heuristics often **FP** on `/api/Challenges`; still validates HTTP + reporting.
3. **crAPI** — REST IDOR/auth patterns align better with current checkers **when OpenAPI or traffic hits the right routes**; use **two principals** when testing cross-user issues.
4. **DVGA** — validates GraphQL HTTP plumbing with a minimal OpenAPI stub; **zero REST-style findings** is often expected until GraphQL-specific oracles exist.

### Before / after changing validation methodology

Run **`npm test`** so offline checker behavior stays the reference anchor.

## Troubleshooting labs

| Issue | Mitigation |
| ----- | ---------- |
| **`docker compose pull`** TLS timeout / registry errors | Retry; check VPN/firewall; use crAPI README “prebuilt images” zip workflow. |
| **crAPI not up** | Confirm containers listen on **8888** per compose; **`LISTEN_IP=0.0.0.0`** if binding off localhost (see crAPI README). |
| **Juice Shop `/rest/products` 500** | Often transient during warm-up; retry or use OpenAPI minimal fixture paths that return **200** (`/api/Challenges`). |
