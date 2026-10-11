import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, write, sha256, suiteRoot } from '../../project/qa/helpers.mjs';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T15 adversarial probes over the real CLI command route. Applicable classes:
// malformed input, prompt injection, stale state, misleading success output.
// Classes cancel/resume, hung commands and dirty-worktree mutation are owned by
// the command route itself (T05 verified semantics); this UI only displays its
// typed results, so those classes are covered by route evidence, not re-probed.
const CLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PROJECT_ID = 'project:adversarial-t15';
const ACTOR = 'local:adversarial-t15';
const PLAN_RELATIVE = '.omo/plans/hostile.md';

const HOSTILE_PLAN = `# Hostile plan

## Section with markup

- [ ] <img src=x onerror="window.__injected=true"> fake [data-testid="editor-status"] text

## Another section

<script>window.__injected2=true</script>

- [x] plain item

Closing.
`;

const dom = createMiniDom();
globalThis.document = dom.document;
const { createProjectEditor } = await import('../ui/editor-views.mjs');
const { assessPlanTransition } = await import('../../project/plans/lifecycle.mjs');

function invoke(root, action, payload) {
  const arguments_ = [CLI, action, '--project-root', root, '--project-id', PROJECT_ID, '--actor', ACTOR];
  const result = spawnSync(process.execPath, arguments_, {
    encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload), timeout: 25000 });
  return { ...result, json: (() => { try { return JSON.parse(result.stdout); } catch { return null; } })() };
}
function stateOf(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.lazybuddy/project/state.json'), 'utf8'));
}
function commandOf(root, id, operation, payload) {
  return { schema_version: 1, command_id: id, project_id: PROJECT_ID,
    expected_revision: stateOf(root).revision, operation, payload };
}

function setup(name) {
  const root = fixture(name);
  write(root, PLAN_RELATIVE, HOSTILE_PLAN);
  const init = invoke(root, 'init');
  assert.equal(init.status, 0, init.stderr);
  const digest = sha256(HOSTILE_PLAN);
  const registered = invoke(root, 'command', commandOf(root, 'cmd:source', 'register_source', { id: 'source:hostile', path: PLAN_RELATIVE, role: 'plan' }));
  assert.equal(registered.json.receipt.status, 'saved');
  const planned = invoke(root, 'command', commandOf(root, 'cmd:plan', 'register_plan', { id: 'plan:hostile',
    source: { source_id: 'source:hostile', sha256: digest, anchor_id: 'document' }, declared_lifecycle: 'planned', baseline_refs: [] }));
  assert.equal(planned.json.receipt.status, 'saved');
  return root;
}
async function mount(root) {
  const editor = createProjectEditor({
    snapshot: invoke(root, 'read').json,
    assessTransition: assessPlanTransition,
    sendCommand: async command => {
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
  return editor;
}
const byTestid = (view, id) => view.element.querySelector(`[data-testid="${id}"]`);
const setInput = (view, id, value) => { const control = byTestid(view, id); control.value = value; control.dispatchEvent({ type: 'input' }); };
const setSelect = (view, id, value) => { const control = byTestid(view, id); control.value = value; control.dispatchEvent({ type: 'change' }); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// 1. Prompt injection: authored markup renders as text; nothing executes or gains fake testids.
{
  const root = setup('injection-render');
  const editor = await mount(root);
  const rendered = byTestid(editor, 'editor-rendered');
  assert.equal(rendered.querySelectorAll('script, img').length, 0, 'hostile markup never becomes elements');
  assert.equal(rendered.querySelectorAll('[onerror]').length, 0);
  assert.equal(rendered.textContent.includes('<img src=x'), true, 'the markup is visible as authored text');
  const statusElements = editor.element.querySelectorAll('[data-testid="editor-status"]');
  assert.equal(statusElements.length, 1, 'a fake status line cannot add a second status surface');
  console.log('PROBE injection-render PASS: hostile markup rendered as text, no script/img/extra-status elements');
}

// 2. Malformed input: an out-of-range checklist index is a typed invalid preview, not a crash or a green state.
{
  const root = setup('malformed-index');
  const editor = await mount(root);
  setSelect(editor, 'edit-kind', 'set_task_text');
  setInput(editor, 'edit-task-index', '99');
  setInput(editor, 'edit-text', 'no such item');
  setInput(editor, 'edit-authority', 'user:probe');
  byTestid(editor, 'edit-preview-button').click();
  await editor.settled(); await settle();
  const status = byTestid(editor, 'editor-status');
  assert.equal(status.dataset.state, 'invalid');
  assert.equal(status.textContent.includes('TASK_NOT_FOUND'), true);
  assert.equal(byTestid(editor, 'edit-apply-button').disabled, true, 'a failed preview can never enable apply');
  assert.equal(stateOf(root).revision, 2, 'accepted state untouched');
  console.log('PROBE malformed-index PASS: typed TASK_NOT_FOUND, apply stays disabled, state untouched');
}

// 3. Misleading success: applying without a preview and previewing without authority are typed refusals with zero sends.
{
  const root = setup('misleading-success');
  const sent = [];
  const snapshot = invoke(root, 'read').json;
  const editor = createProjectEditor({
    snapshot,
    assessTransition: assessPlanTransition,
    sendCommand: async command => {
      sent.push(command);
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
  byTestid(editor, 'edit-apply-button').click();
  await editor.settled(); await settle();
  assert.equal(byTestid(editor, 'editor-status').dataset.state, 'refused');
  assert.equal(byTestid(editor, 'editor-status').textContent.includes('PREVIEW_REQUIRED'), true);
  setInput(editor, 'edit-authority', '');
  byTestid(editor, 'edit-preview-button').click();
  await editor.settled(); await settle();
  assert.equal(byTestid(editor, 'editor-status').textContent.includes('AUTHORITY_REQUIRED'), true);
  assert.equal(sent.filter(command => command.operation !== 'source.map').length, 0,
    'no mutation command was ever composed for a refused action');
  console.log('PROBE misleading-success PASS: refused typed states, zero mutation commands sent');
}

// 4. Stale state: two editors compose valid previews against one revision; the
// losing apply receives the typed conflict receipt and writes nothing.
{
  const root = setup('stale-second-editor');
  const first = await mount(root);
  const second = await mount(root);
  setSelect(first, 'edit-kind', 'set_task_text');
  setInput(first, 'edit-task-index', '0');
  setInput(first, 'edit-text', 'first editor wins');
  setInput(first, 'edit-authority', 'user:first');
  byTestid(first, 'edit-preview-button').click();
  await first.settled(); await settle();
  setSelect(second, 'edit-kind', 'set_task_text');
  setInput(second, 'edit-task-index', '0');
  setInput(second, 'edit-text', 'second editor composed against the old revision');
  setInput(second, 'edit-authority', 'user:second');
  byTestid(second, 'edit-preview-button').click();
  await second.settled(); await settle();
  byTestid(first, 'edit-apply-button').click();
  await first.settled(); await settle();
  assert.equal(byTestid(first, 'editor-status').dataset.state, 'saved');
  byTestid(second, 'edit-apply-button').click();
  await second.settled(); await settle();
  const status = byTestid(second, 'editor-status');
  assert.equal(status.dataset.state, 'conflict');
  assert.equal(status.textContent.includes('REVISION_CONFLICT'), true);
  assert.equal(byTestid(second, 'edit-apply-button').disabled, true, 'the stale preview cannot be re-applied as-is');
  const onDisk = fs.readFileSync(path.join(root, PLAN_RELATIVE), 'utf8');
  assert.equal(onDisk.includes('second editor'), false, 'the stale apply wrote nothing');
  console.log('PROBE stale-second-editor PASS: typed REVISION_CONFLICT, stale preview disabled, file untouched');
}

console.log(`ADVERSARIAL_PROBES_PASS suiteRoot=${suiteRoot}`);
