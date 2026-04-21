# Validation feedback logs

See **`docs/VALIDATION-BENCHMARKS.md`** for **expected findings** and **offline vs live targets**. See **`docs/VALIDATION-TRIAGE.md`** for **replay-based TP/FP/FN** classification (confirming findings without adding product features).

Use this folder to track benchmark runs against intentionally vulnerable labs
before testing real bug bounty programs.

Quick-start playbooks live in `target-playbooks/` for:

- `dvga.md`
- `crapi.md`
- `juiceshop.md`

## Rolling timeline (machine-readable)

After each Mythos benchmark, append one row so you can see **how the tool behaved over time**:

```bash
npm run validation:log
```

Reads the newest `output/mythos-report-*.json` by timestamp and appends mode / executed count / findings to **`SESSION-LOG.md`**.

To record a specific report:

```bash
npm run validation:log -- ./output/mythos-report-1234567890.json
```

Deep narrative still lives in each run folder (`run.md`, `findings.csv`). Per-row JSON reports remain the ground truth under `output/`.

## Goal

Keep each run reproducible and comparable:

- target and environment used
- exact command and options
- what was found, missed, and noisy
- whether the output was actionable

## Suggested workflow

1. Create a new run folder:
   - `npm run validation:new -- --target dvga`
2. Start the vulnerable lab locally.
3. Run Mythos with the same command logged in `run.md`.
4. Copy generated report paths into `run.md`.
5. Fill `findings.csv` with:
   - true positives
   - false positives
   - false negatives (known vulns missed)
6. Add concrete next actions for tool improvements.

## Status values for `findings.csv`

- `TP`: expected vuln found correctly
- `FP`: noisy or invalid finding
- `FN`: known vuln missed by tool
- `N/A`: informational observation
