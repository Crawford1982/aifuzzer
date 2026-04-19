#!/usr/bin/env node
/**
 * Optional live LLM → plan smoke (requires API key). Not part of npm test.
 * Enable: MYTHOS_E2E_LLM=1 MYTHOS_LLM_API_KEY=...
 */
if (process.env.MYTHOS_E2E_LLM !== '1') {
  console.log('skip test-llm-e2e (set MYTHOS_E2E_LLM=1 to run)');
  process.exit(0);
}

import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(root, '../fixtures/minimal-posts.openapi.json');

const { loadOpenApi } = await import('../src/openapi/OpenApiLoader.js');
const { inferProducerConsumerEdges } = await import('../src/state/dependencyGraph.js');
const { requestExecutionPlanFromLlm } = await import('../src/planner/llmPlanner.js');

const spec = loadOpenApi(specPath);
const { edges } = inferProducerConsumerEdges(spec.operations);
const out = await requestExecutionPlanFromLlm({
  spec,
  effectiveBaseUrl: 'https://jsonplaceholder.typicode.com',
  edges,
  maxRetries: 2,
});

if (!out.ok) {
  console.error('e2e planner failed:', out.reason, out.detail || '');
  process.exit(1);
}
assert.ok(out.plan?.sequence?.length);
console.log('test-llm-e2e ok, steps:', out.plan.sequence.length);
