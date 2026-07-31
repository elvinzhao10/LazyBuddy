'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { LifecycleError, readActive, recoverBootstrapLock, recoveryReport } = require('./index');
const { safeFile } = require('./files');
const { receiptFor } = require('./receipt');

function createStatus({ envelope }) {
  function assertRuntime(paths, active, receipt) {
    const runtime = active.runtime_path;
    let file;
    try {
      file = safeFile(runtime, 'STALE_RUNTIME');
    } catch (error) {
      throw new LifecycleError('STALE_RUNTIME', `recorded Node runtime is unavailable: ${runtime}`, error);
    }
    const fingerprint = receipt.runtime.fingerprint;
    const digest = crypto.createHash('sha256').update(file.bytes).digest('hex');
    if (fs.realpathSync(runtime) !== fingerprint.realpath || digest !== fingerprint.sha256
      || active.release_metadata[active.active_release].runtime_path !== runtime) {
      throw new LifecycleError('STALE_RUNTIME', 'recorded Node runtime fingerprint changed');
    }
  }

  function inspect(paths) {
    const recovery = recoveryReport(paths);
    if (!fs.existsSync(paths.productRoot)) {
      const bootstrapIssues = recovery.issues.filter((issue) => issue.code === 'BOOTSTRAP_LOCK_PRESENT');
      return bootstrapIssues.length === 0
        ? { status: 'absent', packageReadiness: { status: 'absent' } }
        : { status: 'blocked', packageReadiness: { status: 'blocked', issues: bootstrapIssues } };
    }
    if (recovery.issues.length > 0) {
      return { status: 'blocked', packageReadiness: { status: 'blocked', issues: recovery.issues } };
    }
    try {
      const active = readActive(paths);
      if (!active) throw new LifecycleError('ACTIVE_ABSENT', 'active lifecycle state is absent');
      const verified = receiptFor(paths, active.active_release);
      assertRuntime(paths, active, verified.receipt);
      return {
        status: 'ready',
        packageReadiness: {
          status: 'ready',
          bundle: { release_id: active.active_release, version: '1.0.3', launcher: paths.launcher },
        },
        extra: { release_id: active.active_release, commit_sha: verified.receipt.commit_sha },
      };
    } catch (error) {
      return {
        status: 'blocked',
        packageReadiness: {
          status: 'blocked',
          issues: [{ code: error.code || 'INVALID_STATE', path: paths.productRoot }],
        },
      };
    }
  }

  function recoverBootstrap(options, paths) {
    if (!options.yes) {
      return {
        code: 2,
        output: envelope(options, {
          status: 'confirmation_required',
          packageReadiness: { status: 'blocked' },
          extra: { action: 'recover only a verified stale sibling bootstrap lock; rerun with --yes' },
        }),
      };
    }
    recoverBootstrapLock(paths, 'recover-stale-bootstrap-lock');
    const current = inspect(paths);
    return {
      code: 0,
      output: envelope(options, {
        status: 'bootstrap_lock_recovered',
        packageReadiness: current.packageReadiness,
        hostReadiness: current.hostReadiness,
      }),
    };
  }

  return { inspect, recoverBootstrap };
}

module.exports = { createStatus };
