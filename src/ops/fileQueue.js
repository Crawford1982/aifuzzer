/**
 * Milestone E — filesystem-backed job queue (no Redis required).
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export class FileJobQueue {
  /**
   * @param {string} rootDir e.g. `.mythos-queue` or `MYTHOS_QUEUE_DIR`
   */
  constructor(rootDir) {
    this.root = path.resolve(rootDir);
    this.pending = path.join(this.root, 'pending');
    this.processing = path.join(this.root, 'processing');
    this.done = path.join(this.root, 'done');
    this.failed = path.join(this.root, 'failed');
    for (const d of [this.pending, this.processing, this.done, this.failed]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  /**
   * @param {Record<string, unknown>} jobObj
   * @returns {string} job id
   */
  enqueue(jobObj) {
    const id = typeof jobObj.id === 'string' && jobObj.id.trim() ? jobObj.id.trim() : randomUUID();
    const full = { ...jobObj, id, enqueuedAt: new Date().toISOString() };
    const name = `${id}.json`;
    const p = path.join(this.pending, name);
    fs.writeFileSync(p, JSON.stringify(full, null, 2), 'utf8');
    return id;
  }

  /**
   * @returns {{ id: string, processingPath: string, job: Record<string, unknown> } | null}
   */
  dequeue() {
    const files = fs.readdirSync(this.pending).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) return null;
    const f = files[0];
    const from = path.join(this.pending, f);
    const id = f.replace(/\.json$/, '');
    const to = path.join(this.processing, f);
    try {
      fs.renameSync(from, to);
    } catch {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(to, 'utf8'));
    return { id, jobId: id, processingPath: to, job: raw };
  }

  /**
   * Move jobs stuck in `processing/` back to `pending/` (e.g. worker killed mid-run).
   *
   * @param {number} [maxAgeMs] default 30 minutes
   * @returns {number} count re-queued
   */
  recoverStaleProcessing(maxAgeMs = 30 * 60 * 1000) {
    const now = Date.now();
    let n = 0;
    for (const f of fs.readdirSync(this.processing).filter((x) => x.endsWith('.json'))) {
      const p = path.join(this.processing, f);
      const st = fs.statSync(p);
      if (now - st.mtimeMs > maxAgeMs) {
        const to = path.join(this.pending, f);
        fs.renameSync(p, to);
        n += 1;
        console.error(`[mythos] file queue: re-queued stale processing ${f} (>${maxAgeMs}ms)`);
      }
    }
    return n;
  }

  /**
   * @param {string} processingPath
   * @param {Record<string, unknown>} result
   * @param {unknown} [_meta]
   */
  complete(processingPath, result, _meta) {
    const id = path.basename(processingPath, '.json');
    const to = path.join(this.done, `${id}.json`);
    const out = { ...result, completedAt: new Date().toISOString() };
    fs.writeFileSync(to, JSON.stringify(out, null, 2), 'utf8');
    fs.unlinkSync(processingPath);
  }

  /**
   * @param {string} processingPath
   * @param {unknown} err
   */
  fail(processingPath, err) {
    const id = path.basename(processingPath, '.json');
    const to = path.join(this.failed, `${id}.json`);
    const out = {
      error: err instanceof Error ? err.message : String(err),
      failedAt: new Date().toISOString(),
    };
    fs.writeFileSync(to, JSON.stringify(out, null, 2), 'utf8');
    fs.unlinkSync(processingPath);
  }
}
