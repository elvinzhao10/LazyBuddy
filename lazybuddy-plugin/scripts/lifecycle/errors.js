'use strict';

class LifecycleError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LifecycleError';
    this.code = code;
  }
}

function workspacePreserved(paths, artifacts, message, cause) {
  const error = new LifecycleError('WORKSPACE_PRESERVED', message, cause);
  error.preservation = {
    status: 'recovery_required',
    public_workspace: paths.productRoot,
    retained_artifacts: artifacts
      .filter(({ lastKnownPath }) => lastKnownPath !== paths.productRoot)
      .map(({ kind, lastKnownPath }) => ({
        kind,
        last_known_path: lastKnownPath,
      })),
  };
  return error;
}

module.exports = { LifecycleError, workspacePreserved };
