import test from 'node:test';
import assert from 'node:assert/strict';
import { projectArchitecture, productJourney } from '../architecture.mjs';

function state() {
  return {
    plans: [{ id: 'plan:search', revision: 1, edges: [
      { id: 'e1', kind: 'shares-component', from_plan_id: 'plan:search', component_id: 'component:index' },
    ] }],
    architecture: [
      { id: 'component:index', role: 'search index over notes', contains: [], state: 'accepted',
        relationships: [{ kind: 'uses', to: 'component:store', basis: 'authored' }] },
      { id: 'component:store', role: 'local note storage', contains: [], state: 'accepted', relationships: [] },
      { id: 'component:cloud-sync', role: 'optional cloud sync', contains: [], state: 'proposed',
        relationships: [{ kind: 'replaces', to: 'component:store', basis: 'authored' }] },
    ],
  };
}
const OBSERVATIONS = [
  { component_id: 'component:index', observed_at: '2026-10-06T10:00:00Z', content_revision: 'a1b2c3',
    paths: ['src/index.ts'], coverage: 'path-exact', basis: 'git-observation' },
  { component_id: 'component:store', observed_at: '2026-10-06T10:00:00Z', content_revision: 'a1b2c3',
    paths: ['src/store.ts'], coverage: 'path-exact', basis: 'git-observation' },
  { component_id: 'component:temp-cache', observed_at: '2026-10-06T10:00:00Z', content_revision: 'a1b2c3',
    paths: ['src/cache/'], coverage: 'directory-prefix', basis: 'git-observation' },
];

test('current/planned/change views share identities and expose source scope', () => {
  const views = projectArchitecture(state(), { observations: OBSERVATIONS });
  assert.deepEqual(views.identities, ['component:cloud-sync', 'component:index', 'component:store', 'component:temp-cache']);
  const current = views.current.find(entry => entry.id === 'component:index');
  assert.equal(current.implementation, 'observed');
  assert.deepEqual(current.paths, ['src/index.ts']);
  assert.equal(current.coverage, 'path-exact');
  const planned = views.planned.find(entry => entry.id === 'component:cloud-sync');
  assert.equal(planned.treatment, 'ghost'); // proposed components use the ghost treatment, visibly
  assert.equal(planned.state, 'proposed');
  assert.deepEqual(views.change.additions.map(entry => entry.id), ['component:temp-cache']);
  assert.deepEqual(views.change.open_migrations.map(entry => entry.id), ['component:cloud-sync']);
  assert.deepEqual(views.change.replacements.map(entry => entry.id), ['component:cloud-sync']);
});

test('implementation and verification are separate: observed without proof is not-verified', () => {
  const views = projectArchitecture(state(), { observations: OBSERVATIONS, verification_evidence: [{ component_id: 'component:index' }] });
  assert.equal(views.current.find(entry => entry.id === 'component:index').verification, 'verified');
  assert.equal(views.current.find(entry => entry.id === 'component:store').verification, 'not-verified');
});

test('contributing plans attach through shares-component edges only', () => {
  const views = projectArchitecture(state(), { observations: OBSERVATIONS });
  assert.deepEqual(views.planned.find(entry => entry.id === 'component:index').contributing_plans, ['plan:search']);
  assert.deepEqual(views.planned.find(entry => entry.id === 'component:store').contributing_plans, []);
});

test('an authored element with no observation is an open migration, and the gap is honest', () => {
  const views = projectArchitecture(state(), { observations: [] });
  const migration = views.change.open_migrations.find(entry => entry.id === 'component:store');
  assert.equal(migration.state, 'accepted');
  assert.match(migration.detail, /migration or collector gap/);
  assert.match(views.coverage_note, /never verified/);
});

test('journeys are authored content over real components and fail closed on unauthored steps', () => {
  const journey = productJourney(state(), [
    { component_id: 'component:index', interaction: 'user searches notes', source: 'docs/project/architecture.md#search' },
    { component_id: 'component:store', interaction: 'results read local storage' },
  ]);
  assert.equal(journey.steps.length, 2);
  assert.equal(journey.basis.includes('agent-authored'), true);
  assert.throws(() => productJourney(state(), [
    { component_id: 'component:index', interaction: 'ok' },
    { component_id: 'component:imaginary', interaction: 'not authored' },
  ]), error => error.code === 'UNKNOWN_ITEM');
});

test('malformed observations fail closed', () => {
  assert.throws(() => projectArchitecture(state(), { observations: [{ component_id: 'x' }] }),
    error => error.code === 'MISSING_FIELD'); // observed_at is required
  assert.throws(() => projectArchitecture(state(), { observations: 'nope' }),
    error => error.code === 'INVALID_VALUE');
  assert.throws(() => projectArchitecture(state(), { observations: [], verification_evidence: 'nope' }),
    error => error.code === 'INVALID_VALUE');
});
