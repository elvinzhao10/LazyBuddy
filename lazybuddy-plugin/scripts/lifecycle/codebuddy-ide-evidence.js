'use strict';

const path = require('node:path');
const { LifecycleError } = require('./errors');
const { readJson } = require('./files');
const {
  marketplaceIdentity,
  timestamp,
  validateMarketplace,
  validateWorkspace,
  workspaceFor,
  writeOutput,
} = require('./codebuddy-ide-surfaces');

const SURFACES = Object.freeze([
  ['openFile', 'invoke-documented'],
  ['openDiff', 'invoke-documented'],
  ['getDiagnostics', 'observe'],
  ['close_tab', 'invoke-documented'],
  ['oauth', 'observe'],
  ['roots', 'observe'],
  ['sampling', 'observe'],
  ['prompts', 'observe'],
  ['resources', 'observe'],
  ['browser-preview', 'observe'],
  ['browser-error-feedback', 'observe'],
  ['artifacts', 'observe'],
  ['files', 'observe'],
  ['changes', 'observe'],
  ['native-checkpoint-restore', 'invoke-documented'],
]);
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const SECRET_KEY = /(?:^|_)(?:access_token|refresh_token|client_secret|authorization|cookie|credential|code_verifier|oauth_code|secret)(?:$|_)/i;
const SECRET_VALUE = /(?:bearer\s+|access_token|refresh_token|client_secret|sk-[a-z0-9]{8,}|gh[opurs]_[a-z0-9]{8,})/i;

function fail(code, message) {
  throw new LifecycleError(code, message);
}

function exact(value, keys, name, code = 'NATIVE_EVIDENCE_INVALID') {
  if (value === null || Array.isArray(value) || typeof value !== 'object') fail(code, `${name} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code, `${name} fields are invalid`);
}

function rejectSecrets(value, key = '') {
  if (SECRET_KEY.test(key) || (typeof value === 'string' && SECRET_VALUE.test(value))) {
    fail('SECRET_MATERIAL_REJECTED', 'secret material is prohibited');
  }
  if (Array.isArray(value)) {
    value.forEach(item => rejectSecrets(item));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => rejectSecrets(child, childKey));
  }
}

function validateBaseTemplate(template) {
  if (template.schema_version !== 1 || template.record_type !== 'codebuddy-ide-native-template'
    || template.host !== 'codebuddy-ide' || template.status !== 'pending' || template.promotion !== 'prohibited') {
    fail('NATIVE_TEMPLATE_INVALID', 'native pending template is required');
  }
  const marketplace = marketplaceIdentity(path.join(template.marketplace.release_root, '.codebuddy-plugin', 'marketplace.json'));
  validateMarketplace(template.marketplace, marketplace);
  const workspace = workspaceFor(template.workspace.roots, template.workspace.primary_root, template.workspace.branch);
  validateWorkspace(template.workspace, workspace);
  return { marketplace, workspace };
}

function createEvidenceTemplate(options) {
  timestamp(options.generatedAt, 'generated_at');
  const nativeTemplate = readJson(options.template, 'NATIVE_TEMPLATE_INVALID');
  const authority = validateBaseTemplate(nativeTemplate);
  const result = {
    schema_version: 1,
    record_type: 'codebuddy-ide-evidence-template',
    template_id: 'pending:codebuddy-ide-evidence',
    host: 'codebuddy-ide',
    status: 'pending',
    generated_at: options.generatedAt,
    marketplace: authority.marketplace,
    workspace: authority.workspace,
    surfaces: SURFACES.map(([surface_id, native_mode]) => ({ surface_id, native_mode, status: 'pending' })),
    invocation: 'not-performed',
    host_readiness: { status: 'pending' },
    promotion: 'prohibited',
  };
  writeOutput(options.output, result);
  return result;
}

function validateDigest(value, code = 'NATIVE_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code, 'evidence digest is invalid');
}

function validateDocumented(details) {
  exact(details, ['contract', 'invocation'], 'documented operation');
  if (details.contract !== 'documented' || details.invocation !== 'not-performed') fail('LIVE_INVOCATION_PROHIBITED', 'descriptor cannot claim live invocation');
}

function validateDiagnostics(details, observation, now, workspace) {
  exact(details, ['captured_at', 'read_only', 'root'], 'diagnostics');
  timestamp(details.captured_at, 'diagnostics captured_at');
  if (details.read_only !== true) fail('DIAGNOSTIC_MUTATION_PROHIBITED', 'diagnostics must be read-only');
  if (!workspace.roots.includes(details.root)) fail('UNAUTHORIZED_ROOT', 'diagnostic root is not authorized');
  if (Date.parse(details.captured_at) < Date.parse(observation.observed_at) || Date.parse(details.captured_at) > Date.parse(now)) {
    fail('STALE_DIAGNOSTIC', 'diagnostics are outside the current observation window');
  }
}

function validateAvailability(details, status) {
  const keys = status === 'unavailable' ? ['availability', 'reason_code'] : ['availability'];
  exact(details, keys, 'MCP capability');
  if (details.availability !== (status === 'unavailable' ? 'unavailable' : 'available')) fail('MCP_AVAILABILITY_INVALID', 'MCP availability is inconsistent');
  if (status === 'unavailable' && details.reason_code !== 'HOST_UNSUPPORTED') fail('MCP_AVAILABILITY_INVALID', 'unsupported MCP requires a typed reason');
}

function validateRoots(details, workspace) {
  exact(details, ['roots'], 'roots');
  if (!Array.isArray(details.roots) || details.roots.length === 0
    || details.roots.some(root => !workspace.roots.includes(root))) fail('UNAUTHORIZED_ROOT', 'observed roots must be authorized');
}

function validatePreview(details, id, status) {
  if (status !== 'observed') fail('UI_SURFACE_UNAVAILABLE', `${id} requires observed UI evidence`);
  if (id === 'browser-preview') {
    exact(details, ['preview_id'], 'browser preview');
    if (!ID.test(details.preview_id)) fail('NATIVE_EVIDENCE_INVALID', 'preview identity is invalid');
    return;
  }
  exact(details, ['errors'], 'browser error feedback');
  if (!Array.isArray(details.errors) || details.errors.length === 0) fail('PREVIEW_EVIDENCE_INVALID', 'preview errors require verification evidence');
  details.errors.forEach((error, index) => {
    exact(error, ['error_digest', 'verification_evidence_digest'], `preview error ${index}`, 'PREVIEW_EVIDENCE_INVALID');
    validateDigest(error.error_digest, 'PREVIEW_EVIDENCE_INVALID');
    validateDigest(error.verification_evidence_digest, 'PREVIEW_EVIDENCE_INVALID');
  });
}

function validateEntries(details) {
  exact(details, ['entries'], 'artifact entries', 'ARTIFACT_EVIDENCE_INVALID');
  if (!Array.isArray(details.entries) || details.entries.length === 0) fail('ARTIFACT_EVIDENCE_INVALID', 'artifact entries are required');
  details.entries.forEach((entry, index) => {
    exact(entry, ['digest', 'entry_id', 'relative_path'], `artifact entry ${index}`, 'ARTIFACT_EVIDENCE_INVALID');
    if (!ID.test(entry.entry_id) || typeof entry.relative_path !== 'string' || entry.relative_path === ''
      || path.isAbsolute(entry.relative_path) || entry.relative_path.split(/[\\/]/).includes('..')) {
      fail('ARTIFACT_EVIDENCE_INVALID', 'artifact identity or path is invalid');
    }
    validateDigest(entry.digest, 'ARTIFACT_EVIDENCE_INVALID');
  });
}

function validateCheckpoint(details, workspace) {
  exact(details, ['checkpoint_id', 'external_files', 'ledger_effect', 'scope_root'], 'native checkpoint');
  if (!ID.test(details.checkpoint_id) || details.external_files !== false || details.ledger_effect !== 'none'
    || !workspace.roots.includes(details.scope_root)) fail('CHECKPOINT_SCOPE_INVALID', 'native checkpoint cannot cover external files or advance the ledger');
}

function validateSurface(surface, descriptor, observation, now, workspace) {
  exact(surface, ['details', 'evidence_digest', 'native_mode', 'status', 'surface_id'], 'surface');
  if (surface.surface_id !== descriptor.surface_id || surface.native_mode !== descriptor.native_mode
    || !['observed', 'unavailable'].includes(surface.status)) fail('NATIVE_EVIDENCE_INVALID', 'surface descriptor changed');
  validateDigest(surface.evidence_digest);
  switch (surface.surface_id) {
    case 'openFile': case 'openDiff': case 'close_tab': validateDocumented(surface.details); break;
    case 'getDiagnostics': validateDiagnostics(surface.details, observation, now, workspace); break;
    case 'oauth': case 'sampling': case 'prompts': case 'resources': validateAvailability(surface.details, surface.status); break;
    case 'roots': validateRoots(surface.details, workspace); break;
    case 'browser-preview': case 'browser-error-feedback': validatePreview(surface.details, surface.surface_id, surface.status); break;
    case 'artifacts': case 'files': case 'changes': validateEntries(surface.details); break;
    case 'native-checkpoint-restore': validateCheckpoint(surface.details, workspace); break;
    default: fail('NATIVE_EVIDENCE_INVALID', 'surface is unsupported');
  }
}

function ingestEvidenceObservation(options) {
  timestamp(options.now, 'now');
  const template = readJson(options.template, 'NATIVE_TEMPLATE_INVALID');
  if (template.schema_version !== 1 || template.record_type !== 'codebuddy-ide-evidence-template'
    || template.status !== 'pending' || template.invocation !== 'not-performed' || template.promotion !== 'prohibited') {
    fail('NATIVE_TEMPLATE_INVALID', 'evidence pending template is required');
  }
  const currentMarketplace = marketplaceIdentity(path.join(template.marketplace.release_root, '.codebuddy-plugin', 'marketplace.json'));
  validateMarketplace(template.marketplace, currentMarketplace);
  const workspace = workspaceFor(template.workspace.roots, template.workspace.primary_root, template.workspace.branch);
  validateWorkspace(template.workspace, workspace);
  const observation = readJson(options.observation, 'NATIVE_EVIDENCE_INVALID');
  rejectSecrets(observation);
  exact(observation, ['expires_at', 'marketplace', 'observation_id', 'observed_at', 'record_type', 'schema_version', 'session_id', 'surfaces', 'workspace'], 'observation');
  if (observation.schema_version !== 1 || observation.record_type !== 'codebuddy-ide-evidence-observation'
    || !ID.test(observation.observation_id) || !ID.test(observation.session_id)) fail('NATIVE_EVIDENCE_INVALID', 'observation identity is invalid');
  timestamp(observation.observed_at, 'observed_at');
  timestamp(observation.expires_at, 'expires_at');
  if (Date.parse(observation.observed_at) > Date.parse(options.now) || Date.parse(observation.expires_at) <= Date.parse(options.now)) {
    fail('NATIVE_EVIDENCE_STALE', 'observation freshness is stale');
  }
  validateMarketplace(observation.marketplace, template.marketplace);
  validateWorkspace(observation.workspace, template.workspace);
  if (!Array.isArray(observation.surfaces) || observation.surfaces.length !== template.surfaces.length) fail('NATIVE_EVIDENCE_INVALID', 'all surfaces are required');
  observation.surfaces.forEach((surface, index) => validateSurface(surface, template.surfaces[index], observation, options.now, workspace));
  const receipt = {
    schema_version: 1,
    record_type: 'codebuddy-ide-evidence-receipt',
    host: 'codebuddy-ide',
    status: 'observed',
    observation_id: observation.observation_id,
    session_id: observation.session_id,
    observed_at: observation.observed_at,
    expires_at: observation.expires_at,
    marketplace: observation.marketplace,
    workspace: observation.workspace,
    surfaces: observation.surfaces,
    ledger_effect: 'none',
    host_readiness: { status: 'pending', reason: 'evidence-recorded-not-promoted' },
    promotion: 'prohibited',
  };
  writeOutput(options.output, receipt);
  return receipt;
}

module.exports = { SURFACES, createEvidenceTemplate, ingestEvidenceObservation };
