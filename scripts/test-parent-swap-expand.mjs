#!/usr/bin/env node
/**
 * Phase 3 — schema-aware parent path swaps on nested routes (bounded).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { loadOpenApi } from '../src/openapi/OpenApiLoader.js';
import { expandFromOpenApi, schemaAwareParentSwapAlts } from '../src/hypothesis/SpecHypothesisEngine.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const intAlts = schemaAwareParentSwapAlts({ type: 'integer', example: 1 });
assert.equal(intAlts.length <= 2, true);
assert.ok(intAlts.every((a) => a !== '1'));

const spec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
const cases = expandFromOpenApi(spec, 'https://example.com', {
  maxRequests: 900,
  hasAuth: false,
  maxWordlistInjections: 0,
  maxBodyMutationsPerOp: 0,
});

const nestedSwap = cases.filter(
  (c) => c.family === 'OPENAPI_PARENT_SWAP' && String(c.id).includes('getPostCommentNested')
);
assert.ok(nestedSwap.length >= 1, 'expected parent_swap cases for two-param nested route');
assert.ok(nestedSwap.every((c) => c.meta?.parentSwap === true));

const liveCases = expandFromOpenApi(spec, 'https://example.com', {
  maxRequests: 900,
  hasAuth: false,
  maxWordlistInjections: 0,
  maxBodyMutationsPerOp: 0,
  liveParentIdsByCollection: { '/posts': ['2', '40'] },
});
const harvestTagged = liveCases.filter(
  (c) =>
    c.family === 'OPENAPI_PARENT_SWAP' &&
    String(c.id).includes('getPostCommentNested') &&
    String(c.id).includes('parent_swap_harvest')
);
assert.ok(harvestTagged.length >= 1, 'live harvest should emit parent_swap_harvest cases');
assert.ok(harvestTagged.every((c) => c.meta?.parentSwapSource === 'harvest'));

console.log('parent swap expand ok');
