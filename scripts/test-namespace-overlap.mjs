#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { checkNamespacePrincipalOverlap } from '../src/verify/namespaceReplay.js';

const body = 'y'.repeat(70);
const overlap = [
  { caseId: 'c1', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: body },
  { caseId: 'c1:authAlt', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: body },
];
const hits = checkNamespacePrincipalOverlap(overlap);
assert.equal(hits.length, 1);
assert.equal(hits[0].checkerId, 'namespace_cross_principal_overlap');

const mismatch = [
  { caseId: 'c1', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: body },
  { caseId: 'c1:authAlt', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: `${body}z` },
];
assert.equal(checkNamespacePrincipalOverlap(mismatch).length, 0);

const tooShort = [
  { caseId: 'c1', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: 'short' },
  { caseId: 'c1:authAlt', method: 'GET', url: 'https://api.example/a', status: 200, bodyPreview: 'short' },
];
assert.equal(checkNamespacePrincipalOverlap(tooShort).length, 0);

console.log('namespace overlap ok');
