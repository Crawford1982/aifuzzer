#!/usr/bin/env node
import { strict as assert } from 'node:assert';

const { buildBaselineFingerprints } = await import('../src/verify/baseline.js');
const { scoreFinding, enrichFindingsWithConfidence } = await import('../src/verify/confidence.js');
const { minimizationHint } = await import('../src/verify/minimize.js');

const execResults = [
  {
    caseId: 'b1',
    family: 'OPENAPI_BASELINE',
    method: 'GET',
    url: 'https://example.com/items',
    status: 200,
    bodyPreview: '{"a":1}',
  },
  {
    caseId: 'f1',
    family: 'OPENAPI_ERROR',
    method: 'GET',
    url: 'https://example.com/items',
    status: 500,
    bodyPreview: '{"err":true}',
  },
];

const baselines = buildBaselineFingerprints(execResults);
assert.ok(baselines.has('GET:/items'));

const scored = scoreFinding({ severity: 'high', caseId: 'f1' }, execResults[1], baselines);
assert.ok(scored.score >= 0.5);
assert.ok(scored.signals.includes('body_diff_vs_baseline'));

const findings = [{ severity: 'high', title: 'x', caseId: 'f1', url: '' }];
const enriched = enrichFindingsWithConfidence(findings, execResults, baselines);
assert.equal(enriched[0].confidence, scored.score);

const hintCase = {
  id: 'q1',
  method: 'GET',
  url: 'https://x/y',
  family: 'X',
  meta: { query: { debug: '1', ok: '1' } },
};
const hint = minimizationHint(hintCase);
assert.equal(hint?.kind, 'drop_query_keys');

console.log('milestone D verify ok');
