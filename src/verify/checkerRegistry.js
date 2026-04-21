/**
 * Mythos checker registry — RESTler-style metadata without copying their implementation.
 * LLMs never interpret these; orchestration maps fired checkers here for reporting only.
 */

/**
 * @typedef {{
 *   checkerId: string,
 *   title: string,
 *   precondition: string,
 *   owaspMapping: string[],
 *   bountyTierHint: 'low' | 'medium' | 'high',
 * }} CheckerDefinition
 */

/** @type {CheckerDefinition[]} */
export const MYTHOS_CHECKERS = [
  {
    checkerId: 'leak_after_failed_create',
    title: 'Possible create/list leakage after failed mutating request',
    precondition:
      'A POST/PUT/PATCH returned 4xx (failed create/update), then a collection GET returned 200 with a JSON array body.',
    owaspMapping: ['API8:2023', 'API10:2023'],
    bountyTierHint: 'medium',
  },
  {
    checkerId: 'delete_still_readable',
    title: 'Resource still readable after successful DELETE',
    precondition:
      'DELETE returned success (2xx), then GET to the same resource path returned 2xx with a body.',
    owaspMapping: ['API8:2023'],
    bountyTierHint: 'medium',
  },
  {
    checkerId: 'broken_collection_list_path',
    title: 'Bare collection route errors while sibling …/all list succeeds',
    precondition:
      'Two GET requests share the same logical collection (same path with one using an `/all` list suffix); one returned 5xx and the other 200.',
    owaspMapping: ['API8:2023'],
    bountyTierHint: 'low',
  },
  {
    checkerId: 'resource_hierarchy_cross_parent',
    title: 'Same response body across different parent contexts (possible BOLA)',
    precondition:
      'Two GETs to the same route shape (normalized path template) with different parent IDs both returned 200 with identical normalized body fingerprints.',
    owaspMapping: ['API1:2023'],
    bountyTierHint: 'high',
  },
  {
    checkerId: 'nested_resource_hierarchy_cross_parent',
    title: 'Nested route: identical bodies across different parents (possible BOLA)',
    precondition:
      'Same as hierarchy cross-parent, but the path template has two or more dynamic `{id}`/`{uuid}` segments (nested resource shape).',
    owaspMapping: ['API1:2023'],
    bountyTierHint: 'high',
  },
  {
    checkerId: 'namespace_cross_principal_overlap',
    title: 'Same resource body for primary vs alternate Authorization',
    precondition:
      '--auth and --auth-alt set; replayed GETs with alternate token returned 200 with the same body fingerprint as the primary run (possible cross-tenant access).',
    owaspMapping: ['API1:2023', 'API5:2023'],
    bountyTierHint: 'high',
  },
];

const BY_ID = new Map(MYTHOS_CHECKERS.map((c) => [c.checkerId, c]));

/**
 * @param {string} id
 */
export function getCheckerDefinition(id) {
  return BY_ID.get(id);
}

/** @returns {Record<string, CheckerDefinition>} */
export function checkerRegistryExport() {
  return Object.fromEntries(BY_ID);
}
