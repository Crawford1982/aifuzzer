#!/usr/bin/env node
/**
 * Offline: YAML + JSON OpenAPI load + normalize.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { strict as assert } from 'node:assert';
import { loadOpenApi } from '../src/openapi/OpenApiLoader.js';

const root = path.dirname(fileURLToPath(import.meta.url));

const jsonSpec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.json'));
assert.equal(jsonSpec.operations.length >= 1, true);

const yamlSpec = loadOpenApi(path.join(root, '../fixtures/minimal-posts.openapi.yaml'));
assert.equal(yamlSpec.operations.length >= 1, true);

const refSpec = loadOpenApi(path.join(root, '../fixtures/refs-parameters.openapi.yaml'));
const getWidget = refSpec.operations.find((o) => o.operationId === 'getWidget');
assert.ok(getWidget?.pathParamNames.includes('id'), '$ref parameter should resolve to path param id');

console.log('openapi load (json+yaml): ok');
