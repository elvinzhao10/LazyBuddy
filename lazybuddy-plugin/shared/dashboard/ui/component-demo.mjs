import { createTaskInspector } from './inspector-view.mjs';
import { createVerificationView } from './verification-view.mjs';
import { createWorkView } from './work-view.mjs';

const progress = ({ verified, total, stale = 0, failed = 0 }) => ({ denominator: 'required_criteria', total, verified, stale, failed, unavailable: 0, pending: total - verified - stale - failed, optional: 0, not_applicable: 0, criterion_versions: [] });
const scenario = { id: 'scenario:removal', requirement: 'Compare caller-owned files before and after removal', verifier_ref: 'removal-regression' };
const criterion = { id: 'criterion:remove', task_id: 'remove', version: 2, requirement: 'Offboarding preserves unrelated files', applicability: 'required', verification: 'failed', scenarios: [scenario], result_ids: ['attempt:remove'], history: [{ version: 1, requirement: 'Offboarding exits successfully', result_ids: ['attempt:old'] }] };
const provenance = { source_id: 'runtime', generation: '14', source_event_id: 'event:remove', line: 3, kind: 'runtime', timestamp: '2026-10-04T14:02:00Z' };
const attempt = { id: 'attempt:remove', task_id: 'remove', criterion_id: criterion.id, criterion_version: 2, plan_revision: 14, consumed_plan_revision: 14, worker_id: 'worker:remove', parent_task_id: 'remove', source_revision: 'demo-head', execution: 'failed', verification: 'failed', started_at: '2026-10-04T14:01:00Z', finished_at: '2026-10-04T14:02:00Z', evidence: [{ path: 'evidence/removal.log', sha256: null, provenance: 'illustrative demo fixture' }], provenance };
const task = item => ({ ...item, scope: item.scope ?? item.title, priority: item.priority ?? 0, blocker: item.blocker ?? null, criteria: item.criteria ?? [], attempts: item.attempts ?? [], progress: item.progress ?? progress({ verified: 0, total: 0 }) });
const baseSnapshot = { schema_version: 1, project_id: 'project:demo', run_id: 'run:demo', revision: 14, plan_revision: 14, queue_revision: 3, freshness: 'snapshot',
  cursor: { schema_version: 1, project_id: 'project:demo', run_id: 'run:demo', revision: 14, state_sha256: 'demo', queue_revision: 3, queue_sha256: 'demo', sources: [] },
  capabilities: { embedding: 'unobserved', chat_handoff: 'unobserved', wake: 'unobserved', observations: 'available' },
  tasks: [
    task({ id: 'setup', title: 'Prepare isolated workspace', depends_on: [], execution: 'finished', verification: 'verified', progress: progress({ verified: 2, total: 2 }) }),
    task({ id: 'install', title: 'Check installation', depends_on: ['setup'], execution: 'running', verification: 'verifying', priority: 2, progress: progress({ verified: 1, total: 3 }) }),
    task({ id: 'recover', title: 'Check recovery', depends_on: ['setup'], execution: 'running', verification: 'unverified', priority: 1, progress: progress({ verified: 0, total: 2 }) }),
    task({ id: 'remove', title: 'Check removal safety', depends_on: ['setup'], execution: 'failed', verification: 'failed', priority: 3, criteria: [criterion], attempts: [attempt], progress: progress({ verified: 0, total: 1, failed: 1 }) }),
    task({ id: 'join', title: 'Release readiness', depends_on: ['install', 'recover', 'remove'], execution: 'not_started', verification: 'unverified', blocker: 'Waiting for removal evidence.', progress: progress({ verified: 0, total: 2 }) }),
    task({ id: 'package', title: 'Package sibling adapters', depends_on: ['join'], execution: 'not_started', verification: 'unverified', progress: progress({ verified: 0, total: 1 }) }),
  ],
  decisions: [{ id: 'decision:logs', title: 'Choose removal log policy', choice: null, rationale: 'Decide which generated logs remain after offboard.', scope: ['remove'], alternatives: ['Retain all logs', 'Retain verified evidence only'], reference: null, state: 'proposed', supersedes: null, revision: 2 }],
  queue: [
    { id: 'plan:repair', project_id: 'project:demo', title: 'Repair removal check', priority: 3, readiness: 'ready', prerequisites: [], decision_id: null, revision: 3 },
    { id: 'plan:adapters', project_id: 'project:demo', title: 'Package sibling adapters', priority: 2, readiness: 'held', prerequisites: ['plan:repair'], decision_id: null, revision: 3 },
    { id: 'plan:timeline', project_id: 'project:demo', title: 'Explore observed timeline', priority: 1, readiness: 'draft', prerequisites: [], decision_id: null, revision: 3 },
    { id: 'plan:history', project_id: 'project:demo', title: 'Design history navigation', priority: 0, readiness: 'draft', prerequisites: [], decision_id: null, revision: 3 },
  ], acknowledgements: [], observations: [], issues: [] };

let snapshot = structuredClone(baseSnapshot);
const evidenceHref = evidence => `#${encodeURIComponent(evidence.path)}`;
const inspector = createTaskInspector({ snapshot, context: { evidenceHref } });
document.body.append(inspector.element);
const callbacks = { onSelect({ taskId, trigger }) { inspector.open(taskId, trigger); }, onLayoutChange({ taskId }) { document.querySelector('#demo-status').textContent = `Layout changed for ${taskId}. No command was sent.`; } };
const work = createWorkView({ snapshot, callbacks, context: { connection: 'connected' } });
const verification = createVerificationView({ snapshot, callbacks, context: { evidenceHref } });
document.querySelector('#work-root').append(work.element);
document.querySelector('#verification-root').append(verification.element);

function showView(name) {
  const isWork = name === 'work';
  document.querySelector('#work-root').hidden = !isWork;
  document.querySelector('#verification-root').hidden = isWork;
  document.querySelector('#work-tab').setAttribute('aria-selected', String(isWork));
  document.querySelector('#verification-tab').setAttribute('aria-selected', String(!isWork));
}
document.querySelector('#work-tab').addEventListener('click', () => showView('work'));
document.querySelector('#verification-tab').addEventListener('click', () => showView('verification'));
document.querySelector('#snapshot-update').addEventListener('click', () => {
  snapshot = structuredClone(snapshot); snapshot.revision += 1;
  snapshot.tasks.find(item => item.id === 'install').scope = `Snapshot revision ${snapshot.revision}; running observation retained.`;
  work.update(snapshot); verification.update(snapshot); inspector.update(snapshot);
  document.querySelector('#demo-status').textContent = `Demo snapshot revision ${snapshot.revision} applied. Selection and viewport retained.`;
});
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const theme = document.querySelector('#theme');
function applyTheme() { document.documentElement.dataset.theme = theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value; }
theme.addEventListener('change', applyTheme); systemTheme.addEventListener('change', applyTheme);
window.demo = { work, verification, inspector, applySnapshot() { document.querySelector('#snapshot-update').click(); } };
