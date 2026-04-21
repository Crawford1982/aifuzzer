#!/usr/bin/env node
/**
 * Offline: mock `global.fetch` and run one `post_to_item` stateful chain
 * (POST /posts → extract id → GET /posts/{id}).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));
const base = 'https://ci-mock.example.com';

/**
 * @param {number} status
 * @param {unknown} body
 */
function jsonResponse(status, body) {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchMock() {
  /** @type {typeof fetch} */
  const mockFetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'POST' && url.pathname === '/posts') {
      return jsonResponse(201, { id: 101, title: 'from-mock-create' });
    }
    if (method === 'GET' && url.pathname === '/posts/101') {
      return jsonResponse(200, { id: 101, title: 'from-mock-create', body: 'x' });
    }
    if (method === 'GET' && url.pathname === '/posts' && !url.pathname.includes('/posts/')) {
      return jsonResponse(200, [{ id: 1, title: 'list-a' }]);
    }
    return jsonResponse(404, { error: 'unexpected in test-chains', url: raw, method });
  };

  globalThis.fetch = mockFetch;
}

installFetchMock();

const { loadOpenApi } = await import('../src/openapi/OpenApiLoader.js');
const { inferProducerConsumerEdges } = await import('../src/state/dependencyGraph.js');
const { buildStatefulChains } = await import('../src/hypothesis/StatefulCampaignEngine.js');
const { compileStatefulChain, executeStatefulChain } = await import('../src/execution/SequenceExecutor.js');

const specPath = path.join(root, '../fixtures/minimal-posts.openapi.json');
const spec = loadOpenApi(specPath);
const { edges } = inferProducerConsumerEdges(spec.operations);

const postEdge = edges.find((e) => e.kind === 'post_to_item' && e.consumerId === 'getPost');
assert.ok(postEdge, 'expected post_to_item edge createPost → getPost');

const chains = buildStatefulChains(spec, { edges }, { maxChains: 20 });
const postChain = chains.find((c) => c.edge.kind === 'post_to_item');
assert.ok(postChain, 'expected a stateful chain for post_to_item');

const byId = new Map(spec.operations.map((o) => [o.operationId, o]));
const compiled = compileStatefulChain(/** @type {any} */ (postChain), byId, base);

const out = await executeStatefulChain(compiled, { timeoutMs: 5000, authHeader: null });

assert.equal(out.results.length, 2, 'producer + consumer');
assert.equal(out.results[0].status, 201);
assert.match(String(out.results[0].url), /\/posts$/);
assert.equal(out.results[1].status, 200);
assert.ok(String(out.results[1].url).includes('/posts/101'));

function installFetchMockPostToList() {
  /** @type {typeof fetch} */
  const mockFetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw);
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'POST' && url.pathname.endsWith('/shop/orders')) {
      return jsonResponse(200, { id: 7, ok: true });
    }
    if (method === 'GET' && url.pathname.endsWith('/shop/orders/all')) {
      return jsonResponse(200, [{ id: 7 }]);
    }
    return jsonResponse(404, { error: 'unexpected in post_to_list test', url: raw, method });
  };

  globalThis.fetch = mockFetch;
}

installFetchMockPostToList();

const crapiSpec = loadOpenApi(path.join(root, '../fixtures/crapi-minimal.openapi.yaml'));
const graph2 = inferProducerConsumerEdges(crapiSpec.operations);
const plEdge = graph2.edges.find(
  (e) => e.kind === 'post_to_list_get' && e.producerId === 'placeShopOrder'
);
assert.ok(plEdge, 'expected post_to_list_get edge for crAPI fixture');

const chains2 = buildStatefulChains(crapiSpec, graph2, { maxChains: 50 });
const plChain = chains2.find((c) => c.edge.kind === 'post_to_list_get');
assert.ok(plChain, 'stateful chain for post_to_list_get');

const byId2 = new Map(crapiSpec.operations.map((o) => [o.operationId, o]));
const compiled2 = compileStatefulChain(/** @type {any} */ (plChain), byId2, base);
const out2 = await executeStatefulChain(compiled2, { timeoutMs: 5000, authHeader: null });

assert.equal(out2.results.length, 2);
assert.equal(out2.results[0].status, 200);
const listUrl = new URL(String(out2.results[1].url));
assert.match(listUrl.pathname, /\/orders\/all$/);

console.log('stateful chain (post_to_item, mocked fetch): ok');
console.log('stateful chain (post_to_list_get, mocked fetch): ok');
