import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildArtifactIndex, NATIVE_STATE_ROOTS } from '../artifacts/index.mjs';
import { assertRegistrableArtifactPath } from '../artifacts/paths.mjs';

const put = (root, relative, value) => {
  const target = join(root, relative); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, value);
};

const snapshot = runtime => ({ project_id: `project:${runtime}`, runtime, revision: 1,
  plans: [], items: [], artifacts: [], research: [], observations: [] });

test('artifact indexing selects exactly the snapshot runtime and never returns a foreign native canary', async t => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-runtime-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, '.lazytrae/runs/trae-run/state.json', JSON.stringify({ run_id: 'trae-run', tasks: [{ id: 'T1',
    evidence: ['evidence/trae.txt'] }] }));
  put(root, '.lazytrae/runs/trae-run/evidence/trae.txt', 'TRAE_SAFE_CANARY');
  put(root, '.lazybuddy/runs/buddy-run/state.json', JSON.stringify({ run_id: 'buddy-run', tasks: [{ id: 'T2',
    evidence: ['evidence/buddy.txt'] }] }));
  put(root, '.lazybuddy/runs/buddy-run/evidence/buddy.txt', 'BUDDY_FOREIGN_SECRET_CANARY');

  const index = await buildArtifactIndex(root, { snapshot: snapshot('LazyTrae') });
  assert.equal(index.native_state_root, '.lazytrae');
  assert.equal(index.scan.history_status, 'unavailable');
  assert.equal(index.scan.history_reason, 'TRAE_LOOP_HISTORY_NOT_INDEXED');
  assert.deepEqual(index.entries.map(entry => entry.path), ['.lazytrae/runs/trae-run/evidence/trae.txt']);
  assert.equal(JSON.stringify(index).includes('BUDDY_FOREIGN_SECRET_CANARY'), false);

  const foreign = snapshot('LazyTrae');
  foreign.artifacts.push({ id: 'artifact:foreign', type: 'log', producer: 'fixture',
    path: '.lazybuddy/runs/buddy-run/evidence/buddy.txt', sha256: 'a'.repeat(64),
    registered_by: 'fixture', registered_at: '2026-10-10T00:00:00.000Z' });
  await assert.rejects(() => buildArtifactIndex(root, { snapshot: foreign }), error => error.code === 'FOREIGN_NATIVE_ARTIFACT_PATH');
});

test('every family dashboard and project store remains protected from artifact registration', () => {
  for (const nativeRoot of Object.values(NATIVE_STATE_ROOTS)) {
    for (const relative of [`${nativeRoot}/dashboard/credential`, `${nativeRoot}/project/state.json`]) {
      assert.throws(() => assertRegistrableArtifactPath(relative), error => error.code === 'PROTECTED_SOURCE_PATH');
    }
  }
});
