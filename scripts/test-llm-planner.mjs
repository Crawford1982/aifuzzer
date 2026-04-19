#!/usr/bin/env node
/**
 * Mock provider API — validates llmPlanner JSON extraction + validatePlan path (no real key).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));

const validPlan = {
  version: '1',
  goal: 'ci_chain',
  attackClass: 'MOCK_LLM',
  sequence: [
    { id: 's1', method: 'GET', pathTemplate: '/posts/1' },
    { id: 's2', method: 'GET', pathTemplate: '/posts/1/comments' },
  ],
};

/** @type {typeof fetch} */
async function mockFetch(url, init) {
  assert.match(String(url), /chat\/completions/);
  const body = JSON.stringify({
    choices: [{ message: { content: JSON.stringify(validPlan) } }],
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

process.env.MYTHOS_LLM_API_KEY = 'mock-key-for-ci';

const { loadOpenApi } = await import('../src/openapi/OpenApiLoader.js');
const { inferProducerConsumerEdges } = await import('../src/state/dependencyGraph.js');
const { requestExecutionPlanFromLlm } = await import('../src/planner/llmPlanner.js');

const spec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
const { edges } = inferProducerConsumerEdges(spec.operations);

const out = await requestExecutionPlanFromLlm({
  spec,
  effectiveBaseUrl: 'https://example.com',
  edges,
  fetchImpl: mockFetch,
});

assert.equal(out.ok, true);
assert.equal(out.plan?.goal, 'ci_chain');

console.log('llmPlanner (mock provider): ok');
