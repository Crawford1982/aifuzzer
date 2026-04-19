#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { loadOpenApi } from '../src/openapi/OpenApiLoader.js';
import { inferProducerConsumerEdges } from '../src/state/dependencyGraph.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const spec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
const { edges } = inferProducerConsumerEdges(spec.operations);
assert.ok(edges.length >= 2, 'expected list→item and create→item edges toward getPost');

const listToItem = edges.find((e) => e.kind === 'list_to_item');
assert.ok(listToItem, 'expected list_to_item edge');

const postToItem = edges.find((e) => e.kind === 'post_to_item');
assert.ok(postToItem, 'expected post_to_item edge (POST /posts → GET /posts/{id})');

console.log('dependency graph:', edges.length, 'edges — ok');
