#!/usr/bin/env node
/**
 * Smoke-test: Mythos resolves scope-lab fuzzAgent via src/adapters/scopeLabFuzzAgent.js
 * Runs a tiny dry plan (no LLM hooks) against a public JSONPlaceholder URL.
 */

import {
  getScopeLabAdapterInfo,
  generateProbes,
  runFuzzPlan,
  DEFAULT_BUDGET
} from '../src/adapters/scopeLabFuzzAgent.js';

const SAFE_TARGET = 'https://jsonplaceholder.typicode.com/posts/1';

async function main() {
  const info = getScopeLabAdapterInfo();
  console.log('Adapter resolved scope-lab fuzzAgent at:\n ', info.fuzzAgentPath);
  console.log('Scope lab root:\n ', info.labRoot);

  const probes = generateProbes(SAFE_TARGET, { hasAuth: false });
  console.log(`\ngenerateProbes: ${probes.length} probes for seed (pattern-only)`);
  console.log('  first ids:', probes.slice(0, 4).map((p) => p.id).join(', '), '…');

  const events = [];
  const summary = await runFuzzPlan({
    targets: [SAFE_TARGET],
    budget: {
      ...DEFAULT_BUDGET,
      maxRequests: Math.min(8, DEFAULT_BUDGET.maxRequests),
      concurrency: 1
    },
    authToken: null,
    llm: null,
    onEvent: (ev) => {
      events.push(ev.type);
      if (ev.type === 'probe') {
        const st = ev.result?.ok ? ev.result.status : ev.result?.error;
        console.log(`  probe ${ev.probe.id}: ${st}`);
      }
    }
  });

  console.log('\nEvent types:', [...new Set(events)].join(', '));
  console.log('Summary:', {
    requests: summary.requests,
    novelty: summary.novelty,
    findings: summary.findings?.length ?? 0
  });
  console.log('\nOK — adapter + runFuzzPlan (no LLM) completed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
