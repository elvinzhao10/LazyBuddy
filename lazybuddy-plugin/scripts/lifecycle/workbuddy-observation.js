'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { atomicJson, readJson, safeFile, sha256File } = require('./files');
const { validateReceiptPath, validateWorkbuddyReceipt } = require('./workbuddy-receipt');
const {
  digest, exact, fail, identifier, rejectSensitive, timestamp, validateItemTimes, validateOutputPath, validateSurfaces,
} = require('./workbuddy-observation-contract');

function realReleaseRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.parse(path.resolve(value)).root === path.resolve(value)) fail('WORKBUDDY_RELEASE_INVALID', 'release root must be absolute and non-root');
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('WORKBUDDY_RELEASE_INVALID', 'release root must be a real directory');
  return fs.realpathSync(value);
}

function validateLedgerLink(link, eventsPath, context) {
  exact(link, ['effect', 'event_id', 'event_sha256', 'owner', 'run_id'], 'ledger_link');
  if (link.owner !== 'run-ledger' || link.effect !== 'reference-only') fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger ownership must remain reference-only');
  identifier(link.run_id, 'ledger_link.run_id');
  identifier(link.event_id, 'ledger_link.event_id');
  digest(link.event_sha256, 'ledger_link.event_sha256');
  const bytes = safeFile(eventsPath, 'WORKBUDDY_LEDGER_LINK_INVALID').bytes;
  if (bytes.length > 1024 * 1024) fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger event stream exceeds the observation limit');
  let match = null;
  for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); } catch (_error) { fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger event stream is malformed'); }
    if (event.event_id === link.event_id) {
      exact(event, ['event', 'event_id', 'observation_id', 'run_id', 'source_receipt_sha256', 'ts'], 'run-ledger observation event', 'WORKBUDDY_LEDGER_LINK_INVALID');
      if (event.event !== 'host_observation_linked' || event.run_id !== link.run_id
        || event.observation_id !== context.observationId || event.source_receipt_sha256 !== context.receiptDigest) fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger observation event changed');
      timestamp(event.ts, 'run-ledger event timestamp');
      if (crypto.createHash('sha256').update(line).digest('hex') !== link.event_sha256) fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger event digest changed');
      match = event;
    }
  }
  if (match === null) fail('WORKBUDDY_LEDGER_LINK_INVALID', 'run-ledger observation event is missing');
}

function observe(options) {
  const releaseRoot = realReleaseRoot(options.releaseRoot);
  timestamp(options.now, 'now');
  validateReceiptPath(options.marketplaceReceipt);
  const receiptDigest = sha256File(options.marketplaceReceipt);
  const observation = readJson(options.observation, 'WORKBUDDY_OBSERVATION_INVALID');
  rejectSensitive(observation);
  exact(observation, ['build', 'bundle_id', 'expires_at', 'host', 'host_readiness', 'invocation', 'ledger_link', 'observation_id', 'observed_at', 'permission_selection', 'promotion', 'record_type', 'schema_version', 'session_id', 'surfaces'], 'observation');
  if (observation.schema_version !== 1 || observation.record_type !== 'workbuddy-sanitized-observation'
    || observation.host !== 'workbuddy') fail('WORKBUDDY_OBSERVATION_INVALID', 'observation identity is invalid');
  identifier(observation.bundle_id, 'bundle_id');
  identifier(observation.observation_id, 'observation_id');
  identifier(observation.build, 'build');
  identifier(observation.session_id, 'session_id');
  timestamp(observation.observed_at, 'observed_at');
  timestamp(observation.expires_at, 'expires_at');
  if (Date.parse(observation.observed_at) > Date.parse(options.now)
    || Date.parse(observation.expires_at) <= Date.parse(options.now)
    || Date.parse(observation.expires_at) <= Date.parse(observation.observed_at)) fail('WORKBUDDY_STALE_OBSERVATION', 'observation freshness is stale');
  if (observation.permission_selection !== 'not-performed') fail('WORKBUDDY_PERMISSION_MUTATION_REJECTED', 'permission selection is prohibited');
  if (observation.invocation !== 'not-performed') fail('WORKBUDDY_REMOTE_INVOCATION_REJECTED', 'remote invocation is prohibited');
  if (observation.promotion !== 'prohibited'
    || JSON.stringify(observation.host_readiness) !== JSON.stringify({ status: 'pending', scope: 'observation-only' })) fail('WORKBUDDY_PROMOTION_REJECTED', 'surface observations cannot promote host readiness');
  const manifest = path.join(releaseRoot, 'lazybuddy-plugin', '.workbuddy-plugin', 'plugin.json');
  validateWorkbuddyReceipt(options.marketplaceReceipt, {
    releaseRoot, manifestSha256: sha256File(manifest), build: observation.build,
    session: observation.session_id, now: new Date(options.now),
  });
  const context = { observationId: observation.observation_id, observedAt: observation.observed_at, expiresAt: observation.expires_at, receiptDigest };
  validateSurfaces(observation.surfaces, context);
  validateItemTimes(observation.surfaces, observation.observed_at, observation.expires_at);
  validateLedgerLink(observation.ledger_link, options.runEvents, context);
  validateOutputPath(options.output);
  const parent = path.dirname(options.output);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail('WORKBUDDY_OUTPUT_INVALID', 'output parent must be a real directory');
  if (fs.existsSync(options.output)) fail('WORKBUDDY_IMMUTABLE_OUTPUT_EXISTS', 'observation bundle output is immutable');
  const bundle = { ...observation, record_type: 'workbuddy-observation-bundle' };
  atomicJson(fs.realpathSync(parent), options.output, bundle);
  return bundle;
}

module.exports = { observe };
