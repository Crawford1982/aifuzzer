/**
 * Compose invariant checkers + attach registry fields for reporting.
 */

import { getCheckerDefinition } from './checkerRegistry.js';
import { runInvariantCheckers } from './invariantCheckers.js';
import { loadBountySignals, matchBountyBattery } from './bountyBattery.js';

/**
 * @param {unknown[]} execResults
 * @param {{ evidenceHarPath?: string | null }} ctx
 */
export function runCheckerPipeline(execResults, ctx = {}) {
  const invariantFindings = runInvariantCheckers(execResults);
  const bountyPack = loadBountySignals();
  const bountyFindings = matchBountyBattery(execResults, bountyPack);

  /** @type {Array<Record<string, unknown>>} */
  const fired = [];

  for (const f of invariantFindings) {
    const def = getCheckerDefinition(String(f.checkerId));
    fired.push({
      ...f,
      kind: 'checker',
      owaspMapping: def?.owaspMapping ?? [],
      bountyTierHint: def?.bountyTierHint ?? 'low',
      evidenceHarPath: ctx.evidenceHarPath ?? null,
    });
  }

  for (const f of bountyFindings) {
    fired.push({
      ...f,
      kind: 'bounty_signal',
      checkerId: `signal:${f.signalId}`,
      owaspMapping: [],
      bountyTierHint: mapSeverityToTier(String(f.severity)),
      evidenceHarPath: ctx.evidenceHarPath ?? null,
    });
  }

  return fired;
}

/**
 * @param {string} s
 */
function mapSeverityToTier(s) {
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}
