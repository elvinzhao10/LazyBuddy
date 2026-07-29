'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promoteRelease } = require('./core');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');
const { receiptFor } = require('./receipt');
const { readActive } = require('./state');

const VERSION = '1.0.3';
const CONTRACT_DIGESTS = Object.freeze({
  'lazy-harness-lifecycle.v1.example.json': '6b10b60074fd9dac366b9b92d22daf06de73e76f8530cc376b58fcae20b05445',
  'lazy-harness-lifecycle.v1.schema.json': 'd43ed27597e97f93d1be408472d2640171eee9d73b0e49d3c7332993bbc04388',
});
const PRODUCTS = Object.freeze({
  LazyBuddy: {
    entrypoint: 'lazybuddy-plugin/scripts/lifecycle.js',
    manifest: 'lazybuddy-plugin/.codebuddy-plugin/plugin.json',
    manifests: [
      ['lazybuddy-plugin/.codebuddy-plugin/plugin.json', 'lazybuddy'],
      ['lazybuddy-plugin/.workbuddy-plugin/plugin.json', 'lazybuddy'],
    ],
    selfTest: 'lazybuddy-plugin/scripts/lifecycle-self-test.js',
    contracts: 'lazybuddy-plugin/contracts',
  },
  LazyTrae: {
    entrypoint: 'lazytrae-plugin/packages/cli/bin/lazytrae.js',
    manifest: 'lazytrae-plugin/packages/cli/package.json',
    manifests: [['lazytrae-plugin/packages/cli/package.json', 'lazytrae-ai']],
    selfTest: 'lazytrae-plugin/packages/cli/scripts/lifecycle-self-test.js',
    contracts: 'lazytrae-plugin/packages/cli/contracts',
  },
});

function parseOfficialSource(source, product) {
  const spec = PRODUCTS[product];
  if (!spec || typeof source !== 'string') throw new LifecycleError('INVALID_ORIGIN', 'unknown product or source');
  const match = /^https:\/\/github\.com\/elvinzhao10\/(LazyTrae|LazyBuddy)(?:\.git|\/tree\/([A-Za-z0-9][A-Za-z0-9._/-]*))?$/.exec(source);
  const ref = match && match[2] ? match[2] : `v${VERSION}`;
  const invalidRef = !match || match[1] !== product || ref.includes('//') || ref.endsWith('/')
    || ref.split('/').some((part) => part === '.' || part === '..' || part.endsWith('.lock'));
  if (invalidRef) throw new LifecycleError('INVALID_ORIGIN', 'source must be a canonical official HTTPS GitHub URL');
  return {
    canonicalOrigin: `https://github.com/elvinzhao10/${product}.git`,
    product,
    ref,
    repository: `elvinzhao10/${product}`,
  };
}

function run(command, args, options) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new LifecycleError('PREREQUISITE_MISSING', `required executable is unavailable: ${command}`, result.error);
  }
  if (result.error) throw new LifecycleError(options.code, `${options.label} did not complete`, result.error);
  if (result.status !== 0) {
    throw new LifecycleError(options.code, `${options.label} failed with exit ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function gitCommand(gitPath, args, options) {
  return run(gitPath, ['-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'http.followRedirects=false', ...args], {
    ...options,
    code: 'GIT_FAILED',
  });
}

function rows(output) {
  if (output === '') return [];
  return output.split('\n').map((line) => {
    const match = /^([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new LifecycleError('GIT_FAILED', 'Git returned malformed revision data');
    return { sha: match[1], ref: match[2] };
  });
}

function resolveRevision(remote, ref, gitPath, timeoutMs) {
  if (/^[0-9a-f]{40}$/.test(ref)) return { fetchRef: ref, sha: ref };
  const common = { label: 'Git revision resolution', timeoutMs };
  const heads = rows(gitCommand(gitPath, ['ls-remote', '--heads', remote, `refs/heads/${ref}`], common));
  const tags = rows(gitCommand(gitPath, ['ls-remote', '--tags', remote, `refs/tags/${ref}`, `refs/tags/${ref}^{}`], common));
  if (heads.length > 0 && tags.length > 0) throw new LifecycleError('AMBIGUOUS_REF', 'branch and tag share the selected name');
  if (heads.length === 1) return { fetchRef: `refs/heads/${ref}`, sha: heads[0].sha };
  if (tags.length > 0) {
    const peeled = tags.find((row) => row.ref.endsWith('^{}'));
    return { fetchRef: `refs/tags/${ref}`, sha: peeled ? peeled.sha : tags[0].sha };
  }
  throw new LifecycleError('REVISION_NOT_FOUND', 'selected revision was not found');
}

function verifyStagedPackage(root, product) {
  const spec = PRODUCTS[product];
  if (!spec) throw new LifecycleError('INVALID_MANIFEST', 'unknown product');
  for (const [relativePath, packageName] of spec.manifests) {
    let manifest;
    try {
      manifest = JSON.parse(safeFile(path.join(root, relativePath), 'INVALID_MANIFEST').bytes.toString('utf8'));
    } catch (error) {
      if (error instanceof LifecycleError) throw error;
      throw new LifecycleError('INVALID_MANIFEST', `package manifest is not valid JSON: ${relativePath}`, error);
    }
    if (manifest.name !== packageName || manifest.version !== VERSION) {
      throw new LifecycleError('INVALID_MANIFEST', `expected ${packageName} v${VERSION}: ${relativePath}`);
    }
  }
  for (const [name, expected] of Object.entries(CONTRACT_DIGESTS)) {
    const contract = safeFile(path.join(root, spec.contracts, name), 'CHECKSUM_MISMATCH').bytes;
    const checksum = safeFile(path.join(root, spec.contracts, `${name}.sha256`), 'CHECKSUM_MISMATCH').bytes.toString('utf8');
    const actual = crypto.createHash('sha256').update(contract).digest('hex');
    if (actual !== expected || checksum !== `${expected}  ${name}\n`) {
      throw new LifecycleError('CHECKSUM_MISMATCH', `contract integrity failed: ${name}`);
    }
  }
  safeFile(path.join(root, spec.entrypoint), 'INVALID_ENTRYPOINT');
  safeFile(path.join(root, spec.selfTest), 'SELF_TEST_FAILED');
  return { entrypoint: spec.entrypoint, manifest: spec.manifest, selfTest: spec.selfTest, version: VERSION };
}

function confirmationResult(parsed, sha) {
  return {
    canonical_origin: parsed.canonicalOrigin,
    commit_sha: sha,
    required_confirmation: sha,
    status: 'revision_confirmation_required',
    test: { status: 'not_run' },
    version: VERSION,
  };
}

function bootstrapRelease(paths, options) {
  const parsed = parseOfficialSource(options.sourceUrl, paths.product);
  if (Object.hasOwn(options, 'allowLocalFixture') || Object.hasOwn(options, 'transportRemote')) {
    throw new LifecycleError('INVALID_ORIGIN', 'bootstrap transport must use the canonical official origin');
  }
  const remote = parsed.canonicalOrigin;
  const gitPath = options.gitPath || 'git';
  const runtimePath = options.runtimePath || process.execPath;
  const timeoutMs = options.timeoutMs || 30_000;
  const nodeVersion = run(runtimePath, ['--version'], {
    code: 'PREREQUISITE_MISSING',
    label: 'Node.js LTS prerequisite',
    timeoutMs,
  });
  const nodeMajor = Number(/^v(\d+)\./.exec(nodeVersion)?.[1]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 20 || nodeMajor % 2 !== 0) {
    throw new LifecycleError('PREREQUISITE_MISSING', 'Node.js LTS 20 or newer is required');
  }
  const gitVersion = gitCommand(gitPath, ['--version'], { label: 'Git prerequisite', timeoutMs });
  const revision = resolveRevision(remote, parsed.ref, gitPath, timeoutMs);
  const active = readActive(paths);
  const activeSha = active && active.active_release.startsWith(`${VERSION}-`)
    ? receiptFor(paths, active.active_release).receipt.commit_sha
    : null;
  if (active && active.active_release.startsWith(`${VERSION}-`)
    && activeSha !== revision.sha
    && options.confirmRevision !== revision.sha) return confirmationResult(parsed, revision.sha);
  if (options.confirmRevision !== undefined && options.confirmRevision !== revision.sha) {
    throw new LifecycleError('REVISION_CONFIRMATION_MISMATCH', 'revision confirmation does not match resolved SHA');
  }
  const releaseId = `${VERSION}-${revision.sha.slice(0, 12)}`;
  const stagingPath = path.join(paths.staging, `${releaseId}-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(stagingPath);
    gitCommand(gitPath, ['init', stagingPath], { label: 'Git staging initialization', timeoutMs });
    gitCommand(gitPath, ['-C', stagingPath, 'fetch', '--depth=1', '--no-tags', remote, revision.fetchRef], {
      label: 'Git staged fetch',
      timeoutMs,
    });
    const fetched = gitCommand(gitPath, ['-C', stagingPath, 'rev-parse', 'FETCH_HEAD^{commit}'], {
      label: 'Git staged revision verification',
      timeoutMs,
    });
    if (fetched !== revision.sha) throw new LifecycleError('REVISION_CHANGED', 'mutable revision changed during staging');
    gitCommand(gitPath, ['-C', stagingPath, 'checkout', '--detach', revision.sha], { label: 'Git staged checkout', timeoutMs });
    fs.rmSync(path.join(stagingPath, '.git'), { recursive: true });
    const verified = verifyStagedPackage(stagingPath, paths.product);
    const testOutput = run(runtimePath, [path.join(stagingPath, verified.selfTest)], {
      code: 'SELF_TEST_FAILED',
      cwd: stagingPath,
      label: 'staged package self-test',
      timeoutMs,
    });
    const promoted = promoteRelease(paths, {
      commitSha: revision.sha,
      entrypoint: verified.entrypoint,
      manifestRelativePath: verified.manifest,
      origin: parsed.canonicalOrigin,
      releaseId,
      runtimePath,
      stagingPath,
      version: VERSION,
    });
    return {
      canonical_origin: parsed.canonicalOrigin,
      commit_sha: revision.sha,
      prerequisites: { git: gitVersion, node: nodeVersion },
      release_id: promoted.releaseId,
      status: 'ready',
      test: { output: testOutput, status: 'passed' },
      version: VERSION,
    };
  } catch (error) {
    if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true });
    throw error;
  }
}

module.exports = {
  CONTRACT_DIGESTS,
  VERSION,
  bootstrapRelease,
  parseOfficialSource,
  resolveRevision,
  verifyStagedPackage,
};
