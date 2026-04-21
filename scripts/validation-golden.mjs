#!/usr/bin/env node
/**
 * Single entry point: full offline suite (`npm test`) — use before/after REST/triage changes.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(root, '..');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['test'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const code = r.status ?? 1;
if (code === 0) {
  console.log('\n[validation:golden] Offline suite passed — see docs/REST-LEVEL-UP-PLAN.md for roadmap.');
}
process.exit(code);
