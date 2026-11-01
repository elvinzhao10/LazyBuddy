import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMiniDom } from './fixtures/mini-dom.mjs';
import { createEvidenceDirectory } from './evidence-directory.mjs';

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
const { architectureGraphModel, createArchitectureView } = await import('../ui/architecture-view.mjs');
const { installFocusSystem } = await import('../ui/components.mjs');
const asSet = values => new Set(values);

const projectCLI = fileURLToPath(new URL('../../project/cli.mjs', import.meta.url));
const PROJECT_ID = 'project:t17';
const ACTOR = 'local:t17-test';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

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

test('architecture lenses render the real fixture with shared identities and stable statuses', async t => {
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

  // 1. Three lens tabs share ids over one identity set (in every perspective),
  //    and the tabs are ONE T12 segmented control (T11 semantics).
  const lensTabs = view.element.querySelector('[data-testid="architecture-lens-tabs"]');
  assert.ok(lensTabs, 'the lens tabs render');
  assert.equal(lensTabs.getAttribute('data-native-segmented'), 'true');
  assert.equal(lensTabs.getAttribute('role'), 'group');
  assert.equal(lensTabs.getAttribute('aria-label'), 'Lens');
  assert.deepEqual([...lensTabs.querySelectorAll('button')].map(control => control.dataset.segment),
    ['current', 'planned', 'change']);
  assert.deepEqual([...lensTabs.querySelectorAll('button[aria-pressed="true"]')].map(control => control.dataset.segment),
    ['current'], 'exactly one lens tab is current');
  for (const perspective of ['product', 'engineering']) {
    view.setPerspective(perspective);
    const stats = view.getStats();
    assert.deepEqual(new Set(stats.identities), identitySet);
    for (const name of ['current', 'planned', 'change']) {
      for (const id of stats.viewIds[name]) assert.ok(identitySet.has(id), `${id} belongs to the shared identity set`);
    }
    assert.deepEqual(new Set([...stats.viewIds.current, ...stats.viewIds.planned, ...stats.viewIds.change]), identitySet);
  }
  view.setPerspective('product');

  // 2. Selecting in the Product perspective, then switching to Engineering (and
  //    across lens tabs), preserves the selected component identity AND keeps
  //    the component-detail dock open on the same identity.
  const stepControl = view.element.querySelector('.architecture-step-control[data-component-id="component:search-index"]');
  assert.ok(stepControl, 'the journey renders the search-index step');
  stepControl.click();
  assert.equal(view.getStats().selectedId, 'component:search-index');
  assert.equal(view.getStats().dockOpen, true, 'selection opens the component-detail dock');
  assert.equal(view.element.querySelector('[data-testid="dock-panel"]').hidden, false);
  view.setPerspective('engineering');
  assert.equal(view.getStats().selectedId, 'component:search-index', 'selection survives the perspective switch');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId,
    'component:search-index', 'the engineering surface marks the same identity selected');
  for (const nextTab of ['current', 'planned', 'change', 'current']) {
    view.setLensTab(nextTab);
    assert.equal(view.getStats().selectedId, 'component:search-index', `selection survives the lens tab switch to ${nextTab}`);
    assert.equal(view.getStats().dockOpen, true, 'the dock stays open across the lens tab switch');
    assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent,
      /component:search-index/, 'the dock still details the same identity');
  }

  // Statuses never change with lens tab or perspective: identical chips
  // everywhere the identity renders inside the content viewport (cards mode
  // renders chips on every surface; graph nodes deliberately do not).
  view.setMode('cards');
  const statusSignature = id => {
    const signatures = [];
    for (const perspective of ['product', 'engineering']) {
      for (const name of ['current', 'planned', 'change']) {
        view.setPerspective(perspective); view.setLensTab(name);
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

  // 3. Change lens lists addition / migration / replacement per T13, each row
  //    carrying its added/changed/removed marker.
  view.setPerspective('engineering'); view.setLensTab('change');
  const groupIds = kind => [...view.element.querySelectorAll(`.architecture-change-group[data-change-kind="${kind}"] [data-component-id]`)]
    .map(node => node.dataset.componentId);
  assert.deepEqual(groupIds('additions'), ['observed-path:src/temp/cache.ts']);
  assert.deepEqual(groupIds('open_migrations'), ['application:notes-app', 'component:notes-ui', 'component:cloud-sync']);
  assert.deepEqual(groupIds('replacements'), ['component:cloud-sync']);
  const additionControl = view.element.querySelector('.architecture-change-group[data-change-kind="additions"] [data-component-id]');
  assert.equal(additionControl.dataset.componentId, 'observed-path:src/temp/cache.ts');
  assert.ok(additionControl.querySelector('[data-marker="added"]'), 'the addition carries the added marker');
  assert.equal(view.element.querySelector('[data-component-id="component:cloud-sync"] [data-marker="changed"]') != null, true,
    'an open migration carries the changed marker');
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

  // 4. Proposed components render the ghost treatment plus a visible label;
  //    treatments distinguish implemented (solid) from planned (dashed).
  view.setLensTab('planned');
  const ghost = view.element.querySelector('.architecture-identity[data-component-id="component:cloud-sync"]');
  assert.equal(ghost.dataset.proposed, 'true');
  assert.equal(ghost.dataset.treatment, 'proposed');
  const proposedChip = ghost.querySelector('[data-proposed-label="true"]');
  assert.ok(proposedChip, 'the proposed label is rendered as a chip');
  assert.match(proposedChip.textContent, /proposed/);
  assert.ok([...ghost.querySelectorAll('.status')].every(chipNode => chipNode.dataset.state === 'unavailable'),
    'a proposed component never renders implementation or verification as healthy');
  assert.equal(view.element.querySelector('.architecture-identity[data-component-id="application:notes-app"]').dataset.treatment,
    'planned', 'authored without observation renders the planned treatment');
  assert.equal(view.element.querySelector('.architecture-identity[data-component-id="component:note-store"]').dataset.treatment,
    'implemented', 'observed code renders the implemented treatment');
  assert.equal(ghost.querySelector('[data-marker="changed"]') != null, true,
    'the migration successor carries its change marker in the planned lens');
  view.select('component:cloud-sync');
  assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent, /proposal:cloud-relay/,
    'the ghost dock names the pending decision that backs the proposed treatment');

  // 5. Authored containment and typed relationships render as an interactive
  //    graph without reinterpreting them as task dependencies. Relationship
  //    cycles are valid architecture and stay drawable.
  view.setMode('graph');
  const graph = architectureGraphModel(projected, 'planned');
  assert.deepEqual(graph.nodes.map(node => node.id).sort(), projected.planned.map(node => node.id).sort());
  assert.equal(graph.edges.filter(edge => edge.kind === 'contains').length, 4, 'authored parent links become containment edges');
  assert.deepEqual(graph.edges.filter(edge => edge.kind === 'uses').map(edge => `${edge.from}->${edge.to}`).sort(), [
    'component:cloud-sync->component:note-store',
    'component:notes-ui->component:search-index',
    'component:search-index->component:note-store',
  ]);
  const cyclic = structuredClone(projected);
  cyclic.components['component:note-store'].authored.relationships.push({
    kind: 'calls', to: 'component:search-index', basis: 'authored', note: 'callback notification',
  });
  const cyclicGraph = architectureGraphModel(cyclic, 'planned');
  assert.ok(cyclicGraph.edges.some(edge => edge.kind === 'uses'
    && edge.from === 'component:search-index' && edge.to === 'component:note-store'));
  assert.ok(cyclicGraph.edges.some(edge => edge.kind === 'calls'
    && edge.from === 'component:note-store' && edge.to === 'component:search-index'),
  'reverse authored relationship remains visible instead of becoming a DAG cycle error');
  assert.equal(view.element.querySelectorAll('.architecture-graph-node').length, projected.planned.length);
  assert.deepEqual([...view.element.querySelectorAll('.architecture-graph-edges [data-kind]')]
    .map(edge => edge.dataset.kind).sort(), graph.edges.map(edge => edge.kind).sort());
  assert.ok(view.element.querySelectorAll('.architecture-graph-edges text').some(label => label.textContent === 'uses'),
    'relationship type is printed on the canvas');
  // Inferred vs authored relationships are visually distinct AND labeled:
  // the agent-authored supersession renders dashed with an 'inferred' label;
  // authored relationships carry their recorded basis.
  const inferredEdge = view.element.querySelector('.architecture-graph-edges [data-basis="agent-authored"]');
  assert.equal(inferredEdge.dataset.kind, 'replaces');
  assert.equal(inferredEdge.dataset.inferred, 'true');
  assert.equal(inferredEdge.querySelector('text').textContent, 'replaces · inferred');
  assert.deepEqual([...view.element.querySelectorAll('.architecture-graph-edges [data-basis="authored"][data-kind="uses"]')]
    .map(edge => edge.dataset.inferred), ['false', 'false', 'false'], 'authored uses edges are never marked inferred');
  assert.equal(view.element.querySelector('.architecture-graph-edges [data-kind="contains"]').dataset.basis, 'authored containment');
  // Same-column relationships route around the column side; the canvas
  // reserves the allowance so no path or label ever clips.
  const svgNode = view.element.querySelector('.architecture-graph');
  const viewBoxWidth = Number(svgNode.getAttribute('viewBox').split(' ')[2]);
  assert.ok(viewBoxWidth >= 728 + 84 + 32, 'the canvas width includes the side-routing allowance');
  for (const pathNode of view.element.querySelectorAll('.architecture-graph-edges path')) {
    const values = (pathNode.getAttribute('d').match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = values.filter((_, index) => index % 2 === 0);
    assert.ok(Math.max(...xs) <= viewBoxWidth + 0.5, 'edge geometry stays inside the canvas');
  }
  // Container treatments on the canvas: implemented solid, planned dashed.
  assert.equal(view.element.querySelector('.architecture-graph-node[data-component-id="component:note-store"]').dataset.treatment, 'implemented');
  assert.equal(view.element.querySelector('.architecture-graph-node[data-component-id="application:notes-app"]').dataset.treatment, 'planned');
  assert.equal(view.element.querySelector('.architecture-graph-node[data-component-id="component:note-store"] [data-marker="removed"]') != null,
    true, 'the superseded component carries the removed marker on the canvas');
  const graphNode = view.element.querySelector('.architecture-graph-node[data-component-id="component:note-store"]');
  graphNode.click();
  assert.equal(view.getStats().selectedId, 'component:note-store', 'graph selection uses the shared component identity');
  // The overview strip renders while the layout exceeds the viewport region,
  // hides when the region fits the whole graph, and centers on click.
  let graphRegion = view.element.querySelector('[data-testid="architecture-graph"]');
  let minimap = view.element.querySelector('[data-testid="architecture-minimap"]');
  assert.ok(minimap, 'the overview strip renders for an oversized graph');
  assert.equal(minimap.querySelectorAll('.architecture-minimap-node').length, projected.planned.length);
  graphRegion.clientWidth = 2000; graphRegion.clientHeight = 1200;
  assert.equal(view.refreshGraphOverview(), false, 'no overview when the viewport fits the whole graph');
  assert.equal(view.element.querySelector('[data-testid="architecture-minimap"]').hidden, true,
    'the overview strip hides itself');
  graphRegion.clientWidth = 640; graphRegion.clientHeight = 420;
  assert.equal(view.refreshGraphOverview(), true, 'the overview returns once the graph exceeds the viewport again');
  minimap = view.element.querySelector('[data-testid="architecture-minimap"]');
  assert.equal(minimap.hidden, false);
  minimap.clientWidth = graph.width; minimap.clientHeight = 40;
  minimap.dispatchEvent({ type: 'click', offsetX: 570, offsetY: 20 });
  assert.equal(view.getStats().graphViewport.scrollLeft, 250, 'a minimap click centers the viewport (570 - 640/2)');
  assert.ok(view.getStats().graphViewport.scrollTop > 0, 'the click also centers vertically');
  view.setViewport({ scale: 1.25, scrollLeft: 90, scrollTop: 45 }, 'test');
  assert.deepEqual(view.getStats().graphViewport, { scale: 1.25, scrollLeft: 90, scrollTop: 45 });
  const graphRefresh = view.applyUpdate(projected);
  assert.equal(graphRefresh.selectedPreserved, true);
  assert.equal(view.getStats().mode, 'graph');
  assert.equal(view.getStats().selectedId, 'component:note-store');
  assert.deepEqual(view.getStats().graphViewport, { scale: 1.25, scrollLeft: 90, scrollTop: 45 },
    'graph pan and zoom survive a status refresh');

  // 6. Implemented-without-evidence is visibly not green; verified is green.
  view.setMode('cards');
  const storeChips = chipStates(view.element.querySelector('.architecture-identity[data-component-id="component:note-store"]'));
  assert.equal(storeChips[0].state, 'neutral');
  assert.match(storeChips[0].label, /observed at/);
  assert.equal(storeChips[1].state, 'attention');
  assert.match(storeChips[1].label, /implemented — not verified/);
  const verifiedChips = chipStates(view.element.querySelector('.architecture-identity[data-component-id="component:search-index"]'));
  assert.equal(verifiedChips[1].state, 'verified');

  // 7. Journey navigation from the feature reaches plans, code, open decisions
  //    and verification with the exact recorded identities — no drift. Plan,
  //    decision and verification links now carry their item-tab payload.
  const featuresPanel = view.element.querySelector('[data-testid="architecture-features"]');
  const featureArticle = featuresPanel.querySelector('article[data-feature-id="feature:notes"]');
  assert.ok(featureArticle);
  const planIds = [...featureArticle.querySelectorAll('[data-plan-id]')].map(node => node.dataset.planId);
  const decisionIds = [...featureArticle.querySelectorAll('[data-decision-id]')].map(node => node.dataset.decisionId);
  const componentIds = [...featureArticle.querySelectorAll('[data-surface="feature"][data-component-id]')].map(node => node.dataset.componentId);
  const evidenceIds = [...featureArticle.querySelectorAll('[data-evidence-id]')].map(node => node.dataset.evidenceId);
  const codePaths = [...featureArticle.querySelectorAll('[data-path]')].map(node => node.dataset.path);
  assert.deepEqual(planIds, ['plan:search']);
  assert.deepEqual(decisionIds, ['proposal:cloud-relay']);
  assert.deepEqual(componentIds, ['component:cloud-sync', 'component:note-store', 'component:notes-ui', 'component:search-index']);
  assert.deepEqual(evidenceIds, ['docs/project/verification/search-index.md']);
  assert.deepEqual(codePaths, ['src/search/index.ts', 'src/store/notes.ts']);
  // Selecting through the feature keeps the identical identity in the lenses.
  featureArticle.querySelector('[data-component-id="component:note-store"]').click();
  view.setPerspective('engineering'); view.setLensTab('current');
  assert.equal(view.getStats().selectedId, 'component:note-store');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId, 'component:note-store');
  // The step source reference survives into the component detail dock.
  view.setPerspective('product');
  view.element.querySelector('.architecture-step-control[data-component-id="component:search-index"]').click();
  assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent, /docs\/project\/architecture\.md#component:search-index/);

  // 8. Narrow equivalent: list mode shares ids and keyboard drives selection.
  view.setMode('list'); view.setPerspective('engineering'); view.setLensTab('planned');
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
  // The perspective and lens controls are native segmented groups: click a
  // segment to activate it (the T11 arrow-key map is covered by ui-native-segmented).
  view.element.querySelector('[data-testid="architecture-perspective"] button[data-segment="product"]').click();
  assert.equal(view.getStats().perspective, 'product', 'the product perspective activates from its segmented control');
  view.element.querySelector('[data-testid="architecture-lens-tabs"] button[data-segment="current"]').click();
  assert.equal(view.getStats().lensTab, 'current', 'the Current lens activates from the segmented lens tabs');
  view.setPerspective('engineering'); view.setLensTab('planned');

  // 9. A real polling tick (second collector pass after another content edit)
  //    preserves lens, view, mode, selection and the viewport marker.
  writeFileSync(join(fixture.root, 'src/search/index.ts'),
    'export function find() { return []; }\n// touched for observation\n// second observation pass\n');
  const laterFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  assert.equal(laterFacts.status, 'observed');
  assert.equal(laterFacts.observed_at >= gitFacts.observed_at, true);
  const updateFixture = buildFixture(laterFacts);
  assert.deepEqual(updateFixture.identities, projected.identities, 'the polling update keeps the identity set');
  view.setPerspective('product'); view.setLensTab('current'); view.setMode('cards');
  view.select('component:note-store');
  const before = view.getStats();
  const update = view.applyUpdate(updateFixture);
  const after = view.getStats();
  assert.equal(update.selectedPreserved, true);
  assert.equal(after.selectedId, before.selectedId);
  assert.equal(after.perspective, before.perspective);
  assert.equal(after.lensTab, before.lensTab);
  assert.equal(after.lens, before.lens, 'legacy stats keys keep their meaning');
  assert.equal(after.view, before.view);
  assert.equal(after.mode, before.mode);
  assert.equal(after.dockOpen, true, 'the open dock survives the polling tick');
  assert.equal(view.element.dataset.viewport, before.viewport, 'viewport preserved across the polling tick');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId, 'component:note-store');
  assert.equal(after.viewRevision > before.viewRevision, true);

  // The exact consumed fixture is exported for the browser proof (same data path).
  const evidenceDirectory = createEvidenceDirectory(t, process.env.T17_EVIDENCE_DIR);
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
  const unavailableView = createArchitectureView({ fixture: unavailableFixture, perspective: 'engineering', lens: 'current' });
    assert.match(unavailableView.element.textContent, /lens current: 0/);
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

test('the dock journey opens every item tab through onOpenItem; overlays close on Escape with focus return', async () => {
  const gitFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  const projected = buildFixture(gitFacts);
  const opened = [];
  const view = createArchitectureView({ fixture: projected, perspective: 'engineering', lens: 'planned', mode: 'cards',
    callbacks: { onOpenItem: item => opened.push(item) } });
  dom.document.body.append(view.element); // attached, like a real page: focus-return needs connectivity
  const dockPanel = view.element.querySelector('[data-testid="dock-panel"]');
  const dockBody = view.element.querySelector('[data-testid="architecture-inspector"]');
  assert.equal(dockPanel.hidden, true, 'the dock starts closed');

  const node = view.element.querySelector('.architecture-identity[data-component-id="component:search-index"]');
  node.focus();
  node.click();
  assert.equal(dockPanel.hidden, false, 'selection opens the component-detail dock');
  assert.equal(view.getStats().dockOpen, true);

  // The journey reads in one order: feature → affected plans → code → open
  // decisions → verification.
  const steps = [...dockBody.querySelectorAll('.architecture-detail-step-heading')].map(heading => heading.textContent);
  assert.deepEqual(steps, ['Features', 'Affected plans', 'Code', 'Open decisions', 'Verification']);
  for (const kind of ['feature', 'plan', 'decision', 'evidence']) {
    dockBody.querySelector(`.architecture-detail-step [data-kind="${kind}"]`).click();
  }
  assert.deepEqual(opened, [
    { kind: 'feature', id: 'feature:notes', componentId: 'component:search-index' },
    { kind: 'plan', id: 'plan:search', componentId: 'component:search-index' },
    { kind: 'decision', id: 'proposal:cloud-relay', componentId: 'component:search-index' },
    { kind: 'evidence', id: 'docs/project/verification/search-index.md', componentId: 'component:search-index' },
  ], 'every journey link opens its item tab with the exact recorded identity');
  assert.match(dockBody.textContent, /src\/search\/index\.ts/);

  // Escape rides the T11 overlay stack: the dock closes and focus returns to
  // the invoking control.
  const detach = installFocusSystem({ root: dom.document });
  try {
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(dockPanel.hidden, true, 'Escape collapses the dock');
    assert.equal(dom.document.activeElement, node, 'focus returns to the invoking node');

    // The legend overlay: opened from the toolbar, carries the REAL treatments
    // (the same classes the canvas uses), closes on Escape with focus return.
    const legendTrigger = view.element.querySelector('[data-testid="architecture-legend-trigger"]');
    const overlayNode = view.element.querySelector('[data-testid="native-overlay"]');
    assert.ok(overlayNode, 'the legend is an overlay, not a static block');
    assert.equal(overlayNode.hidden, true);
    legendTrigger.focus();
    legendTrigger.click();
    assert.equal(overlayNode.hidden, false);
    for (const treatment of ['implemented', 'planned', 'proposed']) {
      assert.ok(overlayNode.querySelector(`.architecture-swatch[data-treatment="${treatment}"]`), `the ${treatment} swatch renders`);
    }
    for (const marker of ['added', 'changed', 'removed']) {
      assert.ok(overlayNode.querySelector(`.architecture-marker[data-marker="${marker}"]`), `the ${marker} marker entry renders`);
    }
    assert.ok(overlayNode.querySelector('.architecture-edge-sample[data-basis="authored"]'), 'the authored edge sample renders');
    assert.ok(overlayNode.querySelector('.architecture-edge-sample[data-basis="agent-authored"]'), 'the inferred edge sample renders');
    assert.match(overlayNode.textContent, /never green/, 'the honesty note stays in the legend');
    dom.document.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(overlayNode.hidden, true, 'Escape closes the legend overlay');
    assert.equal(dom.document.activeElement, legendTrigger, 'legend Escape returns focus to its trigger');
  } finally {
    detach.detach();
  }
  view.closeDock();
  view.element.remove();
});

test('adversarial stale_state: rapid lens/perspective/mode churn with a mid-flight update never drifts selection, statuses or the dock', async () => {
  const gitFacts = await collectLocalGitFacts({ repositoryRoot: fixture.root, sourceScope: ['src/'] });
  const initial = buildFixture(gitFacts);
  const updated = buildFixture(gitFacts);
  const view = createArchitectureView({ fixture: initial, perspective: 'engineering', lens: 'planned', mode: 'graph' });
  const node = view.element.querySelector('.architecture-identity[data-component-id="component:note-store"]');
  node.focus();
  node.click();
  const before = view.getStats();
  const signatureOf = () => JSON.stringify([...view.element
    .querySelectorAll('.architecture-identity[data-component-id="component:note-store"] .status')]
    .map(chipNode => ({ state: chipNode.dataset.state, label: chipNode.textContent })));
  const signatureBefore = signatureOf();

  const churn = ['current', 'planned', 'change', 'planned', 'current', 'change', 'current'];
  let step = 0;
  for (const tab of churn) {
    view.setLensTab(tab);
    if (step % 2 === 0) view.setPerspective(view.getStats().perspective === 'product' ? 'engineering' : 'product');
    view.setMode(['graph', 'cards', 'list'][step % 3]);
    step += 1;
    if (step === 3) view.applyUpdate(updated); // a polling tick lands mid-churn
  }
  const after = view.getStats();
  assert.equal(after.selectedId, before.selectedId, 'the selected identity survives the churn');
  assert.equal(after.dockOpen, true, 'the open dock survives the churn');
  assert.match(view.element.querySelector('[data-testid="architecture-inspector"]').textContent,
    /component:note-store/, 'the dock still details the same identity');
  assert.deepEqual(after.identities, before.identities, 'the identity set never drifts');

  view.setPerspective('engineering'); view.setLensTab('planned'); view.setMode('graph');
  assert.equal(signatureOf(), signatureBefore, 'statuses never drift under churn');
  assert.equal(view.element.querySelector('.architecture-identity[aria-pressed="true"]')?.dataset.componentId,
    'component:note-store', 'the restored surface marks the same identity selected');
  assert.equal(view.getStats().lensTab, 'planned');
  assert.equal(view.getStats().perspective, 'engineering');
  view.closeDock();
});
