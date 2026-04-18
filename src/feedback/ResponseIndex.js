/**
 * Layer 5 — Feedback (stub)
 * Dedup + naive novelty score by status + length bucket + body hash prefix.
 */

import crypto from 'crypto';

export class ResponseIndex {
  constructor() {
    /** @type {Set<string>} */
    this.seen = new Set();
  }

  /** @param {string} body */
  noveltyKey(status, body) {
    const h = crypto.createHash('sha256').update(body || '').digest('hex').slice(0, 16);
    const bucket = Math.min(20, Math.floor((body?.length || 0) / 500));
    return `${status}|${bucket}|${h}`;
  }

  /** @returns {number} 0..1 novelty */
  score(key) {
    if (this.seen.has(key)) return 0;
    this.seen.add(key);
    return 1;
  }
}
