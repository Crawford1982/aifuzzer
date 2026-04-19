/**
 * Milestone D — deterministic minimization hints (no extra HTTP unless caller replays).
 */

/** @typedef {import('../hypothesis/HypothesisEngine.js').FuzzCase} FuzzCase */

/**
 * @param {FuzzCase | undefined} fc
 */
export function minimizationHint(fc) {
  if (!fc?.meta?.query) return null;
  const q = fc.meta.query;
  const keys = Object.keys(q);
  if (keys.length === 0) return null;
  const noise = keys.filter((k) => /debug|trace|verbose|__/.test(k));
  if (noise.length) {
    return { kind: 'drop_query_keys', keys: noise, note: 'Remove noisy query toggles and re-run' };
  }
  if (keys.length > 1) {
    return { kind: 'reduce_query', keys, note: 'Try removing optional query params one at a time' };
  }
  return null;
}
