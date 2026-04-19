#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { buildSessionSummary, mergeCampaignMemory } from '../src/campaign/sessionMemory.js';

const snap = buildSessionSummary([
  { caseId: 'a', method: 'GET', url: 'https://h.example/foo', status: 404 },
]);
assert.ok(snap.routes && snap.routes['GET:/foo']);

const merged = mergeCampaignMemory(null, snap);
assert.equal(merged.format, 'mythos-campaign-memory');
assert.ok(merged.routes['GET:/foo']);

const merged2 = mergeCampaignMemory(merged, snap);
assert.ok(Number(merged2.routes['GET:/foo'].samples) >= 2);

console.log('session memory ok');
