#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyCiProfile, resolveMythosExitCode } from '../src/ops/ciProfile.js';
import { validateCampaignJob } from '../src/ops/campaignJob.js';
import { FileJobQueue } from '../src/ops/fileQueue.js';
import { rankRoutesFromCampaignMemory } from '../src/ops/routeMemoryRank.js';

const cfg = {
  concurrency: 8,
  maxRequests: 999,
  timeoutMs: 12000,
  maxRps: 0,
  planWithLlm: true,
  aiMutationHints: true,
  evidencePack: true,
};
applyCiProfile(cfg);
assert.equal(cfg.concurrency, 2);
assert.equal(cfg.maxRequests, 48);
assert.equal(cfg.planWithLlm, false);
assert.equal(cfg.evidencePack, false);
assert.ok(Number(cfg.maxRps) > 0);

assert.equal(
  resolveMythosExitCode({ findings: [{}, {}] }, { ci: true, failOnFindings: true }),
  2
);
assert.equal(resolveMythosExitCode({ findings: [] }, { ci: true, failOnFindings: true }), 0);

const bad = validateCampaignJob({});
assert.equal(bad.ok, false);

const good = validateCampaignJob({
  version: 1,
  target: 'https://example.com/api',
  openapiPath: 'fixtures/minimal-posts.openapi.json',
});
assert.equal(good.ok, true);

const ranked = rankRoutesFromCampaignMemory({
  format: 'mythos-campaign-memory',
  routes: {
    'GET:/a': { samples: 2, statusMax: 500, errors: 1 },
    'GET:/b': { samples: 1, statusMax: 200, errors: 0 },
  },
});
assert.ok(ranked[0].includes('/a'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-q-'));
const q = new FileJobQueue(tmp);
const id = q.enqueue({ version: 1, target: 'https://z.test', openapiPath: 'x.json', ci: true });
assert.ok(id);
const item = q.dequeue();
assert.ok(item);
assert.ok(item.processingPath.includes('processing'));
assert.equal(item.jobId, item.id);
q.complete(item.processingPath, { ok: true });
const doneFiles = fs.readdirSync(path.join(tmp, 'done'));
assert.ok(doneFiles.some((f) => f.endsWith('.json')));
fs.rmSync(tmp, { recursive: true, force: true });

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-q2-'));
const q2 = new FileJobQueue(tmp2);
const stuck = path.join(q2.processing, 'stuck.json');
fs.writeFileSync(stuck, '{}', 'utf8');
const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
fs.utimesSync(stuck, old, old);
const n = q2.recoverStaleProcessing(30 * 60 * 1000);
assert.equal(n, 1);
assert.ok(fs.existsSync(path.join(q2.pending, 'stuck.json')));
fs.rmSync(tmp2, { recursive: true, force: true });

console.log('milestone E ops ok');
