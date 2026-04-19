/**
 * Milestone E — deterministic route prioritization from merged campaign memory (no embedding deps).
 * Optional input for workers / future orchestrator hooks.
 */

/**
 * @param {Record<string, unknown> | null | undefined} campaignMemory mythos-campaign-memory JSON
 * @param {{ limit?: number }} [opts]
 * @returns {string[]} canonical route keys, highest signal first
 */
export function rankRoutesFromCampaignMemory(campaignMemory, opts = {}) {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 2000);
  const routes =
    campaignMemory &&
    typeof campaignMemory === 'object' &&
    'routes' in campaignMemory &&
    campaignMemory.routes &&
    typeof campaignMemory.routes === 'object'
      ? /** @type {Record<string, Record<string, unknown>>} */ (campaignMemory.routes)
      : {};

  /** @type {Array<{ key: string, score: number }>} */
  const scored = [];

  for (const [key, v] of Object.entries(routes)) {
    if (typeof v !== 'object' || !v) continue;
    const samples = Number(v.samples || 0);
    const errors = Number(v.errors || 0);
    const statusMax = Number(v.statusMax || 0);
    const sessions = Number(v.sessions || 0);
    const score = errors * 100 + (statusMax >= 500 ? 80 : 0) + sessions * 2 + Math.min(samples, 50);
    scored.push({ key, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.key);
}
