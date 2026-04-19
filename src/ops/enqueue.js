#!/usr/bin/env node
/**
 * Enqueue a validated campaign job (file or Redis queue).
 *
 * Usage: node src/ops/enqueue.js <job.json>
 */

import fs from 'fs';
import path from 'path';
import { validateCampaignJob } from './campaignJob.js';
import { createJobQueue } from './queueFactory.js';

async function main() {
  const p = process.argv[2];
  if (!p) {
    console.error('Usage: node src/ops/enqueue.js <job.json>');
    process.exit(1);
  }
  const abs = path.resolve(p);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error('Invalid JSON:', /** @type {Error} */ (e).message);
    process.exit(1);
  }

  const parsed = validateCampaignJob(raw);
  if (!parsed.ok) {
    console.error('Job validation failed:\n', parsed.errors.join('\n'));
    process.exit(1);
  }

  const queue = await createJobQueue();
  const payload = /** @type {Record<string, unknown>} */ ({ ...parsed.job });
  const backend = process.env.MYTHOS_REDIS_URL?.trim() ? 'redis' : 'file';
  const id = await Promise.resolve(
    /** @type {{ enqueue: (j: Record<string, unknown>) => string | Promise<string> }} */ (queue).enqueue(
      payload
    )
  );
  console.log(`Enqueued job ${id} (${backend} queue)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
