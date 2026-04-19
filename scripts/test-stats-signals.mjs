#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import {
  binomialTailAtLeast,
  aggregateRouteStatus,
  enrichFindingsWithStatistics,
} from '../src/verify/statsSignals.js';

assert.ok(binomialTailAtLeast(5, 10, 0.02) < 0.001, 'tail should be tiny for rare events');
assert.ok(binomialTailAtLeast(0, 10, 0.5) > 0.99, 'p(X>=0)');

const exec = [
  { caseId: 'a', method: 'GET', url: 'https://x/items', status: 200, family: 'OPENAPI_BASELINE' },
  { caseId: 'b', method: 'GET', url: 'https://x/items', status: 500, family: 'OPENAPI_ERROR' },
  { caseId: 'c', method: 'GET', url: 'https://x/items', status: 500, family: 'OPENAPI_ERROR' },
];
const routes = aggregateRouteStatus(exec);
assert.equal(routes.get('GET:/items')?.n, 3);

const enriched = enrichFindingsWithStatistics(
  [{ severity: 'high', caseId: 'b', title: 'x' }],
  exec
);
assert.ok(enriched[0].statistics?.routeSamples >= 1);

console.log('statsSignals ok');
