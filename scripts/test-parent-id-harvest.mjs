#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import {
  harvestParentIdsByCollection,
  pathHasDynamicSegment,
  collectionListPathKey,
  extractIdsFromCollectionRows,
} from '../src/feedback/parentIdHarvest.js';
import { collectionBaseForNestedOp } from '../src/hypothesis/SpecHypothesisEngine.js';

assert.equal(pathHasDynamicSegment('/posts'), false);
assert.equal(pathHasDynamicSegment('/posts/99'), true);

assert.equal(collectionListPathKey('/workshop/api/shop/orders/all'), '/workshop/api/shop/orders');

assert.equal(
  collectionBaseForNestedOp('/posts/{postId}/comments/{commentId}'),
  '/posts'
);

const ids = extractIdsFromCollectionRows('[{"id":3,"t":"x"},{"id":8}]', 8);
assert.ok(ids.includes('3') && ids.includes('8'));

const harvested = harvestParentIdsByCollection(
  [
    {
      method: 'GET',
      url: 'https://api.example/posts',
      status: 200,
      bodyPreview: '[{"id":2,"title":"a"},{"id":40,"title":"b"}]',
      family: 'X',
    },
    {
      method: 'GET',
      url: 'https://api.example/posts/2',
      status: 200,
      bodyPreview: '{"id":2}',
      family: 'X',
    },
  ],
  { maxIdsTotal: 32, maxPerKey: 16 }
);

assert.deepEqual(harvested['/posts'].sort(), ['2', '40']);

console.log('parent id harvest ok');
