/**
 * Load deterministic bounty-style matchers from data/bounty-signals.json (regex on previews only).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   severity: string,
 *   referenceUrl?: string,
 *   matcher: {
 *     statusMin?: number,
 *     statusMax?: number,
 *     bodyRegex?: string,
 *     headerNameRegex?: string,
 *     headerValueRegex?: string,
 *   },
 * }} BountySignal
 */

/**
 * @param {string} [dataDir]
 */
export function loadBountySignals(dataDir) {
  const base =
    dataDir ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const fp = path.join(base, 'bounty-signals.json');
  if (!fs.existsSync(fp)) {
    return { version: 1, signals: /** @type {BountySignal[]} */ ([]) };
  }
  const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return {
    version: doc.version ?? 1,
    signals: Array.isArray(doc.signals) ? doc.signals : [],
  };
}

/**
 * @param {unknown} result
 * @param {BountySignal} sig
 */
export function signalMatchesResult(result, sig) {
  const r = /** @type {Record<string, unknown>} */ (result);
  const st = r.status != null ? Number(r.status) : null;
  if (st == null) return false;
  const min = sig.matcher.statusMin ?? 0;
  const max = sig.matcher.statusMax ?? 999;
  if (st < min || st > max) return false;

  const body = String(r.bodyPreview || '');
  if (sig.matcher.bodyRegex) {
    const re = new RegExp(sig.matcher.bodyRegex, 'i');
    if (!re.test(body)) return false;
  }

  if (sig.matcher.headerNameRegex || sig.matcher.headerValueRegex) {
    const hdrs = /** @type {Record<string, string>} */ (
      r.headers && typeof r.headers === 'object' ? r.headers : {}
    );
    let ok = false;
    const nk = sig.matcher.headerNameRegex ? new RegExp(sig.matcher.headerNameRegex, 'i') : null;
    const vk = sig.matcher.headerValueRegex ? new RegExp(sig.matcher.headerValueRegex, 'i') : null;
    for (const [name, val] of Object.entries(hdrs)) {
      const nameOk = nk ? nk.test(name) : true;
      const valOk = vk ? vk.test(String(val)) : true;
      if (nameOk && valOk) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }

  return true;
}

/**
 * @param {unknown[]} execResults
 * @param {{ signals?: BountySignal[] }} pack
 */
export function matchBountyBattery(execResults, pack) {
  /** @type {Array<Record<string, unknown>>} */
  const findings = [];
  const signals = pack.signals || [];

  for (const r of execResults) {
    for (const sig of signals) {
      if (!signalMatchesResult(r, sig)) continue;
      const row = /** @type {Record<string, unknown>} */ (r);
      findings.push({
        kind: 'bounty_signal',
        signalId: sig.id,
        severity: sig.severity,
        title: sig.name,
        detail: `Matched bounty battery signal "${sig.id}" on response preview.`,
        caseId: row.caseId,
        url: row.url,
        referenceUrl: sig.referenceUrl,
      });
    }
  }

  return findings;
}
