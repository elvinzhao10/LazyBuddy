import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, write, sha256 } from '../../project/qa/helpers.mjs';
import { fenceSpans } from '../../project/source-edit/markdown.mjs';
import { assessPlanTransition } from '../../project/plans/lifecycle.mjs';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T15 define-then-run UI test: the project and plan editors over registered
// original documents, driven through the REAL shared command route (cli.mjs
// command action with the typed command JSON on stdin — the same seam the
// native bridge exposes). The view never writes files; every mutation below is
// a source.edit/amend_baseline/plan.transition command the route journal accepts.
const CLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PROJECT_ID = 'project:editor-ui';
const ACTOR = 'local:editor-ui-test';
const PLAN_RELATIVE = '.omo/plans/delivery.md';
const HISTORY_RELATIVE = '.omo/plans/history.md';

const PLAN = `# Delivery plan

Intro prose that must survive edits untouched.

## Requirement — Offline operation

- [ ] Work without a network

## Unassigned — Telemetry opt-in

- [ ] Telemetry stays opt-in

## Tasks

- [ ] Unrelated task

\`\`\`bash
# Fenced example: must stay byte-identical through every edit
- [ ] fake checklist item inside the fence
lazybuddy verify --strict
\`\`\`

Closing prose.
`;

const HISTORY = `# Historical delivery

An old completed plan whose execution stays closed.

## Scope

- [x] Delivered long ago
`;

const BEHAVIORAL_TEXT = 'Work without a network and queue syncs for reconnect';

// The spike view modules address `document` at call time; install the shim before import.
const dom = createMiniDom();
globalThis.document = dom.document;

const { createProjectEditor, parseMarkdownView, predictedInvalidations, sectionTasks, commandResultState, EDITOR_MODES } = await import('../ui/editor-views.mjs');

function invoke(root, action, payload) {
  const arguments_ = [CLI, action, '--project-root', root, '--project-id', PROJECT_ID, '--actor', ACTOR];
  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload),
    timeout: 25000, maxBuffer: 12 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}

function stateOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'), 'utf8'));
}

function commandOf(root, id, operation, payload) {
  return { schema_version: 1, command_id: id, project_id: PROJECT_ID,
    expected_revision: stateOf(root).revision, operation, payload };
}

function run(root, id, operation, payload) {
  return invoke(root, 'command', commandOf(root, id, operation, payload));
}

function setupProject(name) {
  const root = fixture(name);
  const planPath = write(root, PLAN_RELATIVE, PLAN);
  const historyPath = write(root, HISTORY_RELATIVE, HISTORY);
  const init = invoke(root, 'init');
  assert.equal(init.status, 0, init.stderr);
  const digest = sha256(PLAN);
  const historyDigest = sha256(HISTORY);
  const registered = run(root, 'cmd:register-source', 'register_source', { id: 'source:plan', path: PLAN_RELATIVE, role: 'plan' });
  assert.equal(registered.json.receipt.status, 'saved', registered.stdout);
  const historyRegistered = run(root, 'cmd:register-history-source', 'register_source', { id: 'source:history', path: HISTORY_RELATIVE, role: 'plan' });
  assert.equal(historyRegistered.json.receipt.status, 'saved', historyRegistered.stdout);
  const items = run(root, 'cmd:baseline', 'record_baseline_items', {
    items: [
      { id: 'requirement:offline', kind: 'requirement', state: 'accepted', strength: 'binding',
        source: { source_id: 'source:plan', sha256: digest, anchor_id: 'heading:Requirement — Offline operation' } },
      { id: 'requirement:telemetry', kind: 'requirement', state: 'accepted',
        source: { source_id: 'source:plan', sha256: digest, anchor_id: 'heading:Unassigned — Telemetry opt-in' } }] });
  assert.equal(items.json.receipt.status, 'saved', items.stdout);
  const planned = run(root, 'cmd:register-plan', 'register_plan', {
    id: 'plan:delivery', source: { source_id: 'source:plan', sha256: digest, anchor_id: 'document' },
    declared_lifecycle: 'planned', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
  assert.equal(planned.json.receipt.status, 'saved', planned.stdout);
  const completed = run(root, 'cmd:register-history-plan', 'register_plan', {
    id: 'plan:history', source: { source_id: 'source:history', sha256: historyDigest, anchor_id: 'document' },
    declared_lifecycle: 'completed', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] });
  assert.equal(completed.json.receipt.status, 'saved', completed.stdout);
  return { root, planPath, historyPath };
}

// Mounts the editor against the real CLI route; every command the view sends is
// recorded so tests can prove no execution operation was ever composed.
async function mountEditor(root) {
  const sentCommands = [];
  const snapshot = invoke(root, 'read').json;
  const editor = createProjectEditor({
    snapshot,
    assessTransition: assessPlanTransition,
    sendCommand: async command => {
      sentCommands.push(command);
      const result = invoke(root, 'command', command);
      if (result.status !== 0) throw { code: result.stderr.trim().split('\n').pop() };
      return result.json;
    },
    captureSource: async sourceId => {
      const source = stateOf(root).sources.find(entry => entry.id === sourceId);
      const content = fs.readFileSync(path.join(root, source.path), 'utf8');
      return { path: source.path, sha256: sha256(content), content };
    },
  });
  await editor.ready;
  return { editor, sentCommands };
}

const byTestid = (view, id) => view.element.querySelector(`[data-testid="${id}"]`);
const allTestid = (view, id) => view.element.querySelectorAll(`[data-testid="${id}"]`);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function settled(view) { await view.settled(); await settle(); }

function anchorOptionValue(view, labelPart) {
  for (const option of view.element.querySelectorAll('[data-testid="anchor-select"] option')) {
    if (option.textContent.includes(labelPart)) return option.value;
  }
  assert.fail(`no anchor option contains ${labelPart}`);
}
function setSelect(view, testid, value) {
  const control = byTestid(view, testid);
  control.value = value;
  control.dispatchEvent({ type: 'change' });
}
function setInput(view, testid, value) {
  const control = byTestid(view, testid);
  control.value = value;
  control.dispatchEvent({ type: 'input' });
}
async function draftCriterionEdit(view, text = BEHAVIORAL_TEXT, authority = 'user:ui-instruction') {
  setSelect(view, 'anchor-select', anchorOptionValue(view, 'Requirement — Offline operation'));
  setInput(view, 'edit-task-index', '0');
  setSelect(view, 'edit-kind', 'set_task_text');
  setInput(view, 'edit-text', text);
  setInput(view, 'edit-authority', authority);
  await settled(view);
}

test('the rendered view shows the registered original markdown with fences as code and tasks as checkable rows', async () => {
  const project = setupProject('rendered-original');
  const { editor } = await mountEditor(project.root);
  assert.equal(byTestid(editor, 'source-meta').textContent.includes(PLAN_RELATIVE), true);
  const rendered = byTestid(editor, 'editor-rendered');
  const heading = rendered.querySelector('.editor-heading');
  assert.equal(heading.textContent, 'Delivery plan');
  assert.equal(heading.dataset.level, '1');
  const fence = rendered.querySelector('pre');
  assert.equal(fence.textContent.includes('lazybuddy verify --strict'), true);
  assert.equal(fence.textContent.includes('fake checklist item inside the fence'), true);
  const tasks = rendered.querySelectorAll('.editor-task');
  assert.equal(tasks.length, 3, 'the three real checklist items render; the fenced one does not');
  const offline = [...tasks].find(row => row.textContent.includes('Work without a network'));
  assert.equal(offline.dataset.checked, 'false');
});

test('source.map through the command route lists anchors with their linked plans and criteria', async () => {
  const project = setupProject('anchor-map');
  const { editor, sentCommands } = await mountEditor(project.root);
  assert.ok(sentCommands.some(command => command.operation === 'source.map' && command.payload.source_id === 'source:plan'));
  const anchorValue = anchorOptionValue(editor, 'Requirement — Offline operation');
  setSelect(editor, 'anchor-select', anchorValue);
  await settled(editor);
  const tasks = allTestid(editor, 'anchor-task');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].textContent.includes('Work without a network'), true);
  const meta = byTestid(editor, 'anchor-meta');
  assert.equal(meta.textContent.includes('requirement:offline'), true, 'the anchor names its linked criterion');
  assert.equal(meta.textContent.includes('current'), true, 'the capture observation is surfaced');
});

test('source.edit.preview shows the actual unified patch, affected records and explicit authority and revision fields', async () => {
  const project = setupProject('preview-patch');
  const { editor } = await mountEditor(project.root);
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  const preview = byTestid(editor, 'edit-preview');
  assert.equal(preview.dataset.state, 'valid');
  const patch = byTestid(editor, 'edit-patch').textContent;
  assert.ok(patch.startsWith('--- '), 'the preview shows the real unified patch header');
  assert.equal(patch.includes('@@'), true);
  assert.equal(patch.includes('-- [ ] Work without a network'), true);
  assert.equal(patch.includes(`+- [ ] ${BEHAVIORAL_TEXT}`), true);
  const affected = byTestid(editor, 'edit-affected').textContent;
  assert.equal(affected.includes('plan:delivery'), true, 'affected plans are listed');
  assert.equal(affected.includes('requirement:offline'), true, 'affected criteria are listed');
  const expected = byTestid(editor, 'edit-expected').textContent;
  assert.equal(expected.includes('source revision 1'), true, 'the expected source revision is explicit');
  assert.equal(preview.textContent.includes('authority user:ui-instruction'), true, 'the authority reference is explicit');
});

test('source.edit through the route changes the real file, fenced bytes stay identical and the rendered view updates', async () => {
  const project = setupProject('apply-edit');
  const before = fs.readFileSync(project.planPath, 'utf8');
  const { editor, sentCommands } = await mountEditor(project.root);
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  byTestid(editor, 'edit-apply-button').click();
  await settled(editor);
  const status = byTestid(editor, 'editor-status');
  assert.equal(status.dataset.state, 'saved');
  assert.equal(status.textContent.includes('source.edit'), true);
  const after = fs.readFileSync(project.planPath, 'utf8');
  assert.equal(after, before.replace('- [ ] Work without a network', `- [ ] ${BEHAVIORAL_TEXT}`),
    'exactly the targeted checklist line changed, per T05 semantics');
  assert.equal(fenceSpans(before).map(span => span.text).join('\u0000'),
    fenceSpans(after).map(span => span.text).join('\u0000'), 'fenced examples stay byte-identical');
  assert.equal(byTestid(editor, 'editor-rendered').textContent.includes(BEHAVIORAL_TEXT), true,
    'the rendered original refreshes from the post-edit capture');
  const stored = stateOf(project.root);
  assert.equal(stored.revision, sentCommands.filter(command => command.operation === 'source.edit').length + 5,
    'five setup commands plus exactly one accepted edit');
});

test('a revision conflict surfaces the typed conflict receipt and never a saved state', async () => {
  const project = setupProject('conflict-receipt');
  const { editor } = await mountEditor(project.root);
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  // An accepted command lands between preview and apply: the composed
  // expected_revision is now stale and the route must say so honestly.
  const external = run(project.root, 'cmd:external-artifact', 'artifact.register',
    { id: 'artifact:external', type: 'design_note', producer: 'external', path: '.omo/plans/delivery.md', sha256: sha256(PLAN) });
  assert.equal(external.json.receipt.status, 'saved');
  const before = fs.readFileSync(project.planPath, 'utf8');
  byTestid(editor, 'edit-apply-button').click();
  await settled(editor);
  const status = byTestid(editor, 'editor-status');
  assert.equal(status.dataset.state, 'conflict');
  assert.equal(status.textContent.includes('REVISION_CONFLICT'), true);
  assert.equal(fs.readFileSync(project.planPath, 'utf8'), before, 'a conflicting apply changes nothing');
  assert.equal(byTestid(editor, 'edit-preview').dataset.state, 'stale', 'the preview is marked stale, not silently reused');
});

test('a typed route refusal surfaces the route code instead of a generic success', async () => {
  const project = setupProject('typed-refusal');
  const { editor } = await mountEditor(project.root);
  await draftCriterionEdit(editor);
  fs.writeFileSync(project.planPath, PLAN.replace('Closing prose.', 'Closing prose, externally rewritten with new meaning.'));
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  const status = byTestid(editor, 'editor-status');
  assert.equal(status.dataset.state, 'invalid', 'the route answers a materially changed source with a typed invalid result');
  assert.equal(status.textContent.includes('SOURCE_CHANGED'), true);
  const stored = stateOf(project.root);
  assert.equal(stored.revision, 5, 'a refused preview never mutated accepted state');
});

test('the transition editor lists legality reasons including NATIVE_RUN_REQUIRED and enables only legal transitions', async () => {
  const project = setupProject('transition-legality');
  const { editor } = await mountEditor(project.root);
  setSelect(editor, 'plan-select', 'plan:delivery');
  await settled(editor);
  assert.equal(allTestid(editor, 'transition-option').length, 6, 'every other lifecycle is offered with its legality');
  const byTo = to => editor.element.querySelector(`[data-testid="transition-option"][data-to="${to}"]`);
  assert.equal(byTo('active').querySelector('button').disabled, true);
  assert.equal([...byTo('active').querySelectorAll('[data-code]')].map(node => node.dataset.code).includes('NATIVE_RUN_REQUIRED'), true,
    'the missing native run is the displayed reason');
  assert.equal(byTo('completed').querySelector('button').disabled, true);
  assert.equal(byTo('completed').querySelector('[data-code]').dataset.code, 'INVALID_TRANSITION');
  assert.equal(byTo('superseded').querySelector('button').disabled, true);
  assert.equal(byTo('superseded').querySelector('[data-code]').dataset.code, 'MISSING_FIELD');
  assert.equal(byTo('abandoned').querySelector('button').disabled, true, 'retiring still needs its reason');
  setInput(editor, 'transition-reason', 'Roadmap changed');
  await settled(editor);
  assert.equal(byTo('abandoned').querySelector('button').disabled, false, 'with the reason recorded the transition becomes legal');
});

test('a legal plan transition through the route is saved and the lifecycle display updates', async () => {
  const project = setupProject('transition-apply');
  const { editor, sentCommands } = await mountEditor(project.root);
  setSelect(editor, 'plan-select', 'plan:delivery');
  setInput(editor, 'transition-reason', 'Roadmap changed');
  await settled(editor);
  editor.element.querySelector('[data-testid="transition-option"][data-to="abandoned"] button').click();
  await settled(editor);
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'saved');
  const transition = sentCommands.find(command => command.operation === 'plan.transition');
  assert.equal(transition.payload.plan_id, 'plan:delivery');
  assert.equal(byTestid(editor, 'plan-detail').textContent.includes('abandoned'), true);
  assert.equal(stateOf(project.root).plans.find(plan => plan.id === 'plan:delivery').declared_lifecycle, 'abandoned');
});

test('supersession legality requires the successor link and the route refuses illegal transitions with typed codes', async () => {
  const project = setupProject('transition-refusal');
  const { editor } = await mountEditor(project.root);
  setSelect(editor, 'plan-select', 'plan:delivery');
  setInput(editor, 'transition-reason', 'Replaced');
  await settled(editor);
  const superseded = editor.element.querySelector('[data-testid="transition-option"][data-to="superseded"]');
  assert.equal(superseded.querySelector('button').disabled, true, 'superseding without a successor stays illegal');
  assert.equal(superseded.querySelector('[data-code]').dataset.code, 'MISSING_FIELD');
  setSelect(editor, 'transition-successor', 'plan:history');
  await settled(editor);
  const reQueried = editor.element.querySelector('[data-testid="transition-option"][data-to="superseded"]');
  assert.equal(reQueried.querySelector('button').disabled, false);
  reQueried.querySelector('button').click();
  await settled(editor);
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'saved');
  const stored = stateOf(project.root);
  assert.equal(stored.plans.find(plan => plan.id === 'plan:delivery').supersession.successor_plan_id, 'plan:history');
  const refused = run(project.root, 'cmd:illegal-active', 'plan.transition', { plan_id: 'plan:history', to_lifecycle: 'active' });
  assert.notEqual(refused.status, 0, 'the route itself refuses the illegal transition');
  assert.equal(refused.stderr.trim(), 'INVALID_TRANSITION');
});

test('the baseline preview shows the exact patch, affected linked plans and predicted invalidation facts', async () => {
  const project = setupProject('baseline-preview');
  const { editor } = await mountEditor(project.root);
  setSelect(editor, 'item-select', 'requirement:offline');
  await settled(editor);
  setInput(editor, 'amend-text', BEHAVIORAL_TEXT);
  setInput(editor, 'amend-authority', 'user:baseline-owner');
  byTestid(editor, 'amend-preview-button').click();
  await settled(editor);
  const preview = byTestid(editor, 'amend-preview');
  assert.equal(preview.dataset.state, 'valid');
  assert.equal(byTestid(editor, 'amend-patch').textContent.includes(`+- [ ] ${BEHAVIORAL_TEXT}`), true);
  const invalidations = byTestid(editor, 'amend-invalidations').textContent;
  assert.equal(invalidations.includes('plan:delivery'), true, 'linked plans citing revision 1 are named');
  assert.equal(invalidations.includes('plan:history'), true, 'historical linked plans are named too');
  assert.equal(invalidations.includes('BEHAVIORAL_REQUIREMENT_CHANGE'), true);
  assert.equal(invalidations.includes('preview'), true, 'predicted facts are labeled as preview, not authoritative');
});

test('acceptance with recorded authority routes through amend authority, shows authoritative invalidations and never runs a plan', async () => {
  const project = setupProject('baseline-accept');
  const { editor, sentCommands } = await mountEditor(project.root);
  const baselineBefore = stateOf(project.root).baseline_revision;
  setSelect(editor, 'item-select', 'requirement:offline');
  setInput(editor, 'amend-text', BEHAVIORAL_TEXT);
  setInput(editor, 'amend-authority', 'user:instruction-2026-10-06');
  byTestid(editor, 'amend-preview-button').click();
  await settled(editor);
  byTestid(editor, 'amend-accept-button').click();
  await settled(editor);
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'saved');
  const amendment = sentCommands.find(command => command.operation === 'amend_baseline');
  assert.equal(amendment.payload.authority, 'user:instruction-2026-10-06');
  const invalidations = byTestid(editor, 'amend-invalidations').textContent;
  assert.equal(invalidations.includes('carried_forward: false'), true, 'authoritative invalidation facts come from the receipt');
  const stored = stateOf(project.root);
  assert.equal(stored.baseline_revision, baselineBefore + 1);
  assert.equal(stored.items.find(item => item.id === 'requirement:offline').revision, 2);
  assert.equal(fs.readFileSync(project.planPath, 'utf8').includes(BEHAVIORAL_TEXT), true, 'the amendment edited the real document');
  assert.deepEqual(stored.requests ?? [], [], 'baseline acceptance never records a run request');
  assert.equal(fs.existsSync(path.join(project.root, '.lazybuddy/runs')), false, 'no native run exists');
  assert.equal(sentCommands.every(command => !/^run\./.test(command.operation)), true, 'the view never composes execution operations');
});

test('acceptance without authority is refused with a typed code and zero baseline effect', async () => {
  const project = setupProject('baseline-no-authority');
  const { editor, sentCommands } = await mountEditor(project.root);
  setSelect(editor, 'item-select', 'requirement:offline');
  setInput(editor, 'amend-text', BEHAVIORAL_TEXT);
  setInput(editor, 'amend-authority', '');
  await settled(editor);
  assert.equal(byTestid(editor, 'amend-accept-button').disabled, true, 'acceptance stays locked without authority');
  byTestid(editor, 'amend-preview-button').click();
  await settled(editor);
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'refused');
  assert.equal(byTestid(editor, 'editor-status').textContent.includes('AUTHORITY_REQUIRED'), true);
  assert.equal(sentCommands.filter(command => command.operation === 'amend_baseline').length, 0,
    'the view refused locally and sent nothing');
  const before = fs.readFileSync(project.planPath, 'utf8');
  const baselineBefore = stateOf(project.root).baseline_revision;
  const mapProbe = invoke(project.root, 'command', commandOf(project.root, 'map:refusal-anchor', 'source.map', { source_id: 'source:plan' }));
  const anchor = mapProbe.json.result.anchors.find(entry => (entry.linked_item_ids ?? []).includes('requirement:offline'));
  assert.ok(anchor, 'the criterion has a section anchor');
  const refusal = run(project.root, 'cmd:no-authority-amend', 'amend_baseline', {
    authority: '',
    source: { source_id: 'source:plan', expected_sha256: stateOf(project.root).sources.find(source => source.id === 'source:plan').accepted_sha256,
      expected_source_revision: 1 },
    edits: [{ kind: 'set_task_text', anchor_id: anchor.anchor_id, item: 0, text: BEHAVIORAL_TEXT }],
    items: [{ id: 'requirement:offline', kind: 'requirement', state: 'accepted',
      source: { source_id: 'source:plan', sha256: mapProbe.json.result.sha256, anchor_id: 'heading:Requirement — Offline operation' } }],
    plan_updates: [] });
  assert.notEqual(refusal.status, 0, 'the route refuses an authority-less acceptance');
  assert.equal(stateOf(project.root).baseline_revision, baselineBefore, 'the refused acceptance left the baseline untouched');
  assert.equal(fs.readFileSync(project.planPath, 'utf8'), before);
});

test('carried-forward plan references move inside the same acceptance transaction', async () => {
  const project = setupProject('baseline-carry');
  const { editor, sentCommands } = await mountEditor(project.root);
  setSelect(editor, 'item-select', 'requirement:offline');
  setInput(editor, 'amend-text', BEHAVIORAL_TEXT);
  setInput(editor, 'amend-authority', 'user:instruction-carry');
  byTestid(editor, 'amend-preview-button').click();
  await settled(editor);
  const carry = editor.element.querySelector('[data-testid="amend-carry"] button[data-plan-id="plan:delivery"]');
  assert.equal(carry.getAttribute('aria-pressed'), 'false');
  carry.click();
  await settled(editor);
  byTestid(editor, 'amend-accept-button').click();
  await settled(editor);
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'saved');
  const payload = sentCommands.find(command => command.operation === 'amend_baseline').payload;
  assert.deepEqual(payload.plan_updates, [{ plan_id: 'plan:delivery',
    baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] }]);
  const invalidations = byTestid(editor, 'amend-invalidations').textContent;
  assert.equal(invalidations.includes('plan:delivery · considered 1 · carried_forward: true'), true);
  assert.equal(invalidations.includes('plan:history · considered 1 · carried_forward: false'), true);
  const stored = stateOf(project.root);
  assert.deepEqual(stored.plans.find(plan => plan.id === 'plan:delivery').baseline_refs,
    [{ item_id: 'requirement:offline', item_revision: 2 }]);
  assert.deepEqual(stored.plans.find(plan => plan.id === 'plan:history').baseline_refs,
    [{ item_id: 'requirement:offline', item_revision: 1 }], 'the historical plan keeps the revisions it considered');
});

test('polling update preserves the selected source, plan, mode, anchor and draft text', async () => {
  const project = setupProject('polling-context');
  const { editor } = await mountEditor(project.root);
  setSelect(editor, 'source-select', 'source:history');
  await settled(editor);
  setSelect(editor, 'plan-select', 'plan:history');
  setSelect(editor, 'anchor-select', anchorOptionValue(editor, 'Scope'));
  setInput(editor, 'edit-kind', 'set_task_text');
  setInput(editor, 'edit-text', 'Delivered long ago, verified twice');
  setInput(editor, 'edit-authority', 'user:ui-instruction');
  editor.setMode('source');
  await settled(editor);
  run(project.root, 'cmd:poll-bump', 'artifact.register',
    { id: 'artifact:poll', type: 'design_note', producer: 'external', path: '.omo/plans/delivery.md', sha256: sha256(PLAN) });
  editor.update(invoke(project.root, 'read').json);
  await settled(editor);
  const state = editor.getState();
  assert.equal(state.sourceId, 'source:history');
  assert.equal(state.planId, 'plan:history');
  assert.equal(state.mode, 'source');
  assert.equal(byTestid(editor, 'edit-text').value, 'Delivered long ago, verified twice');
  assert.equal(byTestid(editor, 'edit-authority').value, 'user:ui-instruction');
  assert.equal(allTestid(editor, 'anchor-task')[0].textContent.includes('Delivered long ago'), true, 'the anchor task listing survived the poll');
});

test('polling update keeps focus inside the field being edited and refreshes displayed facts', async () => {
  const project = setupProject('polling-focus');
  const { editor } = await mountEditor(project.root);
  const text = byTestid(editor, 'edit-text');
  text.focus();
  setInput(editor, 'edit-text', 'Work without a network and tolerate polling');
  const revisionBefore = byTestid(editor, 'edit-expected').textContent;
  run(project.root, 'cmd:poll-bump-2', 'artifact.register',
    { id: 'artifact:poll-2', type: 'design_note', producer: 'external', path: '.omo/plans/delivery.md', sha256: sha256(PLAN) });
  editor.update(invoke(project.root, 'read').json);
  await settled(editor);
  assert.equal(document.activeElement, text, 'focus is not stolen by a polling refresh');
  assert.equal(text.value, 'Work without a network and tolerate polling');
  assert.notEqual(byTestid(editor, 'edit-expected').textContent, revisionBefore, 'displayed revisions refresh from the new snapshot');
});

test('narrow mode renders the equivalent hierarchical list with full labels', async () => {
  const project = setupProject('narrow-list');
  const { editor } = await mountEditor(project.root);
  editor.setNarrow(true);
  const rows = allTestid(editor, 'editor-row');
  assert.ok(rows.length >= 4, 'sources, plans and criteria become list rows');
  const planRow = [...rows].find(row => row.dataset.nodeId === 'plan:delivery');
  assert.equal(planRow.textContent.includes('Delivery plan'), true, 'full labels are preserved, not miniature graph text');
  const itemRow = [...rows].find(row => row.dataset.nodeId === 'requirement:offline');
  assert.equal(itemRow.textContent.includes('Work without a network'), true, 'criteria rows show their original text');
});

test('keyboard traversal moves focus and Enter selects in the narrow list', async () => {
  const project = setupProject('narrow-keyboard');
  const { editor } = await mountEditor(project.root);
  editor.setNarrow(true);
  const rows = [...allTestid(editor, 'editor-row')];
  rows[0].focus();
  const first = document.activeElement;
  first.dispatchEvent({ type: 'keydown', key: 'ArrowDown', bubbles: true, cancelable: true });
  const second = document.activeElement;
  assert.notEqual(second, first, 'ArrowDown moved focus to the next row');
  second.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true });
  await settled(editor);
  const state = editor.getState();
  assert.equal(state.mode === 'structured' || state.mode === 'baseline', true, 'Enter opened the focused row');
  assert.equal(second.dataset.nodeId === 'plan:delivery' || second.dataset.nodeId === 'source:history'
    || second.dataset.nodeId.startsWith('requirement:') || state.sourceId === second.dataset.nodeId, true,
    'the selection follows the focused row');
});

test('Enter on the task text input runs the preview flow without any pointer interaction', async () => {
  const project = setupProject('keyboard-edit');
  const { editor } = await mountEditor(project.root);
  await draftCriterionEdit(editor);
  const text = byTestid(editor, 'edit-text');
  text.focus();
  text.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true, cancelable: true });
  await settled(editor);
  assert.equal(byTestid(editor, 'edit-preview').dataset.state, 'valid');
  assert.equal(byTestid(editor, 'edit-patch').textContent.includes(BEHAVIORAL_TEXT), true);
});

test('command results map onto the typed state vocabulary', () => {
  assert.equal(commandResultState({ receipt: { status: 'saved' } }), 'saved');
  assert.equal(commandResultState({ receipt: { status: 'conflict', reason: 'REVISION_CONFLICT' } }), 'conflict');
  assert.equal(commandResultState({ result: { status: 'valid' } }), 'valid');
  assert.equal(commandResultState({ result: { status: 'ok' } }), 'valid');
  assert.equal(commandResultState({ result: { status: 'invalid', reason: 'SOURCE_CHANGED' } }), 'invalid');
  assert.equal(commandResultState({ result: { status: 'conflict' } }), 'conflict');
  assert.deepEqual([...EDITOR_MODES], ['rendered', 'structured', 'source', 'baseline']);
});

test('markdown parsing and invalidation prediction are pure and match the editing grammar', () => {
  const view = parseMarkdownView(PLAN);
  const headings = view.blocks.filter(block => block.kind === 'heading').map(block => block.title);
  assert.deepEqual(headings, ['Delivery plan', 'Requirement — Offline operation', 'Unassigned — Telemetry opt-in', 'Tasks']);
  assert.equal(view.blocks.filter(block => block.kind === 'fence').length, 1, 'fenced examples are recognized, not parsed as tasks');
  assert.equal(sectionTasks(PLAN, 'Requirement — Offline operation').length, 1);
  assert.equal(sectionTasks(PLAN, null).length, 3, 'a document anchor addresses every real task, never a fenced one');
  const snapshot = { plans: [
    { id: 'plan:a', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 1 }] },
    { id: 'plan:b', baseline_refs: [{ item_id: 'requirement:offline', item_revision: 2 }] },
    { id: 'plan:c', baseline_refs: [] }] };
  assert.deepEqual(predictedInvalidations(snapshot, 'requirement:offline', 2), [{
    item_id: 'requirement:offline', from_revision: 1, to_revision: 2,
    reason: 'BEHAVIORAL_REQUIREMENT_CHANGE',
    affected: [{ plan_id: 'plan:a', considered_revision: 1, carried_forward: false }] }]);
  assert.deepEqual(predictedInvalidations(snapshot, 'requirement:offline', 1), [],
    'no reference moves when the revision does not advance');
});
