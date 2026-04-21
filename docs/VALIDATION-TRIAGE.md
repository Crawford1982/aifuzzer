# Validation triage — confirm findings without new product features

Mythos `findings[]` are **heuristic signals** (keyword hits, checker preconditions, baseline deltas). Treat lab validation as **matching signals to ground truth**, not maximizing row count.

## End-to-end workflow

### 1. Establish ground truth before you judge the tool

| Lab | Where to learn what exists |
| --- | --- |
| **Juice Shop** | In-app scoreboard + https://github.com/juice-shop/juice-shop |
| **crAPI** | https://github.com/OWASP/crAPI — challenges / docs |
| **DVGA** | https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application |

Decide what is **in scope for HTTP replay** (same host, paths you actually hit). If the lab needs **two users** or **JWT swapping** for BOLA/IDOR, a run **without** `--auth` / `--auth-alt` cannot “prove” the tool missed tenant isolation — it proves **inputs were insufficient**.

### 2. For each finding row in `output/mythos-report-*.json`

1. Read **`title`**, **`detail`**, **`url`**, **`confidence`**, **`signals`**.
2. Copy **`replayCurl`** from the matching **`results[]`** row (same case / URL).
3. Run it in a shell **against the same lab instance** you used for the scan.
4. Ask:
   - **Would a reasonable reviewer call this a vulnerability on its own?** If the body is **expected public content** (e.g. Juice Shop `/api/Challenges` descriptions), keyword hits are usually **noise** → classify **FP** for “real vuln,” **N/A** for “signal fired correctly.”
   - **Does the checker precondition match what happened?** See `checkerRegistry[]` + `checkersFired[]` in the report.

### 3. Record verdicts in `findings.csv`

Use the columns in **`data/validation-feedback/findings-log.template.csv`**:

| Status | Meaning |
| ------ | ------- |
| **TP** | Signal aligns with a **documented** weakness you can replay (same severity family). |
| **FP** | Signal fired but ground truth says **benign** or **by design** for that endpoint. |
| **FN** | Ground truth says a vuln exists on a path the run should have exercised, but **no** corresponding signal. |
| **N/A** | Informational (tool health, wiring, keyword noise explicitly expected). |

Add a short **notes** column reason (e.g. “Challenge JSON contains the word password by design”).

### 4. Principal / tenant testing (when the lab supports it)

For **namespace / cross-user** checks, Mythos supports **`--auth`** and **`--auth-alt`** (plus `--namespace-replay-budget`, **`--openapi`** so there are GETs to replay). If you skip this, **absence of “same body for two tenants” findings** is **inconclusive**, not an automatic FN.

Prefer **`--auth-env VAR`** so tokens stay out of shell history where possible. Reports under **`output/`** include **`replayCurl`** with full Bearer material — **`output/` is gitignored**; do not paste those lines into committed docs.

See root **`README.md`** and `docs/VALIDATION-BENCHMARKS.md` for flags; keep using **`--scope-file`** for local `127.0.0.1` targets.

### 5. Logging order of operations

1. `npm run validation:new -- --target <lab> --label <run-name>`
2. Start lab (Docker / local).
3. Run Mythos; copy report path into **`run.md`**.
4. `npm run validation:log` (or pass explicit report path).
5. Triage per §2–3 above; update **`findings.csv`**.

### 6. Automated vs live truth

| Check | What it proves |
| ----- | -------------- |
| **`npm test`** | Pipeline + checkers under **fixtures** (no network). |
| **Live lab** | End-to-end HTTP + your **manual** TP/FP/FN labels in CSV. |

Both are required: tests confirm **implementation**; labs confirm **calibration** for your methodology.
