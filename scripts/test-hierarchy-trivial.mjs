#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import {
  checkResourceHierarchyCrossParent,
  checkNestedResourceHierarchyCrossParent,
  isTrivialPublicPayload,
} from '../src/verify/invariantCheckers.js';

assert.equal(isTrivialPublicPayload('[{"id":1}]'), true);
assert.equal(isTrivialPublicPayload('[]'), true);

const longShell = '[{"id":1},{"id":2},{"id":3}]' + ' '.repeat(80);
assert.ok(longShell.length >= 64);
assert.equal(isTrivialPublicPayload(longShell), true);

const substantial = '{"x":"y"}'.repeat(40);
assert.equal(isTrivialPublicPayload(substantial), false);

const hierRows = [
  {
    caseId: 'h1',
    method: 'GET',
    url: 'https://x.test/posts/1/comments',
    status: 200,
    bodyPreview: substantial,
    family: 'Y',
  },
  {
    caseId: 'h2',
    method: 'GET',
    url: 'https://x.test/posts/2/comments',
    status: 200,
    bodyPreview: substantial,
    family: 'Y',
  },
];
assert.ok(checkResourceHierarchyCrossParent(hierRows).length >= 1);

const nestedBody = '{"k":1,"p":"' + 'z'.repeat(80) + '"}';
const nestedHierarchy = [
  {
    caseId: 'n1',
    method: 'GET',
    url: 'https://x.test/a/1/b/2/c',
    status: 200,
    bodyPreview: nestedBody,
  },
  {
    caseId: 'n2',
    method: 'GET',
    url: 'https://x.test/a/9/b/2/c',
    status: 200,
    bodyPreview: nestedBody,
  },
];
assert.ok(checkNestedResourceHierarchyCrossParent(nestedHierarchy).length >= 1);

const trivialHierarchy = [
  {
    caseId: 't1',
    method: 'GET',
    url: 'https://x.test/posts/1/items',
    status: 200,
    bodyPreview: longShell,
  },
  {
    caseId: 't2',
    method: 'GET',
    url: 'https://x.test/posts/2/items',
    status: 200,
    bodyPreview: longShell,
  },
];
assert.equal(checkResourceHierarchyCrossParent(trivialHierarchy).length, 0);

console.log('hierarchy trivial guard ok');
