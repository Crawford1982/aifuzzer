#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { buildHarLog, buildReplayBundle } from '../src/verify/evidenceExport.js';

const casesById = new Map(
  [
    {
      id: 'c1',
      method: 'GET',
      url: 'https://example.com/api',
      family: 'T',
      headers: {},
    },
    {
      id: 'c2',
      method: 'POST',
      url: 'https://example.com/api',
      family: 'T',
      headers: { 'X-Test': '1' },
      meta: { jsonBody: { a: 1 }, contentType: 'application/json' },
    },
  ].map((c) => [c.id, c]),
);

const execResults = [
  {
    caseId: 'c1',
    method: 'GET',
    url: 'https://example.com/api?debug=1',
    status: 200,
    elapsedMs: 12,
    headers: { 'content-type': 'application/json' },
    bodyPreview: '{"ok":true}',
    bodyBytes: 9,
    error: null,
  },
  {
    caseId: 'c2',
    method: 'POST',
    url: 'https://example.com/api',
    status: 201,
    elapsedMs: 20,
    headers: { 'content-type': 'application/json' },
    bodyPreview: '{}',
    bodyBytes: 2,
    error: null,
  },
];

const gen = '2026-01-01T00:00:00.000Z';
const har = buildHarLog(execResults, casesById, { generatedAt: gen, authHeader: 'secret' });
assert.equal(har.log.version, '1.2');
assert.equal(har.log.entries.length, 2);
assert.equal(har.log.entries[0].response.status, 200);
assert.equal(har.log.entries[0].request.queryString.length, 1);
assert.ok(
  har.log.entries[1].request.postData?.text?.includes('"a"'),
  'POST body in HAR',
);

const bundle = buildReplayBundle(execResults, casesById, { generatedAt: gen, authHeader: 'secret' });
assert.equal(bundle.format, 'mythos-replay-bundle');
assert.equal(bundle.entryCount, 2);

const dupBundle = buildReplayBundle([...execResults, execResults[0]], casesById, {
  generatedAt: gen,
  authHeader: 'secret',
  dedupeReplayCurls: true,
});
assert.equal(dupBundle.entryCount, 2, 'duplicate curl rows dropped');

const expandedMap = new Map(casesById);
for (let i = 0; i < 12; i++) expandedMap.set(`cx${i}`, /** @type {any} */ (casesById.get('c1')));
const manyRows = Array.from({ length: 12 }, (_, i) => ({ ...execResults[0], caseId: `cx${i}` }));
const capped = buildReplayBundle(manyRows, expandedMap, { generatedAt: gen, maxReplayEntries: 5 });
assert.equal(capped.entryCount, 5);
assert.ok(bundle.entries[1].replayCurl?.includes('curl'));
assert.equal(bundle.entries[1].request.headers.Authorization, '[redacted]');

console.log('evidence export ok');
