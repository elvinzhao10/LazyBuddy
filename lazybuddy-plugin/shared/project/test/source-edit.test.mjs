import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, write, sha256, suiteRoot } from '../qa/helpers.mjs';
import { fenceSpans } from '../source-edit/markdown.mjs';

// T05 interface under test: transactional AST editing of registered original
// Markdown through the shared command route and the native bridge seam. The
// hard regression case is fenced-example safety — an edit to one checklist
// item leaves fenced examples and unrelated prose byte-identical.
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const PROJECT_ID = 'project:source-edit';
const ACTOR = 'local:source-edit-test';
const PLAN_RELATIVE = '.omo/plans/release.md';

const PLAN = `# Release plan

Intro prose that must survive edits untouched.

## Requirements coverage — offline

The plan keeps working without a network; this section backs one baseline item.

## Tasks

- [ ] First task
- [ ] Second task owner=z status=open
- [ ] Third task

## Verification gates

- [x] Existing check

\`\`\`bash
# Fenced example: must stay byte-identical through every edit
- [ ] fake checklist item inside the fence
## Not a real heading
lazybuddy verify --strict
\`\`\`

\`\`\`python
print("second fenced example")
\`\`\`

Closing prose.
`;

const CRLF_PLAN = ['# Windows plan', '', 'Keeps CRLF line endings everywhere.', '', '## Tasks', '',
  '- [ ] Alpha task', '- [x] Beta task', '', '## Notes', '', '```yaml',
  'key: value', '- [ ] fake fenced item', '```', '', 'End.', ''].join('\r\n');

const MATERIAL_EXTERNAL = PLAN.replace('Closing prose.', 'Closing prose, externally rewritten with new meaning.');

function invoke(root, action, payload, options = {}) {
  const arguments_ = [CLI, action, '--project-root', root, '--project-id', options.projectId ?? PROJECT_ID, '--actor', ACTOR];
  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload),
    timeout: 25000, maxBuffer: 12 * 1024 * 1024, env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}

function command(root, id, operation, payload, expectedRevision = stateOf(root).revision) {
  return { schema_version: 1, command_id: id, project_id: PROJECT_ID,
    expected_revision: expectedRevision, operation, payload };
}

function stateOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'), 'utf8'));
}

function stateBytes(root) {
  return fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'));
}

function sourceMap(root) {
  const result = invoke(root, 'command', command(root, 'map:probe', 'source.map', { source_id: 'source:plan' }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.result.status, 'ok');
  return result.json.result;
}

function anchorFor(root, title) {
  const entry = sourceMap(root).anchors.find(candidate => candidate.title === title);
  assert.ok(entry, `expected a mapped anchor for ${title}`);
  return entry.anchor_id;
}

function setupProject(name, planText = PLAN, planRelative = PLAN_RELATIVE) {
  const root = fixture(name);
  const planPath = write(root, planRelative, planText);
  const init = invoke(root, 'init');
  assert.equal(init.status, 0, init.stderr);
  const digest = sha256(fs.readFileSync(planPath));
  const registered = invoke(root, 'command', command(root, 'cmd:register-source', 'register_source',
    { id: 'source:plan', path: planRelative, role: 'plan' }, 0));
  assert.equal(registered.json.receipt.status, 'saved', registered.stdout);
  const planned = invoke(root, 'command', command(root, 'cmd:register-plan', 'register_plan', {
    id: 'plan:release', source: { source_id: 'source:plan', sha256: digest, anchor_id: 'document' },
    declared_lifecycle: 'planned', baseline_refs: [] }));
  assert.equal(planned.json.receipt.status, 'saved', planned.stdout);
  return { root, planPath, digest };
}

const faultEnvironment = (root, fault) => ({
  PYTHONPATH: fileURLToPath(new URL('../qa/fault-hooks/', import.meta.url)),
  PROJECT_REVIEW_SUITE_ROOT: suiteRoot,
  PROJECT_REVIEW_ROOT: root,
  PROJECT_REVIEW_FAULT: fault,
});

const fencesOf = text => JSON.stringify(fenceSpans(text).map(span => span.text));

test('a registered plan edited through the CLI command route updates the real file', () => {
  const { root, planPath } = setupProject('end-to-end');
  const before = fs.readFileSync(planPath, 'utf8');
  const tasks = anchorFor(root, 'Tasks');
  const edit = command(root, 'edit:check-second', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(before),
    expected_source_revision: 1,
    edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] });

  const applied = invoke(root, 'command', edit);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.json.receipt.status, 'saved');
  assert.deepEqual(applied.json.receipt.changed_ids, ['source:plan', 'plan:release']);

  // The native bridge seam updated the actual registered original plan file.
  const after = fs.readFileSync(planPath, 'utf8');
  const restored = after.replace('- [x] Second task owner=z status=open', '- [ ] Second task owner=z status=open');
  assert.equal(restored, before, 'Only the targeted checklist line may change');
  assert.equal(fencesOf(before), fencesOf(after), 'Fenced examples must stay byte-identical');

  const stored = stateOf(root);
  assert.equal(stored.sources[0].accepted_sha256, sha256(fs.readFileSync(planPath)));
  assert.equal(stored.sources[0].revision, 2);
  const plan = stored.plans.find(entry => entry.id === 'plan:release');
  assert.equal(plan.revision, 2, 'An edited plan source bumps the plan semantic revision');
  assert.equal(plan.source.sha256, stored.sources[0].accepted_sha256);
  const read = invoke(root, 'read');
  assert.equal(read.json.sources[0].observation.status, 'current');
  assert.deepEqual(fs.readdirSync(path.join(root, '.omo/plans')), ['release.md'],
    'No temporary write artifacts remain next to the original document');
  assert.equal(fs.readdirSync(path.join(root, '.lazybuddy/project/edit-journal')).length, 0,
    'A completed transaction leaves no journal entry');

  // Idempotent replay: same command id and body returns the original receipt,
  // rewrites nothing, and does not advance the revision.
  const replay = invoke(root, 'command', edit);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(replay.json.receipt, applied.json.receipt);
  assert.equal(stateOf(root).revision, stored.revision);
  assert.equal(fs.readFileSync(planPath, 'utf8'), after);
  const replayedState = stateOf(root);
  assert.equal(replayedState.receipts.length, replayedState.revision);
});

test('preview is inert and reports the actual patch and affected records', () => {
  const { root, planPath } = setupProject('preview');
  const item = invoke(root, 'command', command(root, 'cmd:baseline', 'record_baseline_items', {
    items: [{ id: 'requirement:offline-plan', kind: 'requirement', state: 'accepted',
      source: { source_id: 'source:plan', sha256: sha256(fs.readFileSync(planPath)),
        anchor_id: 'heading:Requirements coverage — offline' } }] }));
  assert.equal(item.json.receipt.status, 'saved', item.stdout);
  const other = invoke(root, 'command', command(root, 'cmd:other-plan', 'register_plan', {
    id: 'plan:other', source: { source_id: 'source:plan', sha256: sha256(fs.readFileSync(planPath)), anchor_id: 'document' },
    declared_lifecycle: 'planned',
    baseline_refs: [{ item_id: 'requirement:offline-plan', item_revision: 1 }] }));
  assert.equal(other.json.receipt.status, 'saved', other.stdout);

  const fileBefore = fs.readFileSync(planPath);
  const stateBefore = stateBytes(root);
  const tasks = anchorFor(root, 'Tasks');
  const preview = invoke(root, 'command', command(root, 'preview:check-second', 'source.edit.preview', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(fileBefore.toString('utf8')),
    expected_source_revision: 1,
    edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] }));
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.json.result.status, 'valid');
  assert.match(preview.json.result.patch_text, /- \[ \] Second task owner=z status=open/);
  assert.match(preview.json.result.patch_text, /\+- \[x\] Second task owner=z status=open/);
  const affected = preview.json.result.affected;
  assert.deepEqual(affected.plans.map(plan => plan.plan_id).sort(), ['plan:other', 'plan:release']);
  assert.deepEqual(affected.criteria.map(entry => entry.item_id), ['requirement:offline-plan']);
  assert.deepEqual(affected.dependencies, [{ plan_id: 'plan:other', item_ids: ['requirement:offline-plan'] }]);
  assert.deepEqual(affected.evidence, { artifact_ids: [], observation_ids: [] });
  assert.deepEqual(affected.sources, ['source:plan']);
  assert.equal(preview.json.result.authority, 'ui:plan-editor');
  assert.deepEqual(fs.readFileSync(planPath).compare(fileBefore), 0, 'A preview never writes the document');
  assert.deepEqual(stateBytes(root).compare(stateBefore), 0, 'A preview never mutates accepted state');

  const stale = invoke(root, 'command', command(root, 'preview:stale', 'source.edit.preview',
    { authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(fileBefore.toString('utf8')),
      expected_source_revision: 1, edits: [] }, stateOf(root).revision - 1));
  assert.equal(stale.json.result.status, 'conflict');
  assert.equal(stale.json.result.reason, 'REVISION_CONFLICT');
});

test('stale expected revisions conflict without touching the file', () => {
  const { root, planPath } = setupProject('stale-revision');
  const tasks = anchorFor(root, 'Tasks');
  const first = invoke(root, 'command', command(root, 'edit:one', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(fs.readFileSync(planPath, 'utf8')),
    expected_source_revision: 1, edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 0, state: 'checked' }] }));
  assert.equal(first.json.receipt.status, 'saved', first.stdout);
  const afterFirst = fs.readFileSync(planPath, 'utf8');
  const stateAfterFirst = stateBytes(root);

  // A stale aggregate revision returns a conflict receipt, never a write.
  const staleProject = invoke(root, 'command', command(root, 'edit:stale-project', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(afterFirst),
    expected_source_revision: 2, edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] },
    stateOf(root).revision - 1));
  assert.equal(staleProject.status, 0, staleProject.stderr);
  assert.equal(staleProject.json.receipt.status, 'conflict');
  assert.equal(staleProject.json.receipt.reason, 'REVISION_CONFLICT');
  assert.equal(fs.readFileSync(planPath, 'utf8'), afterFirst);
  assert.deepEqual(stateBytes(root).compare(stateAfterFirst), 0);

  // A stale source semantic revision is a typed refusal.
  const staleSource = invoke(root, 'command', command(root, 'edit:stale-source', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(afterFirst),
    expected_source_revision: 1, edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] }));
  assert.notEqual(staleSource.status, 0);
  assert.match(staleSource.stderr, /^SOURCE_REVISION_CONFLICT\n$/);
  assert.equal(fs.readFileSync(planPath, 'utf8'), afterFirst);
  assert.deepEqual(stateBytes(root).compare(stateAfterFirst), 0);
});

test('a material external edit is a typed conflict and stays a visible working change', () => {
  const { root, planPath } = setupProject('external-material');
  const stateBefore = stateBytes(root);
  fs.writeFileSync(planPath, MATERIAL_EXTERNAL);
  const tasks = anchorFor(root, 'Tasks');
  const refused = invoke(root, 'command', command(root, 'edit:over-old-revision', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(PLAN),
    expected_source_revision: 1, edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] }));
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /^SOURCE_CHANGED\n$/);
  assert.equal(fs.readFileSync(planPath, 'utf8'), MATERIAL_EXTERNAL, 'The external edit is never overwritten');
  assert.deepEqual(stateBytes(root).compare(stateBefore), 0);
  const observed = invoke(root, 'read');
  assert.equal(observed.json.sources[0].observation.status, 'changed',
    'A material external edit stays a visible working change');
});

test('formatting-only external changes are adoptable; material adoption is refused', () => {
  const { root, planPath } = setupProject('adopt-formatting');
  const reformatted = PLAN.replace('Intro prose that must survive edits untouched.',
    'Intro prose that must\nsurvive edits untouched.');
  fs.writeFileSync(planPath, reformatted);
  const adopt = invoke(root, 'command', command(root, 'adopt:formatting', 'source.adopt',
    { authority: 'ui:plan-editor', source_id: 'source:plan' }));
  assert.equal(adopt.status, 0, adopt.stderr);
  assert.equal(adopt.json.receipt.status, 'saved');
  assert.equal(stateOf(root).sources[0].accepted_sha256, sha256(fs.readFileSync(planPath)));
  const after = invoke(root, 'read');
  assert.equal(after.json.sources[0].observation.status, 'current');
  assert.deepEqual(after.json.plans.find(plan => plan.id === 'plan:release').baseline_reference_status, 'unassessed');

  fs.writeFileSync(planPath, MATERIAL_EXTERNAL);
  const refused = invoke(root, 'command', command(root, 'adopt:material', 'source.adopt',
    { authority: 'ui:plan-editor', source_id: 'source:plan' }));
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /^MATERIAL_EXTERNAL_EDIT\n$/);
  assert.equal(fs.readFileSync(planPath, 'utf8'), MATERIAL_EXTERNAL);
  const observed = invoke(root, 'read');
  assert.equal(observed.json.sources[0].observation.status, 'changed');
});

test('crash mid-transaction never overwrites a newer external edit', () => {
  const scenarios = [
    { phase: 'before_state_publish', external: true },
    { phase: 'after_state_publish', external: true },
    { phase: 'before_state_publish', external: false },
  ];
  for (const { phase, external } of scenarios) {
    const { root, planPath } = setupProject(`crash-${phase}-${external ? 'foreign' : 'rollforward'}`);
    const before = fs.readFileSync(planPath, 'utf8');
    const revisionBefore = stateOf(root).revision;
    const tasks = anchorFor(root, 'Tasks');
    const edit = command(root, 'edit:crash', 'source.edit', {
      authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(before),
      expected_source_revision: 1,
      edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 1, state: 'checked' }] });

    const crashed = invoke(root, 'command', edit, { env: faultEnvironment(root, phase) });
    assert.notEqual(crashed.status, 0, 'The injected fault must interrupt the command');
    const journal = path.join(root, '.lazybuddy/project/edit-journal');
    assert.ok(fs.existsSync(journal), 'The interrupted transaction leaves its journal intent');

    if (external) fs.writeFileSync(planPath, MATERIAL_EXTERNAL);
    const recovered = invoke(root, 'read');
    assert.equal(recovered.status, 0, recovered.stderr);

    if (external) {
      assert.equal(fs.readFileSync(planPath, 'utf8'), MATERIAL_EXTERNAL,
        'Recovery must preserve the newer external edit byte-for-byte');
      const exposed = recovered.json.sources[0].observation.status;
      const revision = stateOf(root).revision;
      if (phase === 'before_state_publish') {
        assert.equal(revision, revisionBefore, 'Aborted recovery keeps the previous accepted revision');
        assert.equal(exposed, 'changed');
      } else {
        assert.equal(revision, revisionBefore + 1, 'A published state revision stays complete');
        assert.equal(exposed, 'changed', 'The external edit remains a visible working change');
      }
    } else {
      // No external edit: recovery completes the journaled transaction.
      const expected = before.replace('- [ ] Second task owner=z status=open', '- [x] Second task owner=z status=open');
      assert.equal(fs.readFileSync(planPath, 'utf8'), expected);
      assert.equal(stateOf(root).revision, revisionBefore + 1);
      assert.equal(recovered.json.sources[0].observation.status, 'current');
    }
    assert.equal(fs.readdirSync(journal).length, 0, 'Recovery resolves the pending journal entry');
  }
});

test('moved and renamed headings keep their anchor identities; copies get new ids', () => {
  const { root, planPath } = setupProject('stable-anchors');
  const before = sourceMap(root);
  const identities = new Map(before.anchors.map(entry => [entry.title, entry.anchor_id]));
  const gates = identities.get('Verification gates');
  const tasks = identities.get('Tasks');

  const edited = invoke(root, 'command', command(root, 'edit:restructure', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(fs.readFileSync(planPath, 'utf8')),
    expected_source_revision: 1,
    edits: [{ kind: 'move_section', anchor_id: gates, before_anchor_id: tasks },
      { kind: 'rename_heading', anchor_id: gates, title: 'Verification gates v2' }] }));
  assert.equal(edited.status, 0, edited.stderr);
  assert.equal(edited.json.receipt.status, 'saved');

  const after = sourceMap(root);
  const moved = after.anchors.find(entry => entry.title === 'Verification gates v2');
  assert.ok(moved, 'The renamed heading is still mapped');
  assert.equal(moved.anchor_id, gates, 'A moved and renamed heading keeps its stable anchor id');
  assert.deepEqual(moved.linked_plan_ids, ['plan:release']);
  assert.equal(after.anchors.find(entry => entry.title === 'Tasks').anchor_id, tasks);
  assert.equal(after.anchors.find(entry => entry.title === 'Release plan').anchor_id, identities.get('Release plan'));
  assert.ok(moved.line < after.anchors.find(entry => entry.title === 'Tasks').line,
    'The section actually moved above Tasks');
  assert.equal(after.observation, 'current');

  // A copy of the document under a new source identity receives fresh anchors.
  write(root, '.omo/plans/release-copy.md', fs.readFileSync(planPath, 'utf8'));
  const copied = invoke(root, 'command', command(root, 'cmd:register-copy', 'register_source',
    { id: 'source:copy', path: '.omo/plans/release-copy.md', role: 'plan' }));
  assert.equal(copied.json.receipt.status, 'saved', copied.stdout);
  const copyMap = invoke(root, 'command', command(root, 'map:copy', 'source.map', { source_id: 'source:copy' }));
  assert.equal(copyMap.json.result.status, 'ok');
  const originalIds = new Set(after.anchors.map(entry => entry.anchor_id));
  for (const entry of copyMap.json.result.anchors) {
    assert.equal(originalIds.has(entry.anchor_id), false, `A copy must not inherit the original anchor ${entry.anchor_id}`);
  }
  assert.equal(new Set(copyMap.json.result.anchors.map(entry => entry.anchor_id)).size,
    copyMap.json.result.anchors.length, 'Copy anchors stay unambiguous');
});

test('CRLF line endings survive edits byte-for-byte', () => {
  const { root, planPath } = setupProject('crlf', CRLF_PLAN);
  const before = fs.readFileSync(planPath, 'utf8');
  const tasks = anchorFor(root, 'Tasks');
  const edited = invoke(root, 'command', command(root, 'edit:crlf', 'source.edit', {
    authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(before),
    expected_source_revision: 1,
    edits: [{ kind: 'set_task_state', anchor_id: tasks, item: 0, state: 'checked' }] }));
  assert.equal(edited.status, 0, edited.stderr);
  assert.equal(edited.json.receipt.status, 'saved');
  const after = fs.readFileSync(planPath, 'utf8');
  assert.equal(after, before.replace('- [ ] Alpha task', '- [x] Alpha task'));
  assert.doesNotMatch(after, /[^\r]\n/, 'No bare LF may appear in a CRLF document');
  assert.equal(fencesOf(before), fencesOf(after));
});

test('malformed or hostile edit requests fail closed without side effects', () => {
  const { root, planPath } = setupProject('adversarial');
  const before = fs.readFileSync(planPath, 'utf8');
  const stateBefore = stateBytes(root);
  const tasks = anchorFor(root, 'Tasks');
  const documentHeading = anchorFor(root, 'Release plan');
  const attempts = [
    { kind: 'set_task_state', anchor_id: 'sa:999999', item: 0, state: 'checked' },
    { kind: 'set_task_state', anchor_id: tasks, item: 99, state: 'checked' },
    { kind: 'set_task_text', anchor_id: tasks, item: 0, text: 'injected\n- [x] forged line' },
    { kind: 'rename_heading', anchor_id: 'document', title: 'Nope' },
    { kind: 'move_section', anchor_id: documentHeading, before_anchor_id: tasks },
    { kind: 'set_task_state', anchor_id: 'document', item: 99, state: 'checked' },
  ];
  for (const [index, edits] of attempts.entries()) {
    const rejected = invoke(root, 'command', command(root, `edit:adversarial-${index}`, 'source.edit', {
      authority: 'ui:plan-editor', source_id: 'source:plan', expected_sha256: sha256(before),
      expected_source_revision: 1, edits: [edits] }));
    assert.notEqual(rejected.status, 0, `Attempt ${index} must be refused: ${edits.kind}`);
    assert.equal(rejected.stdout, '', 'A refused edit must not emit an accepted snapshot');
    assert.equal(fs.readFileSync(planPath, 'utf8'), before);
    assert.deepEqual(stateBytes(root).compare(stateBefore), 0);
  }
  // The fenced decoys never became addressable AST nodes.
  const map = sourceMap(root);
  assert.equal(map.anchors.some(entry => entry.title.includes('Not a real heading')), false);
  assert.equal(fencesOf(before), fencesOf(fs.readFileSync(planPath, 'utf8')));
});
