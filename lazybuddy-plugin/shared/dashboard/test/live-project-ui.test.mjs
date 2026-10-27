import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiniDom } from './fixtures/mini-dom.mjs';

const dom = createMiniDom();
globalThis.document = dom.document;
globalThis.CSS = { escape: value => String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&') };

const { createLiveProjectViews } = await import('../ui/project-live-views.mjs');
const { createProjectShell } = await import('../ui/project-shell.mjs');
const { overviewBundle } = await import('../ui/live-project-adapter.mjs');

const project = {
  schema_version: 1, project_id: 'project:live', runtime: 'LazyBuddy', repository_key: 'repo:live',
  revision: 3, baseline_revision: 1, observation_revision: 0,
  summary: { accepted_features: 1, accepted_principles: 0, accepted_requirements: 0, accepted_decisions: 0,
    plan_count: 1, unassigned_item_ids: [], pending_proposals: 0 },
  sources: [{ id: 'source:plan', path: '.omo/plans/live.md', role: 'plan', revision: 1, accepted_sha256: 'a'.repeat(64),
    observation: { status: 'current', sha256: 'a'.repeat(64), path: '.omo/plans/live.md', observed_at: '2026-10-10T12:00:00.000Z' } },
  { id: 'source:research', path: 'research/live.md', role: 'research', revision: 1, accepted_sha256: 'c'.repeat(64),
    observation: { status: 'current', sha256: 'c'.repeat(64), path: 'research/live.md', observed_at: '2026-10-10T12:00:00.000Z' } }],
  items: [{ id: 'feature:live', kind: 'feature', state: 'accepted', title: 'Live shell', revision: 1,
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'document' }, source_freshness: 'current', contributing_plan_ids: ['plan:live'] }],
  plans: [{ id: 'plan:live', title: 'Live dashboard plan', revision: 1, declared_lifecycle: 'active', baseline_refs: [],
    baseline_reference_status: 'unassessed', stale_item_ids: [], source_freshness: 'current',
    source: { source_id: 'source:plan', sha256: 'a'.repeat(64), anchor_id: 'heading:Work' },
    native_runs: [{ runtime: 'LazyBuddy', native_project_id: 'project:live', run_id: 'run-live' }], native_observations: [] }],
  proposals: [], architecture: [], research: [{ id: 'research:live', question: 'Can the live shell keep native context?',
    sources: ['research/live.md'], captured_at: '2026-10-10T12:00:00.000Z',
    findings: 'The registered source remains readable from its native identity.', uncertainty: 'Run execution is outside this finding.',
    recommendation: 'Keep the source and evidence links adjacent.', promotion_proposal_id: null,
    recorded_by: 'test:live', recorded_at: '2026-10-10T12:00:00.000Z', revision: 1 }],
  reconciliations: [], observations: [], invalidations: [], artifacts: [{ id: 'artifact:research', type: 'research',
    producer: 'test:live', path: 'research/live.md', sha256: 'c'.repeat(64), registered_by: 'test:live',
    registered_at: '2026-10-10T12:00:00.000Z' }], requests: [], issues: [],
  worktrees: { status: 'observed', identity: { basis: 'registry', repository_key: 'repo:live', shared: true },
    entries: [{ root: '/tmp/live', branch: 'main', head: 'b'.repeat(40), current: true, kind: 'main' }] },
};

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('research search and capture drafts survive polls; revision-checked failure retains the draft and success preserves newer edits', async () => {
  let received; let accept;
  const live = createLiveProjectViews({ project, adapter: {
    source: async id => ({ path: id, content: '# Original' }), detail: async () => { throw new Error('unused'); },
    command: async value => { received = value; return new Promise(resolve => { accept = resolve; }); },
    assessTransition: async () => ({ allowed: false, reasons: [] })
  } });
  const root = live.views.research.element; document.body.append(root); await tick();
  const search = root.querySelector('input[type="search"]'); search.value = 'native context'; search.dispatchEvent({ type: 'input' });
  assert.equal(root.querySelectorAll('[data-research-id]').length, 1);
  const form = root.querySelector('form'); const inputs = [...form.querySelectorAll('input,textarea')];
  inputs[0].value = 'How to resume?'; inputs[1].value = 'research/live.md'; inputs[2].value = 'Retain exact artifacts.';
  live.update({ ...project, revision: 4 }); assert.equal(inputs[0].value, 'How to resume?'); assert.equal(search.value, 'native context');
  form.dispatchEvent({ type: 'submit', preventDefault() {} });
  assert.equal(received.expected_revision, 4); assert.equal(received.operation, 'record_research_findings');
  accept({ receipt: { status: 'conflict', reason: 'REVISION_CONFLICT' } }); await tick();
  assert.equal(inputs[2].value, 'Retain exact artifacts.'); assert.match(form.textContent, /REVISION_CONFLICT/);
  form.dispatchEvent({ type: 'submit', preventDefault() {} }); inputs[2].value = 'New draft while saving';
  accept({ receipt: { status: 'saved' } }); await tick();
  assert.equal(inputs[2].value, 'New draft while saving'); assert.equal(inputs[0].value, '');
  search.value = 'no-match'; search.dispatchEvent({ type: 'input' });
  assert.match(root.textContent, /No research matches/);
});

test('research can register a captured source hash and keeps web references inert until explicitly opened', async () => {
  let command;
  const snapshot = { ...project, artifacts: [], research: [{ ...project.research[0], sources: ['research/live.md', 'https://example.org/research'] }] };
  const live = createLiveProjectViews({ project: snapshot, adapter: {
    source: async id => ({ path: id, content: '# Source', sha256: 'c'.repeat(64) }),
    command: async value => { command = value; return { receipt: { status: 'saved' } }; },
    detail: async () => { throw new Error('unused'); }, assessTransition: async () => ({ allowed: false, reasons: [] })
  } });
  await tick(); const root = live.views.research.element;
  const register = [...root.querySelectorAll('button')].find(button => button.textContent === 'Register evidence reference');
  register.click(); await tick();
  assert.equal(command.operation, 'artifact.register'); assert.equal(command.expected_revision, 3);
  assert.equal(command.payload.path, 'research/live.md'); assert.equal(command.payload.sha256, 'c'.repeat(64));
  assert.match(root.textContent, /Evidence reference registered/);
  const link = [...root.querySelectorAll('a')].find(link => link.textContent === 'Open web source');
  assert.equal(link.href, 'https://example.org/research'); assert.equal(link.rel, 'noopener noreferrer');
});

function browsingFixture(source) {
  const second = { ...project.plans[0], id: 'plan:archive', title: 'Archived delivery', declared_lifecycle: 'completed',
    source: { source_id: 'source:research', sha256: 'c'.repeat(64), anchor_id: 'document' } };
  const snapshot = { ...project, plans: [...project.plans, second] };
  const live = createLiveProjectViews({ project: snapshot, adapter: {
    source: source ?? (async id => ({ path: id, content: `# Original ${id}` })),
    command: async () => { throw new Error('not used'); },
    assessTransition: async () => ({ allowed: false, reasons: [] }),
    detail: async () => { throw new Error('not used'); },
  } });
  return { live, snapshot, plans: live.views.plans.element };
}

test('plan filters search native title, id and source path while retaining the selected document and input focus through polling', async () => {
  const { live, snapshot, plans } = browsingFixture(); await tick();
  const search = plans.querySelector('input[type="search"]');
  const lifecycle = plans.querySelector('select');
  const count = plans.querySelector('[role="status"]');
  const original = plans.querySelector('[data-testid="document-view"]');
  const resultIds = () => [...plans.querySelectorAll('[data-plan-id]')].map(control => control.dataset.planId);
  for (const query of ['ARCHIVED DELIVERY', 'plan:archive', 'research/live.md']) {
    search.value = query; search.dispatchEvent({ type: 'input' });
    assert.deepEqual(resultIds(), ['plan:archive']); assert.equal(count.textContent, '1 of 2 plans');
    assert.equal(plans.querySelector('[data-testid="document-view"]'), original);
  }
  lifecycle.value = 'active'; lifecycle.dispatchEvent({ type: 'change' });
  assert.equal(resultIds().length, 0); assert.match(plans.textContent, /No plans match/);
  search.focus(); live.update({ ...snapshot, revision: 4 }); await tick();
  assert.equal(plans.querySelector('input[type="search"]'), search);
  assert.equal(document.activeElement, search); assert.equal(search.value, 'research/live.md');
  assert.equal(lifecycle.value, 'active'); assert.equal(plans.querySelector('[data-testid="document-view"]'), original);
  const clear = plans.querySelector('.plan-filters button'); clear.click();
  assert.deepEqual(resultIds(), ['plan:live', 'plan:archive']); assert.equal(document.activeElement, search);
  assert.equal(clear.hidden, true);
});

test('source responses never steal focus or replace a newer cached plan selection', async () => {
  let complete;
  const { plans } = browsingFixture(async id => id === 'source:research'
    ? new Promise(resolve => { complete = resolve; }) : { path: id, content: '# First source' });
  await tick();
  plans.querySelector('[data-plan-id="plan:archive"]').click();
  const selected = plans.querySelector('[data-plan-id="plan:archive"]');
  assert.equal(document.activeElement, selected, 'focus moves to the replacement index control immediately');
  const search = plans.querySelector('input'); search.focus();
  complete({ path: 'research/live.md', content: '# Second source' }); await tick();
  assert.equal(document.activeElement, search, 'the completed read does not move focus from search');
  plans.querySelector('[data-plan-id="plan:live"]').click(); await tick();
  plans.querySelector('[data-plan-id="plan:archive"]').click();
  plans.querySelector('[data-plan-id="plan:live"]').click(); await tick();
  complete({ path: 'research/live.md', content: '# Delayed obsolete source' }); await tick();
  assert.match(plans.querySelector('.plan-detail').textContent, /First source/);
  assert.doesNotMatch(plans.querySelector('.plan-detail').textContent, /Delayed obsolete/);
});

test('a failed registered source read can retry in place and clears busy feedback on success', async () => {
  let calls = 0;
  const { plans } = browsingFixture(async id => {
    calls += 1; if (calls === 1) throw new Error('Temporarily missing');
    return { path: id, content: '# Recovered original' };
  });
  await tick();
  assert.match(plans.textContent, /Temporarily missing/);
  const retry = plans.querySelector('[data-action="retry-plan-source"]'); assert.ok(retry); retry.click();
  await tick();
  assert.match(plans.textContent, /Recovered original/);
  assert.equal(plans.querySelector('[data-action="retry-plan-source"]'), null);
  assert.equal(plans.querySelector('.plan-document-host').getAttribute('aria-busy'), 'false');
});

test('project summary figures refresh from the current native projection', async () => {
  const { live, snapshot } = browsingFixture(); await tick();
  const summary = live.views.project.element.querySelector('.project-summary');
  assert.equal(summary.querySelector('strong').textContent, '1');
  live.update({ ...snapshot, revision: 4, summary: { ...snapshot.summary, accepted_features: 7, plan_count: 2 } });
  assert.deepEqual([...summary.querySelectorAll('strong')].map(value => value.textContent), ['7', '0', '0', '0', '2']);
});

const runSnapshot = {
  schema_version: 1, project_id: 'project:live', run_id: 'run-live', revision: 7, plan_revision: 1,
  tasks: [{ id: 'T1', title: 'Run the live task', scope: 'Exercise the native task and attempt projection',
    priority: 1, depends_on: [], execution: 'running', verification: 'verifying', blocker: null,
    criteria: [{ id: 'C1' }], progress: {}, attempts: [{ id: 'attempt:live', task_id: 'T1',
      criterion_id: 'C1', criterion_version: 1, plan_revision: 1, consumed_plan_revision: 1,
      worker_id: 'worker:live', parent_task_id: null, source_revision: 'source:1', execution: 'running',
      verification: 'verifying', started_at: '2026-10-10T12:00:00.000Z', finished_at: null,
      evidence: [], provenance: { source_id: 'native', generation: 'g1', source_event_id: 'event:live',
        line: 1, kind: 'runtime', timestamp: '2026-10-10T12:00:00.000Z' } }] }],
};

test('live shell enables every layer, renders the registered long document, and drills plan to its bound run', async () => {
  const runElement = document.createElement('section'); runElement.dataset.testid = 'bound-run';
  const adapter = { source: async id => id === 'source:research'
    ? { source_id: id, path: 'research/live.md', sha256: 'c'.repeat(64), content: '# Research source\n\nNative context stays linked.\n' }
    : { source_id: id, path: '.omo/plans/live.md', sha256: 'a'.repeat(64),
      content: '# Live dashboard plan\n\n## Work\n\n- [ ] Keep the authored checklist read-only\n' },
    command: async () => { throw new Error('not used'); },
    assessTransition: async (_snapshot, _planId, to) => ({ allowed: false, from: 'active', to,
      reasons: [{ code: 'FIXTURE_READ_ONLY', detail: 'UI composition test' }] }),
    detail: async () => { throw new Error('not loaded in this scenario'); } };
  let shell;
  const live = createLiveProjectViews({ project, adapter, runElement, runId: 'run-live', runSnapshot,
    onDestinationRequest: destination => shell.selectDestination(destination),
    onOpenItem: item => shell.openItem(item),
    onOpenPlan: planId => shell.openPlan(planId) });
  shell = createProjectShell({ projectionProvider: () => overviewBundle(project), views: live.views });
  await tick();
  const destinations = [...shell.element.querySelectorAll('[data-destination]')];
  assert.equal(destinations.length, 8); assert.equal(destinations.every(control => !control.disabled), true);
  const context = shell.element.querySelector('[data-testid="shell-context"]').textContent;
  assert.match(context, /branch main @ b{12}/, 'the live project worktree supplies the compact header context');
  assert.doesNotMatch(context, /not projected|observed 2026/, 'source freshness is not mislabeled as Git observation time');

  shell.selectDestination('plans'); await tick();
  assert.ok(shell.element.querySelector('[data-testid="document-view"]'));
  assert.ok(shell.element.textContent.includes('Keep the authored checklist read-only'));
  assert.equal(shell.element.querySelector('.lb-tabs, [role="tablist"]'), null, 'no tab strip: the plans destination replaced the content in place');
  assert.deepEqual(shell.getStats().location, { destination: 'plans', item: null }, 'the location names the plans destination');
  assert.ok(shell.element.querySelector('[data-action="jump-to-plan-section"]'), 'the source anchor exposes an exact section jump');
  const documentElement = shell.element.querySelector('[data-testid="document-view"]');
  documentElement.querySelector('[data-document-mode="source"]').click();
  live.update({ ...project, revision: 4 }); await tick();
  assert.equal(shell.element.querySelector('[data-testid="document-view"]'), documentElement, 'polling retains the document view instance');
  assert.equal(documentElement.dataset.mode, 'source', 'polling retains the rendered/source selection');
  const run = shell.element.querySelector('[data-run-id="run-live"]'); assert.ok(run); run.click();
  assert.equal(shell.getStats().activeDestination, 'execution');
  const nested = shell.element.querySelector('[data-testid="execution-view"]');
  assert.ok(nested, 'the linked bound run opens the nested native task and attempt surface');
  assert.ok(shell.element.querySelector('[data-testid="bound-run"]'), 'the original authenticated run controls remain in a disclosure');
  shell.element.querySelector('[data-action="open-run-controls"]').click();
  assert.equal(shell.element.querySelector('.execution-run-controls').open, true, 'verification and evidence controls open explicitly');
  nested.querySelector('.execution-node[data-node-id="T1"]').click();
  nested.querySelector('[data-testid="execution-drill"]').click();
  const taskExecution = shell.element.querySelector('[data-testid="execution-view"]');
  assert.equal(taskExecution.dataset.level, 'task');
  taskExecution.querySelector('.execution-node[data-node-id="attempt:live"]').click();
  live.updateRun({ ...runSnapshot, revision: 8 });
  assert.equal(shell.element.querySelector('[data-testid="execution-view"]'), taskExecution, 'polling retains the nested execution instance');
  assert.equal(taskExecution.querySelector('.execution-node[data-node-id="attempt:live"]').getAttribute('aria-pressed'), 'true',
    'polling retains the selected attempt');
  assert.equal(shell.element.querySelector('.execution-run-controls').open, true, 'polling retains the original controls disclosure');
  taskExecution.querySelector('[data-crumb-level="batch"]').click();
  assert.equal(shell.element.querySelector('[data-testid="execution-view"]').dataset.level, 'batch');
  const back = shell.element.querySelector('[data-testid="shell-back"]'); assert.ok(back); back.click(); await tick();
  assert.equal(shell.getStats().activeDestination, 'plans', 'the page-header back affordance returns from the run to the plans location');
  shell.openPlan('plan:live'); await tick();
  assert.deepEqual(shell.getStats().location, { destination: 'plans', item: 'plan:plan:live' }, 'returning from a run reopens the plan as an in-place item');

  shell.selectDestination('research');
  assert.ok(shell.element.textContent.includes('The registered source remains readable from its native identity.'));
  assert.ok(shell.element.textContent.includes('Run execution is outside this finding.'));
  assert.ok(shell.element.textContent.includes('Keep the source and evidence links adjacent.'));
  shell.element.querySelector('.research-source button').click(); await tick();
  const researchDocument = shell.element.querySelector('[data-testid="document-view"]');
  assert.ok(researchDocument);
  assert.ok(shell.element.textContent.includes('Native context stays linked.'));
  live.update({ ...project, revision: 5 }); await tick();
  assert.equal(shell.element.querySelector('[data-testid="document-view"]'), researchDocument,
    'unchanged project polling retains the open research source document');
  assert.ok(shell.element.querySelector('[data-evidence-path="research/live.md"]'), 'retained source links to the Evidence destination');

  destinations[0].focus();
  document.dispatchEvent({ type: 'keydown', key: '2', code: 'Digit2', metaKey: true, cancelable: true });
  assert.equal(shell.getStats().activeDestination, 'project', 'Cmd/Ctrl+2 reaches the second destination from anywhere in the shell');
  assert.equal(shell.element.querySelector('.lb-sidebar-destination[aria-current="page"]').dataset.destination, 'project',
    'the sidebar current state follows the shortcut navigation');
});

// V2-T4 — the Health workspace destination composes from the sibling module
// ui/health-view.mjs through the exact contract (dynamic import,
// createHealthView({ adapter })). The module lands in parallel, so the proof
// accepts BOTH honest outcomes: the view mounting with its element, or the
// explicit unavailable panel while the module is absent — never a fabricated
// health surface either way.
test('the health destination mounts the sibling view or the honest unavailable panel (V2-T4)', async () => {
  const adapter = { source: async () => { throw new Error('not used'); },
    command: async () => { throw new Error('not used'); },
    assessTransition: async () => { throw new Error('not used'); },
    detail: async () => { throw new Error('not used'); } };
  let shell;
  const live = createLiveProjectViews({ project, adapter,
    onDestinationRequest: destination => shell.selectDestination(destination),
    onOpenItem: item => shell.openItem(item),
    onOpenPlan: planId => shell.openPlan(planId) });
  shell = createProjectShell({ projectionProvider: () => overviewBundle(project), views: live.views });
  await tick();

  const row = shell.element.querySelector('.lb-sidebar-destination[data-destination="health"]');
  assert.ok(row, 'the health destination row renders in the live shell');
  shell.selectDestination('health');
  await tick();
  await tick(); // the lazy dynamic import settles over a microtask
  assert.equal(shell.getStats().activeDestination, 'health');
  const surface = shell.element.querySelector('[data-testid="health-destination"]');
  assert.ok(surface, 'the health destination surface mounts in the content region');
  const view = surface.querySelector('[data-testid="health-view"]');
  if (view) {
    assert.ok(view.nodeType === 1, 'the sibling module mounted through createHealthView({ adapter })');
    assert.equal(surface.children[0], view, 'the mounted view owns the destination surface');
    // The base adapter exposes no health reader, so the narrowed adapter is
    // null and the view renders its OWN honest no-adapter state — never a
    // project record refused as a malformed health snapshot.
    assert.match(view.textContent, /no health adapter is connected/,
      'without a health reader the view states its honest unobserved case');
    // Project polling snapshots are NOT health snapshots — they must never
    // reach the schema-gated view (no malformed-refusal takeover).
    live.update({ ...project, revision: 9 });
    await tick();
    assert.match(live.views.health.getView().element.textContent, /no health adapter is connected/,
      'project polling never trips the health view refusal');
  } else {
    const unavailable = surface.querySelector('[data-testid="health-unavailable"]');
    assert.ok(unavailable, 'the honest unavailable panel renders while the module is absent');
    assert.ok(unavailable.textContent.includes('not available'), 'the panel names the actual reason');
    assert.ok(unavailable.textContent.includes('nothing is inferred'), 'no fabricated health state rides the panel');
  }
  // Updates keep flowing to whichever outcome owns the surface (no throw).
  live.update({ ...project, revision: 10 });
  await tick();
  assert.equal(shell.getStats().activeDestination, 'health', 'polling preserves the health destination');
});

test('leaving a dirty live editor asks through the shell guard; polls never spend the drafts (T20, stale_state)', async () => {
  const runElement = document.createElement('section');
  const adapter = { source: async id => ({ source_id: id, path: '.omo/plans/live.md', sha256: 'a'.repeat(64),
      content: '# Live dashboard plan\n\n## Work\n\n- [ ] Keep the authored checklist read-only\n' }),
    command: async () => { throw new Error('not used'); },
    assessTransition: async (_snapshot, _planId, to) => ({ allowed: false, from: 'active', to,
      reasons: [{ code: 'FIXTURE_READ_ONLY', detail: 'UI composition test' }] }),
    detail: async () => { throw new Error('not loaded in this scenario'); } };
  let shell;
  const live = createLiveProjectViews({ project, adapter, runElement, runId: 'run-live', runSnapshot,
    onDestinationRequest: destination => shell.selectDestination(destination),
    onOpenItem: item => shell.openItem(item),
    onOpenPlan: planId => shell.openPlan(planId) });
  shell = createProjectShell({ projectionProvider: () => overviewBundle(project), views: live.views });
  await tick();

  shell.selectDestination('project');
  await tick();
  const draftInput = shell.element.querySelector('[data-testid="edit-text"]');
  assert.ok(draftInput, 'the structured editor composes inside the project destination');
  const chip = shell.element.querySelector('[data-testid="editor-dirty-chip"]');
  assert.equal(chip.hidden, true, 'a clean editor shows no in-surface chip');
  draftInput.value = 'unsaved edit in the live shell';
  draftInput.dispatchEvent({ type: 'input' });
  assert.equal(chip.hidden, false, 'drafting lights the in-surface dirty chip');

  // A poll while dirty never spends the drafts (stale_state).
  live.update({ ...project, revision: 6 });
  await tick();
  assert.equal(chip.hidden, false, 'the chip survives the poll');
  assert.equal(draftInput.value, 'unsaved edit in the live shell', 'the draft survives the poll');

  // Sidebar leave while dirty: the guard asks; Keep editing aborts in place.
  shell.selectDestination('overview');
  await tick();
  const guard = shell.element.querySelector('[data-testid="editor-leave-guard"]');
  assert.ok(guard, 'the FO-3 leave guard renders inside the shell');
  assert.equal(guard.hidden, false, 'the leave guard opens');
  assert.equal(guard.textContent.includes('a composed source edit'), true, 'the guard names the pending change class');
  assert.equal(shell.getStats().activeDestination, 'project', 'the navigation holds while the guard is open');
  guard.querySelector('[data-testid="editor-leave-guard-cancel"]').click();
  await tick();
  assert.equal(guard.hidden, true, 'keep editing closes the guard');
  assert.equal(shell.getStats().activeDestination, 'project', 'keep editing aborts the navigation (cancel_resume)');
  assert.equal(draftInput.value, 'unsaved edit in the live shell', 'keep editing preserves the draft');

  // Discard completes the navigation and spends the drafts locally.
  shell.selectDestination('overview');
  await tick();
  guard.querySelector('[data-testid="editor-leave-guard-confirm"]').click();
  await tick();
  assert.equal(shell.getStats().activeDestination, 'overview', 'discard completes the navigation');
  assert.equal(draftInput.value, '', 'discard spends the drafts');
  shell.selectDestination('project');
  await tick();
  assert.equal(chip.hidden, true, 'returning to the destination shows a clean editor again');
});
