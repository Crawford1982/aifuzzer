#!/usr/bin/env node
/**
 * Drain campaign job queue one job at a time (`FileJobQueue` or Redis).
 *
 * Env: MYTHOS_QUEUE_DIR (default `.mythos-queue`), or MYTHOS_REDIS_URL for Redis.
 *
 * Usage:
 *   node src/ops/worker.js           # poll until interrupted
 *   node src/ops/worker.js --once   # exit when queue empty / one job processed
 */

import { validateCampaignJob } from './campaignJob.js';
import { createJobQueue } from './queueFactory.js';
import { runCampaignJob } from './runCampaignJob.js';

/**
 * @typedef {{ id: string, jobId?: string, processingPath: string | null, job: Record<string, unknown> }} QueueItem
 */

/**
 * @param {unknown} queue
 */
async function dequeueUnified(queue) {
  const raw = queue.dequeue();
  return /** @type {Promise<QueueItem | null>} */ (Promise.resolve(raw));
}

/**
 * @param {unknown} queue
 * @param {string | null} processingPath
 * @param {Record<string, unknown>} result
 * @param {QueueItem} item
 */
async function completeUnified(queue, processingPath, result, item) {
  const target = typeof item.job?.target === 'string' ? item.job.target : undefined;
  const meta = {
    jobId: item.jobId || item.id,
    target,
  };

  if (processingPath != null && processingPath !== '') {
    /** @type {{ complete: (p: string, r: Record<string, unknown>, m?: unknown) => void }} */ (
      queue
    ).complete(processingPath, result, meta);
    return;
  }

  const q = /** @type {{ complete?: (p: unknown, r: Record<string, unknown>, m?: unknown) => void }} */ (
    queue
  );
  if (typeof q.complete === 'function') {
    await Promise.resolve(q.complete(null, result, meta));
  }
}

/**
 * @param {unknown} queue
 * @param {string | null} processingPath
 * @param {unknown} err
 * @param {Record<string, unknown>} jobSnapshot
 * @param {QueueItem} item
 */
async function failUnified(queue, processingPath, err, jobSnapshot, item) {
  const meta = { jobId: item.jobId || item.id };
  const q = /** @type {{
    fail: (
      p: string | null,
      e: unknown,
      j?: Record<string, unknown>,
      m?: unknown
    ) => void | Promise<void>;
  }} */ (queue);
  if (processingPath != null && processingPath !== '') {
    await Promise.resolve(q.fail(processingPath, err));
    return;
  }
  await Promise.resolve(q.fail(null, err, jobSnapshot, meta));
}

async function processItem(queue, item) {
  const parsed = validateCampaignJob(item.job);
  if (!parsed.ok) {
    console.error(`Invalid job ${item.id}:`, parsed.errors.join('; '));
    await failUnified(queue, item.processingPath, new Error(parsed.errors.join('; ')), item.job, item);
    return;
  }

  try {
    const { outfile, report } = await runCampaignJob(parsed.job);
    const result = {
      outfile,
      findingCount: Array.isArray(report.findings) ? report.findings.length : 0,
      executed: report.executed,
    };
    await completeUnified(queue, item.processingPath, result, item);
    console.log(`OK job ${item.id} → ${outfile} (${result.findingCount} findings)`);
  } catch (e) {
    console.error(`FAIL job ${item.id}:`, e);
    await failUnified(queue, item.processingPath, e, item.job, item);
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const pollMs = Number(process.env.MYTHOS_WORKER_POLL_MS || 750) || 750;
  /** @type {Awaited<ReturnType<typeof createJobQueue>>} */
  let queue = await createJobQueue();

  const q = /** @type {{ recoverProcessing?: () => Promise<void>, recoverStaleProcessing?: (n?: number) => number }} */ (
    queue
  );
  if (typeof q.recoverProcessing === 'function') {
    await q.recoverProcessing();
  }
  if (typeof q.recoverStaleProcessing === 'function') {
    const maxAge = Number(process.env.MYTHOS_STALE_PROCESSING_MS || 30 * 60 * 1000) || 30 * 60 * 1000;
    q.recoverStaleProcessing(maxAge);
  }

  for (;;) {
    const item = await dequeueUnified(queue);
    if (!item) {
      if (once) {
        console.log('Queue empty (--once).');
        process.exit(0);
      }
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    await processItem(queue, item);
    if (once) process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
