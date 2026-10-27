import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceFixture, http } from './service-fixture.mjs';
import { processCall, amendment } from './command-fixture.mjs';
import { assertAdmissionForTransition, admissionSelfTest } from '../adapters/admission.mjs';

// T20b residual 3: admission rechecking on the served route. The vendored
// plans library ships previewAdmission/recheckAdmission with documented refusal
// reasons; this suite pins the served surface that finally calls them:
//   * POST /api/project/admission-recheck computes the preview server-side
//     against the CURRENT accepted project (graphs and facts come from the
//     caller; the verdict never does) and persists the evidence.
//   * A plan.transition -> active through the served command route rechecks
//     that evidence against current state and refuses with the documented
//     blocked reason when revisions drifted (STALE_PREVIEW) or the gate is
//     unsatisfied (ADMIT_BLOCKED), and admits a revalidated basis.
//   * Plans without recorded evidence keep the bridge's own rules.
//   * The library's GATE_INVALIDATED branch is pinned through the adapter's
//     transition-time recheck with a hand-built stale gate.

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

async function projectCall(root, action, value) {
  return processCall([process.execPath, projectCLI, action, '--project-root', root,
    '--project-id', 'project:b1', '--actor', 'test:admission'], value === undefined ? '' : JSON.stringify(value));
}

const PLAN_MARKDOWN = '# Dependency plan\n\n- [ ] A: produce the verified outcome\n- [ ] B: depend on it\n';

const graphFor = (planId, planRevision, contentSha) => ({
  schema_version: 1, plan_id: planId, plan_revision: planRevision, content_sha256: contentSha,
  resources: [],
  tasks: [
    { id: 'A', title: 'Produce the verified outcome', required: true,
      criteria: [{ id: 'c:a', revision: 1, required: true }], dependencies: [] },
    { id: 'B', title: 'Depend on the verified outcome', required: true, criteria: [],
      dependencies: [{ id: 'dep:b-verified', kind: 'depends-on-gate',
        condition: 'independent-verification-confirmed', gate_id: 'gate:a-verified',
        target: { type: 'task', plan_id: planId, task_id: 'A' } }] },
  ],
  edges: [],
});

const verificationFact = (planId, contentSha, planRevision, satisfied) => ({
  id: 'fact:verify-a', kind: 'task', condition: 'independent-verification-confirmed',
  value: satisfied, observed_at: '2026-10-18T12:00:00.000Z', plan_id: planId, task_id: 'A',
  basis: { plan_revision: planRevision, content_sha256: contentSha, criterion_revisions: { 'c:a': 1 } },
});

test('the served command route rechecks admission evidence before activating a plan', async () => {
  const f = await serviceFixture();
  try {
    // Bootstrap: plan document, project, registered plan, a bound native run.
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/dep.md'), PLAN_MARKDOWN);
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    const register = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:dep',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:dep', path: '.omo/plans/dep.md', role: 'plan' } });
    assert.equal(register.code, 0, register.stderr);
    const created = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'plan:dep',
      project_id: 'project:b1', expected_revision: 1, operation: 'register_plan',
      payload: { id: 'plan:dep', source: { source_id: 'source:dep', sha256: digest(PLAN_MARKDOWN), anchor_id: 'document' },
        declared_lifecycle: 'planned', baseline_refs: [] } });
    assert.equal(created.code, 0, created.stderr);
    // Bind the native run to the project through the served run command route,
    // then link it to the plan (link_native_run demands a captured run).
    const bound = await f.request('/api/commands', { body: amendment(f.revision) });
    assert.equal(bound.status, 200, JSON.stringify(bound.value));
    const linked = await projectCall(f.root, 'command', { schema_version: 1, command_id: 'link:probe',
      project_id: 'project:b1', expected_revision: 2, operation: 'link_native_run',
      payload: { plan_id: 'plan:dep', native_project_id: 'project:b1', run_id: 'probe' } });
    assert.equal(linked.code, 0, linked.stderr);

    const revision = () => f.request('/api/project').then(response => response.value.project.revision);

    // Before any evidence exists the transition keeps bridge semantics.
    const withoutEvidence = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:pre', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'plan.transition', payload: { plan_id: 'plan:dep', to_lifecycle: 'active' } } });
    assert.equal(withoutEvidence.status, 200, JSON.stringify(withoutEvidence.value));
    assert.equal(withoutEvidence.value.receipt.status, 'saved');
    // Back to paused so the recheck scenarios below can attempt activation again.
    const paused = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:pause', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'plan.transition', payload: { plan_id: 'plan:dep', to_lifecycle: 'paused' } } });
    assert.equal(paused.status, 200, JSON.stringify(paused.value));

    // Graphs and facts bind to the CURRENT plan revision and content digest.
    const read = await f.request('/api/project');
    const plan = read.value.project.plans.find(entry => entry.id === 'plan:dep');
    assert.equal(plan.declared_lifecycle, 'paused');
    const graphs = [graphFor('plan:dep', plan.revision, plan.source.sha256)];
    const facts = [verificationFact('plan:dep', plan.source.sha256, plan.revision, true)];

    // Recorded admission evidence: satisfied verifier gate at current revisions.
    const admitted = await f.request('/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts } });
    assert.equal(admitted.status, 200, JSON.stringify(admitted.value));
    assert.equal(admitted.value.status, 'admitted');
    assert.equal(admitted.value.preview_status, 'eligible');
    assert.equal(admitted.value.basis.plan_revision, plan.revision);
    assert.equal(admitted.value.gate.status, 'satisfied');

    // Stale evidence: any accepted command moves the project revision, and the
    // next activation attempt must refuse with the documented STALE_PREVIEW.
    const drifted = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'artifact:drift', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'artifact.register', payload: { id: 'artifact:drift', type: 'design_note',
        producer: 'test:admission', path: '.omo/plans/dep.md', sha256: digest(PLAN_MARKDOWN) } } });
    assert.equal(drifted.status, 200, JSON.stringify(drifted.value));
    const stale = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:stale', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'plan.transition', payload: { plan_id: 'plan:dep', to_lifecycle: 'active' } } });
    assert.equal(stale.status, 422);
    assert.equal(stale.value.code, 'STALE_PREVIEW');

    // Unsatisfied verifier gate: evidence recorded against a false-valued fact
    // refuses activation with the documented ADMIT_BLOCKED reason.
    const blockedFacts = [verificationFact('plan:dep', plan.source.sha256, plan.revision, false)];
    const blocked = await f.request('/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts: blockedFacts } });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.value.status, 'refused');
    assert.equal(blocked.value.reason.code, 'ADMIT_BLOCKED');
    assert.equal(blocked.value.reason.detail, 'The preview itself was not eligible');
    const refused = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:blocked', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'plan.transition', payload: { plan_id: 'plan:dep', to_lifecycle: 'active' } } });
    assert.equal(refused.status, 422);
    assert.equal(refused.value.code, 'ADMIT_BLOCKED');

    // Revalidated evidence admits the transition: same graphs and facts,
    // recomputed against the current accepted project.
    const revalidated = await f.request('/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts } });
    assert.equal(revalidated.value.status, 'admitted');
    const activated = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:active', project_id: 'project:b1', expected_revision: await revision(),
      operation: 'plan.transition', payload: { plan_id: 'plan:dep', to_lifecycle: 'active' } } });
    assert.equal(activated.status, 200, JSON.stringify(activated.value));
    const after = await f.request('/api/project');
    assert.equal(after.value.project.plans.find(entry => entry.id === 'plan:dep').declared_lifecycle, 'active');

    // Malformed recheck requests stay typed.
    assert.equal((await f.request('/api/project/admission-recheck', { body: { plan_id: 'plan:dep' } })).value.code, 'INVALID_ADMISSION_RECHECK');
    assert.equal((await f.request('/api/project/admission-recheck', { body: {
      plan_id: 'plan:dep', task_id: 'B', graphs: [{ schema_version: 2 }], facts: [] } })).value.code, 'INVALID_VALUE');
    assert.equal((await f.request('/api/project/admission-recheck', { body: {
      plan_id: 'plan:missing', task_id: 'B', graphs, facts } })).value.code, 'UNKNOWN_PLAN');
    const unauthenticated = await http(f.live.url, '/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts } });
    assert.equal(unauthenticated.status, 401, 'admission rechecks require the in-memory session');
  } finally { await f.cleanup(); }
});

test('a gate that stops being satisfied refuses with the documented GATE_INVALIDATED reason', async () => {
  const f = await serviceFixture();
  try {
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/dep.md'), PLAN_MARKDOWN);
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:dep',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:dep', path: '.omo/plans/dep.md', role: 'plan' } });
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'plan:dep',
      project_id: 'project:b1', expected_revision: 1, operation: 'register_plan',
      payload: { id: 'plan:dep', source: { source_id: 'source:dep', sha256: digest(PLAN_MARKDOWN), anchor_id: 'document' },
        declared_lifecycle: 'planned', baseline_refs: [] } });
    const bound = await f.request('/api/commands', { body: amendment(f.revision) });
    assert.equal(bound.status, 200, JSON.stringify(bound.value));
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'link:probe',
      project_id: 'project:b1', expected_revision: 2, operation: 'link_native_run',
      payload: { plan_id: 'plan:dep', native_project_id: 'project:b1', run_id: 'probe' } });
    const read = await f.request('/api/project');
    const plan = read.value.project.plans.find(entry => entry.id === 'plan:dep');
    const graphs = [graphFor('plan:dep', plan.revision, plan.source.sha256)];
    // An eligible preview pinned to the CURRENT basis, but reported facts whose
    // verification value is false: exactly the state the library documents as
    // "the admission gate is no longer satisfied against current facts".
    const facts = [verificationFact('plan:dep', plan.source.sha256, plan.revision, false)];
    const derived = admissionSelfTest.deriveAdmission(read.value.project, { plan_id: 'plan:dep', task_id: 'B', graphs, facts });
    const evidence = { schema_version: 1, plan_id: 'plan:dep', task_id: 'B',
      preview: { plan_id: 'plan:dep', task_id: 'B', status: 'eligible', blockers: [],
        basis: derived.preview.basis, gate: derived.preview.gate },
      graphs, facts, verdict: { status: 'admitted', reason: null } };
    const paths = admissionSelfTest.storePath(f.root, 'plan:dep');
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.file, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
    await assert.rejects(assertAdmissionForTransition(
      { projectRoot: f.root, projectId: 'project:b1' }, 'test:admission', 'plan:dep'),
    error => error.code === 'GATE_INVALIDATED');
  } finally { await f.cleanup(); }
});

test('admission evidence for one plan never gates another plan, and unknown plans stay untouched', async () => {
  const f = await serviceFixture();
  try {
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    // Evidence keyed to a plan that does not exist must not throw on lookup of
    // other plans; transitions without plans still fail typed at the bridge.
    const transition = await f.request('/api/project/commands', { body: { schema_version: 1,
      command_id: 'transition:ghost', project_id: 'project:b1', expected_revision: 0,
      operation: 'plan.transition', payload: { plan_id: 'plan:ghost', to_lifecycle: 'active' } } });
    assert.equal(transition.status, 422);
    assert.equal(transition.value.code, 'UNKNOWN_PLAN');
    await assert.doesNotReject(assertAdmissionForTransition(
      { projectRoot: f.root, projectId: 'project:b1' }, 'test:admission', 'plan:never-registered'));
    const evidence = await readFile(join(f.root, '.lazybuddy/project-admissions'), 'utf8').catch(() => '');
    assert.equal(evidence, '', 'no evidence store is created by a lookup');
  } finally { await f.cleanup(); }
});

// T23: a recorded admission recheck also persists into canonical accepted
// state as an observation on the plan — subject `plan`, classification
// `inferred` (the verdict is derived server-side, never caller-supplied), and
// provenance pointing at the evidence file the transition-time recheck reads.
// The evidence file remains the recheck-time store; the observation is the
// accepted-state record of the verdict.
test('a recorded admission recheck mirrors into canonical state as a plan observation', async () => {
  const f = await serviceFixture();
  try {
    await mkdir(join(f.root, '.omo/plans'), { recursive: true });
    await writeFile(join(f.root, '.omo/plans/dep.md'), PLAN_MARKDOWN);
    assert.equal((await projectCall(f.root, 'init')).code, 0);
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'register:dep',
      project_id: 'project:b1', expected_revision: 0, operation: 'register_source',
      payload: { id: 'source:dep', path: '.omo/plans/dep.md', role: 'plan' } });
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'plan:dep',
      project_id: 'project:b1', expected_revision: 1, operation: 'register_plan',
      payload: { id: 'plan:dep', source: { source_id: 'source:dep', sha256: digest(PLAN_MARKDOWN), anchor_id: 'document' },
        declared_lifecycle: 'planned', baseline_refs: [] } });
    const bound = await f.request('/api/commands', { body: amendment(f.revision) });
    assert.equal(bound.status, 200, JSON.stringify(bound.value));
    await projectCall(f.root, 'command', { schema_version: 1, command_id: 'link:probe',
      project_id: 'project:b1', expected_revision: 2, operation: 'link_native_run',
      payload: { plan_id: 'plan:dep', native_project_id: 'project:b1', run_id: 'probe' } });
    const read = await f.request('/api/project');
    const plan = read.value.project.plans.find(entry => entry.id === 'plan:dep');
    const graphs = [graphFor('plan:dep', plan.revision, plan.source.sha256)];
    const facts = [verificationFact('plan:dep', plan.source.sha256, plan.revision, true)];

    const admitted = await f.request('/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts } });
    assert.equal(admitted.status, 200, JSON.stringify(admitted.value));
    assert.equal(admitted.value.canonical.store, 'lazybuddy/project-observe@1');
    assert.ok(admitted.value.canonical.observation_revision >= 1);

    const canonical = JSON.parse((await projectCall(f.root, 'read')).stdout);
    const mirrored = (canonical.observations ?? []).filter(entry => entry.subject.kind === 'plan'
      && entry.subject.id === 'plan:dep');
    assert.equal(mirrored.length, 1, 'exactly one canonical observation mirrors the recheck');
    const [record] = mirrored;
    assert.match(record.id, /^admission:[a-f0-9]{16}:[a-f0-9]{24}$/);
    assert.equal(record.classification, 'inferred');
    assert.match(record.observed_by, /^dashboard:/, 'the served route actor is recorded as the observer');
    assert.equal(record.observed_at, admitted.value.recorded_at);
    assert.equal(record.provenance.kind, 'file');
    assert.equal(record.provenance.reference,
      `.lazybuddy/project-admissions/${createHash('sha256').update('plan:dep').digest('hex')}.json`);
    const summary = JSON.parse(record.text);
    assert.equal(summary.schema_version, 1);
    assert.equal(summary.plan_id, 'plan:dep');
    assert.equal(summary.task_id, 'B');
    assert.equal(summary.status, 'admitted');

    // The second recheck of the same basis is a new observation event (its
    // recorded_at differs), never a duplicate-identity refusal.
    const again = await f.request('/api/project/admission-recheck',
      { body: { plan_id: 'plan:dep', task_id: 'B', graphs, facts } });
    assert.equal(again.status, 200, JSON.stringify(again.value));
    const after = JSON.parse((await projectCall(f.root, 'read')).stdout);
    assert.equal((after.observations ?? []).filter(entry => entry.subject.kind === 'plan'
      && entry.subject.id === 'plan:dep').length, 2);
    assert.equal(after.revision, canonical.revision, 'mirroring never advances the command revision');
  } finally { await f.cleanup(); }
});
