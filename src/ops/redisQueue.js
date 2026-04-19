/**
 * Milestone E — Redis list queue with durable completion records + processing recovery.
 */

import { randomUUID } from 'crypto';

const LIST_KEY = 'mythos:campaign:jobs';
const PROCESSING_HASH = `${LIST_KEY}:processing`;
const DONE_LIST = `${LIST_KEY}:done`;

export class RedisJobQueue {
  /** @param {object} client connected redis client from `createClient` */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {Record<string, unknown>} jobObj
   * @returns {Promise<string>}
   */
  async enqueue(jobObj) {
    const id = typeof jobObj.id === 'string' && jobObj.id.trim() ? jobObj.id.trim() : randomUUID();
    const full = JSON.stringify({
      ...jobObj,
      id,
      enqueuedAt: new Date().toISOString(),
    });
    await this.client.lPush(LIST_KEY, full);
    return id;
  }

  /**
   * @returns {Promise<{ id: string, processingPath: null, job: Record<string, unknown>, jobId: string } | null>}
   */
  async dequeue() {
    const raw = await this.client.rPop(LIST_KEY);
    if (!raw || typeof raw !== 'string') return null;
    const job = /** @type {Record<string, unknown>} */ (JSON.parse(raw));
    const id = String(job.id || '');
    await this.client.hSet(PROCESSING_HASH, id, raw);
    return { id, processingPath: null, job, jobId: id };
  }

  /**
   * Persist success metadata (mirrors file-queue `done/` artifacts).
   *
   * @param {string | null} _processingRef unused
   * @param {Record<string, unknown>} result
   * @param {{ jobId?: string, target?: string }} [meta]
   */
  async complete(_processingRef, result, meta = {}) {
    const jobId = meta.jobId;
    if (jobId) {
      await this.client.hDel(PROCESSING_HASH, jobId);
    }

    const cap = Number(process.env.MYTHOS_REDIS_DONE_CAP ?? 500);
    const safeCap = Math.min(Math.max(1, cap), 10000);

    const record = JSON.stringify({
      ...result,
      jobId,
      completedAt: new Date().toISOString(),
      target: meta.target || undefined,
    });
    await this.client.lPush(DONE_LIST, record);
    await this.client.lTrim(DONE_LIST, 0, safeCap - 1);
  }

  /**
   * @param {unknown} _processingRef
   * @param {unknown} err
   * @param {Record<string, unknown>} [jobSnapshot]
   * @param {{ jobId?: string }} [meta]
   */
  async fail(_processingRef, err, jobSnapshot = undefined, meta = {}) {
    const jobId = meta.jobId;
    if (jobId) {
      await this.client.hDel(PROCESSING_HASH, jobId);
    }
    const msg = err instanceof Error ? err.message : String(err);
    await this.client.lPush(
      `${LIST_KEY}:failed`,
      JSON.stringify({
        error: msg,
        at: new Date().toISOString(),
        job: jobSnapshot ?? null,
        jobId: jobId || null,
      })
    );
  }

  /**
   * Re-queue all jobs left in the processing hash (e.g. worker crash after RPOp, before complete).
   */
  async recoverProcessing() {
    const all = await this.client.hGetAll(PROCESSING_HASH);
    const keys = Object.keys(all);
    for (const id of keys) {
      const raw = all[id];
      if (raw) {
        await this.client.lPush(LIST_KEY, raw);
        await this.client.hDel(PROCESSING_HASH, id);
      }
    }
    if (keys.length) {
      console.error(
        `[mythos] Redis: re-queued ${keys.length} job(s) from processing (unclean shutdown or lost worker)`
      );
    }
  }
}

/**
 * @param {string} url redis://...
 */
export async function createRedisJobQueue(url) {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  client.on('error', (err) => console.error('[mythos redis]', err));
  await client.connect();
  return new RedisJobQueue(client);
}
