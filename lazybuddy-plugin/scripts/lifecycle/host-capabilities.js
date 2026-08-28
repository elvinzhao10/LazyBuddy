'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CAPABILITY_STATUSES = Object.freeze(['host-executed', 'host-observed', 'descriptor-only', 'unavailable']);
const CLI_CAPABILITIES = Object.freeze(['worktree', 'background', 'daemon', 'plugin', 'workflow', 'workflow-resume']);
const WORKBUDDY_CAPABILITIES = Object.freeze(['skills', 'commands', 'agents', 'hooks', 'mcp']);
const HOSTILE_OUTPUT = /ignore previous instructions|system prompt|<\/?(?:system|assistant|user)>/i;
const VERSION = /(?:CodeBuddy(?: Code)?(?: CLI)?\s+)?v?(\d+)\.(\d+)\.(\d+)/i;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readableFingerprint(file) {
  try {
    return sha256(file);
  } catch (error) {
    if (error && typeof error === 'object' && ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}

function unavailable(capability, reasonCode, fingerprint = null) {
  return { capability, status: 'unavailable', reason_code: reasonCode, fingerprint };
}

function capability(capabilityName, status, fingerprint, evidence, reasonCode = null) {
  if (!CAPABILITY_STATUSES.includes(status)) throw new Error('invalid capability status');
  return { capability: capabilityName, status, reason_code: reasonCode, fingerprint, evidence };
}

function execute(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    cwd: path.dirname(executable), encoding: 'utf8', shell: false, timeout: 3000, maxBuffer: 65536,
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return { ok: false, output: '' };
  if (HOSTILE_OUTPUT.test(result.stdout) || result.stdout.length > 65535) return { ok: false, hostile: true, output: '' };
  return { ok: true, hostile: false, output: result.stdout };
}

function parsedVersion(executable) {
  const result = execute(executable, ['--version']);
  if (!result.ok) return { ...result, version: null };
  const matched = result.output.match(VERSION);
  return { ...result, version: matched ? matched.slice(1, 4).map(Number) : null };
}

function versionText(version) {
  return version.join('.');
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

function helpCapability(executable, fingerprint, now, capabilityName, arguments_, supported, reasonCode) {
  const result = execute(executable, arguments_);
  if (result.hostile) return unavailable(capabilityName, 'UNTRUSTED_PROBE_OUTPUT', fingerprint);
  if (!result.ok || !supported.test(result.output)) return unavailable(capabilityName, reasonCode, fingerprint);
  return capability(capabilityName, 'host-executed', fingerprint, { scope: 'probe', observed_at: now, argv: arguments_ });
}

function workflowCapability(executable, fingerprint, now) {
  const singular = helpCapability(executable, fingerprint, now, 'workflow', ['workflow', '--help'], /\b(?:create|resume|list)\b/, 'WORKFLOW_HELP_UNSUPPORTED');
  if (singular.status === 'host-executed' || singular.reason_code === 'UNTRUSTED_PROBE_OUTPUT') return singular;
  return helpCapability(executable, fingerprint, now, 'workflow', ['workflows', '--help'], /\b(?:create|resume|list)\b/, 'WORKFLOW_HELP_UNSUPPORTED');
}

function currentObservation(observation, now) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return { current: false, reason: 'OBSERVATION_ABSENT' };
  const observedAt = Date.parse(observation.observed_at);
  const current = Date.parse(now);
  if (!Number.isFinite(observedAt) || observedAt > current || current - observedAt > FIFTEEN_MINUTES) {
    return { current: false, reason: 'OBSERVATION_STALE' };
  }
  return { current: true, reason: null };
}

function probeCodeBuddy({ aliases, now, currentSessionId = null, workflowObservation = null }) {
  if (!Array.isArray(aliases) || aliases.length === 0) {
    return { product: 'CodeBuddy Code CLI', outcome: 'degraded', aliases: [], capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'BINARY_ABSENT')) };
  }
  const probes = aliases.map(executable => ({ executable, name: path.basename(executable), fingerprint: readableFingerprint(executable), probe: parsedVersion(executable) }));
  if (probes.some(({ fingerprint }) => fingerprint === null)) {
    return { product: 'CodeBuddy Code CLI', outcome: 'blocked', aliases: [], capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'BINARY_UNREADABLE')) };
  }
  if (probes.some(({ probe }) => probe.hostile)) {
    return { product: 'CodeBuddy Code CLI', outcome: 'blocked', aliases: [], capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'UNTRUSTED_PROBE_OUTPUT')) };
  }
  if (probes.some(({ probe }) => !probe.ok || probe.version === null)) {
    return { product: 'CodeBuddy Code CLI', outcome: 'blocked', aliases: [], capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'VERSION_PROBE_FAILED')) };
  }
  const versions = new Set(probes.map(({ probe }) => versionText(probe.version)));
  if (versions.size !== 1) {
    return { product: 'CodeBuddy Code CLI', outcome: 'blocked', aliases: probes.map(({ name, fingerprint }) => ({ name, fingerprint })), capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'ALIAS_VERSION_DISAGREEMENT')) };
  }
  const selected = probes.find(({ name }) => name === 'codebuddy') || probes[0];
  const fingerprint = selected.fingerprint;
  const version = selected.probe.version;
  const aliasesResult = probes.map(({ name, fingerprint: digest }) => ({ name, fingerprint: digest, version: versionText(version) }));
  const capabilities = [
    helpCapability(selected.executable, fingerprint, now, 'worktree', ['--help'], /--worktree\b/, 'WORKTREE_HELP_UNSUPPORTED'),
    helpCapability(selected.executable, fingerprint, now, 'background', ['--help'], /--bg\b/, 'BACKGROUND_HELP_UNSUPPORTED'),
    helpCapability(selected.executable, fingerprint, now, 'daemon', ['daemon', '--help'], /\bstart\b/, 'DAEMON_HELP_UNSUPPORTED'),
    helpCapability(selected.executable, fingerprint, now, 'plugin', ['plugin', '--help'], /\b(?:marketplace|install)\b/, 'PLUGIN_HELP_UNSUPPORTED'),
  ];
  const workflow = versionAtLeast(version, [2, 105, 0])
    ? workflowCapability(selected.executable, fingerprint, now)
    : unavailable('workflow', 'WORKFLOW_VERSION_UNSUPPORTED', fingerprint);
  capabilities.push(workflow);
  let resume = unavailable('workflow-resume', 'SAME_SESSION_OBSERVATION_REQUIRED', fingerprint);
  const freshness = currentObservation(workflowObservation, now);
  if (workflow.status !== 'host-executed') resume = unavailable('workflow-resume', workflow.reason_code, fingerprint);
  else if (workflowObservation && !freshness.current) resume = unavailable('workflow-resume', freshness.reason, fingerprint);
  else if (workflowObservation && workflowObservation.session_id !== currentSessionId) resume = unavailable('workflow-resume', 'WORKFLOW_SESSION_MISMATCH', fingerprint);
  else if (workflowObservation && (workflowObservation.product !== 'CodeBuddy Code CLI' || workflowObservation.status !== 'observed'
    || workflowObservation.capability !== 'workflow-resume' || workflowObservation.version !== versionText(version)
    || workflowObservation.executable_fingerprint !== fingerprint || workflowObservation.workspace_clean !== true)) {
    resume = unavailable('workflow-resume', 'WORKFLOW_OBSERVATION_INVALID', fingerprint);
  } else if (workflowObservation) resume = capability('workflow-resume', 'host-executed', fingerprint, { scope: 'current-session', observed_at: workflowObservation.observed_at, session_id: currentSessionId });
  capabilities.push(resume);
  const postProbeFingerprints = probes.map(probe => readableFingerprint(probe.executable));
  if (probes.some((probe, index) => postProbeFingerprints[index] !== probe.fingerprint)) {
    const currentFingerprint = postProbeFingerprints[probes.indexOf(selected)];
    return {
      product: 'CodeBuddy Code CLI', version: versionText(version), outcome: 'blocked',
      aliases: probes.map((probe, index) => ({ name: probe.name, fingerprint: postProbeFingerprints[index], version: versionText(version) })),
      capabilities: CLI_CAPABILITIES.map(name => unavailable(name, 'STALE_EXECUTABLE', currentFingerprint)),
    };
  }
  const blocked = capabilities.some(row => row.reason_code === 'UNTRUSTED_PROBE_OUTPUT');
  return { product: 'CodeBuddy Code CLI', version: versionText(version), outcome: blocked ? 'blocked' : 'observed', aliases: aliasesResult, capabilities };
}

function observeCodeBuddyIdePlugin({ receipt, now, expectedFingerprint, expectedVersion, expectedBuild, sessionId }) {
  if (receipt === null || receipt === undefined) return capability('plugin', 'descriptor-only', expectedFingerprint, { scope: 'package' });
  const freshness = currentObservation(receipt, now);
  if (!freshness.current) return unavailable('plugin', freshness.reason, expectedFingerprint);
  if (receipt.product !== 'CodeBuddy IDE' || receipt.status !== 'observed' || receipt.capability !== 'plugin'
    || receipt.plugin_fingerprint !== expectedFingerprint || receipt.version !== expectedVersion
    || receipt.build !== expectedBuild || receipt.session_id !== sessionId || receipt.workspace_clean !== true) {
    return unavailable('plugin', 'IDE_PLUGIN_OBSERVATION_INVALID', expectedFingerprint);
  }
  return capability('plugin', 'host-observed', expectedFingerprint, { scope: 'current-session', observed_at: receipt.observed_at, session_id: sessionId });
}

function blockedWorkBuddy(reasonCode, fingerprint) {
  return { product: 'WorkBuddy', executable: null, outcome: 'blocked', reason_code: reasonCode, capabilities: WORKBUDDY_CAPABILITIES.map(name => unavailable(name, reasonCode, fingerprint)) };
}

function buildWorkBuddyMatrix({ manifestPath, routes, receipt, now, version = null, build = null, sessionId = null, workbuddyBinary = null }) {
  const fingerprint = sha256(manifestPath);
  if (workbuddyBinary !== null) return blockedWorkBuddy('WORKBUDDY_EXECUTABLE_UNSUPPORTED', fingerprint);
  const selected = new Set(routes);
  if (selected.has('workbuddy-full-plugin') && selected.has('manual-skills-mcp-fallback')) return blockedWorkBuddy('ROUTE_COLLISION', fingerprint);
  if (receipt === null || receipt === undefined) {
    const allowed = selected.has('manual-skills-mcp-fallback') ? new Set(['skills', 'mcp']) : new Set(WORKBUDDY_CAPABILITIES);
    return {
      product: 'WorkBuddy', executable: null, outcome: 'degraded', reason_code: 'OBSERVATION_ABSENT',
      capabilities: WORKBUDDY_CAPABILITIES.map(name => allowed.has(name)
        ? capability(name, 'descriptor-only', fingerprint, { scope: 'package' })
        : unavailable(name, 'FALLBACK_SURFACE_EXCLUDED', fingerprint)),
    };
  }
  const freshness = currentObservation(receipt, now);
  if (!freshness.current) return blockedWorkBuddy(freshness.reason, fingerprint);
  if (receipt.status !== 'observed') return blockedWorkBuddy('OBSERVATION_STATUS_INVALID', fingerprint);
  if (receipt.workspace_clean !== true) return blockedWorkBuddy('WORKSPACE_DIRTY', fingerprint);
  if (receipt.product !== 'WorkBuddy' || receipt.version !== version || receipt.build !== build || receipt.session_id !== sessionId
    || receipt.manifest_fingerprint !== fingerprint || receipt.route !== [...selected][0] || !Array.isArray(receipt.surfaces)) {
    return blockedWorkBuddy('WORKBUDDY_OBSERVATION_INVALID', fingerprint);
  }
  const observed = new Set(receipt.surfaces);
  return {
    product: 'WorkBuddy', executable: null, outcome: 'observed', reason_code: null,
    capabilities: WORKBUDDY_CAPABILITIES.map(name => observed.has(name)
      ? capability(name, 'host-observed', fingerprint, { scope: 'current-session', observed_at: receipt.observed_at, session_id: sessionId })
      : unavailable(name, 'SURFACE_NOT_OBSERVED', fingerprint)),
  };
}

function discoverCodeBuddyAliases(pathValue = process.env.PATH || '') {
  const aliases = [];
  for (const name of ['codebuddy', 'cbc']) {
    for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
      const candidate = path.resolve(directory, name);
      try {
        fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK);
        aliases.push(candidate);
        break;
      } catch (error) {
        if (!error || typeof error !== 'object' || !['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
      }
    }
  }
  return aliases;
}

module.exports = { CAPABILITY_STATUSES, buildWorkBuddyMatrix, discoverCodeBuddyAliases, observeCodeBuddyIdePlugin, probeCodeBuddy };
