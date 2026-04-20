/**
 * test-milestone-g.mjs — Milestone G: feedback loops (offline, no network)
 *
 * Covers:
 *  - extractIdsFromBody: collections, single resources, UUID regex, non-JSON
 *  - harvestIdsFromResults: 2xx-only filtering, cap enforcement, dedup
 *  - prioritizeCases: campaign-memory rank ordering, route novelty ordering, stable sort
 */

import assert from 'assert/strict';
import { extractIdsFromBody, harvestIdsFromResults } from '../src/feedback/idHarvest.js';
import { prioritizeCases } from '../src/feedback/casePrioritizer.js';

// ── extractIdsFromBody ────────────────────────────────────────────────────────

{
  // Collection response — extract IDs from first items
  const body = JSON.stringify([{ id: 5, title: 'Alpha' }, { id: 12, title: 'Beta' }]);
  const ids = extractIdsFromBody(body);
  assert.ok(ids.includes('5'), 'Should extract id 5 from collection array');
  assert.ok(ids.includes('12'), 'Should extract id 12 from collection array');
}

{
  // Single resource response
  const body = JSON.stringify({ id: 42, name: 'thing', status: 'active' });
  const ids = extractIdsFromBody(body);
  assert.ok(ids.includes('42'), 'Should extract id 42 from single resource');
}

{
  // Non-standard id key (userId, postId, etc.)
  const body = JSON.stringify({ userId: 99, email: 'x@example.com' });
  const ids = extractIdsFromBody(body);
  assert.ok(ids.includes('99'), 'Should extract userId as id-like value');
}

{
  // UUID extraction via regex
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  const body = JSON.stringify({ resourceId: uuid, name: 'item' });
  const ids = extractIdsFromBody(body);
  assert.ok(
    ids.some((id) => id.toLowerCase() === uuid.toLowerCase()),
    'Should extract UUID from body'
  );
}

{
  // UUID in nested object (one level deep)
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const body = JSON.stringify({ data: { id: uuid }, meta: {} });
  const ids = extractIdsFromBody(body);
  assert.ok(
    ids.some((id) => id.toLowerCase() === uuid.toLowerCase()),
    'Should extract UUID from nested object one level deep'
  );
}

{
  // Non-JSON body returns empty
  const ids = extractIdsFromBody('<html><body>Not JSON</body></html>');
  assert.equal(ids.length, 0, 'Non-JSON body should yield no IDs');
}

{
  // Empty / null-ish inputs
  assert.deepEqual(extractIdsFromBody(''), [], 'Empty string yields empty array');
  assert.deepEqual(extractIdsFromBody('{}'), [], 'Empty object yields empty array');
  assert.deepEqual(extractIdsFromBody('[]'), [], 'Empty array yields empty array');
}

{
  // Large collection — only scan first 32 items
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, v: 'x' }));
  const body = JSON.stringify(items);
  const ids = extractIdsFromBody(body);
  // Should have IDs 1–32 at most
  assert.ok(ids.length <= 32, `Should not exceed 32 IDs from array, got ${ids.length}`);
}

// ── harvestIdsFromResults ─────────────────────────────────────────────────────

{
  // 2xx-only filtering
  const results = [
    { status: 200, bodyPreview: JSON.stringify([{ id: 1 }, { id: 2 }]), method: 'GET', url: '/posts' },
    { status: 201, bodyPreview: JSON.stringify({ id: 3, title: 'new' }), method: 'POST', url: '/posts' },
    { status: 404, bodyPreview: JSON.stringify({ id: 99 }), method: 'GET', url: '/posts/99' },
    { status: 400, bodyPreview: JSON.stringify({ id: 100 }), method: 'POST', url: '/posts' },
    { error: 'timeout', bodyPreview: '', method: 'GET', url: '/posts/x' },
  ];
  const ids = harvestIdsFromResults(results);
  assert.ok(ids.includes('1'), 'Should harvest id 1 from 200 collection');
  assert.ok(ids.includes('2'), 'Should harvest id 2 from 200 collection');
  assert.ok(ids.includes('3'), 'Should harvest id 3 from 201 POST response');
  assert.ok(!ids.includes('99'), 'Should NOT harvest from 404 response');
  assert.ok(!ids.includes('100'), 'Should NOT harvest from 400 response');
}

{
  // Cap enforcement
  const results = [];
  for (let i = 0; i < 200; i++) {
    results.push({
      status: 200,
      bodyPreview: JSON.stringify([{ id: i + 1000 }]),
      method: 'GET',
      url: '/items',
    });
  }
  const ids = harvestIdsFromResults(results, { maxIds: 10 });
  assert.ok(ids.length <= 10, `maxIds cap should be honoured, got ${ids.length}`);
}

{
  // Deduplication: same ID from multiple responses counted once
  const results = [
    { status: 200, bodyPreview: JSON.stringify({ id: 7 }), method: 'GET', url: '/a' },
    { status: 200, bodyPreview: JSON.stringify({ id: 7 }), method: 'GET', url: '/b' },
    { status: 200, bodyPreview: JSON.stringify({ id: 7 }), method: 'GET', url: '/c' },
  ];
  const ids = harvestIdsFromResults(results);
  assert.equal(ids.filter((x) => x === '7').length, 1, 'Duplicate IDs should be deduped');
}

{
  // Empty results returns empty array
  const ids = harvestIdsFromResults([]);
  assert.deepEqual(ids, [], 'Empty results should yield empty array');
}

// ── prioritizeCases ───────────────────────────────────────────────────────────

const makeCases = (specs) =>
  specs.map(([id, method, path]) => ({
    id,
    method,
    url: `https://api.example.com${path}`,
    family: 'OPENAPI_BASELINE',
    headers: {},
  }));

{
  // Campaign-memory ranked routes come first
  const cases = makeCases([
    ['c-posts', 'GET', '/posts'],
    ['c-users', 'GET', '/users'],
    ['c-comments', 'GET', '/comments'],
  ]);
  // /users and /comments ranked high in campaign memory (index 0 and 1)
  const result = prioritizeCases(cases, {
    rankedRouteKeys: ['GET:/users', 'GET:/comments'],
  });
  assert.equal(result[0].id, 'c-users', 'Rank-0 /users should be first');
  assert.equal(result[1].id, 'c-comments', 'Rank-1 /comments should be second');
  assert.equal(result[2].id, 'c-posts', 'Unranked /posts should be last');
}

{
  // Route novelty: unseen routes come before seen routes
  const cases = makeCases([
    ['c-posts', 'GET', '/posts'],
    ['c-users', 'GET', '/users'],
  ]);
  const seenRouteKeys = new Set(['GET:/posts']); // /posts already visited this run
  const result = prioritizeCases(cases, { seenRouteKeys });
  assert.equal(result[0].id, 'c-users', 'Unseen /users should come before seen /posts');
  assert.equal(result[1].id, 'c-posts', 'Seen /posts should come last');
}

{
  // Campaign rank beats novelty signal
  const cases = makeCases([
    ['c-seen-ranked', 'GET', '/admin'],    // seen this run, but ranked high
    ['c-unseen-unranked', 'GET', '/misc'], // unseen, but not in campaign memory
  ]);
  const seenRouteKeys = new Set(['GET:/admin']);
  const rankedRouteKeys = ['GET:/admin']; // /admin is ranked highest despite being seen
  const result = prioritizeCases(cases, { rankedRouteKeys, seenRouteKeys });
  assert.equal(result[0].id, 'c-seen-ranked', 'Campaign rank should beat novelty signal');
}

{
  // No opts — original order preserved
  const cases = makeCases([['c1', 'GET', '/a'], ['c2', 'GET', '/b'], ['c3', 'GET', '/c']]);
  const result = prioritizeCases(cases, {});
  assert.deepEqual(
    result.map((c) => c.id),
    ['c1', 'c2', 'c3'],
    'Empty opts should preserve original order'
  );
}

{
  // Empty cases returns empty array
  const result = prioritizeCases([], { rankedRouteKeys: ['GET:/posts'] });
  assert.deepEqual(result, [], 'Empty cases should return empty array');
}

{
  // Stable sort: equal-priority cases keep original relative order
  const cases = makeCases([
    ['c1', 'GET', '/x'],
    ['c2', 'GET', '/y'],
    ['c3', 'GET', '/z'],
  ]);
  // All unranked, none seen — should stay in original order
  const result = prioritizeCases(cases, {
    rankedRouteKeys: [],
    seenRouteKeys: new Set(),
  });
  assert.deepEqual(
    result.map((c) => c.id),
    ['c1', 'c2', 'c3'],
    'Equal-priority cases should preserve insertion order (stable sort)'
  );
}

{
  // Campaign memory with multiple routes at same priority resolved by original order
  const cases = makeCases([
    ['c-a', 'GET', '/alpha'],
    ['c-b', 'GET', '/beta'],
  ]);
  const rankedRouteKeys = ['GET:/alpha', 'GET:/beta']; // both ranked, /alpha higher
  const result = prioritizeCases(cases, { rankedRouteKeys });
  assert.equal(result[0].id, 'c-a', '/alpha (rank 0) should beat /beta (rank 1)');
}

console.log('milestone G feedback loops ok');
