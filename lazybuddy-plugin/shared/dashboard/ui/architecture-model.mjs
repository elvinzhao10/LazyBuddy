// T17 architecture projection adapter — a PURE read-only composition that
// bridges recorded project facts into the T13 projection (projectArchitecture /
// productJourney; called, never forked) and adds the view-facing fields T13
// deliberately leaves out (authored titles/kinds, per-component status chips,
// feature navigation). Every derivation is traceable to a recorded field:
//   - containment comes from contract parent_id (inverted),
//   - 'proposed' comes from a pending baseline proposal's impact (the open
//     decision record is the authority for the ghost treatment),
//   - supersession links are agent-authored inputs validated against authored
//     identities (spec §7.3: initial mapping may be agent-authored with source
//     references) and enter T13 as basis 'agent-authored' relationships,
//   - observations come from the T11 local-git collector's binding for the
//     current worktree (declared content revision, declared coverage); paths
//     outside every declared component scope surface as collector-minted
//     observed-path identities, never as authored components.
// Statuses are computed ONCE per identity here, so no lens or view switch in
// the DOM layer can change a component's status.
import { projectArchitecture, productJourney } from '../../project/architecture.mjs';

export class ArchitectureProjectionError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ArchitectureProjectionError';
    this.code = code;
  }
}

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const chip = (state, label) => ({ state, label });
const sorted = values => [...values].sort((left, right) => left.localeCompare(right));
const fail = (code, detail) => { throw new ArchitectureProjectionError(code, detail); };

function requireArray(value, field, maximum = 4096) {
  if (!Array.isArray(value) || value.length > maximum) fail('INVALID_VALUE', `${field} must be a bounded array`);
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.length || value.length > 4096) fail('INVALID_VALUE', `${field} must be bounded nonempty text`);
  return value;
}

// A declared component scope is agent-authored content with a source
// reference; coverage names exactly what was declared, path-exact or
// directory-prefix, and is never upgraded by the projection.
function parseScopes(componentScopes, authoredIds) {
  const scopes = [];
  const seen = new Set();
  for (const scope of requireArray(componentScopes, 'componentScopes', 256)) {
    if (!plain(scope)) fail('INVALID_VALUE', 'A component scope must be a plain object');
    for (const key of Reflect.ownKeys(scope)) {
      if (!['component_id', 'paths', 'coverage', 'source'].includes(key)) fail('UNKNOWN_FIELD', 'A component scope has an unsupported field');
    }
    if (typeof scope.component_id !== 'string' || !authoredIds.has(scope.component_id)) {
      fail('UNKNOWN_ITEM', `A component scope must name an authored element: ${scope.component_id}`);
    }
    if (seen.has(scope.component_id)) fail('DUPLICATE_ID', `A component scope repeats ${scope.component_id}`);
    seen.add(scope.component_id);
    const paths = requireArray(scope.paths, 'component scope paths', 256)
      .map(path => requireText(path, 'component scope path'));
    if (!paths.length) fail('EMPTY_CHANGE', 'A component scope declares at least one path');
    const coverage = scope.coverage ?? 'path-exact';
    if (!['path-exact', 'directory-prefix'].includes(coverage)) fail('INVALID_VALUE', 'A component scope declares path-exact or directory-prefix coverage');
    scopes.push({ component_id: scope.component_id, paths: sorted(paths), coverage, source: requireText(scope.source, 'component scope source') });
  }
  return scopes;
}

function parseSupersessions(supersessions, authoredIds) {
  const links = [];
  for (const link of requireArray(supersessions, 'supersessions', 256)) {
    if (!plain(link)) fail('INVALID_VALUE', 'A supersession link must be a plain object');
    for (const key of Reflect.ownKeys(link)) {
      if (!['successor_id', 'superseded_id', 'source'].includes(key)) fail('UNKNOWN_FIELD', 'A supersession link has an unsupported field');
    }
    if (!authoredIds.has(link.successor_id) || !authoredIds.has(link.superseded_id)) {
      fail('UNKNOWN_ITEM', 'A supersession link must connect authored elements');
    }
    if (link.successor_id === link.superseded_id) fail('INVALID_VALUE', 'A supersession link cannot be a self link');
    links.push({ successor_id: link.successor_id, superseded_id: link.superseded_id, source: requireText(link.source, 'supersession source') });
  }
  return links;
}

function parseVerification(verification, authoredIds) {
  const entries = [];
  const seen = new Set();
  for (const entry of requireArray(verification, 'verification', 4096)) {
    if (!plain(entry)) fail('INVALID_VALUE', 'Verification evidence must be a plain object');
    for (const key of Reflect.ownKeys(entry)) {
      if (!['component_id', 'source'].includes(key)) fail('UNKNOWN_FIELD', 'Verification evidence has an unsupported field');
    }
    if (typeof entry.component_id !== 'string' || !authoredIds.has(entry.component_id)) {
      fail('UNKNOWN_ITEM', `Verification evidence names an unauthored element: ${entry.component_id}`);
    }
    if (seen.has(entry.component_id)) fail('DUPLICATE_ID', `Verification evidence repeats ${entry.component_id}`);
    seen.add(entry.component_id);
    entries.push({ component_id: entry.component_id, source: requireText(entry.source, 'verification source') });
  }
  return entries;
}

// Agent-authored journeys keep T13's own validation (fail-closed on unauthored
// steps); the adapter only adds journey identity and title.
function parseJourneys(journeys) {
  const parsed = [];
  const seen = new Set();
  for (const journey of requireArray(journeys, 'journeys', 64)) {
    if (!plain(journey)) fail('INVALID_VALUE', 'A journey must be a plain object');
    for (const key of Reflect.ownKeys(journey)) {
      if (!['id', 'title', 'steps'].includes(key)) fail('UNKNOWN_FIELD', 'A journey has an unsupported field');
    }
    requireText(journey.id, 'journey id');
    requireText(journey.title, 'journey title');
    if (seen.has(journey.id)) fail('DUPLICATE_ID', `A journey repeats ${journey.id}`);
    seen.add(journey.id);
    const steps = requireArray(journey.steps, 'journey steps', 128).map((step, index) => {
      if (!plain(step)) fail('INVALID_VALUE', `journey[${index}] must be a plain object`);
      for (const key of Reflect.ownKeys(step)) {
        if (!['component_id', 'interaction', 'source'].includes(key)) fail('UNKNOWN_FIELD', `journey[${index}] has an unsupported field`);
      }
      if (typeof step.component_id !== 'string' || !step.component_id.length) fail('INVALID_ID', `journey[${index}] names its component`);
      if (typeof step.interaction !== 'string' || !step.interaction.length) fail('INVALID_VALUE', `journey[${index}] describes the interaction`);
      return { component_id: step.component_id, interaction: step.interaction, source: step.source ?? null };
    });
    if (!steps.length) fail('EMPTY_CHANGE', `Journey ${journey.id} has no steps`);
    parsed.push({ id: journey.id, title: journey.title, steps });
  }
  return parsed;
}

// Contract-shaped snapshot from the shared command route.
function parseSnapshot(snapshot) {
  if (!plain(snapshot)) fail('SNAPSHOT_REQUIRED', 'architectureFixture composes a project snapshot');
  for (const field of ['architecture', 'proposals', 'items', 'plans', 'project_id']) {
    if (!(field in snapshot)) fail('SNAPSHOT_SHAPE', `snapshot.${field} is required`);
  }
  requireArray(snapshot.architecture, 'snapshot.architecture', 1024);
  requireArray(snapshot.proposals, 'snapshot.proposals', 256);
  requireArray(snapshot.items, 'snapshot.items', 1024);
  requireArray(snapshot.plans, 'snapshot.plans', 256);
  return snapshot;
}

function parseGraphs(graphs, planIds) {
  const parsed = [];
  for (const graph of requireArray(graphs, 'graphs', 256)) {
    if (!plain(graph)) fail('INVALID_VALUE', 'A plan graph must be a plain object');
    if (typeof graph.plan_id !== 'string' || !planIds.has(graph.plan_id)) {
      fail('UNKNOWN_PLAN', `A graph references ${graph.plan_id}`);
    }
    const edges = requireArray(graph.edges ?? [], 'graph edges', 1024).map(edge => {
      if (!plain(edge) || typeof edge.kind !== 'string') fail('INVALID_VALUE', 'A graph edge must carry its kind');
      return { kind: edge.kind, component_id: edge.component_id ?? null, item_id: edge.item_id ?? null,
        from_plan_id: edge.from_plan_id ?? graph.plan_id, to_plan_id: edge.to_plan_id ?? null, note: edge.note ?? null };
    });
    parsed.push({ plan_id: graph.plan_id, edges });
  }
  return parsed;
}

// Observed code paths for a declared scope: the collector's binding keeps only
// changed paths inside the declared source scope; a scope with no relevant
// changed path stays honestly unobserved (never inferred from existence).
function scopeCovers(changedPath, scopePath, coverage) {
  if (coverage === 'path-exact') return changedPath === scopePath;
  const prefix = scopePath.endsWith('/') ? scopePath : `${scopePath}/`;
  return changedPath === scopePath || changedPath.startsWith(prefix);
}

function observationsFromGit(gitFacts, scopes) {
  if (gitFacts == null) return { observations: [], git: { status: 'unavailable', reason: 'GIT_FACTS_NOT_SUPPLIED', observed_at: null, head: null, collector: null, unmapped_paths: [] } };
  if (!plain(gitFacts)) fail('INVALID_VALUE', 'gitFacts must be a plain object');
  if (gitFacts.status !== 'observed') {
    return { observations: [], git: { status: 'unavailable', reason: gitFacts.reason ?? 'NOT_OBSERVED', observed_at: null, head: null, collector: gitFacts.collector ?? null, unmapped_paths: [] } };
  }
  const worktree = (gitFacts.worktrees ?? []).find(entry => plain(entry) && entry.current && entry.status === 'observed') ?? null;
  const binding = worktree?.binding ?? null;
  if (!binding || !Array.isArray(binding.relevant_changed_paths)) {
    return { observations: [], git: { status: 'unavailable', reason: 'CURRENT_WORKTREE_BINDING_UNAVAILABLE', observed_at: gitFacts.observed_at ?? null, head: gitFacts.head ?? null, collector: gitFacts.collector ?? null, unmapped_paths: [] } };
  }
  const changed = binding.relevant_changed_paths.map(entry => entry.path);
  const observations = [];
  const mapped = new Set();
  for (const scope of scopes) {
    const paths = sorted(changed.filter(path => scope.paths.some(declared => scopeCovers(path, declared, scope.coverage))));
    for (const path of paths) mapped.add(path);
    if (!paths.length) continue;
    observations.push({ component_id: scope.component_id, observed_at: gitFacts.observed_at,
      content_revision: binding.head_oid ?? gitFacts.head ?? null, paths, coverage: scope.coverage, basis: gitFacts.collector ?? 'git-observation/local@1' });
  }
  // Paths the collector observed inside the source scope but no declared
  // component claims: additions with collector-minted identities. They are
  // never authored components and never inherit verification.
  const unmappedPaths = sorted(changed.filter(path => !mapped.has(path)));
  for (const path of unmappedPaths) {
    observations.push({ component_id: `observed-path:${path}`, observed_at: gitFacts.observed_at,
      content_revision: binding.head_oid ?? gitFacts.head ?? null, paths: [path], coverage: 'path-exact',
      basis: `${gitFacts.collector ?? 'git-observation/local@1'} unmapped-path` });
  }
  return { observations, git: { status: 'observed', reason: null, observed_at: gitFacts.observed_at,
    head: binding.head_oid ?? gitFacts.head ?? null, collector: gitFacts.collector ?? null, unmapped_paths: unmappedPaths } };
}

// The single per-identity status record. Labels carry their evidence; a
// verified chip exists only where declared evidence names the component, so
// implemented-without-tests can never render green.
function statusOf({ intent, observation, verified, pendingProposalIds }) {
  const revision = observation?.content_revision ? String(observation.content_revision).slice(0, 10) : null;
  if (intent?.state === 'proposed') {
    return {
      proposed: true, pending_decision_ids: pendingProposalIds,
      implementation: chip('unavailable', 'proposed — no code observed'),
      verification: chip('unavailable', 'not applicable while proposed'),
    };
  }
  if (observation) {
    return {
      proposed: false, pending_decision_ids: pendingProposalIds,
      implementation: chip('neutral', `observed at ${revision ?? 'unrevisioned content'}`),
      verification: verified
        ? chip('verified', 'verified — declared evidence on record')
        : chip('attention', 'implemented — not verified'),
    };
  }
  return {
    proposed: false, pending_decision_ids: pendingProposalIds,
    implementation: chip('unavailable', 'no current observation'),
    verification: chip('unavailable', 'unverified — nothing observed to verify'),
  };
}

export function architectureFixture({ snapshot, graphs = [], componentScopes = [], supersessions = [],
  journeys = [], gitFacts = null, verification = [] } = {}) {
  const state = parseSnapshot(snapshot);
  const authoredElements = requireArray(state.architecture, 'snapshot.architecture');
  const authoredIds = new Set(authoredElements.map(element => element.id));
  for (const element of authoredElements) {
    if (typeof element.id !== 'string' || !element.id.length) fail('INVALID_ID', 'An architecture element carries its identity');
    if (element.parent_id != null && (!authoredIds.has(element.parent_id) || element.parent_id === element.id)) {
      fail('INVALID_REFERENCE', `Containment link on ${element.id} must reference another element`);
    }
    for (const relationship of requireArray(element.relationships ?? [], 'element relationships', 128)) {
      if (!authoredIds.has(relationship.target_id) || relationship.target_id === element.id) {
        fail('INVALID_REFERENCE', `A relationship on ${element.id} must reference another element`);
      }
    }
  }

  const scopes = parseScopes(componentScopes, authoredIds);
  const supersessionLinks = parseSupersessions(supersessions, authoredIds);
  const verificationEntries = parseVerification(verification, authoredIds);
  const journeyInputs = parseJourneys(journeys);
  const graphInputs = parseGraphs(graphs, new Set(state.plans.map(plan => plan.id)));

  // Pending proposals are the recorded authority for the proposed treatment.
  const pendingProposals = requireArray(state.proposals, 'snapshot.proposals')
    .filter(proposal => plain(proposal) && proposal.state === 'proposed');
  const pendingByComponent = new Map();
  for (const proposal of pendingProposals) {
    for (const componentId of proposal.impact?.architecture_ids ?? []) {
      if (!pendingByComponent.has(componentId)) pendingByComponent.set(componentId, []);
      pendingByComponent.get(componentId).push(proposal.id);
    }
  }

  // Contract elements -> T13 authored state (containment inverted from
  // parent_id; relationships mapped onto the projection vocabulary).
  const childrenOf = new Map();
  for (const element of authoredElements) {
    if (element.parent_id == null) continue;
    if (!childrenOf.has(element.parent_id)) childrenOf.set(element.parent_id, []);
    childrenOf.get(element.parent_id).push(element.id);
  }
  const authoredState = authoredElements.map(element => ({
    id: element.id, role: element.role ?? null,
    contains: sorted(childrenOf.get(element.id) ?? []),
    relationships: requireArray(element.relationships ?? [], 'element relationships', 128)
      .map(relationship => ({ kind: relationship.kind, to: relationship.target_id, basis: 'authored', note: relationship.note ?? null })),
    state: pendingByComponent.has(element.id) ? 'proposed' : 'accepted',
    contributing_plans: [],
  }));
  const authoredById = new Map(authoredState.map(element => [element.id, element]));
  for (const link of supersessionLinks) {
    authoredById.get(link.successor_id).relationships.push({ kind: 'replaces', to: link.superseded_id, basis: 'agent-authored', note: link.source });
  }

  const { observations, git } = observationsFromGit(gitFacts, scopes);
  const t13State = { architecture: authoredState, plans: [], graphs: graphInputs.map(graph => ({ plan_id: graph.plan_id, edges: graph.edges })) };
  const views = projectArchitecture(t13State, {
    observations,
    verification_evidence: verificationEntries.map(entry => ({ component_id: entry.component_id })),
  });
  const journeysProjected = journeyInputs.map(journey => ({ id: journey.id, title: journey.title,
    ...productJourney(t13State, journey.steps) }));

  // Authored detail the T13 views deliberately do not carry.
  const authoredDetail = new Map();
  for (const element of authoredElements) {
    authoredDetail.set(element.id, {
      id: element.id, kind: element.kind, title: element.title, role: element.role ?? null,
      source: element.source ?? null, parent_id: element.parent_id ?? null,
      contains: sorted(childrenOf.get(element.id) ?? []),
      relationships: authoredById.get(element.id).relationships,
      pending_decision_ids: sorted(pendingByComponent.get(element.id) ?? []),
    });
  }

  const currentById = new Map(views.current.map(entry => [entry.id, entry]));
  const plannedById = new Map(views.planned.map(entry => [entry.id, entry]));
  const verifiedComponents = new Set(verificationEntries.map(entry => entry.component_id));
  const verificationByComponent = new Map(verificationEntries.map(entry => [entry.component_id, entry]));

  // Statuses computed once; the DOM layer renders these verbatim.
  const components = {};
  for (const id of views.identities) {
    const intent = plannedById.get(id) ?? null;
    const observation = currentById.get(id) ?? null;
    const verifiedSource = verificationByComponent.get(id)?.source ?? null;
    components[id] = {
      id,
      status: statusOf({ intent, observation, verified: verifiedComponents.has(id),
        pendingProposalIds: sorted(pendingByComponent.get(id) ?? []) }),
      intent: intent ? { state: intent.state, treatment: intent.treatment, role: intent.role,
        contains: intent.contains, relationships: intent.relationships, contributing_plans: intent.contributing_plans } : null,
      observation: observation ? { paths: observation.paths, content_revision: observation.content_revision,
        coverage: observation.coverage, observed_at: observation.observed_at } : null,
      authored: authoredDetail.get(id) ?? null,
      verification: verifiedSource ? { source: verifiedSource } : null,
      in_current: Boolean(observation), in_planned: Boolean(intent),
    };
  }

  // Feature navigation (spec §7.3): a feature points at several components and
  // plans; every id below is the recorded identity, so navigation between
  // lenses cannot drift.
  const contributingPlansByComponent = new Map();
  for (const graph of graphInputs) {
    for (const edge of graph.edges) {
      if (edge.kind !== 'shares-component' || !edge.component_id) continue;
      if (!contributingPlansByComponent.has(edge.component_id)) contributingPlansByComponent.set(edge.component_id, []);
      contributingPlansByComponent.get(edge.component_id).push(graph.plan_id);
    }
  }
  const openDecisionIds = pendingProposals.map(proposal => proposal.id);
  const features = [];
  for (const item of state.items) {
    if (!plain(item) || item.applicability?.scope !== 'component') continue;
    const componentIds = requireArray(item.applicability.subject_ids ?? [], 'feature subject_ids', 256)
      .filter(subject => authoredIds.has(subject));
    if (!componentIds.length) continue;
    const directPlans = state.plans.filter(plan => requireArray(plan.baseline_refs ?? [], 'plan baseline_refs', 4096)
      .some(reference => reference.item_id === item.id)).map(plan => plan.id);
    const planIds = sorted(new Set([...directPlans,
      ...componentIds.flatMap(componentId => contributingPlansByComponent.get(componentId) ?? [])]));
    const codePaths = sorted(new Set(componentIds.flatMap(componentId => components[componentId]?.observation?.paths ?? [])));
    const decisions = sorted(new Set(state.proposals
      .filter(proposal => plain(proposal) && proposal.state === 'proposed'
        && (requireArray(proposal.impact?.item_ids ?? [], 'proposal impact item_ids', 256).includes(item.id)
          || requireArray(proposal.impact?.architecture_ids ?? [], 'proposal impact architecture_ids', 256)
            .some(componentId => componentIds.includes(componentId))))
      .map(proposal => proposal.id)));
    const verificationFor = componentIds
      .filter(componentId => verificationByComponent.has(componentId))
      .map(componentId => ({ component_id: componentId, source: verificationByComponent.get(componentId).source }));
    features.push({ id: item.id, title: item.title ?? item.id, component_ids: sorted(componentIds),
      affected_plan_ids: planIds, code_paths: codePaths, open_decision_ids: decisions, verification: verificationFor });
  }

  return {
    viewId: 'architecture', docId: `architecture:${state.project_id}`,
    title: 'Architecture', subtitle: 'Product and engineering lenses over one component identity set (read-only projection)',
    identities: views.identities, current: views.current, planned: views.planned, change: views.change,
    coverageNote: views.coverage_note,
    journeys: journeysProjected, features, components, git,
    openDecisionIds,
    scopeDeclarations: scopes.map(scope => ({ component_id: scope.component_id, paths: scope.paths, coverage: scope.coverage, source: scope.source })),
    supersessions: supersessionLinks,
  };
}
