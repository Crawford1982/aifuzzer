#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';

const root = path.dirname(fileURLToPath(import.meta.url));

const { loadScopePolicy, assertUrlInScope, checkRedirectPolicy } = await import(
  '../src/safety/scopePolicy.js'
);

const fixture = path.join(root, '../fixtures/mythos-scope.example.yaml');
const policy = loadScopePolicy(fixture, 'https://jsonplaceholder.typicode.com/posts/1');

assert.ok(policy.allowHosts.has('jsonplaceholder.typicode.com'));

const ok = assertUrlInScope('https://jsonplaceholder.typicode.com/posts/1', policy);
assert.equal(ok.ok, true);

const badHost = assertUrlInScope('https://evil.example.com/posts/1', policy);
assert.equal(badHost.ok, false);

const hdrs = new Headers({ location: 'https://evil.example.com/x' });
const rd = checkRedirectPolicy('https://jsonplaceholder.typicode.com/a', 302, hdrs, policy);
assert.equal(rd.ok, false);

console.log('scopePolicy ok');
