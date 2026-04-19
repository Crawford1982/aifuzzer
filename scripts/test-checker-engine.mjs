#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import {
  checkLeakAfterFailedCreate,
  checkDeleteStillReadable,
  checkResourceHierarchyCrossParent,
} from '../src/verify/invariantCheckers.js';
import { runCheckerPipeline } from '../src/verify/checkerEngine.js';
import { MYTHOS_CHECKERS } from '../src/verify/checkerRegistry.js';

const leakRows = [
  {
    caseId: 'p1',
    method: 'POST',
    url: 'https://x.test/posts',
    status: 422,
    bodyPreview: '',
    family: 'X',
  },
  {
    caseId: 'g1',
    method: 'GET',
    url: 'https://x.test/posts',
    status: 200,
    bodyPreview: '[{"id":1}]',
    family: 'OPENAPI_BASELINE',
  },
];
const leaks = checkLeakAfterFailedCreate(leakRows);
assert.ok(leaks.some((x) => x.checkerId === 'leak_after_failed_create'));

const delRows = [
  {
    caseId: 'd1',
    method: 'DELETE',
    url: 'https://x.test/posts/9',
    status: 204,
    bodyPreview: '',
    family: 'DEL',
  },
  {
    caseId: 'g2',
    method: 'GET',
    url: 'https://x.test/posts/9',
    status: 200,
    bodyPreview: '{"id":9}',
    family: 'GET',
  },
];
assert.ok(checkDeleteStillReadable(delRows).length >= 1);

const hierRows = [
  {
    caseId: 'h1',
    method: 'GET',
    url: 'https://x.test/posts/1/comments',
    status: 200,
    bodyPreview: '{"x":"y"}'.repeat(20),
    family: 'Y',
  },
  {
    caseId: 'h2',
    method: 'GET',
    url: 'https://x.test/posts/2/comments',
    status: 200,
    bodyPreview: '{"x":"y"}'.repeat(20),
    family: 'Y',
  },
];
assert.ok(checkResourceHierarchyCrossParent(hierRows).length >= 1);

const fired = runCheckerPipeline(leakRows, { evidenceHarPath: '/tmp/x.har' });
assert.ok(fired.some((x) => x.kind === 'checker'));
assert.ok(MYTHOS_CHECKERS.length >= 3);

console.log('checker engine ok');
