#!/usr/bin/env node
// Opt-in inactivity harness (IO-2): reproduces the T01 normalization conventions
// EXACTLY (see EV/T01/baseline-normalize.mjs) and byte-compares the not-initialized
// dashboard path against the T01 baseline capture. Exits 0 only on an exact match.
//
// Usage: node qa/inactivity-baseline.mjs --compare --baseline <T01/inactivity-baseline.json> [--artifacts <dir>]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJSON } from '../history.mjs';

export const VOLATILE = new Set(['timestamp', 'ts', 'started', 'pid', 'port', 'instance', 'url', 'executable',
  'executable_sha256', 'service_sha256', 'token', 'expiry', 'credential_file', 'state_sha256', 'queue_sha256', 'sha256']);

export const clean = value => Array.isArray(value) ? value.map(clean)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .filter(([key]) => !VOLATILE.has(key))
      .map(([key, entry]) => [key, key === 'cursor' && typeof entry === 'string' && entry.length > 40 ? '<cursor:omitted-volatile>' : clean(entry)])
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  : value;

export function snapshotBody(rawSnapshot) {
  return clean(JSON.parse(rawSnapshot.slice(rawSnapshot.indexOf('{'))));
}

export function defaultView(indexBody) {
  const navMatch = indexBody.match(/<nav id="view-tabs"[^>]*>/);
  const buttons = [...indexBody.matchAll(/<button id="([a-z-]+)-tab"[^>]*aria-pressed="(true|false)"[^>]*>([^<]+)<\/button>/g)]
    .map(match => ({ id: match[1] + '-tab', aria_pressed: match[2], label: match[3] }));
  const roots = [...indexBody.matchAll(/<div id="([a-z-]+)-root"([^>]*)>/g)].map(match => match[1] + '-root');
  const projectDestinationStrings = ['overview', 'project', 'plans', 'execution', 'git', 'evidence', 'research']
    .filter(word => new RegExp(`aria-label="[^"]*\\b${word}\\b|id="[a-z-]*${word}[a-z-]*-tab"`, 'i').test(indexBody));
  return {
    index_body_sha256: createHash('sha256').update(indexBody, 'utf8').digest('hex'),
    nav: { id: 'view-tabs', hidden_pre_connect: /<nav id="view-tabs"[^>]*hidden/.test(indexBody), destinations: buttons },
    view_roots_in_document_order: roots,
    project_destinations_present: projectDestinationStrings,
    connection_status_initial: (indexBody.match(/data-testid="connection-status"[^>]*>([^<]*)</) || [])[1],
  };
}

export function buildNormalized(rawSnapshot, rawIndex) {
  const indexBody = rawIndex.slice(rawIndex.toLowerCase().indexOf('<!doctype'));
  return {
    normalizer: 'T01 baseline-normalize.mjs v1 conventions, reproduced by qa/inactivity-baseline.mjs: sorted keys, VOLATILE set removed, cursor string replaced, index nav extracted structurally',
    api_snapshot_normalized: snapshotBody(rawSnapshot),
    default_view: defaultView(indexBody),
  };
}

const REPO_ROOT = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const SERVICE = fileURLToPath(new URL('../../dashboard/service.mjs', import.meta.url));
const CREATE_RUN = fileURLToPath(new URL('../../../scripts/state/create-run.sh', import.meta.url));
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });

export async function compare(baselinePath, artifactsDir) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // T01 used a physical /private/tmp fixture so the service accepts a canonical root.
  const temporaryRoot = existsSync('/private/tmp') ? '/private/tmp' : realpathSync(tmpdir());
  const fixtureRoot = realpathSync(mkdtempSync(join(temporaryRoot, 't02-inactivity-')));
  const report = { mode: 'compare', fixture_root: fixtureRoot, node: process.version };
  let stopReceipt = null;
  try {
    const git = (args, options = {}) => run('git', ['-c', 'user.name=T02', '-c', 'user.email=t02@invalid', ...args], { cwd: fixtureRoot, ...options });
    if (run('git', ['init', '-q'], { cwd: fixtureRoot }).status !== 0) throw new Error('GIT_INIT_FAILED');
    if (git(['commit', '-q', '--allow-empty', '-m', 'fixture baseline']).status !== 0) throw new Error('GIT_COMMIT_FAILED');
    const created = run('bash', [CREATE_RUN, 't01run', 'T01 inactivity baseline run'],
      { cwd: fixtureRoot, env: { ...process.env, CWD: fixtureRoot } });
    if (created.status !== 0) throw new Error(`CREATE_RUN_FAILED: ${created.stderr}`);
    report.run_created = 't01run';

    const started = run(process.execPath, [SERVICE, 'start', '--project-root', fixtureRoot,
      '--project-id', 'project:t01-inactivity', '--run-id', 't01run'], { cwd: REPO_ROOT });
    if (started.status !== 0) throw new Error(`SERVICE_START_FAILED: ${started.stderr}${started.stdout}`);
    const startJson = JSON.parse(started.stdout);
    const base = startJson.url;
    const port = new URL(base).port;
    report.service = { pid: startJson.identity?.pid ?? null, port: Number(port), url_public_fields_only: true };
    const credential = readFileSync(startJson.credential_file, 'utf8').trim();

    const session = run('curl', ['-sS', '-X', 'POST', `${base}/api/session`, '-H', `X-Dashboard-Bootstrap: ${credential}`,
      '-H', `Host: 127.0.0.1:${port}`, '-H', `Origin: ${base}`, '-H', 'Content-Type: application/json', '--data', '{}']);
    if (session.status !== 0) throw new Error('SESSION_FAILED');
    const token = JSON.parse(session.stdout).token;

    const unauthenticated = run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', `${base}/api/snapshot`,
      '-H', `Host: 127.0.0.1:${port}`]);
    report.unauthenticated_snapshot_status = unauthenticated.stdout.trim();

    const snapshotResponse = run('curl', ['-sS', `${base}/api/snapshot`, '-H', `Authorization: Bearer ${token}`,
      '-H', `Host: 127.0.0.1:${port}`]);
    if (snapshotResponse.status !== 0) throw new Error('SNAPSHOT_FAILED');
    const indexResponse = run('curl', ['-sS', `${base}/`, '-H', `Host: 127.0.0.1:${port}`]);
    if (indexResponse.status !== 0) throw new Error('INDEX_FAILED');

    const normalized = buildNormalized(snapshotResponse.stdout, indexResponse.stdout);
    const rerun = buildNormalized(snapshotResponse.stdout, indexResponse.stdout);
    if (canonicalJSON(rerun) !== canonicalJSON(normalized)) throw new Error('NORMALIZER_NOT_DETERMINISTIC');

    if (artifactsDir) {
      writeFileSync(join(artifactsDir, 'inactivity-snapshot-raw.txt'), snapshotResponse.stdout);
      writeFileSync(join(artifactsDir, 'inactivity-index-raw.txt'), indexResponse.stdout);
      writeFileSync(join(artifactsDir, 'inactivity-normalized.json'), JSON.stringify(normalized, null, 2) + '\n');
      report.artifacts_dir = artifactsDir;
    }

    const snapshotMatch = canonicalJSON(normalized.api_snapshot_normalized) === canonicalJSON(baseline.api_snapshot_normalized);
    const viewMatch = canonicalJSON(normalized.default_view) === canonicalJSON(baseline.default_view);
    report.io2 = {
      api_snapshot_normalized_identical: snapshotMatch,
      default_view_identical: viewMatch,
      project_destinations_in_served_default_view: normalized.default_view.project_destinations_present.length,
      nav_destinations: normalized.default_view.nav.destinations.map(destination => destination.label),
      no_project_registry_created: !existsSync(join(fixtureRoot, '.lazybuddy/project')),
    };

    const stopped = run(process.execPath, [SERVICE, 'stop', '--project-root', fixtureRoot,
      '--project-id', 'project:t01-inactivity', '--run-id', 't01run'], { cwd: REPO_ROOT });
    stopReceipt = stopped.status === 0 ? JSON.parse(stopped.stdout) : { status: 'stop-failed', stderr: stopped.stderr };
    report.stop_receipt = stopReceipt;
    report.listener_after_stop = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).stdout.trim() === '';

    const drift = [];
    if (!snapshotMatch) drift.push('api_snapshot_normalized');
    if (!viewMatch) drift.push('default_view');
    if (!report.io2.no_project_registry_created) drift.push('project_registry_created');
    if (stopReceipt.status !== 'stopped') drift.push('service_stop');
    report.result = drift.length ? 'drift' : 'match';
    report.drift = drift;
    return report;
  } finally {
    if (stopReceipt?.status !== 'stopped') {
      run(process.execPath, [SERVICE, 'stop', '--project-root', fixtureRoot,
        '--project-id', 'project:t01-inactivity', '--run-id', 't01run'], { cwd: REPO_ROOT });
    }
    rmSync(fixtureRoot, { recursive: true, force: true });
    report.fixture_removed = !existsSync(fixtureRoot);
  }
}

export async function main(argv) {
  const values = new Map();
  let wantsCompare = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--compare') { wantsCompare = true; continue; }
    if (['--baseline', '--artifacts'].includes(flag) && argv[index + 1] !== undefined && !values.has(flag)) {
      values.set(flag, argv[index + 1]); index += 1; continue;
    }
    process.stderr.write('USAGE_COMPARE_BASELINE_PATH\n'); process.exitCode = 64; return;
  }
  if (!wantsCompare || values.get('--baseline') === undefined) {
    process.stderr.write('USAGE_COMPARE_BASELINE_PATH\n'); process.exitCode = 64; return;
  }
  const report = await compare(values.get('--baseline'), values.get('--artifacts'));
  process.stdout.write(JSON.stringify(report) + '\n');
  if (report.result !== 'match') process.exitCode = 70;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
