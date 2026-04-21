/**
 * Stateful-ish invariant checks over the ordered execution log (no LLM).
 */

import { fingerprintBody } from './baseline.js';
import { checkNamespacePrincipalOverlap } from './namespaceReplay.js';

/**
 * @param {unknown} x
 */
function row(x) {
  return /** @type {Record<string, unknown>} */ (x);
}

/**
 * @param {string} urlStr
 */
function pathnameOnly(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = u.pathname.replace(/\/+$/, '') || '/';
    return p;
  } catch {
    return '';
  }
}

/**
 * Collection path for POST /collection — last segment static collection name.
 *
 * @param {string} urlStr
 */
export function collectionPathForMutating(urlStr) {
  return pathnameOnly(urlStr);
}

/**
 * POST 4xx then GET list 200 with non-empty JSON array — RESTler leakage analogue (heuristic).
 *
 * @param {unknown[]} execResults
 */
export function checkLeakAfterFailedCreate(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (let i = 0; i < execResults.length; i++) {
    const a = row(execResults[i]);
    const method = String(a.method || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) continue;
    const st = a.status != null ? Number(a.status) : null;
    if (st == null || st < 400 || st > 499) continue;

    const postPath = collectionPathForMutating(String(a.url || ''));
    if (!postPath) continue;

    const windowEnd = Math.min(execResults.length, i + 48);
    for (let j = i + 1; j < windowEnd; j++) {
      const b = row(execResults[j]);
      if (String(b.method || 'GET').toUpperCase() !== 'GET') continue;
      if (Number(b.status) !== 200) continue;
      const getPath = pathnameOnly(String(b.url || ''));
      if (getPath !== postPath) continue;

      const body = String(b.bodyPreview || '').trim();
      if (!body.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          out.push({
            checkerId: 'leak_after_failed_create',
            severity: 'medium',
            title: 'Possible create/list leakage',
            detail: `After ${method} ${st} on ${postPath}, GET ${getPath} returned 200 with non-empty array (${parsed.length} items).`,
            evidenceCaseIds: [a.caseId, b.caseId],
            caseId: a.caseId,
            url: b.url,
          });
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

/**
 * DELETE 2xx then GET same resource 2xx with body.
 *
 * @param {unknown[]} execResults
 */
export function checkDeleteStillReadable(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (let i = 0; i < execResults.length; i++) {
    const a = row(execResults[i]);
    if (String(a.method || '').toUpperCase() !== 'DELETE') continue;
    const st = a.status != null ? Number(a.status) : null;
    if (st == null || st < 200 || st >= 300) continue;
    const delPath = pathnameOnly(String(a.url || ''));
    if (!delPath) continue;

    const windowEnd = Math.min(execResults.length, i + 48);
    for (let j = i + 1; j < windowEnd; j++) {
      const b = row(execResults[j]);
      if (String(b.method || '').toUpperCase() !== 'GET') continue;
      const stb = b.status != null ? Number(b.status) : null;
      if (stb == null || stb < 200 || stb >= 300) continue;
      if (pathnameOnly(String(b.url || '')) !== delPath) continue;
      if (!b.bodyPreview || String(b.bodyPreview).length < 3) continue;

      out.push({
        checkerId: 'delete_still_readable',
        severity: 'medium',
        title: 'Resource still readable after DELETE',
        detail: `DELETE ${st} then GET ${stb} on ${delPath} returned a body — verify deletion semantics.`,
        evidenceCaseIds: [a.caseId, b.caseId],
        caseId: b.caseId,
        url: b.url,
      });
      break;
    }
  }

  return out;
}

/**
 * GET collection path returns 5xx while sibling `…/all` list returns 200 — routing mismatch signal
 * (common when a bare list route is broken but an alternate list endpoint works).
 *
 * @param {unknown[]} execResults
 */
export function checkBrokenCollectionListSibling(execResults) {
  /** @type {Map<string, { bare?: Record<string, unknown>, suff?: Record<string, unknown> }>} */
  const buckets = new Map();

  for (const r of execResults) {
    const o = row(r);
    if (String(o.method || '').toUpperCase() !== 'GET') continue;
    const p = pathnameOnly(String(o.url || ''));
    if (!p) continue;
    const key = collectionListBareKey(p);
    const slot = buckets.get(key) || {};
    if (/\/all$/i.test(p)) slot.suff = o;
    else slot.bare = o;
    buckets.set(key, slot);
  }

  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const [, slot] of buckets) {
    if (!slot.bare || !slot.suff) continue;
    const sb = slot.bare.status != null ? Number(slot.bare.status) : null;
    const ss = slot.suff.status != null ? Number(slot.suff.status) : null;
    if (sb != null && sb >= 500 && ss === 200) {
      const pb = pathnameOnly(String(slot.bare.url || ''));
      const ps = pathnameOnly(String(slot.suff.url || ''));
      out.push({
        checkerId: 'broken_collection_list_path',
        severity: 'low',
        title: 'Sibling list paths disagree (server error vs OK)',
        detail: `GET ${pb} returned ${sb} while GET ${ps} returned 200 — confirm which route is the supported list endpoint.`,
        evidenceCaseIds: [slot.bare.caseId, slot.suff.caseId],
        caseId: slot.bare.caseId,
        url: slot.suff.url,
      });
    }
  }

  return out;
}

/**
 * @param {string} pathname
 */
function collectionListBareKey(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (/\/all$/i.test(p)) {
    const stripped = p.replace(/\/all$/i, '').replace(/\/+$/, '') || '/';
    return stripped.toLowerCase();
  }
  return p.toLowerCase();
}

/**
 * Query keys Mythos adds for info-disclosure / pattern probes only.
 * Two URLs that differ only by these (plus equivalent remaining params) are the
 * same logical resource for hierarchy / BOLA heuristics — not distinct parents.
 */
const PROBE_ONLY_QUERY_KEYS = new Set(['debug', 'trace', 'verbose', '__debug']);

/**
 * Stable URL string for deduping: pathname + sorted query with probe keys removed.
 *
 * @param {string} urlStr
 */
export function canonicalUrlForHierarchyCompare(urlStr) {
  try {
    const u = new URL(urlStr);
    /** @type {Array<[string, string]>} */
    const kept = [];
    u.searchParams.forEach((value, key) => {
      if (!PROBE_ONLY_QUERY_KEYS.has(key.toLowerCase())) {
        kept.push([key, value]);
      }
    });
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    const out = new URL(u.origin + u.pathname);
    for (const [k, v] of kept) {
      out.searchParams.append(k, v);
    }
    return out.toString();
  } catch {
    return urlStr;
  }
}

/**
 * Normalize path: numeric and UUID segments → placeholders for grouping.
 *
 * @param {string} pathname
 */
export function normalizedPathTemplate(pathname) {
  return pathname
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?=\/|$)/gi, '/{uuid}');
}

/**
 * Count dynamic `{id}` / `{uuid}` slots after path normalization — used for nested vs flat hierarchy splits.
 *
 * @param {string} pathnameOnly
 */
export function dynamicSegmentCount(pathnameOnly) {
  const tmpl = normalizedPathTemplate(pathnameOnly);
  const ids = tmpl.match(/\{id\}/g)?.length ?? 0;
  const uuids = tmpl.match(/\{uuid\}/g)?.length ?? 0;
  return ids + uuids;
}

/**
 * Skip hierarchy checker on empty shells / identical public list plumbing (reduces FP on read-only APIs).
 *
 * @param {string} text
 */
export function isTrivialPublicPayload(text) {
  const t = text.trim();
  if (t.length < 48) return true;
  if (/^\[\s*\]\s*$/.test(t)) return true;
  if (/^\{\s*\}\s*$/.test(t)) return true;
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j) && j.length === 0) return true;
    if (
      Array.isArray(j) &&
      j.length > 0 &&
      j.length <= 3 &&
      j.every((row) => row && typeof row === 'object' && Object.keys(row).length <= 3)
    ) {
      const keys = new Set();
      for (const row of j) {
        if (row && typeof row === 'object') {
          for (const k of Object.keys(row)) keys.add(k);
        }
      }
      if (keys.size <= 3 && keys.has('id')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Shared hierarchy fingerprint bucket build (flat vs nested filters).
 *
 * @param {unknown[]} execResults
 * @param {(dynamicCount: number) => boolean} dynamicFilter
 */
function collectHierarchyCrossParent(execResults, dynamicFilter) {
  /** @type {Map<string, { fp: string, url: string, caseId: unknown }[]>} */
  const buckets = new Map();

  for (const r of execResults) {
    const o = row(r);
    if (String(o.method || '').toUpperCase() !== 'GET') continue;
    const st = o.status != null ? Number(o.status) : null;
    if (st !== 200) continue;
    const p = pathnameOnly(String(o.url || ''));
    if (!p) continue;
    const tmpl = normalizedPathTemplate(p);
    if (!dynamicFilter(dynamicSegmentCount(p))) continue;
    const key = `GET:${tmpl}`;
    const prev = String(o.bodyPreview || '');
    if (prev.length < 64) continue;
    if (isTrivialPublicPayload(prev)) continue;
    const fp = fingerprintBody(prev);
    if (!fp) continue;

    const list = buckets.get(key) || [];
    list.push({ fp, url: String(o.url), caseId: o.caseId });
    buckets.set(key, list);
  }

  return buckets;
}

/**
 * Same normalized GET template, different concrete paths, both 200, identical body fingerprint.
 * **Flat routes only** (exactly one dynamic `{id}` or `{uuid}` segment) — list/collection reads.
 *
 * @param {unknown[]} execResults
 */
export function checkResourceHierarchyCrossParent(execResults) {
  return finalizeHierarchyCrossParent(
    collectHierarchyCrossParent(execResults, (n) => n === 1),
    'resource_hierarchy_cross_parent',
    'Identical GET bodies for different URLs (possible BOLA)',
  );
}

/**
 * Nested resource routes (two or more dynamic segments) — stronger cross-parent / BOLA-traversal signal.
 *
 * @param {unknown[]} execResults
 */
export function checkNestedResourceHierarchyCrossParent(execResults) {
  return finalizeHierarchyCrossParent(
    collectHierarchyCrossParent(execResults, (n) => n >= 2),
    'nested_resource_hierarchy_cross_parent',
    'Nested route: identical GET bodies across different parent paths (possible BOLA / broken scoping)',
  );
}

/**
 * @param {Map<string, { fp: string, url: string, caseId: unknown }[]>} buckets
 * @param {string} checkerId
 * @param {string} title
 */
function finalizeHierarchyCrossParent(buckets, checkerId, title) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const [, rows] of buckets) {
    if (rows.length < 2) continue;
    /** @type {Map<string, typeof rows>} */
    const byFp = new Map();
    for (const row of rows) {
      const g = byFp.get(row.fp) || [];
      g.push(row);
      byFp.set(row.fp, g);
    }
    for (const [, group] of byFp) {
      const distinctCanonical = [
        ...new Set(group.map((x) => canonicalUrlForHierarchyCompare(String(x.url)))),
      ];
      if (distinctCanonical.length < 2) continue;
      out.push({
        checkerId,
        severity: 'high',
        title,
        detail: `Same body fingerprint across: ${distinctCanonical.slice(0, 4).join(' | ')}${distinctCanonical.length > 4 ? ' …' : ''}`,
        evidenceCaseIds: group.map((x) => x.caseId),
        caseId: group[0].caseId,
        url: group[0].url,
      });
      break;
    }
  }

  return out;
}

/**
 * @param {unknown[]} execResults
 */
/** Milestone H — sensitive path segments (function-level authz). */
const SENSITIVE_ROUTE_SEG =
  /(\/|^)(admin|internal|private|mgmt|management|moderator|sudo|superuser|root-users|configuration\/admin)(\/|$)/i;

const VERSION_SKEW_PATH = /\/(v0|beta|alpha|legacy|deprecated|staging-api|internal-api)(\/|$)/i;

/**
 * @param {string} path
 * @returns {'inventory_or_docs_surface' | 'legacy_or_alt_version_path' | null}
 */
function classifyShadowPath(path) {
  if (
    /\/(swagger|api-docs|openapi\.json|graphql|graphiql|playground|actuator)(\/|$)/i.test(path) ||
    /\/health\/details(\/|$)/i.test(path) ||
    /\/\.env(\/|$)/i.test(path) ||
    /\/(metrics|prometheus)(\/|$)/i.test(path) ||
    /\/(debug|trace)(\/|$)/i.test(path)
  ) {
    return 'inventory_or_docs_surface';
  }
  if (VERSION_SKEW_PATH.test(path)) return 'legacy_or_alt_version_path';
  return null;
}

const MASS_ASSIGN_MARKER = '__mythosUnexpected';

/**
 * POST/PUT/PATCH **extra_prop** body fuzz (synthetic field) returned 2xx; later GET reflects the marker in JSON.
 * API3:2023 — bounded window search (requires body mutations enabled in the run).
 *
 * @param {unknown[]} execResults
 */
export function checkMassAssignmentReflection(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (let i = 0; i < execResults.length; i++) {
    const a = row(execResults[i]);
    const cid = String(a.caseId || '');
    if (!cid.includes(':bodyfuzz:extra_prop')) continue;
    const m = String(a.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(m)) continue;
    const st = a.status != null ? Number(a.status) : null;
    if (st == null || st < 200 || st >= 300) continue;

    const windowEnd = Math.min(execResults.length, i + 96);
    for (let j = i + 1; j < windowEnd; j++) {
      const b = row(execResults[j]);
      if (String(b.method || '').toUpperCase() !== 'GET') continue;
      if (Number(b.status) !== 200) continue;
      const prev = String(b.bodyPreview || '');
      if (!prev.includes(MASS_ASSIGN_MARKER)) continue;

      out.push({
        checkerId: 'mass_assignment',
        severity: 'high',
        title: 'Mass assignment: synthetic field reflected after mutating request',
        detail:
          `Body fuzz case ${cid} returned ${st}; a subsequent GET response includes "${MASS_ASSIGN_MARKER}" — verify unwanted property binding.`,
        evidenceCaseIds: [a.caseId, b.caseId],
        caseId: a.caseId,
        url: b.url,
      });
      break;
    }
  }

  return out;
}

/**
 * Sensitive routes returned success without auth (omit_auth) or with alternate principal (authAlt).
 * API5:2023 — heuristic path probe.
 *
 * @param {unknown[]} execResults
 */
export function checkFunctionLevelAuthWeakness(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const raw of execResults) {
    const r = row(raw);
    const fam = String(r.family || '');
    const cid = String(r.caseId || '');
    const path = pathnameOnly(String(r.url || ''));
    if (!path || !SENSITIVE_ROUTE_SEG.test(path)) continue;

    const st = r.status != null ? Number(r.status) : null;
    if (st == null || st < 200 || st >= 300) continue;

    const bodyLen = String(r.bodyPreview || '').length;
    if (bodyLen < 32) continue;

    if (fam === 'AUTH_BYPASS' && cid.includes('omit_auth')) {
      out.push({
        checkerId: 'function_level_authz',
        severity: 'high',
        title: 'Sensitive path reachable without Authorization (omit_auth probe)',
        detail: `${String(r.method || 'GET')} ${path} returned ${st} with body (${bodyLen} chars) — verify role checks on privileged routes.`,
        evidenceCaseIds: [r.caseId],
        caseId: r.caseId,
        url: r.url,
      });
      continue;
    }

    if (fam === 'NAMESPACE_AUTH_REPLAY' && cid.endsWith(':authAlt')) {
      out.push({
        checkerId: 'function_level_authz',
        severity: 'medium',
        title: 'Sensitive path returned 200 under alternate principal',
        detail: `Alternate Authorization reached ${path} (${st}) — verify intended cross-principal access for admin/internal surfaces.`,
        evidenceCaseIds: [r.caseId],
        caseId: r.caseId,
        url: r.url,
      });
    }
  }

  return dedupeCheckerRows(out, 'function_level_authz');
}

/**
 * Shadow / inventory / legacy-version URLs that returned 200 with non-trivial JSON-like bodies.
 * API9:2023 — exposure of undocumented or auxiliary surfaces.
 *
 * @param {unknown[]} execResults
 */
export function checkShadowEndpointExposure(execResults) {
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const raw of execResults) {
    const r = row(raw);
    if (String(r.method || '').toUpperCase() !== 'GET') continue;
    if (Number(r.status) !== 200) continue;

    const path = pathnameOnly(String(r.url || ''));
    if (!path) continue;

    const prev = String(r.bodyPreview || '').trim();
    if (prev.length < 24) continue;

    const looksJson = prev.startsWith('{') || prev.startsWith('[');
    if (!looksJson) continue;

    const kind = classifyShadowPath(path);
    if (!kind) continue;

    out.push({
      checkerId: 'shadow_endpoint',
      severity: kind === 'inventory_or_docs_surface' ? 'medium' : 'low',
      title:
        kind === 'inventory_or_docs_surface'
          ? 'Possible shadow or management endpoint exposed'
          : 'Possible legacy or alternate API version path exposed',
      detail: `GET ${path} returned 200 with JSON-like body (${prev.length} chars) — confirm inventory / versioning posture.`,
      evidenceCaseIds: [r.caseId],
      caseId: r.caseId,
      url: r.url,
    });
  }

  return dedupeCheckerRows(out, 'shadow_endpoint');
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} checkerId
 */
function dedupeCheckerRows(rows, checkerId) {
  const seen = new Set();
  /** @type {typeof rows} */
  const out = [];
  for (const row of rows) {
    if (String(row.checkerId) !== checkerId) continue;
    const k = `${row.caseId}|${row.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

export function runInvariantCheckers(execResults) {
  return [
    ...checkLeakAfterFailedCreate(execResults),
    ...checkDeleteStillReadable(execResults),
    ...checkBrokenCollectionListSibling(execResults),
    ...checkResourceHierarchyCrossParent(execResults),
    ...checkNestedResourceHierarchyCrossParent(execResults),
    ...checkNamespacePrincipalOverlap(execResults),
    ...checkMassAssignmentReflection(execResults),
    ...checkFunctionLevelAuthWeakness(execResults),
    ...checkShadowEndpointExposure(execResults),
  ];
}

