import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T17 interface under test: architecture lenses over T13's three views. The
// fixture is REAL end to end — a disposable git repository with two tracked
// component files plus an unmapped path, project records authored through the
// actual T02 CLI command route (record_architecture_elements, feature item with
// component applicability, a pending baseline proposal carrying the proposed
// component, a registered plan), observations from the real T11 local-git
// collector binding, and declared verification evidence for exactly one
// component. The T17 adapter calls T13's projectArchitecture/productJourney;
// the DOM view renders one identity set under both lenses and all three views.
const dom = createMiniDom();
globalThis.document = dom.document;

const { collectLocalGitFacts } = await import('../../project/git-observation/local.mjs');
const { authorPlanGraph, composeGraphSet } = await import('../../project/plans/dependencies.mjs');
const { architectureFixture, ArchitectureProjectionError } = await import('../ui/architecture-model.mjs');
const { createArchitectureView } = await import('../ui/architecture-view.mjs');
const asSet = values => new Set(values);

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PROJECT_ID = 'project:t17';
const ACTOR = 'local:t17-test';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const evidenceDirectory = process.env.T17_EVIDENCE_DIR
  ?? '/Users/Admin/Desktop/lazyseries/.omo/evidence/lazyseries-1.4.0-project-platform/T17';

const ARCHITECTURE_DOC = `# Architecture

## application:notes-app — Offline notes application

One application: a local notes workspace with local search and storage.

## component:notes-ui — Note workspace

The user opens a workspace, edits notes, and issues find requests.

## component:search-index — Local search index

Answers find queries from a local index without a network.

## component:note-store — Local note storage

Owns the durable note documents on local disk.

## component:cloud-sync — Optional cloud sync

Proposed: sync notes through an optional cloud relay.
`;

const REQUIREMENTS_DOC = `# Requirements

## feature:notes — Personal notes

People create, find, and keep their own notes locally.
`;

const PLAN_DOC = `# Search plan

Build the local search index over the note store.
`;

const VERIFICATION_DOC = `# Search index verification

An independent check that the local search index answers find queries offline.
`;

function invokeProject(root, action, input) {
  const result = spawnSync(process.execPath, [projectCLI, action, '--project-root', root, '--project-id', PROJECT_ID,
    '--actor', ACTOR], { cwd: root, input: input ?? '', encoding: 'utf8', timeout: 30000 });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function reduceCLI(action, state, contextOptions) {
  const result = spawnSync(process.execPath, [projectCLI, '--reduce'], {
    stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify({ action, state, context: contextOptions ?? {} }),
    encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`--reduce ${action} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function runGit(root, args, env = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: root, ...env } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

const fixture = { root: null };

test.before(async () => {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 't17-architecture-')));
  fixture.root = root;
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.name', 'Architecture QA']);
  runGit(root, ['config', 'user.email', 'architecture@example.invalid']);
  writeFileSync(join(root, '.gitignore'), '.lazybuddy/\n');
  mkdirSync(join(root, 'docs/project/verification'), { recursive: true });
  mkdirSync(join(root, '.omo/plans'), { recursive: true });
  mkdirSync(join(root, 'src/search'), { recursive: true });
  mkdirSync(join(root, 'src/store'), { recursive: true });
  mkdirSync(join(root, 'src/temp'), { recursive: true });
  writeFileSync(join(root, 'docs/project/architecture.md'), ARCHITECTURE_DOC);
  writeFileSync(join(root, 'docs/project/requirements.md'), REQUIREMENTS_DOC);
  writeFileSync(join(root, 'docs/project/verification/search-index.md'), VERIFICATION_DOC);
  writeFileSync(join(root, '.omo/plans/search.md'), PLAN_DOC);
  writeFileSync(join(root, 'src/search/index.ts'), 'export function find() { return []; }\n');
  writeFileSync(join(root, 'src/store/notes.ts'), 'export const notes: string[] = [];\n');
  writeFileSync(join(root, 'src/temp/cache.ts'), 'export const cache = new Map();\n');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 't17 fixture baseline']);

  // The real T02 CLI route: init, sources, architecture elements, feature item,
  // plan, pending proposal — every record through the shared command route.
  const init = invokeProject(root, 'init');
  assert.equal(init.code, 0, init.stderr);
  assert.ok(existsSync(join(root, '.lazyseries/project.json')), 'explicit init creates the neutral registry');
  let revision = 0;
  const command = (operation, payload) => {
    const result = invokeProject(root, 'command', JSON.stringify({ schema_version: 1,
      command_id: `t17:${operation}:${revision}`, project_id: PROJECT_ID, expected_revision: revision,
      operation, payload }));
    if (result.code !== 0) throw new Error(`${operation} failed: ${result.stderr}\n${result.stdout}`);
    revision += 1;
    return JSON.parse(result.stdout);
  };

  command('register_source', { id: 'source:architecture', path: 'docs/project/architecture.md', role: 'architecture' });
  command('register_source', { id: 'source:requirements', path: 'docs/project/requirements.md', role: 'requirements' });
  command('register_source', { id: 'source:search-plan', path: '.omo/plans/search.md', role: 'plan' });
  const architectureDigest = digest(ARCHITECTURE_DOC);
  const requirementsDigest = digest(REQUIREMENTS_DOC);
  const planDigest = digest(PLAN_DOC);
  const sourceRef = (sourceId, sha, anchor) => ({ source_id: sourceId, sha256: sha, anchor_id: anchor });
  command('record_architecture_elements', { elements: [
    { id: 'application:notes-app', kind: 'application', title: 'Offline notes application',
      role: 'One application: a local notes workspace with local search and storage.',
      source: sourceRef('source:architecture', architectureDigest, 'heading:application:notes-app — Offline notes application'),
      parent_id: null, relationships: [] },
    { id: 'component:notes-ui', kind: 'component', title: 'Note workspace',
      role: 'The user opens a workspace, edits notes, and issues find requests.',
      source: sourceRef('source:architecture', architectureDigest, 'heading:component:notes-ui — Note workspace'),
      parent_id: 'application:notes-app',
      relationships: [{ target_id: 'component:search-index', kind: 'uses', note: 'issues find requests' }] },
    { id: 'component:search-index', kind: 'interface', title: 'Local search index',
      role: 'Answers find queries from a local index without a network.',
      source: sourceRef('source:architecture', architectureDigest, 'heading:component:search-index — Local search index'),
      parent_id: 'application:notes-app',
      relationships: [{ target_id: 'component:note-store', kind: 'uses', note: 'reads stored notes' }] },
    { id: 'component:note-store', kind: 'data_store', title: 'Local note storage',
      role: 'Owns the durable note documents on local disk.',
      source: sourceRef('source:architecture', architectureDigest, 'heading:component:note-store — Local note storage'),
      parent_id: 'application:notes-app', relationships: [] },
    { id: 'component:cloud-sync', kind: 'component', title: 'Optional cloud sync',
      role: 'Proposed: sync notes through an optional cloud relay.',
      source: sourceRef('source:architecture', architectureDigest, 'heading:component:cloud-sync — Optional cloud sync'),
      parent_id: 'application:notes-app',
      relationships: [{ target_id: 'component:note-store', kind: 'uses', note: 'writes through the relay' }] },
  ] });
  command('record_baseline_items', { items: [
    { id: 'feature:notes', kind: 'feature', state: 'accepted',
      source: sourceRef('source:requirements', requirementsDigest, 'heading:feature:notes — Personal notes'),
      applicability: { scope: 'component',
        subject_ids: ['component:notes-ui', 'component:search-index', 'component:note-store', 'component:cloud-sync'] } },
  ] });
  command('register_plan', { id: 'plan:search', source: sourceRef('source:search-plan', planDigest, 'document'),
    declared_lifecycle: 'planned', baseline_refs: [{ item_id: 'feature:notes', item_revision: 1 }] });
  command('record_baseline_proposal', {
    id: 'proposal:cloud-relay', summary: 'Adopt the optional cloud-sync component for the notes feature',
    patches: [{ source_id: 'source:architecture', anchor_id: 'document', current_sha256: architectureDigest,
      proposed_text: `${ARCHITECTURE_DOC}\nThe cloud relay supersedes direct local storage for sync.\n` }],
    options: [{ id: 'option:adopt-relay', title: 'Adopt the relay', summary: 'Cloud sync becomes optional-but-default.' }],
    impact: { item_ids: [], plan_ids: [], architecture_ids: ['component:cloud-sync'] },
    evidence_observation_ids: [],
    unresolved: 'Adopt the proposed cloud-sync component, or keep the local-only store?' });

  fixture.state = JSON.parse(readFileSync(join(root, '.lazybuddy/project/state.json'), 'utf8'));

  // Real observation input: dirty the two component files plus an unmapped
  // path, then run the T11 collector over the repository source scope.
  writeFileSync(join(root, 'src/search/index.ts'), 'export function find() { return []; }\n// touched for observation\n');
  writeFileSync(join(root, 'src/store/notes.ts'), 'export const notes: string[] = [];\n// touched for observation\n');
  writeFileSync(join(root, 'src/temp/cache.ts'), 'export const cache = new Map();\n// touched for observation\n');
});

test.after(() => {
  const receipt = [];
  if (fixture.root) {
    if (existsSync(fixture.root)) {
      rmSync(fixture.root, { recursive: true, force: true });
      receipt.push('fixture-root-removed');
    }
    assert.equal(existsSync(fixture.root), false);
  }
  process.stdout.write(`cleanup receipt: ${receipt.join(',')}\n`);
});

function graphDocuments(state) {
  const plan = state.plans.find(entry => entry.id === 'plan:search');
  const document = { schema_version: 1, plan_id: 'plan:search', plan_revision: plan.revision,
    content_sha256: plan.source.sha256, resources: [],
    tasks: [{ id: 's1', title: 'Build the local search index', criteria: [], dependencies: [] }],
    edges: [
      { id: 'edge:search-feature', kind: 'contributes-to-feature', from_plan_id: 'plan:search', item_id: 'feature:notes' },
      { id: 'edge:search-component', kind: 'shares-component', from_plan_id: 'plan:search', component_id: 'component:search-index' },
    ] };
  authorPlanGraph(document);
  // The T07 composer must accept the shares-component edge against the real
  // registered plan before the projection consumes it.
  composeGraphSet([document], { state });
  return [document];
}

const AGENT_INPUTS = {
  componentScopes: [
    { component_id: 'component:search-index', paths: ['src/search/index.ts'], coverage: 'path-exact',
      source: 'docs/project/architecture.md#component:search-index' },
    { component_id: 'component:note-store', paths: ['src/store/notes.ts'], coverage: 'path-exact',
      source: 'docs/project/architecture.md#component:note-store' },
  ],
  supersessions: [
    { successor_id: 'component:cloud-sync', superseded_id: 'component:note-store',
      source: 'docs/project/architecture.md#component:cloud-sync' },
  ],
  journeys: [
    { id: 'journey:find-note', title: 'Finding a note', steps: [
      { component_id: 'component:notes-ui', interaction: 'user action — opens the workspace and types a search',
        source: 'docs/project/architecture.md#component:notes-ui' },
      { component_id: 'component:search-index', interaction: 'UI — the workspace queries the local search interface',
        source: 'docs/project/architecture.md#component:search-index' },
      { component_id: 'component:note-store', interaction: 'data store — results read the durable note documents',
        source: 'docs/project/architecture.md#component:note-store' },
    ] },
  ],
  verification: [
    { component_id: 'component:search-index', source: 'docs/project/verification/search-index.md' },
  ],
};

function buildFixture(gitFacts, state = fixture.state) {
  const snapshot = reduceCLI('snapshot', state);
  return architectureFixture({ snapshot, graphs: graphDocuments(state), ...structuredClone(AGENT_INPUTS), gitFacts });
}

function chipStates(control) {
  const chipsInOrder = [...control.querySelectorAll('.status')];
  return chipsInOrder.map(chipNode => ({ state: chipNode.dataset.state, label: chipNode.textContent }));
}

test('architecture lenses render the real fixture with shared identities and stable statuses', async () => {
  const gitFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  assert.equal(gitFacts.status, 'observed', 'the real collector observed the disposable repository');
  assert.equal(gitFacts.head, runGit(fixture.root, ['rev-parse', 'HEAD']).trim());
  const projected = buildFixture(gitFacts);

  // T13 outputs over the real records: identities, three views, ghost, evidence.
  assert.deepEqual(projected.identities, ['application:notes-app', 'component:cloud-sync', 'component:note-store',
    'component:notes-ui', 'component:search-index', 'observed-path:src/temp/cache.ts']);
  assert.deepEqual(projected.current.map(entry => entry.id).sort(), ['component:note-store', 'component:search-index', 'observed-path:src/temp/cache.ts']);
  assert.deepEqual(projected.planned.map(entry => entry.id).sort(), ['application:notes-app', 'component:cloud-sync', 'component:note-store', 'component:notes-ui', 'component:search-index']);
  assert.deepEqual(projected.change.additions.map(entry => entry.id), ['observed-path:src/temp/cache.ts']);
  assert.deepEqual(projected.change.open_migrations.map(entry => entry.id),
    ['application:notes-app', 'component:notes-ui', 'component:cloud-sync']);
  assert.deepEqual(projected.change.replacements.map(entry => entry.id), ['component:cloud-sync']);
  assert.equal(projected.planned.find(entry => entry.id === 'component:cloud-sync').treatment, 'ghost');
  assert.equal(projected.components['component:search-index'].status.verification.state, 'verified');
  assert.equal(projected.components['component:note-store'].status.verification.state, 'attention');
  assert.match(projected.components['component:note-store'].status.verification.label, /not verified/);
  assert.equal(projected.components['component:search-index'].observation.content_revision, gitFacts.head);
  assert.deepEqual(projected.components['component:search-index'].intent.contributing_plans, ['plan:search']);
  assert.equal(projected.journeys.length, 1);
  assert.equal(projected.journeys[0].steps.length, 3);

  // Feature navigation records use the recorded identities exactly.
  assert.deepEqual(projected.features.map(feature => feature.id), ['feature:notes']);
  const feature = projected.features[0];
  assert.deepEqual(feature.affected_plan_ids, ['plan:search']);
  assert.deepEqual(feature.open_decision_ids, ['proposal:cloud-relay']);
  assert.deepEqual(feature.code_paths, ['src/search/index.ts', 'src/store/notes.ts']);
  assert.deepEqual(feature.verification.map(entry => entry.component_id), ['component:search-index']);

  const view = createArchitectureView({ fixture: projected });
  const identitySet = new Set(projected.identities);

  // 1. Three views share ids over one identity set (in every lens).
  for (const lens of ['product', 'engineering']) {
    view.setLens(lens);
    const stats = view.getStats();
    assert.deepEqual(new Set(stats.identities), identitySet);
    for (const name of ['current', 'planned', 'change']) {
      for (const id of stats.viewIds[name]) assert.ok(identitySet.has(id), `${id} belongs to the shared identity set`);
    }
    assert.deepEqual(new Set([...stats.viewIds.current, ...stats.viewIds.planned, ...stats.viewIds.change]), identitySet);
  }
  view.setLens('product');

  // 2. Selecting in the Product lens, then switching to Engineering (and across
  //    views), preserves the selected component identity.
  const stepControl = view.element.querySelector('.architecture-step-control[data-component-id="component:search-index"]');
  assert.ok(stepControl, 'the journey renders the search-index step');
  stepControl.click();
  assert.equal(view.getStats().selectedId, 'component:search-index');
  view.setLens('engineering');
  assert.equal(view.getStats().selectedId, 'component:search-index', 'selection survives the lens switch');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId,
    'component:search-index', 'the engineering surface marks the same identity selected');
  for (const nextView of ['current', 'planned', 'change', 'current']) {
    view.setView(nextView);
    assert.equal(view.getStats().selectedId, 'component:search-index', `selection survives the view switch to ${nextView}`);
  }

  // Statuses never change with lens or view: identical chips everywhere the
  // identity renders inside the lens viewport (feature links carry no chips).
  const statusSignature = id => {
    const signatures = [];
    for (const lens of ['product', 'engineering']) {
      for (const name of ['current', 'planned', 'change']) {
        view.setLens(lens); view.setView(name);
        const control = view.element.querySelector(`[data-testid="architecture-viewport"] [data-component-id="${id}"]`);
        if (control) signatures.push(JSON.stringify(chipStates(control)));
      }
    }
    return signatures;
  };
  for (const id of ['component:search-index', 'component:note-store', 'component:cloud-sync']) {
    const signatures = statusSignature(id);
    assert.ok(signatures.length >= 2, `${id} renders in several lens/view combinations`);
    assert.ok(signatures.every(signature => signature === signatures[0]), `${id} status is identical in every lens and view`);
  }

  // 3. Change view lists addition / migration / replacement per T13.
  view.setLens('engineering'); view.setView('change');
  const groupIds = kind => [...view.element.querySelectorAll(`.architecture-change-group[data-change-kind="${kind}"] [data-component-id]`)]
    .map(node => node.dataset.componentId);
  assert.deepEqual(groupIds('additions'), ['observed-path:src/temp/cache.ts']);
  assert.deepEqual(groupIds('open_migrations'), ['application:notes-app', 'component:notes-ui', 'component:cloud-sync']);
  assert.deepEqual(groupIds('replacements'), ['component:cloud-sync']);
  // Collapsed groups still reveal their counts; expanding reveals entries.
  const migrationGroup = () => view.element.querySelector('.architecture-change-group[data-change-kind="open_migrations"]');
  const migrationToggle = () => migrationGroup().querySelector('.architecture-change-toggle');
  migrationToggle().click();
  assert.equal(migrationGroup().dataset.collapsed, 'true');
  assert.equal(migrationGroup().querySelectorAll('[data-component-id]').length, 0,
    'collapsed group hides its entries');
  assert.match(migrationToggle().textContent, /3 migrations/, 'the collapsed summary still reveals the count');
  migrationToggle().click();
  assert.ok(migrationGroup().querySelector('[data-component-id="component:cloud-sync"]'));

  // 4. Proposed components render the ghost treatment plus a visible label.
  view.setView('planned');
  const ghost = view.element.querySelector('.architecture-identity[data-component-id="component:cloud-sync"]');
  assert.equal(ghost.dataset.proposed, 'true');
  const proposedChip = ghost.querySelector('[data-proposed-label="true"]');
  assert.ok(proposedChip, 'the proposed label is rendered as a chip');
  assert.match(proposedChip.textContent, /proposed/);
  assert.ok([...ghost.querySelectorAll('.status')].every(chipNode => chipNode.dataset.state === 'unavailable'),
    'a proposed component never renders implementation or verification as healthy');
  view.select('component:cloud-sync');
  assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent, /proposal:cloud-relay/,
    'the ghost inspector names the pending decision that backs the proposed treatment');

  // 5. Implemented-without-evidence is visibly not green; verified is green.
  const storeChips = chipStates(view.element.querySelector('.architecture-identity[data-component-id="component:note-store"]'));
  assert.equal(storeChips[0].state, 'neutral');
  assert.match(storeChips[0].label, /observed at/);
  assert.equal(storeChips[1].state, 'attention');
  assert.match(storeChips[1].label, /implemented — not verified/);
  const verifiedChips = chipStates(view.element.querySelector('.architecture-identity[data-component-id="component:search-index"]'));
  assert.equal(verifiedChips[1].state, 'verified');

  // 6. Journey navigation from the feature reaches plans, code, open decisions
  //    and verification with the exact recorded identities — no drift.
  const featuresPanel = view.element.querySelector('[data-testid="architecture-features"]');
  const featureArticle = featuresPanel.querySelector('article[data-feature-id="feature:notes"]');
  assert.ok(featureArticle);
  const planIds = [...featureArticle.querySelectorAll('[data-plan-id]')].map(node => node.dataset.planId);
  const decisionIds = [...featureArticle.querySelectorAll('[data-decision-id]')].map(node => node.dataset.decisionId);
  const componentIds = [...featureArticle.querySelectorAll('[data-surface="feature"][data-component-id]')].map(node => node.dataset.componentId);
  const codePaths = [...featureArticle.querySelectorAll('[data-path]')].map(node => node.dataset.path);
  assert.deepEqual(planIds, ['plan:search']);
  assert.deepEqual(decisionIds, ['proposal:cloud-relay']);
  assert.deepEqual(componentIds, ['component:cloud-sync', 'component:note-store', 'component:notes-ui', 'component:search-index', 'component:search-index']);
  assert.deepEqual(codePaths, ['src/search/index.ts', 'src/store/notes.ts']);
  // Selecting through the feature keeps the identical identity in the lenses.
  featureArticle.querySelector('[data-component-id="component:note-store"]').click();
  view.setLens('engineering'); view.setView('current');
  assert.equal(view.getStats().selectedId, 'component:note-store');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId, 'component:note-store');
  // The step source reference survives into the engineering inspector.
  view.setLens('product');
  view.element.querySelector('.architecture-step-control[data-component-id="component:search-index"]').click();
  assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent, /docs\/project\/architecture\.md#component:search-index/);

  // 7. Narrow equivalent: list mode shares ids and keyboard drives selection.
  view.setMode('list'); view.setLens('engineering'); view.setView('planned');
  const listIds = [...view.element.querySelectorAll('.architecture-list [data-component-id]')].map(node => node.dataset.componentId).sort();
  assert.deepEqual(listIds, ['application:notes-app', 'component:cloud-sync', 'component:note-store', 'component:notes-ui', 'component:search-index']);
  const firstRow = view.element.querySelector('.architecture-list [data-component-id="application:notes-app"]');
  firstRow.focus();
  assert.equal(dom.document.activeElement, firstRow);
  const keyEvent = key => {
    const event = { type: 'keydown', key, target: firstRow };
    firstRow.dispatchEvent(event);
    return event;
  };
  keyEvent('Enter');
  assert.equal(view.getStats().selectedId, 'application:notes-app', 'keyboard Enter selects in the list mode');
  assert.equal(keyEvent('ArrowDown').defaultPrevented, true, 'ArrowDown is a handled keyboard move');
  // The lens switcher is a native-button group: keyboard focus + activation.
  const lensButtons = [...view.element.querySelectorAll('.architecture-switcher-lens button')];
  lensButtons[1].focus();
  lensButtons[1].click();
  assert.equal(view.getStats().lens, 'engineering', 'the engineering lens activates from the switcher');

  // 8. A real polling tick (second collector pass after another content edit)
  //    preserves lens, view, mode, selection and the viewport marker.
  writeFileSync(join(fixture.root, 'src/search/index.ts'),
    'export function find() { return []; }\n// touched for observation\n// second observation pass\n');
  const laterFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  assert.equal(laterFacts.status, 'observed');
  assert.equal(laterFacts.observed_at >= gitFacts.observed_at, true);
  const updateFixture = buildFixture(laterFacts);
  assert.deepEqual(updateFixture.identities, projected.identities, 'the polling update keeps the identity set');
  view.setLens('product'); view.setView('current'); view.setMode('cards');
  view.select('component:note-store');
  const before = view.getStats();
  const update = view.applyUpdate(updateFixture);
  const after = view.getStats();
  assert.equal(update.selectedPreserved, true);
  assert.equal(after.selectedId, before.selectedId);
  assert.equal(after.lens, before.lens);
  assert.equal(after.view, before.view);
  assert.equal(after.mode, before.mode);
  assert.equal(view.element.dataset.viewport, before.viewport, 'viewport preserved across the polling tick');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId, 'component:note-store');
  assert.equal(after.viewRevision > before.viewRevision, true);

  // The exact consumed fixture is exported for the browser proof (same data path).
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'architecture-fixture.json'), `${JSON.stringify({
    writtenAt: new Date().toISOString(), projectId: PROJECT_ID,
    initial: projected, update: updateFixture,
  }, null, 2)}\n`);
});

test('adversarial: the adapter fails closed on invented identities and unavailable collectors', async () => {
  const gitFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  const snapshot = reduceCLI('snapshot', fixture.state);
  const base = { snapshot, graphs: graphDocuments(fixture.state), ...structuredClone(AGENT_INPUTS) };

  // Unauthored journey components, scopes, verification and supersessions fail
  // closed (the adapter's own typed errors and T13's UNKNOWN_ITEM both fail
  // closed; the code is the contract, the class differs by origin).
  assert.throws(() => architectureFixture({ ...base, gitFacts, journeys: [
    { id: 'journey:bogus', title: 'Bogus', steps: [{ component_id: 'component:imaginary', interaction: 'not authored' }] }] }),
    error => error.code === 'UNKNOWN_ITEM');
  assert.throws(() => architectureFixture({ ...base, gitFacts, componentScopes: [
    { component_id: 'component:imaginary', paths: ['src/x'], source: 'docs/x' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'UNKNOWN_ITEM');
  assert.throws(() => architectureFixture({ ...base, gitFacts, verification: [
    { component_id: 'component:imaginary', source: 'docs/none' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'UNKNOWN_ITEM');
  assert.throws(() => architectureFixture({ ...base, gitFacts, supersessions: [
    { successor_id: 'component:cloud-sync', superseded_id: 'component:cloud-sync', source: 'docs/x' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'INVALID_VALUE');
  assert.throws(() => architectureFixture({ ...base, gitFacts, supersessions: [
    { successor_id: 'component:imaginary', superseded_id: 'component:note-store', source: 'docs/x' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'UNKNOWN_ITEM');
  assert.throws(() => architectureFixture({ ...base, gitFacts, componentScopes: [
    { component_id: 'component:search-index', paths: ['src/search/index.ts'], source: 'docs/x' },
    { component_id: 'component:search-index', paths: ['src/search/other.ts'], source: 'docs/x' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'DUPLICATE_ID');
  assert.throws(() => architectureFixture({ ...base, gitFacts, componentScopes: [
    { component_id: 'component:search-index', paths: [], source: 'docs/x' }] }),
    error => error instanceof ArchitectureProjectionError && error.code === 'EMPTY_CHANGE');
  assert.throws(() => architectureFixture({ snapshot: null }),
    error => error instanceof ArchitectureProjectionError && error.code === 'SNAPSHOT_REQUIRED');

  // A real collector over a non-repository path stays typed unavailable: no
  // observations, no invented implementation, honest statuses. (A subdirectory
  // of the fixture repo would still resolve to its parent repository.)
  const nonRepo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 't17-nonrepo-')));
  try {
    const unavailableFacts = await collectLocalGitFacts({ repositoryRoot: nonRepo });
    assert.equal(unavailableFacts.status, 'unavailable');
    assert.equal(unavailableFacts.reason, 'NOT_A_REPOSITORY');
  const unavailableFixture = architectureFixture({ ...base, gitFacts: unavailableFacts });
  assert.deepEqual(unavailableFixture.current, []);
  assert.deepEqual(unavailableFixture.identities,
    ['application:notes-app', 'component:cloud-sync', 'component:note-store', 'component:notes-ui', 'component:search-index']);
  for (const id of unavailableFixture.identities) {
    assert.notEqual(unavailableFixture.components[id].status.implementation.state, 'neutral',
      `${id} never renders observed without an observation`);
  }
  assert.equal(unavailableFixture.features[0].code_paths.length, 0, 'the feature honestly loses its code paths');
  const unavailableView = createArchitectureView({ fixture: unavailableFixture, lens: 'engineering', view: 'current' });
    assert.match(unavailableView.element.textContent, /view current: 0/);
  } finally {
    rmSync(nonRepo, { recursive: true, force: true });
    assert.equal(existsSync(nonRepo), false, 'the non-repository probe directory is removed');
  }

  // Ghost treatment resolves only through the recorded decision: once the
  // proposal is no longer pending, the same element renders accepted.
  const resolvedSnapshot = structuredClone(snapshot);
  resolvedSnapshot.proposals.find(proposal => proposal.id === 'proposal:cloud-relay').state = 'superseded';
  const resolvedFixture = architectureFixture({ ...base, snapshot: resolvedSnapshot, gitFacts });
  assert.equal(resolvedFixture.components['component:cloud-sync'].status.proposed, false);
  assert.equal(resolvedFixture.planned.find(entry => entry.id === 'component:cloud-sync').treatment, 'accepted');
  assert.equal(resolvedFixture.features[0].open_decision_ids.length, 0, 'the resolved decision leaves the feature queue');

  // The current worktree losing its binding (collection moved mid-observe)
  // degrades to typed unavailable: no observation is invented from presence.
  const noBinding = structuredClone(gitFacts);
  noBinding.worktrees = noBinding.worktrees.map(worktree =>
    worktree.current ? { ...worktree, status: 'unavailable', binding: null } : worktree);
  const noBindingFixture = architectureFixture({ ...base, gitFacts: noBinding });
  assert.equal(noBindingFixture.git.status, 'unavailable');
  assert.equal(noBindingFixture.git.reason, 'CURRENT_WORKTREE_BINDING_UNAVAILABLE');
  assert.deepEqual(noBindingFixture.current, [], 'no observation survives a lost binding');
});
