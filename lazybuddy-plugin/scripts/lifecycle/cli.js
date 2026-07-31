'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LifecycleError,
  bootstrapProduct,
  offboardProduct,
  parseOfficialSource,
  productPaths,
  resolveInstallRoot,
} = require('./index');
const { receiptFor } = require('./receipt');
const { parseArgs, usage } = require('./cli-arguments');
const { parseObservation, renderHandoff, routeSelection } = require('./host-handoff');
const { createStatus } = require('./status');

const PRODUCT = 'LazyBuddy';

function resolveProject(value) {
  const candidate = value === undefined ? process.cwd() : value;
  if (!path.isAbsolute(candidate) || path.parse(path.resolve(candidate)).root === path.resolve(candidate)) {
    throw new LifecycleError('INVALID_PROJECT', '--project must be a non-root absolute path');
  }
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    throw new LifecycleError('INVALID_PROJECT', 'project path is unavailable', error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new LifecycleError('INVALID_PROJECT', 'project path must be a real directory');
  }
  return fs.realpathSync(candidate);
}

function envelope(options, values) {
  return {
    schema_version: 1,
    product: PRODUCT,
    command: options.command,
    status: values.status,
    package_readiness: values.packageReadiness,
    host_readiness: values.hostReadiness || { status: 'pending' },
    install_root: options.installRoot,
    project_root: options.projectRoot,
    ...values.extra,
  };
}

const { inspect, recoverBootstrap } = createStatus({ envelope });

function install(options, paths) {
  parseOfficialSource(options.source, PRODUCT);
  if (options.command === 'update' && !fs.existsSync(paths.active)) {
    throw new LifecycleError('NOT_INSTALLED', 'update requires an installed LazyBuddy bundle');
  }
  const result = bootstrapProduct(paths, options.command, {
    sourceUrl: options.source,
    confirmRevision: options.confirmRevision,
  });
  if (result.status === 'revision_confirmation_required') {
    return {
      code: 2,
      output: envelope(options, {
        status: result.status,
        packageReadiness: { status: 'ready' },
        extra: {
          commit_sha: result.commit_sha,
          required_confirmation: result.required_confirmation,
          action: 'rerun lifecycle update with --confirm-revision <full-sha>',
        },
      }),
    };
  }
  return {
    code: 0,
    output: envelope(options, {
      status: result.status,
      packageReadiness: { status: 'ready' },
      extra: { release_id: result.release_id, commit_sha: result.commit_sha },
    }),
  };
}

function offboard(options, paths) {
  if (!fs.existsSync(paths.productRoot)) {
    return { code: 0, output: envelope(options, { status: 'absent', packageReadiness: { status: 'absent' } }) };
  }
  if (fs.existsSync(paths.lock)) throw new LifecycleError('LOCKED', 'lifecycle operation lock exists');
  if (!options.yes) {
    const current = inspect(paths);
    if (current.status === 'blocked') {
      return { code: 1, output: envelope(options, current) };
    }
    return {
      code: 2,
      output: envelope(options, {
        status: 'confirmation_required',
        packageReadiness: { status: 'ready' },
        extra: {
          action: `remove exact receipt-owned LazyBuddy state at ${paths.productRoot}; preserve project and host settings; rerun with --yes`,
        },
      }),
    };
  }
  offboardProduct(paths, 'offboard-product');
  return { code: 0, output: envelope(options, { status: 'removed', packageReadiness: { status: 'absent' } }) };
}

function status(options, paths) {
  const current = inspect(paths);
  if (current.status !== 'ready') return { code: current.status === 'blocked' ? 1 : 0, output: envelope(options, current) };
  const selection = routeSelection(options.routes);
  if (selection.kind === 'none') return { code: 0, output: envelope(options, current) };
  if (selection.kind === 'conflict') {
    return {
      code: 1,
      output: envelope(options, {
        status: 'blocked',
        packageReadiness: current.packageReadiness,
        extra: { ...current.extra, route_conflict: { routes: selection.routes, next_action: selection.nextAction } },
      }),
    };
  }
  receiptFor(paths, current.extra.release_id);
  const releaseRoot = path.join(paths.releases, current.extra.release_id);
  return {
    code: 0,
    output: envelope(options, {
      ...current,
      hostReadiness: parseObservation(options.observationReceipt, selection.host),
      extra: { ...current.extra, host_handoff: renderHandoff(selection.route, releaseRoot, options.projectRoot) },
    }),
  };
}

function execute(options) {
  options.installRoot = resolveInstallRoot({ installRoot: options.installRoot });
  options.projectRoot = resolveProject(options.project);
  const paths = productPaths({ installRoot: options.installRoot, product: PRODUCT });
  if (['onboard', 'update'].includes(options.command)) return install(options, paths);
  if (options.command === 'offboard') return offboard(options, paths);
  if (options.command === 'recover-bootstrap-lock') return recoverBootstrap(options, paths);
  return status(options, paths);
}

function failure(options, error) {
  let installRoot = null;
  try {
    installRoot = resolveInstallRoot({ installRoot: options.installRoot });
  } catch (error) {
    if (!(error instanceof LifecycleError)) throw error;
  }
  const issuePath = installRoot === null ? null : path.join(installRoot, PRODUCT);
  return envelope(
    {
      command: options.command || 'unknown',
      installRoot,
      projectRoot: options.projectRoot || options.project || process.cwd(),
    },
    {
      status: 'error',
      packageReadiness: {
        status: 'blocked',
        issues: [{ code: error.code || 'UNEXPECTED_ERROR', path: issuePath }],
      },
      extra: {
        ...(error.preservation ? { preservation: error.preservation } : {}),
        error: { code: error.code || 'UNEXPECTED_ERROR', message: error.message },
      },
    },
  );
}

function print(result, asJson) {
  if (asJson) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  else process.stdout.write(`${result.output.product} ${result.output.command}: ${result.output.status}\n`);
}

function run(argv) {
  let options = { command: argv[0], json: argv.includes('--json') };
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(usage());
      return 0;
    }
    const result = execute(options);
    print(result, options.json);
    return result.code;
  } catch (cause) {
    const error = cause instanceof LifecycleError
      ? cause
      : new LifecycleError('UNEXPECTED_ERROR', cause instanceof Error ? cause.message : String(cause), cause);
    const output = failure(options, error);
    if (options.json) process.stdout.write(`${JSON.stringify(output)}\n`);
    else process.stderr.write(`lazybuddy lifecycle: ${error.code}: ${error.message}\n`);
    return 1;
  }
}

module.exports = { parseArgs, run, usage };
