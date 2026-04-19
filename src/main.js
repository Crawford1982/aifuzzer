#!/usr/bin/env node

import { parseArgv } from './config.js';
import { runMythosPipeline } from './orchestrator/MythosOrchestrator.js';
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
        ...defaults,
      }
    : await promptConfig(defaults);

  if (args.scopeFile) config.scopeFile = args.scopeFile;
  config.maxRps = Number.isFinite(args.maxRps) ? args.maxRps : 0;

  const resolvedCli = resolveTargetUrl(config.target);
  if (!resolvedCli.ok) {
    console.error(resolvedCli.error);
    process.exit(1);
  }
  config.target = resolvedCli.url;

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
    auth: config.auth,
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
  });

  console.log(`\nReport written: ${outfile}`);
  console.log(`Executed requests: ${report.executed}`);
  console.log(`Findings (heuristic): ${report.findings.length}`);
  if (report.findings.length) {
    console.log('\nTop findings:');
    for (const f of report.findings.slice(0, 10)) {
      console.log(`- [${f.severity}] ${f.title}: ${f.detail}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
