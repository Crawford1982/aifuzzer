#!/usr/bin/env node
/**
 * Integration: harvestParentIdsByCollection → expandFromOpenApi(liveParentIdsByCollection)
 * Mirrors MythosOrchestrator wiring (offline, no HTTP).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { loadOpenApi } from '../src/openapi/OpenApiLoader.js';
import { expandFromOpenApi } from '../src/hypothesis/SpecHypothesisEngine.js';
import { harvestParentIdsByCollection } from '../src/feedback/parentIdHarvest.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const earlyResults = [
  {
    method: 'GET',
    url: 'https://jsonplaceholder.typicode.com/posts',
    status: 200,
    bodyPreview: '[{"userId":1,"id":10,"title":"a"},{"userId":1,"id":20,"title":"b"}]',
    family: 'CHAIN',
  },
];

const live = harvestParentIdsByCollection(earlyResults, { maxPerKey: 16, maxIdsTotal: 32 });
assert.deepEqual(live['/posts']?.sort(), ['10', '20']);

const spec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
const cases = expandFromOpenApi(spec, 'https://jsonplaceholder.typicode.com', {
  maxRequests: 800,
  hasAuth: false,
  maxWordlistInjections: 0,
  maxBodyMutationsPerOp: 0,
  liveParentIdsByCollection: live,
});

const harvestCases = cases.filter(
  (c) =>
    c.family === 'OPENAPI_PARENT_SWAP' &&
    String(c.id).includes('parent_swap_harvest') &&
    String(c.id).includes('getPostCommentNested')
);
assert.ok(harvestCases.length >= 1, 'nested op should get harvest-driven parent_swap_harvest');
assert.ok(
  harvestCases.every((c) => c.meta?.parentSwapSource === 'harvest' && c.meta?.parentCollectionKey === '/posts')
);

console.log('pipeline parent harvest integration ok');
