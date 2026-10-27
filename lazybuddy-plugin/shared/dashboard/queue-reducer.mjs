import { createHash } from 'node:crypto';
import { ContractError, parseContract, stableJSON } from './contracts/parse.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => hash(stableJSON(value));
const fail = code => { throw new ContractError(code); };
function graph(plans, archived) {
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  if (byId.size !== plans.length || new Set(archived).size !== archived.length || archived.some(id => byId.has(id))) fail('DUPLICATE_PLAN');
  const complete = new Set(); const pending = new Set();
  function visit(id) {
    if (complete.has(id) || archived.includes(id)) return;
    if (pending.has(id)) fail('QUEUE_CYCLE');
    const plan = byId.get(id); if (!plan) fail('UNKNOWN_PREREQUISITE');
    if (new Set(plan.prerequisites).size !== plan.prerequisites.length) fail('DUPLICATE_PREREQUISITE');
    pending.add(id); plan.prerequisites.forEach(visit); pending.delete(id); complete.add(id);
  }
  plans.forEach(plan => visit(plan.id));
}
function checked(input) {
  const store = parseContract('queue_store', input.store);
  if (Buffer.byteLength(stableJSON(store)) > 4 * 1024 * 1024) fail('QUEUE_TOTAL_BYTES');
  if (store.project_id !== input.project_id || store.revision !== input.revision) fail('QUEUE_BINDING_MISMATCH');
  if (store.plans.some(plan => plan.project_id !== store.project_id || plan.revision > store.revision)) fail('QUEUE_PLAN_MISMATCH');
  const commands = new Set();
  let previousCommandRevision = 0;
  for (const receipt of store.commands) {
    const command = receipt.command;
    if (commands.has(command.command_id) || receipt.content_hash !== fingerprint(command)) fail('QUEUE_RECEIPT_CORRUPT');
    commands.add(command.command_id);
    if (command.target.project_id !== store.project_id || command.target.run_id !== null || !command.operation.endsWith('_queued_plan') ||
      receipt.result.command_id !== command.command_id || stableJSON(receipt.result.target) !== stableJSON(command.target) || receipt.result.revision > store.revision ||
      receipt.result.status !== 'saved' || receipt.result.plan_revision !== 0 || receipt.result.consumed_plan_revision !== null || receipt.result.reason !== null ||
      receipt.result.revision !== command.expected_revision + 1 || receipt.result.revision <= previousCommandRevision || receipt.actor.length > 256) fail('QUEUE_RECEIPT_CORRUPT');
    previousCommandRevision = receipt.result.revision;
  }
  const ids = new Set(); const runs = new Set();
  for (const intent of store.intents) {
    const request = intent.request;
    if (ids.has(request.activation_id) || runs.has(request.run_id) || request.project_id !== store.project_id ||
      intent.content_hash !== fingerprint(request) || hash(intent.content) !== request.source_sha256 ||
      intent.plan.id !== request.plan_id || intent.plan.project_id !== store.project_id || intent.plan.revision !== request.expected_plan_revision ||
      intent.result.activation_id !== request.activation_id || intent.result.run_id !== request.run_id || intent.result.plan_id !== request.plan_id) fail('ACTIVATION_INTENT_CORRUPT');
    ids.add(request.activation_id); runs.add(request.run_id);
    if (intent.status === 'pending' && !store.plans.some(plan => stableJSON(plan) === stableJSON(intent.plan))) fail('ACTIVATION_PLAN_CHANGED');
  }
  if (store.intents.filter(intent => intent.status === 'pending').length > 1) fail('MULTIPLE_PENDING_ACTIVATIONS');
  graph(store.plans, store.intents.filter(intent => intent.status === 'linked').map(intent => intent.plan.id));
  return store;
}
function command(input, store) {
  const request = parseContract('command', input.request);
  if (request.target.project_id !== store.project_id || request.target.run_id !== null) fail('QUEUE_TARGET_MISMATCH');
  if (!['create_queued_plan', 'amend_queued_plan', 'reorder_queued_plan'].includes(request.operation)) fail('QUEUE_OPERATION_REQUIRED');
  const receipt = store.commands.find(item => item.command.command_id === request.command_id);
  if (receipt) {
    if (receipt.content_hash !== fingerprint(request)) fail('COMMAND_ID_COLLISION');
    return { store, result: receipt.result, replay: true };
  }
  const result = { schema_version: 1, command_id: request.command_id, target: request.target, status: 'saved',
    revision: store.revision + 1, plan_revision: 0, consumed_plan_revision: null, reason: null };
  if (request.expected_revision !== store.revision) return { store, replay: true,
    result: { ...result, status: 'conflict', revision: store.revision, reason: 'QUEUE_REVISION_CONFLICT' } };
  if (store.intents.some(intent => intent.status === 'pending')) fail('ACTIVATION_RECOVERY_REQUIRED');
  const plan = store.plans.find(item => item.id === request.target.id);
  switch (request.operation) {
    case 'create_queued_plan': {
      const created = request.payload.plan;
      if (created.id !== request.target.id || created.project_id !== store.project_id || created.revision !== 0) fail('QUEUE_PLAN_IDENTITY');
      if (plan || store.intents.some(intent => intent.plan.id === created.id)) fail('DUPLICATE_PLAN');
      store.plans.push(created); break;
    }
    case 'amend_queued_plan':
      if (!plan) fail('UNKNOWN_PLAN');
      Object.assign(plan, request.payload, { revision: plan.revision + 1 }); break;
    case 'reorder_queued_plan': {
      if (request.target.id !== 'queue') fail('QUEUE_TARGET_MISMATCH');
      const ids = request.payload.plan_ids;
      if (ids.length !== store.plans.length || new Set(ids).size !== ids.length || ids.some(id => !store.plans.some(item => item.id === id))) fail('QUEUE_REORDER_PERMUTATION');
      store.plans = ids.map(id => store.plans.find(item => item.id === id)); break;
    }
    default: fail('QUEUE_OPERATION_REQUIRED');
  }
  store.revision += 1;
  store.commands.push({ command: request, content_hash: fingerprint(request), actor: input.actor, result });
  return { store: checked({ ...input, store, revision: store.revision }), result, replay: false };
}
function activate(input, store) {
  const request = parseContract('activation', input.request);
  if (request.project_id !== store.project_id) fail('QUEUE_TARGET_MISMATCH');
  const prior = store.intents.find(intent => intent.request.activation_id === request.activation_id);
  if (prior) {
    if (prior.content_hash !== fingerprint(request)) fail('ACTIVATION_ID_COLLISION');
    return { store, intent: prior, replay: true };
  }
  if (request.expected_revision !== store.revision) fail('QUEUE_REVISION_CONFLICT');
  if (store.intents.some(intent => intent.status === 'pending')) fail('ACTIVATION_RECOVERY_REQUIRED');
  if (store.intents.some(intent => intent.request.run_id === request.run_id || intent.plan.id === request.plan_id)) fail('ACTIVATION_IDENTITY_COLLISION');
  const plan = store.plans.find(item => item.id === request.plan_id);
  if (!plan || plan.revision !== request.expected_plan_revision) fail('PLAN_REVISION_CONFLICT');
  if (plan.readiness !== 'ready' || plan.decision_id !== null || plan.prerequisites.some(id => !store.intents.some(intent => intent.plan.id === id && intent.status === 'linked'))) fail('PLAN_NOT_READY');
  return { store, plan, request, content_hash: fingerprint(request), replay: false };
}
export function reduceQueue(input) {
  const store = checked(input);
  if (typeof input.actor !== 'string' || !input.actor || input.actor.length > 256) fail('TRUSTED_ACTOR_REQUIRED');
  switch (input.action) {
    case 'read': return { store };
    case 'command': return command(input, store);
    case 'activate': return activate(input, store);
    default: fail('UNKNOWN_QUEUE_ACTION');
  }
}
