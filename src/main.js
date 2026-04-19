#!/usr/bin/env node

import { parseArgv } from './config.js';
import { runMythosPipeline } from './orchestrator/MythosOrchestrator.js';
import { isCiMode, applyCiProfile, resolveMythosExitCode } from './ops/ciProfile.js';
import { resolveAuthFields } from './ops/authRefs.js';
import { isCiRequireScope } from './ops/ciScope.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveTargetUrl } from './util/resolveTargetUrl.js';

function printHelp() {
  console.log(`
Mythos fuzzer — authorized testing only.

Usage:
  npm start -- --target <base-url> [--openapi <spec.json|yaml>] [--stub-plan]
  npm start -- --target <url> [--auth <token>] [--concurrency N] [--max-requests N]
                                   [--scope-file <scope.yaml|json>] [--max-rps N]
  npm start                       # interactive mode

OpenAPI mode:
  --openapi path/to/openapi.yaml   Spec-driven cases (JSON or YAML). --target is the API base URL
                                   (overrides servers[0] when provided).
Stub typed plan (compiler + executor smoke, no LLM):
  --stub-plan                      Emit fixed multi-step plan from stubPlanner.js (still needs --target).

Bounded LLM planner (Milestone C — requires API key in env):
  --plan-with-llm                 With --openapi: ask LLM for one ExecutionPlan, validate, run a capped slice,
                                   then continue with stateful chains + flat expansion. Uses MYTHOS_LLM_* env vars.

Safety (v0.2):
  --scope-file <path>             Host + path-prefix allowlist (YAML/JSON); block out-of-scope requests early.
  --max-rps <n>                   Global token-bucket cap (0 = unlimited).

Milestone D — evidence export:
  --evidence-pack                 Write HAR 1.2 + structured replay JSON next to the report (same timestamp).
  --max-response-chars <n>        Truncate stored response text to this many UTF-8 code units (default: 8192, or 262144 with --evidence-pack).

AI-assisted fuzzing (OpenAPI, spec-only prompt; hints validated before HTTP):
  --ai-mutation-hints            Ask the LLM for extra query/header probes (uses MYTHOS_LLM_*; capped budget).

Checker oracles & bounded fuzz expansion (OpenAPI):
  --wordlist <path>               Inject values into ID-like path params (capped; requires --openapi).
  --max-wordlist-injections <n>  Max injections total (default 64, hard cap 512).
  --max-body-mutations-per-op <n> Schema-aware JSON body probes per POST/PUT/PATCH op (default 0).

Principal / campaign (OpenAPI + both auths — bounded, no vendor megawordlists):
  --auth-alt <token|header>       With --auth + --openapi: replay GETs with alternate Authorization (capped).
  --namespace-replay-budget <n>   Max distinct URLs for alt-auth replay (default 24, hard cap 48).
  --curated-wordlist              Merge tiny in-repo ID slice (data/seclists-curated/ids-small.txt) under caps.
  --campaign-memory <path>        Load/merge/write bounded route stats JSON for the next run.

Milestone E — CI / queues:
  MYTHOS_CI=1 or --ci             Conservative caps; disables LLM planner + AI hints + evidence-pack write.
                                  Requires --openapi or --stub-plan with --target (non-interactive).
  --ci-fail-on-findings           With CI: exit 2 if any findings (pipeline gates).
  MYTHOS_CI_REQUIRE_SCOPE / --ci-require-scope   With CI: refuse to run unless --scope-file is set (safety posture).
  --auth-env NAME                 Read primary auth from env var (e.g. MYTHOS_API_TOKEN); do not combine with --auth.
  --auth-alt-env NAME             Alternate principal for namespace replay via env var.
  MYTHOS_QUEUE_DIR                File job queue directory (default ./.mythos-queue).
  MYTHOS_REDIS_URL                Redis queue + durable done list mythos:campaign:jobs:done (cap MYTHOS_REDIS_DONE_CAP).
  MYTHOS_STALE_PROCESSING_MS      Re-queue file-queue jobs stuck in processing/ older than this (default 30m).

Examples:
  npm start -- --target "https://jsonplaceholder.typicode.com" --openapi ./spec/openapi.json
  npm start -- --target "https://jsonplaceholder.typicode.com" --stub-plan
  npm start -- --target "https://jsonplaceholder.typicode.com/posts/{id}"

Requires Node.js 18+ (global fetch).
`);
}

function printInteractiveHelp() {
  console.log(`
What to paste as Target URL
────────────────────────────
• A full URL from Swagger / your browser, including https://
• Or a Dynatrace sprint shortcut (labs only, when you are authorized):
    sprint2:YOUR-ENV
    sprint2:YOUR-ENV/rest-api-doc/index.jsp
    sprint3:YOUR-ENV/platform/swagger-ui/index.html

Do NOT paste wildcards like *.sprint.dynatracelabs.com — that names a scope, not a server.

Examples:
  https://jsonplaceholder.typicode.com/posts/1
  sprint2:your-environment-id

At the Target prompt, type "help" to show this again.
`);
}

async function promptConfig(defaults) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\nInteractive mode');
    console.log('Press Enter to keep defaults shown in brackets.');
    printInteractiveHelp();

    /** @type {string | null} */
    let target = null;
    while (!target) {
      const targetRaw = await rl.question('\nTarget URL (required): ');
      const line = targetRaw.trim();
      if (!line) {
        console.error('Target is required. Try again or type help.\n');
        continue;
      }
      if (/^help$/i.test(line)) {
        printInteractiveHelp();
        continue;
      }
      const resolved = resolveTargetUrl(line);
      if (!resolved.ok) {
        console.error(`\n✗ ${resolved.error}\n`);
        continue;
      }
      console.log(`→ Using: ${resolved.url}`);
      target = resolved.url;
    }

    const authRaw = await rl.question('Auth token/header [optional]: ');
    const concurrencyRaw = await rl.question(`Concurrency [${defaults.concurrency}]: `);
    const maxRequestsRaw = await rl.question(`Max requests [${defaults.maxRequests}]: `);
    const timeoutRaw = await rl.question(`Timeout ms [${defaults.timeoutMs}]: `);
    const outputDirRaw = await rl.question(`Output dir [${defaults.outputDir}]: `);

    const maybeNum = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    return {
      target,
      auth: authRaw.trim() || null,
      concurrency: maybeNum(concurrencyRaw.trim(), defaults.concurrency),
      maxRequests: maybeNum(maxRequestsRaw.trim(), defaults.maxRequests),
      timeoutMs: maybeNum(timeoutRaw.trim(), defaults.timeoutMs),
      outputDir: outputDirRaw.trim() || defaults.outputDir,
    };
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgv(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const ci = isCiMode(args);

  if (ci && !args.target) {
    console.error('Error: MYTHOS_CI / --ci require --target (non-interactive).');
    process.exit(1);
  }
  if (ci && !args.openapiPath && !args.useStubPlan) {
    console.error('Error: CI mode requires --openapi <spec> or --stub-plan for reproducible runs.');
    process.exit(1);
  }

  if (args.planWithLlm && !args.openapiPath) {
    console.error('Error: --plan-with-llm requires --openapi <spec.json|yaml>');
    process.exit(1);
  }

  const defaults = {
    concurrency: Number.isFinite(args.concurrency) ? args.concurrency : 4,
    maxRequests: Number.isFinite(args.maxRequests) ? args.maxRequests : 120,
    timeoutMs: Number.isFinite(args.timeoutMs) ? args.timeoutMs : 8000,
    outputDir: args.outputDir || 'output',
  };

  const config = args.target
    ? {
        target: args.target,
        auth: args.auth || null,
        openapiPath: args.openapiPath,
        scopeFile: args.scopeFile || null,
        maxRps: Number.isFinite(args.maxRps) ? args.maxRps : 0,
        useStubPlan: args.useStubPlan,
        planWithLlm: args.planWithLlm,
        evidencePack: args.evidencePack,
        aiMutationHints: args.aiMutationHints,
        maxResponseBodyChars: Number.isFinite(args.maxResponseBodyChars)
          ? args.maxResponseBodyChars
          : undefined,
        wordlistFile: args.wordlistFile || null,
        maxWordlistInjections: Number.isFinite(args.maxWordlistInjections)
          ? args.maxWordlistInjections
          : 64,
        maxBodyMutationsPerOp: Number.isFinite(args.maxBodyMutationsPerOp)
          ? args.maxBodyMutationsPerOp
          : 0,
        authAlt: args.authAlt || null,
        namespaceReplayBudget: Number.isFinite(args.namespaceReplayBudget)
          ? args.namespaceReplayBudget
          : 24,
        useCuratedWordlist: Boolean(args.useCuratedWordlist),
        campaignMemoryFile: args.campaignMemoryFile || null,
        authEnv: args.authEnv || null,
        authAltEnv: args.authAltEnv || null,
        ...defaults,
      }
    : await promptConfig(defaults);

  if (args.scopeFile) config.scopeFile = args.scopeFile;
  config.maxRps = Number.isFinite(args.maxRps) ? args.maxRps : 0;
  if (args.evidencePack) config.evidencePack = true;
  if (args.aiMutationHints) config.aiMutationHints = true;
  if (Number.isFinite(args.maxResponseBodyChars)) config.maxResponseBodyChars = args.maxResponseBodyChars;
  if (args.wordlistFile) config.wordlistFile = args.wordlistFile;
  if (Number.isFinite(args.maxWordlistInjections)) config.maxWordlistInjections = args.maxWordlistInjections;
  if (Number.isFinite(args.maxBodyMutationsPerOp)) config.maxBodyMutationsPerOp = args.maxBodyMutationsPerOp;
  if (args.authAlt) config.authAlt = args.authAlt;
  if (Number.isFinite(args.namespaceReplayBudget)) config.namespaceReplayBudget = args.namespaceReplayBudget;
  if (args.useCuratedWordlist) config.useCuratedWordlist = true;
  if (args.campaignMemoryFile) config.campaignMemoryFile = args.campaignMemoryFile;
  if (args.ci) config.ci = true;
  if (args.ciFailOnFindings) config.ciFailOnFindings = true;
  if (args.ciRequireScope) config.ciRequireScope = true;
  if (args.authEnv) config.authEnv = args.authEnv;
  if (args.authAltEnv) config.authAltEnv = args.authAltEnv;

  if (ci) {
    applyCiProfile(
      /** @type {Record<string, unknown>} */ (
        /** @type {unknown} */ (config)
      )
    );
  }

  const resolvedCli = resolveTargetUrl(config.target);
  if (!resolvedCli.ok) {
    console.error(resolvedCli.error);
    process.exit(1);
  }
  config.target = resolvedCli.url;

  if (ci && isCiRequireScope(args) && !(config.scopeFile && String(config.scopeFile).trim())) {
    console.error(
      'Error: MYTHOS_CI_REQUIRE_SCOPE / --ci-require-scope requires --scope-file (predictable surface).'
    );
    process.exit(1);
  }

  /** @type {{ auth: string | null, authAlt: string | null }} */
  let resolvedAuthBundle;
  try {
    resolvedAuthBundle = resolveAuthFields({
      auth: config.auth,
      authEnv: /** @type {unknown} */ (config).authEnv ?? null,
      authAlt: config.authAlt || null,
      authAltEnv: /** @type {unknown} */ (config).authAltEnv ?? null,
    });
  } catch (e) {
    console.error((/** @type {Error} */ (e)).message || e);
    process.exit(1);
  }

  /** @type {import('./safety/scopePolicy.js').ScopePolicy | null} */
  let scopePolicy = null;
  if (config.scopeFile) {
    const { loadScopePolicy } = await import('./safety/scopePolicy.js');
    try {
      scopePolicy = loadScopePolicy(config.scopeFile, config.target);
    } catch (e) {
      console.error((/** @type {Error} */ (e)).message || e);
      process.exit(1);
    }
  }

  const { outfile, report } = await runMythosPipeline({
    target: config.target,
    auth: resolvedAuthBundle.auth,
    concurrency: config.concurrency,
    maxRequests: config.maxRequests,
    timeoutMs: config.timeoutMs,
    outputDir: config.outputDir,
    openapiPath: config.openapiPath || null,
    useStubPlan: Boolean(config.useStubPlan),
    planWithLlm: Boolean(config.planWithLlm),
    scopePolicy,
    maxRps: Number.isFinite(config.maxRps) ? config.maxRps : 0,
    scopeFile: config.scopeFile || null,
    evidencePack: Boolean(config.evidencePack),
    aiMutationHints: Boolean(config.aiMutationHints),
    maxResponseBodyChars:
      Number.isFinite(config.maxResponseBodyChars) ? config.maxResponseBodyChars : undefined,
    wordlistFile: config.wordlistFile || null,
    maxWordlistInjections: Number.isFinite(config.maxWordlistInjections)
      ? config.maxWordlistInjections
      : 64,
    maxBodyMutationsPerOp: Number.isFinite(config.maxBodyMutationsPerOp)
      ? config.maxBodyMutationsPerOp
      : 0,
    authAlt: resolvedAuthBundle.authAlt,
    namespaceReplayBudget: Number.isFinite(config.namespaceReplayBudget)
      ? config.namespaceReplayBudget
      : 24,
    useCuratedWordlist: Boolean(config.useCuratedWordlist),
    campaignMemoryFile: config.campaignMemoryFile || null,
  });

  console.log(`\nReport written: ${outfile}`);
  if (report.evidencePack?.har && report.evidencePack?.replay) {
    console.log(`Evidence HAR: ${report.evidencePack.har}`);
    console.log(`Evidence replay JSON: ${report.evidencePack.replay}`);
  }
  console.log(`Executed requests: ${report.executed}`);
  console.log(`Findings (heuristic): ${report.findings.length}`);
  if (report.findings.length) {
    console.log('\nTop findings:');
    for (const f of report.findings.slice(0, 10)) {
      console.log(`- [${f.severity}] ${f.title}: ${f.detail}`);
    }
  }

  const exitCode = resolveMythosExitCode(report, {
    ci,
    failOnFindings: Boolean(args.ciFailOnFindings),
  });
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
