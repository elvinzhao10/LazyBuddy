// T20 shared chat/UI project tool surface (spec 6.1). This module invents no
// authority: every action maps onto the existing project model operations and
// executes through the same shared command route the T15 UI editor uses
// (shared/project/cli.mjs executeProjectCommand / readProject). Chat (MCP
// `project` tool) and UI submit the same typed command JSON, so the same edit
// has the same authoritative outcome. Delivery and consumption are reported by
// the native runtime only — never inferred from file writes — and a
// not-initialized repository answers with a typed hint whose init offer is a
// question, never an action (IO-1/IO-3).
import { CAPABILITY_OPERATIONS, SOURCE_OPERATIONS, assertProjectCommand,
  ProjectContractError } from '../../project/contract.mjs';
import { ProjectBridgeError, executeProjectCommand, readProject } from '../../project/cli.mjs';

export const CHAT_TOOL_ACTIONS = Object.freeze([...CAPABILITY_OPERATIONS, ...SOURCE_OPERATIONS, 'project.context']);

const notInitialized = action => ({
  schema_version: 1, status: 'not_initialized', operation: action,
  hint: 'PROJECT_NOT_INITIALIZED', initialized: false,
  init_offer: { kind: 'question',
    question: 'No project record is initialized for this repository. Ask the user whether to run the explicit project init command; this tool never creates or initializes a project.' },
});

const invalid = (action, reason) => ({
  schema_version: 1, status: 'invalid', operation: action, reason, initialized: true,
});

// Unobserved-delivery receipt (spec 6 step 8): recording a request or saving a
// change says nothing about native delivery or consumption.
const deliveryReceipt = () => ({
  channel: 'shared-command-route', native_delivery: 'unobserved', consumed_by_native: false,
  basis: 'delivery and consumption are reported by the native runtime only; never inferred from file writes',
});

const tally = (values, accessor) => Object.fromEntries([...new Set(values.map(value => accessor(value)))]
  .sort().map(state => [state, values.filter(value => accessor(value) === state).length]));

// Read-only context provider: a deterministic summary of the initialized
// project state an agent may load, with the honesty boundaries explicit.
export function contextSummary(snapshot) {
  const plans = snapshot.plans ?? [];
  const requests = snapshot.requests ?? [];
  return {
    schema_version: 1, kind: 'project-context',
    project: { project_id: snapshot.project_id, runtime: snapshot.runtime,
      revision: snapshot.revision, baseline_revision: snapshot.baseline_revision,
      observation_revision: snapshot.observation_revision ?? 0 },
    sources: { total: (snapshot.sources ?? []).length,
      by_observation_status: tally(snapshot.sources ?? [], s => s.observation.status) },
    baseline: { items_total: (snapshot.items ?? []).length,
      items_by_state: tally(snapshot.items ?? [], item => item.state),
      items_by_kind: tally(snapshot.items ?? [], item => item.kind) },
    plans: { total: plans.length, by_lifecycle: tally(plans, plan => plan.declared_lifecycle),
      stale_reference_plan_ids: plans.filter(plan => plan.baseline_reference_status === 'stale').map(plan => plan.id) },
    collaboration: { proposals_by_state: tally(snapshot.proposals ?? [], proposal => proposal.state),
      open_reconciliations: (snapshot.reconciliations ?? []).length,
      requests: { total: requests.length, recorded: requests.filter(request => request.state === 'recorded').length,
        delivery_unobserved: requests.filter(request => request.delivery === 'unobserved').length } },
    artifacts: { total: (snapshot.artifacts ?? []).length },
    boundaries: { native_delivery: 'unobserved', host_wake: 'unclaimed',
      consumption: 'reported by the native runtime only; never inferred from file writes' },
  };
}

function composeCommand(action, projectId, request) {
  const value = request === undefined || request === null ? {} : request;
  const command = { schema_version: 1, command_id: value.command_id, project_id: projectId,
    expected_revision: value.expected_revision, operation: action, payload: value.payload ?? {} };
  assertProjectCommand(command);
  return command;
}

function typedFailure(action, error) {
  if (error instanceof ProjectBridgeError && error.code === 'PROJECT_NOT_INITIALIZED') return notInitialized(action);
  if (error instanceof ProjectBridgeError || error instanceof ProjectContractError) return invalid(action, error.code);
  throw error;
}

// One tool call: chat and UI bind this to the identical command executor.
// Every response is the same envelope: { schema_version, tool, action, route,
// delivery, result } where `result` is the typed model outcome
// (ok/valid/invalid/conflict/not_initialized) and, for accepted commands, the
// retained receipt and post-command snapshot ride alongside it.
export async function executeProjectTool({ projectRoot, projectId, actor, action, request }) {
  if (!CHAT_TOOL_ACTIONS.includes(action)) throw new ProjectBridgeError('UNKNOWN_CHAT_TOOL_ACTION');
  if (typeof request !== 'object' && request !== undefined && request !== null) {
    throw new ProjectBridgeError('INVALID_TOOL_REQUEST');
  }
  const envelope = outcome => ({ schema_version: 1, tool: 'project', action, route: 'shared-command-route',
    delivery: deliveryReceipt(), ...outcome });
  if (action === 'project.context') {
    let snapshot;
    try { snapshot = await readProject({ projectRoot, projectId, actor }); }
    catch (error) { return envelope({ result: typedFailure(action, error) }); }
    return envelope({ result: { schema_version: 1, status: 'ok', operation: 'project.context', initialized: true,
      project_id: snapshot.project_id, summary: contextSummary(snapshot) } });
  }
  let command;
  try { command = composeCommand(action, projectId, request); }
  catch (error) { return envelope({ result: typedFailure(action, error) }); }
  let outcome;
  try { outcome = await executeProjectCommand({ projectRoot, projectId, actor }, command); }
  catch (error) { return envelope({ result: typedFailure(action, error) }); }
  const response = {};
  if (outcome.result !== undefined) response.result = outcome.result;
  if (outcome.receipt) response.receipt = outcome.receipt;
  response.snapshot = outcome.snapshot;
  return envelope(response);
}
