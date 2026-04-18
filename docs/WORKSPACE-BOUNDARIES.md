# Workspace boundaries

This file avoids cross-project confusion.

## Canonical folders

- `C:\Users\Admin\Desktop\cloud brain`
  - Baseline multi-model chat app.
  - Keep as stable reference unless explicitly changing base behavior.

- `C:\Users\Admin\Desktop\AI-guided REST API fuzzer\cloud-brain-scope-lab`
  - Experimental fork of Cloud Brain.
  - Place all "paste policy URL -> derive candidate targets" work here.

- `C:\Users\Admin\Desktop\AI-guided REST API fuzzer`
  - Mythos fuzzer core (CLI and framework layers).
  - Keep focused on execution/analysis pipeline.

## Operational rule

Before editing, confirm target folder in terminal/editor.

## Shared fuzz execution (scope-lab ↔ Mythos)

The hardened probe runner lives in **`cloud-brain-scope-lab/lib/fuzzAgent.js`** (CommonJS).

Mythos (**ESM**) imports it only through **`src/adapters/scopeLabFuzzAgent.js`**, using `createRequire` so there is a single implementation and no copy-paste drift.

Smoke test from the Mythos repo root:

```bash
npm run test:scope-lab-agent
```

Dynatrace HackerOne scope notes and host allowlist reference: `cloud-brain-scope-lab/config/dynatrace-program-scope.json` (automated fuzz allows only `*.dynatrace.com`, `*.dynatrace.cloud`, `*.dynatracelabs.com`; GitHub is not HTTP-fuzzed).

## Quick checks

- Mythos fuzzer: `cd "C:\Users\Admin\Desktop\AI-guided REST API fuzzer"`
- Cloud Brain lab: `cd "C:\Users\Admin\Desktop\AI-guided REST API fuzzer\cloud-brain-scope-lab"`
- Cloud Brain base: `cd "C:\Users\Admin\Desktop\cloud brain"`
