#!/usr/bin/env node
/**
 * Offline: list → GET /posts/{id}/comments (nested sub-resource).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = 'https://ci-scoped.example.com';

/** @type {typeof fetch} */
async function mockFetch(input, init) {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw);
  const method = (init?.method || 'GET').toUpperCase();
  const json = (/** @type {unknown} */ body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (method === 'GET' && url.pathname === '/posts' && !url.pathname.includes('comments')) {
    return json([{ id: 7, title: 'x' }]);
  }
  if (method === 'GET' && url.pathname === '/posts/7/comments') {
    return json([{ id: 1, body: 'c' }]);
  }
  return json({ error: 'unexpected', url: raw }, 404);
}

globalThis.fetch = mockFetch;

const { loadOpenApi } = await import('../src/openapi/OpenApiLoader.js');
const { inferProducerConsumerEdges } = await import('../src/state/dependencyGraph.js');
const { buildStatefulChains } = await import('../src/hypothesis/StatefulCampaignEngine.js');
const { compileStatefulChain, executeStatefulChain } = await import(
  '../src/execution/SequenceExecutor.js'
);

const specPath = path.join(root, '../fixtures/minimal-posts.openapi.json');
const spec = loadOpenApi(specPath);
const { edges } = inferProducerConsumerEdges(spec.operations);
const scopedEdge = edges.find((e) => e.kind === 'list_to_scoped_subresource');
assert.ok(scopedEdge, 'nested edge');

const chains = buildStatefulChains(spec, { edges }, { maxChains: 30 });
const chain = chains.find((c) => c.edge.kind === 'list_to_scoped_subresource');
assert.ok(chain);

const byId = new Map(spec.operations.map((o) => [o.operationId, o]));
const compiled = compileStatefulChain(chain, byId, base);
const out = await executeStatefulChain(compiled, {
  timeoutMs: 5000,
  authHeader: null,
  maxBodyPreviewChars: 16000,
});

assert.equal(out.results.length, 2);
assert.match(String(out.results[1].url), /\/posts\/7\/comments/);

console.log('scoped chain ok');
