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

**Owner:** \`dashboard\`

| Surface | State |
| --- | --- |
| Project | connected |

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

const { createProjectEditor, parseMarkdownView, predictedInvalidations, sectionTasks, commandResultState,
  EDITOR_MODES, applyUnifiedPatch, diffRows, parseUnifiedPatch } = await import('../ui/editor-views.mjs');

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
// mini-DOM hosts expose no Element.closest: walk manually.
const closestField = control => { let node = control; while (node && !(node.classList?.contains?.('lb-field'))) node = node.parentNode; return node; };
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

test('the rendered view uses semantic Markdown for emphasis, tables, fences and read-only tasks', async () => {
  const project = setupProject('rendered-original');
  const { editor } = await mountEditor(project.root);
  assert.equal(byTestid(editor, 'source-meta').textContent.includes(PLAN_RELATIVE), true);
  const rendered = byTestid(editor, 'editor-rendered');
  const document = rendered.querySelector('.markdown-document');
  const heading = document.querySelector('[data-source-line="1"]');
  assert.equal(heading.textContent, 'Delivery plan');
  const fence = rendered.querySelector('pre');
  assert.equal(fence.textContent.includes('lazybuddy verify --strict'), true);
  assert.equal(fence.textContent.includes('fake checklist item inside the fence'), true);
  const tasks = rendered.querySelectorAll('.markdown-task');
  assert.equal(tasks.length, 3, 'the three real checklist items render; the fenced one does not');
  const offline = [...tasks].find(row => row.textContent.includes('Work without a network'));
  assert.equal(offline.querySelector('input').hasAttribute('checked'), false);
  assert.equal(offline.querySelector('input').disabled, true);
  assert.equal(rendered.querySelectorAll('table').length, 1, 'a Markdown table stays a table');
  assert.equal(rendered.querySelector('strong').textContent, 'Owner:');
  assert.equal(document.querySelector('code').textContent, 'dashboard');
  assert.equal(rendered.textContent.includes('**Owner:**'), false, 'raw emphasis syntax is not shown');
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
  const retire = editor.element.querySelector('[data-testid="transition-option"][data-to="abandoned"] button');
  assert.equal(retire.classList.contains('lb-destructive'), true, 'retiring carries the danger treatment (FO-3)');
  retire.click();
  await settle();
  const guard = byTestid(editor, 'transition-confirm');
  assert.equal(guard.hidden, false, 'a retiring transition asks for an explicit confirm first');
  assert.equal(guard.textContent.includes('plan:delivery'), true, 'the confirm names the plan it retires');
  // Cancel first: nothing is sent, nothing changes.
  byTestid(editor, 'transition-confirm-cancel').click();
  await settle();
  assert.equal(guard.hidden, true);
  assert.equal(sentCommands.some(command => command.operation === 'plan.transition'), false, 'a cancelled confirm sends nothing');
  retire.click();
  await settle();
  byTestid(editor, 'transition-confirm-confirm').click();
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
    await settle();
    byTestid(editor, 'transition-confirm-confirm').click();
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
  assert.deepEqual([...EDITOR_MODES], ['rendered', 'structured', 'source']);
});

// ---- T15 redesign: native chrome, docks, dirty state, close guard, validation ----

test('the surface switch is a T11 segmented control in the toolbar and digits 1-3 switch surfaces', async () => {
  const project = setupProject('segmented-modes');
  const { editor } = await mountEditor(project.root);
  const toolbar = byTestid(editor, 'editor-toolbar');
  const group = toolbar.querySelector('[data-native-segmented]');
  assert.ok(group, 'the mode switch renders as a segmented control (NF-1)');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.getAttribute('aria-label'), 'Editor surface');
  const segments = [...group.querySelectorAll('button')];
  assert.deepEqual(segments.map(control => control.dataset.segment), ['rendered', 'structured', 'source']);
  assert.equal(segments[0].getAttribute('aria-pressed'), 'true');
  segments[2].click();
  assert.equal(editor.getState().mode, 'source');
  assert.equal(byTestid(editor, 'editor-source').hidden, false);
  assert.equal(segments[2].getAttribute('aria-pressed'), 'true', 'the segmented control reflects the current surface');
  editor.element.dispatchEvent({ type: 'keydown', key: '1', bubbles: true, cancelable: true });
  assert.equal(editor.getState().mode, 'rendered', 'keyboard digit shortcuts still switch surfaces');
});

test('the rendered surface reads through the document reading layout with one h1 and ordered headings', async () => {
  const project = setupProject('reading-hierarchy');
  const { editor } = await mountEditor(project.root);
  const rendered = byTestid(editor, 'editor-rendered');
  assert.ok(rendered.querySelector('.document-outline-desktop'), 'the reading outline is present');
  const headings = [...rendered.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  assert.equal(rendered.querySelectorAll('h1').length, 1, 'exactly one h1: the document title (TY-1)');
  let previous = null;
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    if (previous != null) assert.ok(level - previous <= 1, `headings never skip a level (TY-2): ${heading.tagName} after h${previous}`);
    previous = level;
  }
  assert.equal(rendered.querySelector('.markdown-document').textContent.includes('Delivery plan'), true);
});

test('the staged edit renders a split view and a paired diff table from the route patch', async () => {
  const project = setupProject('split-diff');
  const { editor } = await mountEditor(project.root);
  editor.setMode('source');
  await settled(editor);
  assert.equal(byTestid(editor, 'edit-split-original').textContent.includes('Work without a network'), true,
    'the registered original shows verbatim');
  assert.equal(byTestid(editor, 'edit-split-edited').textContent.includes(BEHAVIORAL_TEXT), false,
    'before a preview the staged side never guesses content');
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  const edited = byTestid(editor, 'edit-split-edited');
  assert.equal(edited.textContent.includes(BEHAVIORAL_TEXT), true, 'the staged side shows the edited text');
  assert.equal(edited.textContent.includes('- [ ] Work without a network\n'), false, 'the addressed line was replaced');
  const originalSide = byTestid(editor, 'edit-split-original');
  assert.equal(originalSide.textContent.includes('Work without a network'), true, 'the original side stays the capture');
  const diff = byTestid(editor, 'edit-diff');
  assert.equal(diff.querySelectorAll('th').length >= 2, true, 'the diff table carries the two column headers');
  const removed = diff.querySelector('.editor-diff-line[data-change="removed"]');
  const added = diff.querySelector('.editor-diff-line[data-change="added"]');
  // Diff rows carry the whole document line — checklist syntax included, never
  // a stripped guess of what the route changed.
  assert.equal(removed?.textContent, '- [ ] Work without a network');
  assert.equal(added?.textContent, `- [ ] ${BEHAVIORAL_TEXT}`);
  const fenced = 'fake checklist item inside the fence';
  assert.equal(originalSide.textContent.includes(fenced), true);
  assert.equal(edited.textContent.includes(fenced), true, 'fenced bytes stay identical through the reconstruction');
});

test('unified patch parsing, reconstruction and diff pairing are pure', () => {
  const original = '# Title\n\n- [ ] old text\n\nclosing\n';
  const patch = '--- a/plan.md\n+++ b/plan.md\n@@ -1,5 +1,5 @@\n # Title\n \n-- [ ] old text\n+- [ ] new text\n \n closing\n';
  assert.deepEqual(parseUnifiedPatch(patch).map(row => row.kind),
    ['context', 'context', 'remove', 'add', 'context', 'context']);
  assert.equal(applyUnifiedPatch(original, patch), '# Title\n\n- [ ] new text\n\nclosing\n');
  assert.deepEqual(diffRows(patch).map(row => row.change), ['context', 'context', 'changed', 'context', 'context']);
  assert.deepEqual(diffRows(patch)[2], { original: '- [ ] old text', edited: '- [ ] new text', change: 'changed' });
  assert.equal(applyUnifiedPatch(original, '@@ -99,2 +1,2 @@\n-nonsense\n+text\n'), null,
    'an unmappable hunk reconstructs nothing rather than guessing');
});

test('drafts mark the editor and its hosting tab dirty; applying clears the dot', async () => {
  const project = setupProject('dirty-tab');
  const { editor } = await mountEditor(project.root);
  const { createTabs } = await import('../ui/components.mjs');
  const workspace = createTabs({ tabs: [{ id: 'overview', title: 'Overview', pinned: true, content: document.createElement('div') }] });
  document.body.append(workspace.element);
  workspace.openTab({ id: 'editor', title: 'Editors', content: editor.element });
  await settled(editor);
  const tab = workspace.tablist.querySelector('.lb-tab[data-tab-id="editor"]');
  const dot = tab.querySelector('[data-testid="tab-dirty"]');
  assert.ok(dot, 'the hosting tab carries the dirty dot node');
  assert.equal(dot.hidden, true, 'a clean editor shows no dot');
  assert.equal(editor.getState().dirty, false);
  setInput(editor, 'edit-text', 'a drafted edit');
  await settle();
  assert.equal(editor.getState().dirty, true);
  assert.equal(dot.hidden, false, 'drafting text lights the tab dot');
  assert.equal(tab.dataset.dirty, 'true');
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  assert.equal(editor.getState().dirty, true, 'a pending preview keeps the tab dirty');
  byTestid(editor, 'edit-apply-button').click();
  await settled(editor);
  assert.equal(editor.getState().dirty, false, 'a saved apply spends the drafts');
  assert.equal(dot.hidden, true);
  workspace.element.remove();
});

test('closing the dirty tab opens the native guard; keep editing cancels, discard clears and proceeds', async () => {
  const project = setupProject('close-guard');
  const { editor } = await mountEditor(project.root);
  // A minimal shell-tab host: panel labelled by its tab, tab inside a tablist.
  const tablist = document.createElement('div');
  tablist.setAttribute('role', 'tablist');
  const tab = document.createElement('div');
  tab.className = 'lb-tab';
  tab.id = 'guard-tab';
  tab.setAttribute('role', 'tab');
  const label = document.createElement('span');
  label.className = 'lb-tab-label';
  label.textContent = 'Editors';
  const close = document.createElement('button');
  close.className = 'lb-tab-close';
  close.setAttribute('aria-label', 'Close Editors');
  close.textContent = '×';
  tab.append(label, close);
  tablist.append(tab);
  const panel = document.createElement('section');
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'guard-tab');
  panel.append(editor.element);
  document.body.append(tablist, panel);
  await settled(editor);
  setInput(editor, 'edit-text', 'unsaved work in progress');
  await settle();
  assert.equal(editor.getState().dirty, true);
  // Delete-path intent while dirty: intercepted, dialog open, tab intact.
  tab.dispatchEvent({ type: 'keydown', key: 'Delete', bubbles: true, cancelable: true });
  const guard = byTestid(editor, 'editor-close-guard');
  assert.equal(guard.hidden, false, 'the close guard dialog opens');
  assert.equal(guard.textContent.includes('a composed source edit'), true, 'the guard names the pending change class');
  byTestid(editor, 'editor-close-guard-cancel').click();
  await settle();
  assert.equal(guard.hidden, true, 'keep editing closes the guard');
  assert.equal(editor.getState().dirty, true, 'cancel keeps the drafts (cancel_resume)');
  assert.equal(byTestid(editor, 'edit-text').value, 'unsaved work in progress');
  // Click-path intent while dirty: also intercepted.
  tab.dispatchEvent({ type: 'click', bubbles: true, cancelable: true });
  assert.equal(guard.hidden, false, 'the close click is guarded too');
  byTestid(editor, 'editor-close-guard-confirm').click();
  await settle();
  assert.equal(guard.hidden, true);
  assert.equal(editor.getState().dirty, false, 'discard spends the drafts locally');
  assert.equal(byTestid(editor, 'edit-text').value, '');
  // After discard the same close intent passes through un-guarded.
  let reached = false;
  close.addEventListener('click', () => { reached = true; });
  close.dispatchEvent({ type: 'click', bubbles: true, cancelable: true });
  assert.equal(reached, true, 'a clean editor never blocks tab close');
  tablist.remove(); panel.remove();
});

test('the editor header carries an in-surface dirty chip that follows the drafts (T20)', async () => {
  const project = setupProject('dirty-chip');
  const { editor } = await mountEditor(project.root);
  const chip = byTestid(editor, 'editor-dirty-chip');
  assert.ok(chip, 'the editor page header carries the dirty chip');
  assert.equal(chip.hidden, true, 'a clean editor shows no chip');
  assert.equal(chip.getAttribute('aria-label'), 'Unsaved changes');
  setInput(editor, 'edit-text', 'a drafted edit');
  await settle();
  assert.equal(chip.hidden, false, 'drafting lights the in-surface chip');
  assert.equal(chip.textContent.includes('Unsaved changes'), true);
  await draftCriterionEdit(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  assert.equal(chip.hidden, false, 'a pending preview keeps the chip lit');
  byTestid(editor, 'edit-apply-button').click();
  await settled(editor);
  assert.equal(chip.hidden, true, 'a saved apply spends the drafts and the chip');
});

test('confirmLeave guards surface replacement: clean resolves true, keep preserves drafts, discard clears (T20)', async () => {
  const project = setupProject('leave-guard');
  const { editor } = await mountEditor(project.root);
  // Clean editor: the guard resolves immediately, nothing defers.
  assert.equal(editor.needsLeaveGuard(), false);
  assert.equal(await editor.confirmLeave(), true);
  assert.equal(byTestid(editor, 'editor-leave-guard').hidden, true, 'a clean editor never opens the leave dialog');

  setInput(editor, 'edit-text', 'unsaved work in progress');
  await settle();
  assert.equal(editor.needsLeaveGuard(), true, 'the shell can ask synchronously whether a guard is needed');
  const first = editor.confirmLeave();
  const dialog = byTestid(editor, 'editor-leave-guard');
  assert.equal(dialog.hidden, false, 'leaving a dirty editor opens the FO-3 confirm');
  assert.equal(dialog.textContent.includes('a composed source edit'), true, 'the guard names the pending change class');
  byTestid(editor, 'editor-leave-guard-cancel').click();
  assert.equal(await first, false, 'Keep editing resolves false');
  assert.equal(dialog.hidden, true, 'keep editing closes the guard');
  assert.equal(editor.getState().dirty, true, 'keep editing preserves every draft (cancel_resume)');
  assert.equal(byTestid(editor, 'edit-text').value, 'unsaved work in progress');

  const second = editor.confirmLeave();
  assert.equal(dialog.hidden, false, 'the guard asks again on the next leave attempt');
  byTestid(editor, 'editor-leave-guard-confirm').click();
  assert.equal(await second, true, 'Discard resolves true for the navigation');
  assert.equal(editor.getState().dirty, false, 'discard spends the drafts locally');
  assert.equal(byTestid(editor, 'edit-text').value, '');
  assert.equal(await editor.confirmLeave(), true, 'a clean editor resolves immediately again');
});

test('baseline comparison and amendment impact open as dock panels from toolbar actions and Escape closes them', async () => {
  const project = setupProject('docks');
  const detach = (await import('../ui/components.mjs')).installFocusSystem({ root: document });
  try {
    const { editor } = await mountEditor(project.root);
    const baselineDock = byTestid(editor, 'baseline-dock');
    const impactDock = byTestid(editor, 'impact-dock');
    assert.equal(baselineDock.hidden, true, 'docks start closed');
    const baselineTrigger = byTestid(editor, 'baseline-dock-trigger');
    baselineTrigger.click();
    assert.equal(baselineDock.hidden, false, 'the toolbar action opens the comparison dock');
    assert.equal(baselineTrigger.getAttribute('aria-pressed'), 'true');
    assert.equal(byTestid(editor, 'baseline-comparison').textContent.includes('Recorded in the baseline'), true,
      'the comparison table opposes the record and the original');
    byTestid(editor, 'impact-dock-trigger').click();
    assert.equal(impactDock.hidden, false, 'the impact dock opens independently');
    assert.equal(impactDock.contains(byTestid(editor, 'amend-text')), true, 'the amendment composer lives in the impact dock');
    assert.equal(baselineDock.contains(byTestid(editor, 'item-select')), true, 'the comparison owns the item selector');
    document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(impactDock.hidden, true, 'Escape closes the topmost dock through the T11 overlay stack');
    assert.equal(byTestid(editor, 'impact-dock-trigger').getAttribute('aria-pressed'), 'false');
    document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(baselineDock.hidden, true);
  } finally {
    detach.detach();
  }
});

test('validation errors render inline next to their field with the required wiring', async () => {
  const project = setupProject('inline-validation');
  const { editor, sentCommands } = await mountEditor(project.root);
  setSelect(editor, 'edit-kind', 'set_task_text');
  setInput(editor, 'edit-task-index', 'x');
  setInput(editor, 'edit-text', 'an edit without its authority');
  setInput(editor, 'edit-authority', '');
  await settled(editor);
  byTestid(editor, 'edit-preview-button').click();
  await settled(editor);
  const authorityField = closestField(byTestid(editor, 'edit-authority'));
  const authorityError = authorityField.querySelector('[data-testid="field-error"]');
  assert.ok(authorityError, 'the authority field carries an inline error (FO-2)');
  assert.equal(authorityError.textContent.includes('Authority reference is required'), true);
  assert.equal(authorityField.getAttribute('data-invalid'), 'true');
  assert.equal(byTestid(editor, 'edit-authority').getAttribute('aria-invalid'), 'true');
  assert.ok(byTestid(editor, 'edit-authority').getAttribute('aria-describedby').includes(authorityError.id));
  const indexField = closestField(byTestid(editor, 'edit-task-index'));
  assert.equal(indexField.querySelector('[data-testid="field-error"]').textContent.includes('whole number'), true,
    'the index error names the field problem');
  assert.equal(sentCommands.filter(command => command.operation !== 'source.map').length, 0, 'nothing was sent');
  // Typing clears the stale error; a valid preview composes.
  setInput(editor, 'edit-task-index', '0');
  await settle();
  assert.equal(indexField.querySelector('[data-testid="field-error"]'), null, 'the error clears on input');
});

test('polling update keeps the tab dirty marker alive with the drafts (stale_state)', async () => {
  const project = setupProject('polling-dirty');
  const { editor } = await mountEditor(project.root);
  setInput(editor, 'edit-text', 'draft surviving a poll');
  setInput(editor, 'edit-authority', 'user:ui-instruction');
  await settle();
  assert.equal(editor.getState().dirty, true);
  run(project.root, 'cmd:poll-dirty', 'artifact.register',
    { id: 'artifact:poll-dirty', type: 'design_note', producer: 'external', path: '.omo/plans/delivery.md', sha256: sha256(PLAN) });
  editor.update(invoke(project.root, 'read').json);
  await settled(editor);
  const state = editor.getState();
  assert.equal(state.dirty, true, 'the dirty flag survives the poll with the drafts');
  assert.equal(byTestid(editor, 'edit-text').value, 'draft surviving a poll');
  assert.equal(byTestid(editor, 'edit-authority').value, 'user:ui-instruction');
  assert.equal(editor.element.dataset.dirty, 'true');
});

test('the compose form labels every field programmatically and hides irrelevant value fields per kind', async () => {
  const project = setupProject('form-labels');
  const { editor } = await mountEditor(project.root);
  const fields = [...editor.element.querySelectorAll('.editor-pane[data-mode="source"] .lb-field')];
  assert.ok(fields.length >= 8, 'the compose form renders its fields through formField');
  for (const field of fields) {
    const control = field.querySelector('input, select, textarea');
    assert.ok(control, 'every field wraps a platform control (FO-4)');
    assert.ok(field.querySelector('.lb-field-label'), `the field for ${control.dataset.testid ?? control.name} carries a label (FO-1)`);
  }
  assert.equal(byTestid(editor, 'edit-authority').required, true, 'authority is marked required');
  setSelect(editor, 'edit-kind', 'rename_heading');
  await settle();
  assert.equal(closestField(byTestid(editor, 'edit-text')).hidden, true, 'irrelevant value fields recede');
  assert.equal(closestField(byTestid(editor, 'edit-title')).hidden, false);
});

test('editor CSS holds the token discipline: type, spacing, radius, color, motion, numerals', () => {
  const css = fs.readFileSync(new URL('../ui/editor.css', import.meta.url), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(rule => rule.slice(rule.indexOf('{') + 1)).join('\n');
  // TY-3 / TY-7: every font-size and font-weight resolves to a type/weight token.
  for (const match of rules.matchAll(/font-size:\s*([^;]+);/g)) assert.match(match[1], /^var\(--type-/, `font-size ${match[1]}`);
  for (const match of rules.matchAll(/font-weight:\s*([^;]+);/g)) assert.match(match[1], /^var\(--weight-/, `font-weight ${match[1]}`);
  // SP-1: no raw spacing literals survive except the zero resets.
  for (const match of rules.matchAll(/(?:^|;)\s*(?:padding|margin|gap|row-gap|column-gap)[^:]*:\s*([^;]+);/g)) {
    assert.match(match[1], /^(0|calc\(|min\(|var\(--(?:space|density|control|measure|inspector|card-min|icon|lb-card-pad))/, `spacing ${match[1]}`);
  }
  // SP-4 / CL-1 / NF-4: radii and colors resolve to tokens; the only font stack is --mono.
  for (const match of rules.matchAll(/border-radius:\s*([^;]+);/g)) assert.match(match[1], /^var\(--radius-/, `radius ${match[1]}`);
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(rules), false, 'no color literals (CL-1)');
  for (const match of rules.matchAll(/font-family:\s*([^;]+);/g)) assert.equal(match[1].trim(), 'var(--mono)', 'mono for identifiers/code only (NF-4)');
  assert.equal(css.includes('--product-accent'), false, 'the editors chrome consumes no product accent (CL-5)');
  // TY-4: revisions, counts and digest fragments render with the numeric variant.
  assert.match(css, /\.editor-facts dd, \.editor-patch, \.editor-diff-line[^}]*font-variant-numeric:\s*var\(--numeric\)/s);
  // MO-1..3: no animation of its own; motion collapses under reduced motion.
  assert.equal(/@keyframes|animation:|infinite/.test(rules), false, 'no decorative or looping motion (MO-2)');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^@]*transition: none/s);
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
