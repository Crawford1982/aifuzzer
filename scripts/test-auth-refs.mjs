#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { resolveAuthFields } from '../src/ops/authRefs.js';

process.env.MYTHOS_TEST_TOKEN = 'secret-a';
process.env.MYTHOS_TEST_ALT = 'secret-b';

const a = resolveAuthFields({ authEnv: 'MYTHOS_TEST_TOKEN' });
assert.equal(a.auth, 'secret-a');
assert.equal(a.authAlt, null);

const b = resolveAuthFields({
  authEnv: 'MYTHOS_TEST_TOKEN',
  authAltEnv: 'MYTHOS_TEST_ALT',
});
assert.equal(b.authAlt, 'secret-b');

assert.throws(() =>
  resolveAuthFields({
    auth: 'x',
    authEnv: 'MYTHOS_TEST_TOKEN',
  })
);

console.log('auth refs ok');
