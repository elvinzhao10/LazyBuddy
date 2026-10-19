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
  assert.equal(destinations.length, 7); assert.equal(destinations.every(control => !control.disabled), true);
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
