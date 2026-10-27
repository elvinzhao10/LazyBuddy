import { fail } from '../contract.mjs';

// Typed inter-plan/task relationship vocabulary. Only the declared execution
// dependencies (depends-on-*) can affect scheduling or readiness; visual,
// architecture, grouping and research links never gate.
export const EDGE_KINDS = Object.freeze(['contributes-to-feature', 'depends-on-specific-outcome',
  'depends-on-gate', 'extends', 'supersedes', 'alternative-to', 'shares-component']);
export const EXECUTION_EDGE_KINDS = Object.freeze(['depends-on-specific-outcome', 'depends-on-gate']);
export const DEPENDENCY_CONDITIONS = Object.freeze(['execution-finished', 'result-available',
  'independent-verification-confirmed', 'external-decision-accepted', 'resource-declared']);
export const JOIN_MODES = Object.freeze(['all', 'subset', 'any']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CONDITION_TARGETS = Object.freeze({
  'execution-finished': 'task',
  'result-available': 'task',
  'independent-verification-confirmed': 'task',
  'external-decision-accepted': 'decision',
  'resource-declared': 'resource',
});
const OUTCOME_CONDITIONS = Object.freeze(['execution-finished', 'result-available']);

const isId = value => typeof value === 'string' && ID_PATTERN.test(value);
const isText = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !value.includes('\0');
const isHash = value => typeof value === 'string' && HASH_PATTERN.test(value);
const isRevision = value => Number.isSafeInteger(value) && value > 0;

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Strict field checking, mirroring the project contract: unknown fields fail so
// a caller cannot smuggle in readiness or verification flags through authoring.
function fields(value, allowed, path) {
  if (!plain(value)) fail('INVALID_VALUE', `${path} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail('UNKNOWN_FIELD', `${path} has an unsupported field`);
  }
}

function dependencyInput(input, path) {
  fields(input, ['id', 'kind', 'condition', 'outcome_id', 'gate_id', 'target'], path);
  if (!isId(input.id)) fail('INVALID_ID', `${path}.id is not a valid identity`);
  if (!EXECUTION_EDGE_KINDS.includes(input.kind)) fail('INVALID_VALUE', `${path}.kind must be a declared execution dependency kind`);
  if (!DEPENDENCY_CONDITIONS.includes(input.condition)) fail('INVALID_VALUE', `${path}.condition must be a declared dependency condition`);
  if (!plain(input.target)) fail('INVALID_VALUE', `${path}.target must be a plain object`);
  const expectedType = CONDITION_TARGETS[input.condition];
  // A specific-outcome dependency tracks predecessor execution; a gate
  // dependency tracks a verifiable gate (verification, decision or resource).
  if (input.kind === 'depends-on-specific-outcome' && !OUTCOME_CONDITIONS.includes(input.condition)) {
    fail('INVALID_VALUE', `${path} depends-on-specific-outcome requires an execution or result condition`);
  }
  if (input.kind === 'depends-on-gate' && OUTCOME_CONDITIONS.includes(input.condition)) {
    fail('INVALID_VALUE', `${path} depends-on-gate requires a gate-verifiable condition`);
  }
  if (input.outcome_id !== undefined && input.kind !== 'depends-on-specific-outcome') {
    fail('INVALID_VALUE', `${path}.outcome_id applies to a specific-outcome dependency only`);
  }
  if (input.gate_id !== undefined && input.kind !== 'depends-on-gate') {
    fail('INVALID_VALUE', `${path}.gate_id applies to a gate dependency only`);
  }
  if (input.outcome_id !== undefined && !isId(input.outcome_id)) fail('INVALID_ID', `${path}.outcome_id is not a valid identity`);
  if (input.gate_id !== undefined && !isId(input.gate_id)) fail('INVALID_ID', `${path}.gate_id is not a valid identity`);
  const target = input.target;
  if (target.type === 'task') {
    fields(target, ['type', 'plan_id', 'task_id'], `${path}.target`);
    if (!isId(target.plan_id) || !isId(target.task_id)) fail('INVALID_ID', `${path}.target needs plan and task identities`);
  } else if (target.type === 'decision') {
    fields(target, ['type', 'item_id', 'item_revision'], `${path}.target`);
    if (!isId(target.item_id)) fail('INVALID_ID', `${path}.target needs an item identity`);
    if (!isRevision(target.item_revision)) fail('INVALID_VALUE', `${path}.target.item_revision must be positive`);
  } else if (target.type === 'resource') {
    fields(target, ['type', 'resource_id'], `${path}.target`);
    if (!isId(target.resource_id)) fail('INVALID_ID', `${path}.target needs a resource identity`);
  } else fail('INVALID_VALUE', `${path}.target.type is unsupported`);
  if (target.type !== expectedType) {
    fail('INVALID_VALUE', `${path}.condition ${input.condition} requires a ${expectedType} target`);
  }
  return { id: input.id, kind: input.kind, condition: input.condition,
    outcome_id: input.outcome_id ?? null, gate_id: input.gate_id ?? null,
    target: clone(input.target) };
}

function joinRule(join, dependencyIds, path) {
  if (join === undefined) return { mode: 'all', alternatives_permitted: false, subset: null };
  if (!plain(join)) fail('INVALID_VALUE', `${path} must be a plain object`);
  fields(join, ['mode', 'subset', 'alternatives_permitted'], path);
  if (!JOIN_MODES.includes(join.mode)) fail('INVALID_VALUE', `${path}.mode must be all, subset or any`);
  if (join.alternatives_permitted !== undefined && typeof join.alternatives_permitted !== 'boolean') {
    fail('INVALID_VALUE', `${path}.alternatives_permitted must be a boolean`);
  }
  const alternativesPermitted = join.alternatives_permitted ?? false;
  if (join.mode === 'any' && !alternativesPermitted) {
    fail('INVALID_VALUE', `${path} 'any' is allowed only where the authored plan permits alternatives`);
  }
  if (join.mode !== 'any' && alternativesPermitted) {
    fail('INVALID_VALUE', `${path}.alternatives_permitted applies to 'any' joins only`);
  }
  let subset = null;
  if (join.mode === 'subset') {
    if (!Array.isArray(join.subset) || !join.subset.length) {
      fail('MISSING_FIELD', `${path}.subset is required for an explicit subset join`);
    }
    const seen = new Set();
    for (const id of join.subset) {
      if (!isId(id)) fail('INVALID_ID', `${path}.subset entries must be identities`);
      if (seen.has(id)) fail('DUPLICATE_ID', `${path}.subset lists an input twice`);
      seen.add(id);
      if (!dependencyIds.includes(id)) fail('INVALID_REFERENCE', `${path}.subset must select declared inputs`);
    }
    subset = [...join.subset];
  } else if (join.subset !== undefined) {
    fail('INVALID_VALUE', `${path}.subset applies to an explicit subset join only`);
  }
  return { mode: join.mode, alternatives_permitted: alternativesPermitted, subset };
}

function taskInput(task, path) {
  fields(task, ['id', 'title', 'required', 'criteria', 'dependencies', 'join'], path);
  if (!isId(task.id)) fail('INVALID_ID', `${path}.id is not a valid identity`);
  if (!isText(task.title)) fail('INVALID_VALUE', `${path}.title must be bounded nonempty text`);
  if (task.required !== undefined && typeof task.required !== 'boolean') {
    fail('INVALID_VALUE', `${path}.required must be a boolean`);
  }
  if (task.criteria === undefined) task.criteria = [];
  else if (!Array.isArray(task.criteria) || task.criteria.length > 256) {
    fail('INVALID_VALUE', `${path}.criteria must be a bounded array`);
  }
  const criteria = task.criteria.map((criterion, index) => {
    fields(criterion, ['id', 'revision', 'required'], `${path}.criteria[${index}]`);
    if (!isId(criterion.id)) fail('INVALID_ID', `${path}.criteria[${index}].id is not a valid identity`);
    if (!isRevision(criterion.revision)) {
      fail('INVALID_VALUE', `${path}.criteria[${index}].revision must be positive`);
    }
    if (criterion.required !== undefined && typeof criterion.required !== 'boolean') {
      fail('INVALID_VALUE', `${path}.criteria[${index}].required must be a boolean`);
    }
    return { id: criterion.id, revision: criterion.revision, required: criterion.required ?? true };
  });
  const seenCriteria = new Set();
  for (const criterion of criteria) {
    if (seenCriteria.has(criterion.id)) fail('DUPLICATE_ID', `${path} lists a criterion twice`);
    seenCriteria.add(criterion.id);
  }
  if (task.dependencies === undefined) task.dependencies = [];
  else if (!Array.isArray(task.dependencies) || task.dependencies.length > 256) {
    fail('INVALID_VALUE', `${path}.dependencies must be a bounded array`);
  }
  const dependencies = task.dependencies.map((input, index) => dependencyInput(input, `${path}.dependencies[${index}]`));
  const seenInputs = new Set();
  for (const input of dependencies) {
    if (seenInputs.has(input.id)) fail('DUPLICATE_ID', `${path} declares a dependency input twice`);
    seenInputs.add(input.id);
  }
  const join = joinRule(task.join, dependencies.map(input => input.id), `${path}.join`);
  if (join.mode !== 'all' && !dependencies.length) {
    fail('INVALID_VALUE', `${path}.join requires declared dependency inputs`);
  }
  return { id: task.id, title: task.title, required: task.required ?? true, criteria, dependencies, join };
}

function planEdge(edge, path) {
  fields(edge, ['id', 'kind', 'from_plan_id', 'to_plan_id', 'item_id', 'component_id', 'note'], path);
  if (!isId(edge.id)) fail('INVALID_ID', `${path}.id is not a valid identity`);
  if (!EDGE_KINDS.includes(edge.kind)) fail('INVALID_VALUE', `${path}.kind must be a typed plan relationship`);
  if (!isId(edge.from_plan_id)) fail('INVALID_ID', `${path}.from_plan_id is not a valid identity`);
  if (edge.to_plan_id !== undefined && !isId(edge.to_plan_id)) fail('INVALID_ID', `${path}.to_plan_id is not a valid identity`);
  if (edge.item_id !== undefined && !isId(edge.item_id)) fail('INVALID_ID', `${path}.item_id is not a valid identity`);
  if (edge.component_id !== undefined && !isId(edge.component_id)) fail('INVALID_ID', `${path}.component_id is not a valid identity`);
  if (edge.note !== undefined && !isText(edge.note)) fail('INVALID_VALUE', `${path}.note must be bounded nonempty text`);
  if (edge.kind === 'contributes-to-feature') {
    if (!isId(edge.item_id ?? null)) fail('MISSING_FIELD', `${path} contributes-to-feature needs its feature item`);
    if (edge.to_plan_id !== undefined || edge.component_id !== undefined) {
      fail('INVALID_VALUE', `${path} contributes-to-feature targets a baseline feature item only`);
    }
  } else if (edge.kind === 'shares-component') {
    if (!isId(edge.component_id ?? null)) fail('MISSING_FIELD', `${path} shares-component needs its component`);
    if (edge.to_plan_id !== undefined || edge.item_id !== undefined) {
      fail('INVALID_VALUE', `${path} shares-component targets a component only`);
    }
  } else {
    if (!isId(edge.to_plan_id ?? null)) fail('MISSING_FIELD', `${path} needs the related plan`);
    if (edge.item_id !== undefined || edge.component_id !== undefined) {
      fail('INVALID_VALUE', `${path} targets a plan only`);
    }
  }
  return { id: edge.id, kind: edge.kind, from_plan_id: edge.from_plan_id,
    to_plan_id: edge.to_plan_id ?? null, item_id: edge.item_id ?? null,
    component_id: edge.component_id ?? null, note: edge.note ?? null };
}

const clone = value => JSON.parse(JSON.stringify(value));

// Author one plan's execution graph against a specific accepted plan revision
// and document content. Authoring validates shape only; acceptance into a graph
// set additionally resolves references and rejects invalid cycles.
export function authorPlanGraph(document) {
  if (!plain(document)) fail('INVALID_VALUE', 'A plan graph document must be a plain object');
  fields(document, ['schema_version', 'plan_id', 'plan_revision', 'content_sha256', 'resources', 'tasks', 'edges'], 'graph');
  if (document.schema_version !== 1) fail('INVALID_VALUE', 'graph.schema_version must be 1');
  if (!isId(document.plan_id)) fail('INVALID_ID', 'graph.plan_id is not a valid identity');
  if (!isRevision(document.plan_revision)) fail('INVALID_VALUE', 'graph.plan_revision must be positive');
  if (!isHash(document.content_sha256)) fail('INVALID_VALUE', 'graph.content_sha256 must be a SHA-256 digest');
  if (document.resources === undefined) document.resources = [];
  else if (!Array.isArray(document.resources) || document.resources.length > 256) {
    fail('INVALID_VALUE', 'graph.resources must be a bounded array');
  }
  const resources = document.resources.map((resource, index) => {
    fields(resource, ['id', 'title'], `graph.resources[${index}]`);
    if (!isId(resource.id)) fail('INVALID_ID', `graph.resources[${index}].id is not a valid identity`);
    if (!isText(resource.title)) fail('INVALID_VALUE', `graph.resources[${index}].title must be bounded nonempty text`);
    return { id: resource.id, title: resource.title };
  });
  const seenResources = new Set();
  for (const resource of resources) {
    if (seenResources.has(resource.id)) fail('DUPLICATE_ID', 'graph.resources lists an identity twice');
    seenResources.add(resource.id);
  }
  if (!Array.isArray(document.tasks) || !document.tasks.length || document.tasks.length > 4096) {
    fail('INVALID_VALUE', 'graph.tasks must be a nonempty bounded array');
  }
  const tasks = document.tasks.map((task, index) => taskInput(task, `graph.tasks[${index}]`));
  const seenTasks = new Set();
  for (const task of tasks) {
    if (seenTasks.has(task.id)) fail('DUPLICATE_ID', 'graph.tasks lists a task twice');
    seenTasks.add(task.id);
  }
  if (document.edges === undefined) document.edges = [];
  else if (!Array.isArray(document.edges) || document.edges.length > 256) {
    fail('INVALID_VALUE', 'graph.edges must be a bounded array');
  }
  const edges = document.edges.map((edge, index) => planEdge(edge, `graph.edges[${index}]`));
  const seenEdges = new Set();
  for (const edge of edges) {
    if (seenEdges.has(edge.id)) fail('DUPLICATE_ID', 'graph.edges lists an identity twice');
    seenEdges.add(edge.id);
  }
  // Resources referenced by task dependencies must be declared by this plan.
  for (const task of tasks) for (const input of task.dependencies) {
    if (input.target.type === 'task' && input.target.plan_id === document.plan_id &&
        !seenTasks.has(input.target.task_id)) {
      fail('UNKNOWN_TASK', 'A same-plan dependency targets an unknown task');
    }
    if (input.target.type === 'resource' && !seenResources.has(input.target.resource_id)) {
      fail('INVALID_REFERENCE', 'A resource dependency targets an undeclared resource');
    }
    if (input.target.type === 'task' && input.target.plan_id === document.plan_id &&
        input.target.task_id === task.id) {
      fail('INVALID_CYCLE', 'A retry is a new attempt on the same task, never a dependency cycle');
    }
  }
  return { schema_version: 1, plan_id: document.plan_id, plan_revision: document.plan_revision,
    content_sha256: document.content_sha256, resources, tasks, edges };
}

export function taskKey(planId, taskId) {
  return `${planId}\u0000${taskId}`;
}

// Compose the accepted graph set. This is the acceptance boundary: reference
// resolution, plan-level edge grounding and executable-DAG cycle rejection all
// happen here, so an invalid cycle can never be accepted into a runnable set.
export function composeGraphSet(graphDocuments, options = {}) {
  if (!Array.isArray(graphDocuments)) fail('INVALID_VALUE', 'A graph set composes an array of plan graphs');
  const state = options.state ?? null;
  const graphs = graphDocuments.map(document => authorPlanGraph(document));
  const byPlan = new Map();
  for (const graph of graphs) {
    const existing = byPlan.get(graph.plan_id);
    if (!existing) byPlan.set(graph.plan_id, graph);
    else if (existing.plan_revision === graph.plan_revision) {
      fail('DUPLICATE_ID', 'Two plan graphs claim the same plan revision');
    } else if (graph.plan_revision > existing.plan_revision) byPlan.set(graph.plan_id, graph);
  }
  const tasks = new Map();
  for (const graph of byPlan.values()) {
    for (const task of graph.tasks) {
      const key = taskKey(graph.plan_id, task.id);
      if (tasks.has(key)) fail('DUPLICATE_ID', 'A task identity is declared by two accepted graphs');
      tasks.set(key, { graph, task });
    }
  }
  for (const graph of byPlan.values()) {
    if (state) {
      const plan = state.plans.find(entry => entry.id === graph.plan_id);
      if (!plan) fail('UNKNOWN_PLAN', 'A plan graph binds an unregistered plan');
    }
    for (const task of graph.tasks) for (const input of task.dependencies) {
      if (input.target.type === 'task') {
        if (!tasks.has(taskKey(input.target.plan_id, input.target.task_id))) {
          fail('UNKNOWN_TASK', 'A dependency targets a task outside the accepted graph set');
        }
      } else if (input.target.type === 'decision' && state) {
        if (!state.items.some(entry => entry.id === input.target.item_id)) {
          fail('UNKNOWN_ITEM', 'A decision dependency targets an unknown baseline item');
        }
      }
    }
    for (const edge of graph.edges) {
      if (state && edge.item_id != null && !state.items.some(entry => entry.id === edge.item_id)) {
        fail('UNKNOWN_ITEM', 'A contributes-to-feature edge targets an unknown baseline item');
      }
      const related = edge.to_plan_id;
      if (related != null) {
        const known = byPlan.has(related) || (state ? state.plans.some(entry => entry.id === related) : false);
        if (!known) fail('UNKNOWN_PLAN', 'A plan relationship targets an unregistered plan');
      }
      // A plan-level execution edge is a rollup declaration: it must be grounded
      // by at least one task-level dependency on the same predecessor plan, and
      // it never gates anything by itself.
      if (EXECUTION_EDGE_KINDS.includes(edge.kind)) {
        const grounded = graph.tasks.some(task => task.dependencies.some(input =>
          input.target.type === 'task' && input.target.plan_id === related));
        if (!grounded) fail('INVALID_VALUE', 'A plan-level execution edge must be grounded by a task dependency');
      }
    }
  }
  // Cycle rejection over execution dependencies only. Visual, architecture and
  // grouping edges never participate: an extends cycle is presentation, not an
  // invalid executable DAG.
  const successors = new Map();
  for (const [key, { graph, task }] of tasks) {
    for (const input of task.dependencies) {
      if (input.target.type !== 'task') continue;
      const target = taskKey(input.target.plan_id, input.target.task_id);
      if (!successors.has(key)) successors.set(key, []);
      successors.get(key).push(target);
    }
  }
  const stateOf = new Map();
  const OPEN = 1; const DONE = 2;
  function visit(key, path) {
    const mark = stateOf.get(key);
    if (mark === DONE) return;
    if (mark === OPEN) {
      const cycle = path.slice(path.indexOf(key)).concat(key);
      fail('INVALID_CYCLE', `Execution dependencies form a cycle: ${cycle.map(entry => entry.split('\u0000').join('/')).join(' -> ')}`);
    }
    stateOf.set(key, OPEN);
    for (const next of successors.get(key) ?? []) visit(next, [...path, key]);
    stateOf.set(key, DONE);
  }
  for (const key of tasks.keys()) visit(key, [key]);
  const set = {
    plans: byPlan,
    tasks,
    graphFor(planId) { return byPlan.get(planId) ?? null; },
    taskAt(planId, taskId) { return tasks.get(taskKey(planId, taskId)) ?? null; },
  };
  return set;
}

// Plans inside a selected scope. Feature scope follows contributes-to-feature
// edges; plan scope is the plan itself; project scope is every graphed plan.
// Visual edges select scope but never gate readiness.
export function plansInScope(set, scope) {
  if (!plain(scope)) fail('INVALID_VALUE', 'A scope must be a plain object');
  fields(scope, ['kind', 'item_id', 'plan_id'], 'scope');
  if (scope.kind === 'project') {
    if (scope.item_id !== undefined || scope.plan_id !== undefined) fail('INVALID_VALUE', 'Project scope takes no subject');
    return [...set.plans.values()].map(graph => graph.plan_id);
  }
  if (scope.kind === 'feature') {
    if (!isId(scope.item_id ?? null)) fail('MISSING_FIELD', 'Feature scope needs its item identity');
    if (scope.plan_id !== undefined) fail('INVALID_VALUE', 'Feature scope takes no plan identity');
    const ids = new Set();
    for (const graph of set.plans.values()) {
      for (const edge of graph.edges) {
        if (edge.kind === 'contributes-to-feature' && edge.item_id === scope.item_id) ids.add(graph.plan_id);
      }
    }
    return [...ids];
  }
  if (scope.kind === 'plan') {
    if (!isId(scope.plan_id ?? null)) fail('MISSING_FIELD', 'Plan scope needs its plan identity');
    if (scope.item_id !== undefined) fail('INVALID_VALUE', 'Plan scope takes no item identity');
    if (!set.plans.has(scope.plan_id)) fail('UNKNOWN_PLAN', 'Plan scope targets an ungraphed plan');
    return [scope.plan_id];
  }
  fail('INVALID_VALUE', 'scope.kind must be project, feature or plan');
}
