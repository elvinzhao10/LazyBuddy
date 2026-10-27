// Best-effort remote PR/CI observation behind the same collector interface as
// the local facts. `gh` runs with the caller's environment; unauthenticated,
// rate-limited, and missing-binary states stay typed unavailable. A test-merge
// SHA is never mapped onto the PR head: the tested subject stays its own field.
import {
  CollectorUnavailable, DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS, nowIso,
  runBounded, spawnExec,
} from './command.mjs';

export const REMOTE_COLLECTOR = 'git-observation/remote-gh@1';

const PR_FIELDS = 'number,title,state,isDraft,headRefName,headRefOid,baseRefName,baseRefOid,url';

export function parseRemoteUrl(url) {
  const trimmed = url.trim();
  let match = trimmed.match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return { host: match[1], owner: match[2], repo: match[3] };
  match = trimmed.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return { host: match[1], owner: match[2], repo: match[3] };
  match = trimmed.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (match) return { host: match[1], owner: match[2], repo: match[3] };
  return null;
}

function classifyGhFailure(stderrText) {
  const text = stderrText.toLowerCase();
  if (text.includes('gh auth login') || text.includes('authentication required')
      || text.includes('not logged in') || text.includes('badge')) return 'GH_UNAUTHENTICATED';
  if (text.includes('rate limit') || text.includes('429') || text.includes('too many requests')) return 'GH_RATE_LIMITED';
  if (text.includes('could not resolve') || text.includes('network')) return 'GH_NETWORK_UNAVAILABLE';
  return 'GH_COMMAND_FAILED';
}

// Maps one `gh pr list --json` object onto observed facts. The PR head is the
// branch head OID only; the tested subject and any test-merge SHA stay separate
// typed-unavailable fields because this collector does not observe CI runs.
export function mapPullRequest(pr) {
  return {
    number: pr.number,
    title: typeof pr.title === 'string' ? pr.title : null,
    state: pr.state ?? null,
    is_draft: pr.isDraft ?? null,
    url: pr.url ?? null,
    head: { ref: pr.headRefName ?? null, oid: pr.headRefOid ?? null },
    base: { ref: pr.baseRefName ?? null, oid: pr.baseRefOid ?? null },
    tested_subject: { status: 'unavailable', reason: 'CI_TESTED_SUBJECT_NOT_OBSERVED' },
    test_merge: { status: 'unavailable', reason: 'TEST_MERGE_SHA_NOT_OBSERVED',
      note: 'A test-merge SHA is never treated as the PR head.' },
    checks: { status: 'unavailable', reason: 'CHECK_RUNS_NOT_OBSERVED' },
  };
}

// Collects remote PR facts for one repository root, best effort.
// options: { repositoryRoot, remoteName?, pullRequestLimit?, timeoutMs?,
// maxBytes?, ghBinary?, gitBinary?, exec? }
export async function collectRemoteFacts(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== 'string' || !repositoryRoot.length) {
    throw new CollectorUnavailable('INVALID_OPTIONS', 'repositoryRoot is required');
  }
  const exec = options.exec ?? spawnExec;
  const git = options.gitBinary ?? 'git';
  const gh = options.ghBinary ?? 'gh';
  const remoteName = options.remoteName ?? 'origin';
  const limit = options.pullRequestLimit ?? 20;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const commands = [];
  const run = async (purpose, file, args, cwd, failReason) => {
    try {
      const result = await runBounded(exec, file, args, { cwd, timeoutMs, maxBytes, missingReason: failReason });
      commands.push({ purpose, argv: [file, ...args], exit_code: result.code });
      return result;
    } catch (error) {
      if (error instanceof CollectorUnavailable) {
        commands.push({ purpose, argv: [file, ...args], exit_code: null, unavailable: error.reason });
        throw error;
      }
      throw error;
    }
  };

  try {
    const remoteResult = await run('remote-get-url', git,
      ['--no-optional-locks', 'remote', 'get-url', remoteName], repositoryRoot, 'GIT_UNAVAILABLE');
    if (remoteResult.code !== 0) {
      throw new CollectorUnavailable('NO_REMOTE', `No ${remoteName} remote is configured`);
    }
    const url = remoteResult.stdout.toString('utf8');
    const location = parseRemoteUrl(url);
    if (!location) {
      throw new CollectorUnavailable('REMOTE_URL_UNPARSEABLE', 'The remote URL has an unsupported shape');
    }
    // Only the coordinates are recorded; the raw URL is not retained because
    // transport strings can embed credentials.
    const ghResult = await run('gh-pr-list', gh,
      ['pr', 'list', '--repo', `${location.owner}/${location.repo}`, '--json', PR_FIELDS,
        '--limit', String(limit)], repositoryRoot, 'GH_UNAVAILABLE');
    if (ghResult.code !== 0) {
      const reason = classifyGhFailure(ghResult.stderr.toString('utf8'));
      throw new CollectorUnavailable(reason, ghResult.stderr.toString('utf8').trim());
    }
    let listed;
    try { listed = JSON.parse(ghResult.stdout.toString('utf8')); } catch {
      throw new CollectorUnavailable('GH_OUTPUT_UNPARSEABLE', 'gh returned non-JSON output');
    }
    if (!Array.isArray(listed)) throw new CollectorUnavailable('GH_OUTPUT_UNPARSEABLE', 'gh returned a non-array result');
    return {
      collector: REMOTE_COLLECTOR,
      status: 'observed',
      reason: null,
      observed_at: nowIso(),
      remote: { name: remoteName, host: location.host, owner: location.owner, repo: location.repo },
      pull_requests: listed.map(mapPullRequest),
      coverage: { reported: listed.length, total: listed.length === limit ? null : listed.length },
      limits: {
        ci_depth_descope: true,
        note: 'PR head/base come from gh fields; CI tested-subject and test-merge SHAs are not observed by this collector.',
      },
      commands,
    };
  } catch (error) {
    if (!(error instanceof CollectorUnavailable)) throw error;
    return {
      collector: REMOTE_COLLECTOR, status: 'unavailable', reason: error.reason, detail: error.detail,
      observed_at: nowIso(), commands,
    };
  }
}
