#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { loadOpenApi } from '../src/openapi/OpenApiLoader.js';
import { expandFromOpenApi } from '../src/hypothesis/SpecHypothesisEngine.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const spec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
const wlPath = path.join(root, '../fixtures/sample-wordlist.txt');

const cases = expandFromOpenApi(spec, 'https://example.com', {
  maxRequests: 500,
  hasAuth: false,
  wordlistValues: ['admin', '99'],
  maxWordlistInjections: 20,
  maxBodyMutationsPerOp: 0,
});

assert.ok(cases.some((c) => c.family === 'OPENAPI_WORDLIST'));
console.log('wordlist expand ok');
