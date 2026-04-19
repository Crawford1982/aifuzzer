#!/usr/bin/env node
/**
 * Mock chat API — validates aiMutationAdvisor prompt + hint validation (no real key).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(root, '../fixtures/minimal-posts.openapi.json');

const hintJson = JSON.stringify({
  version: '1',
  hints: [{ operationId: 'listPosts', in: 'query', name: '_limit', value: '3' }],
});

/** @type {typeof fetch} */
async function mockFetch(url, init) {
  assert.match(String(url), /chat\/completions/);
  const body = JSON.stringify({
    choices: [{ message: { content: hintJson } }],
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

process.env.MYTHOS_LLM_API_KEY = 'mock-advisor-key';

const { loadOpenApi } = await import('../src/openapi/OpenApiLoader.js');
const { requestMutationHintsFromLlm, hintsToFuzzCases } = await import(
  '../src/planner/aiMutationAdvisor.js'
);

const spec = loadOpenApi(specPath);
const out = await requestMutationHintsFromLlm({
  spec,
  effectiveBaseUrl: 'https://jsonplaceholder.typicode.com',
  fetchImpl: mockFetch,
});

assert.equal(out.ok, true);
assert.ok(out.hints?.length);
const cases = hintsToFuzzCases(spec, 'https://jsonplaceholder.typicode.com', out.hints, {
  maxCases: 4,
});
assert.ok(cases[0].url.includes('_limit'));
assert.equal(cases[0].family, 'OPENAPI_AI_HINT');

console.log('aiMutationAdvisor ok');
