#!/usr/bin/env node

import { parseArgv } from './config.js';
import { runMythosPipeline } from './orchestrator/MythosOrchestrator.js';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveTargetUrl } from './util/resolveTargetUrl.js';

function printHelp() {
  console.log(`
Mythos fuzzer v0.1 — authorized testing only.

Usage:
  npm start -- --target <url> [--auth <token>] [--concurrency N] [--max-requests N]
  npm start                       # interactive mode

Examples:
  npm start -- --target "https://jsonplaceholder.typicode.com/posts/{id}"
  npm start -- --target "https://jsonplaceholder.typicode.com/posts/1"

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
        ...defaults,
      }
    : await promptConfig(defaults);

  const resolvedCli = resolveTargetUrl(config.target);
  if (!resolvedCli.ok) {
    console.error(resolvedCli.error);
    process.exit(1);
  }
  config.target = resolvedCli.url;

  const { outfile, report } = await runMythosPipeline({
    target: config.target,
    auth: config.auth,
    concurrency: config.concurrency,
    maxRequests: config.maxRequests,
    timeoutMs: config.timeoutMs,
    outputDir: config.outputDir,
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
