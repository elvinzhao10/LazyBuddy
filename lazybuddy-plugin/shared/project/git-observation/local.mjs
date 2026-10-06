// Local Git/worktree observation collector. Deterministic, coverage-explicit,
// and bounded: every fact carries its source command, failures stay typed
// unavailable, and ignored (unregistered) content is never recorded.
import { realpathSync, statSync } from 'node:fs';
import {
  CollectorUnavailable, DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS, digestOf, nowIso,
  runBounded, spawnExec,
} from './command.mjs';

export const LOCAL_COLLECTOR = 'git-observation/local@1';

const MODE = /^\d{6}$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RENAME_SCORE = /^[A-Z]\d+$/;

const slice = (bytes, start, end) => bytes.slice(start, end).toString('utf8');

// Parses `git status --porcelain=v2 -z --branch` bytes. Rename records carry
// their original path as the next NUL-terminated token. Path fields are taken
// from the tail of each record so paths containing spaces survive.
export function parseStatusPorcelainZ(buffer) {
  const tokens = [];
  for (let start = 0, index = 0; index <= buffer.length; index += 1) {
    if (index === buffer.length || buffer[index] === 0) {
      if (index > start) tokens.push(slice(buffer, start, index));
      start = index + 1;
    }
  }
  const header = { oid: null, initial: false, branch_label: null, detached: false, upstream: null, ahead: null, behind: null };
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith('# branch.oid ')) {
      const value = token.slice(13);
      if (value === '(initial)') header.initial = true;
      else header.oid = value;
    } else if (token.startsWith('# branch.head ')) {
      const value = token.slice(14);
      if (value === '(detached)') header.detached = true;
      else header.branch_label = value;
    } else if (token.startsWith('# branch.upstream ')) header.upstream = token.slice(17);
    else if (token.startsWith('# branch.ab ')) {
      const ahead = token.match(/\+(\d+)/); const behind = token.match(/-(\d+)/);
      if (ahead) header.ahead = Number(ahead[1]);
      if (behind) header.behind = Number(behind[1]);
    } else if (token.startsWith('? ') || token.startsWith('! ')) {
      entries.push({ kind: token[0], path: token.slice(2) });
    } else if (/^[12u] /.test(token)) {
      const kind = token[0];
      entries.push({ kind, xy: token.split(' ')[1], sub: token.split(' ')[2], path: recordPath(kind, token),
        rename_from: kind === '2' ? tokens[index + 1] ?? null : null });
      if (kind === '2') index += 1;
    }
  }
  return { header, entries };
}

// Extracts the path field of a `1`/`2`/`u` record: three or four mode tokens,
// then up to three object ids (this Git build omits the worktree blob id on
// `1` records), then optionally a rename score, then the path.
function recordPath(kind, token) {
  const parts = token.split(' ');
  const modeCount = kind === 'u' ? 4 : 3;
  let index = 3;
  for (let seen = 0; seen < modeCount && index < parts.length && MODE.test(parts[index]); seen += 1) index += 1;
  for (let seen = 0; seen < 3 && index < parts.length && OID.test(parts[index]); seen += 1) index += 1;
  if (kind === '2' && index < parts.length && RENAME_SCORE.test(parts[index])) index += 1;
  return parts.slice(index).join(' ');
}

// Parses `git worktree list --porcelain -z` bytes into per-worktree records.
// The main worktree is always listed first; the empty token ends an entry.
export function parseWorktreeListZ(buffer) {
  const tokens = [];
  for (let start = 0, index = 0; index <= buffer.length; index += 1) {
    if (index === buffer.length || buffer[index] === 0) {
      if (index > start) tokens.push(slice(buffer, start, index));
      start = index + 1;
    }
  }
  const worktrees = [];
  let current = null;
  for (const token of tokens) {
    if (token.startsWith('worktree ')) {
      current = { root: token.slice(9), head: null, branch: null, bare: false, detached: false, locked: null, prunable: null };
      worktrees.push(current);
    } else if (!current) continue;
    else if (token.startsWith('HEAD ')) current.head = token.slice(5);
    else if (token.startsWith('branch ')) current.branch = token.slice(7);
    else if (token === 'bare') current.bare = true;
    else if (token === 'detached') current.detached = true;
    else if (token.startsWith('locked')) current.locked = token.slice(6).trim() || 'locked';
    else if (token.startsWith('prunable')) current.prunable = token.slice(8).trim() || 'prunable';
  }
  return worktrees;
}

// Parses `git diff-files|diff-index --numstat -z` bytes. Each record is one
// tab-separated token: added, deleted, path. Binary pairs render as `-`/`-`.
export function parseNumstatZ(buffer) {
  const entries = new Map();
  for (let start = 0, index = 0; index <= buffer.length; index += 1) {
    if (index === buffer.length || buffer[index] === 0) {
      if (index > start) {
        const token = slice(buffer, start, index);
        const parts = token.split('\t');
        if (parts.length >= 3) {
          const binary = parts[0] === '-' || parts[1] === '-';
          entries.set(parts.slice(2).join('\t'), {
            added: binary || parts[0] === '' ? null : Number(parts[0]),
            deleted: binary || parts[1] === '' ? null : Number(parts[1]),
            binary,
          });
        }
      }
      start = index + 1;
    }
  }
  return entries;
}

function classifyEntries(entries, maxPaths) {
  const staged = []; const unstaged = []; const untracked = []; const unmerged = [];
  const union = new Map();
  const addToUnion = (path, classes, renameFrom = null) => {
    const existing = union.get(path);
    if (existing) { for (const item of classes) if (!existing.classes.includes(item)) existing.classes.push(item); }
    else union.set(path, { path, classes: [...classes], rename_from: renameFrom });
  };
  for (const entry of entries) {
    // `!` records are ignored content: excluded so unregistered paths never
    // reach the project record.
    if (entry.kind === '!') continue;
    if (entry.kind === '?') {
      untracked.push(entry.path);
      addToUnion(entry.path, ['untracked']);
    } else if (entry.kind === 'u') {
      unmerged.push({ path: entry.path, xy: entry.xy });
      addToUnion(entry.path, ['unmerged']);
    } else {
      const classes = [];
      if (entry.xy[0] !== '.') { classes.push('staged'); staged.push({ path: entry.path, xy: entry.xy, rename_from: entry.rename_from ?? null }); }
      if (entry.xy[1] !== '.') { classes.push('unstaged'); unstaged.push({ path: entry.path, xy: entry.xy }); }
      if (classes.length) addToUnion(entry.path, classes, entry.rename_from ?? null);
    }
  }
  staged.sort((a, b) => a.path.localeCompare(b.path));
  unstaged.sort((a, b) => a.path.localeCompare(b.path));
  untracked.sort((a, b) => a.localeCompare(b));
  unmerged.sort((a, b) => a.path.localeCompare(b.path));
  const limit = (values) => values.length > maxPaths
    ? { paths: values.slice(0, maxPaths), truncated: true, total: values.length }
    : { paths: values, truncated: false, total: values.length };
  return {
    staged: limit(staged), unstaged: limit(unstaged), untracked: limit(untracked), unmerged: limit(unmerged),
    union_total: union.size, union,
  };
}

// A path is inside the declared source scope on an exact match, a directory
// prefix match, or coverage by an untracked directory marker (`dir/`).
function inScope(path, scope) {
  for (const item of scope) {
    const prefix = item.endsWith('/') ? item : `${item}/`;
    if (path === item || path.startsWith(prefix)) return true;
    if (path.endsWith('/') && (item === path.slice(0, -1) || item.startsWith(path))) return true;
  }
  return false;
}

function churnOf(numstat, path) {
  const entry = numstat.get(path);
  if (!entry) return null;
  return { added: entry.added, deleted: entry.deleted, binary: entry.binary };
}

// The dirty-content snapshot binding: repository/worktree identity, HEAD, the
// declared source scope, and the manifest of relevant changed paths with their
// churn numbers. Same HEAD plus a relevant edit changes the digest; a branch
// rename changes nothing here because labels are not part of the binding.
function buildBinding({ root, gitCommonDir, headOid, scope, classified, worktreeNumstat, stagedNumstat }) {
  const relevant = [];
  for (const entry of classified.union.values()) {
    const pathRelevant = inScope(entry.path, scope);
    const originRelevant = entry.rename_from != null && inScope(entry.rename_from, scope);
    if (!pathRelevant && !originRelevant) continue;
    relevant.push({
      path: entry.path,
      classes: [...entry.classes].sort(),
      rename_from: entry.rename_from,
      staged_churn: churnOf(stagedNumstat, entry.path),
      worktree_churn: churnOf(worktreeNumstat, entry.path),
      rename_from_churn: entry.rename_from != null ? churnOf(stagedNumstat, entry.rename_from) : null,
    });
  }
  relevant.sort((a, b) => a.path.localeCompare(b.path));
  const identity = {
    worktree_root: root,
    repository_git_common_dir: gitCommonDir,
    head_oid: headOid,
    source_scope: [...scope].sort(),
    relevant_changed_paths: relevant,
    unrelated_changed_path_count: classified.union_total - relevant.length,
  };
  return { ...identity, digest: digestOf(identity) };
}

function binaryPaths(...numstats) {
  const paths = new Set();
  for (const numstat of numstats) for (const [path, entry] of numstat) if (entry.binary) paths.add(path);
  return [...paths].sort();
}

function parseLog(buffer) {
  const commits = [];
  const text = buffer.toString('utf8');
  for (const record of text.split('\x1e')) {
    const clean = record.replace(/^\s+/, '');
    if (!clean) continue;
    const [oid, parents, authorAt, committerAt, ...subject] = clean.split('\x1f');
    commits.push({
      oid, parent_oids: parents ? parents.split(' ').filter(Boolean) : [],
      author_at: authorAt, committer_at: committerAt, subject: subject.join('\x1f'),
    });
  }
  return commits;
}

// Collects local Git facts for one repository root and all of its worktrees.
// options: { repositoryRoot, sourceScope?, commitLimit?, maxWorktrees?,
// maxPaths?, timeoutMs?, maxBytes?, gitBinary?, exec? }
export async function collectLocalGitFacts(options = {}) {
  const repositoryRoot = options.repositoryRoot;
  if (typeof repositoryRoot !== 'string' || !repositoryRoot.length) {
    throw new CollectorUnavailable('INVALID_OPTIONS', 'repositoryRoot is required');
  }
  // A missing root is typed unavailable before any subprocess runs, so a spawn
  // ENOENT can only mean the git binary itself is unavailable.
  try {
    if (!statSync(repositoryRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    return {
      collector: LOCAL_COLLECTOR, status: 'unavailable', reason: 'NOT_A_REPOSITORY',
      detail: `${repositoryRoot} is not an accessible directory`,
      observed_at: nowIso(), source_scope: [...new Set(options.sourceScope ?? [])].sort(), commands: [],
    };
  }
  const exec = options.exec ?? spawnExec;
  const git = options.gitBinary ?? 'git';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const commitLimit = options.commitLimit ?? 50;
  const maxWorktrees = options.maxWorktrees ?? 8;
  const maxPaths = options.maxPaths ?? 5000;
  const scope = [...new Set(options.sourceScope ?? [])].sort();
  const startedAt = nowIso();
  const commands = [];
  const run = async (purpose, args, cwd) => {
    try {
      const result = await runBounded(exec, git, args, { cwd, timeoutMs, maxBytes, missingReason: 'GIT_UNAVAILABLE' });
      commands.push({ purpose, argv: args, exit_code: result.code });
      if (result.code !== 0) {
        throw new CollectorUnavailable(purpose === 'rev-parse-identity' && /not a git repository/i.test(result.stderr.toString('utf8'))
          ? 'NOT_A_REPOSITORY' : 'GIT_COMMAND_FAILED',
        `${args.join(' ')} exited ${result.code}: ${result.stderr.toString('utf8').trim()}`);
      }
      return result;
    } catch (error) {
      if (error instanceof CollectorUnavailable && !commands.some(entry => entry.purpose === purpose)) {
        commands.push({ purpose, argv: args, exit_code: null, unavailable: error.reason });
      }
      throw error;
    }
  };

  try {
    const identityResult = await run('rev-parse-identity',
      ['--no-optional-locks', 'rev-parse', '--absolute-git-dir', '--git-common-dir'], repositoryRoot);
    const [gitDir, gitCommonDir] = identityResult.stdout.toString('utf8').split('\n').filter(Boolean);

    const worktreeResult = await run('worktree-list',
      ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z'], repositoryRoot);
    const listed = parseWorktreeListZ(worktreeResult.stdout);

    // The subject of the observation is the requested root, which may be a
    // linked worktree; worktree list always prints the main worktree first.
    let subjectRoot = repositoryRoot;
    try { subjectRoot = realpathSync(repositoryRoot); } catch { /* keep the caller value */ }
    const worktrees = [];
    let primaryFirstStatusBytes = null;
    for (let index = 0; index < listed.length && index < maxWorktrees; index += 1) {
      const entry = listed[index];
      const worktree = {
        root: entry.root,
        kind: index === 0 ? 'main' : 'linked',
        head: entry.head,
        branch: entry.branch ? entry.branch.replace(/^refs\/heads\//, '') : null,
        bare: entry.bare, detached: entry.detached,
        locked: entry.locked, prunable: entry.prunable,
        current: entry.root === subjectRoot,
        status: 'observed', reason: null,
      };
      try {
        const statusBytes = (await run('status-porcelain-v2',
          ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch'], entry.root)).stdout;
        if (worktree.current) primaryFirstStatusBytes = statusBytes;
        const parsed = parseStatusPorcelainZ(statusBytes);
        worktree.head = parsed.header.initial ? null : parsed.header.oid ?? worktree.head;
        if (!worktree.bare && !worktree.detached) worktree.branch = parsed.header.branch_label ?? worktree.branch;
        worktree.upstream = parsed.header.upstream;
        worktree.ahead = parsed.header.ahead; worktree.behind = parsed.header.behind;
        worktree.changed = classifyEntries(parsed.entries, maxPaths);
        const [worktreeNumstat, stagedNumstat] = await Promise.all([
          run('diff-files-numstat', ['--no-optional-locks', 'diff-files', '--numstat', '-z'], entry.root),
          run('diff-index-numstat', ['--no-optional-locks', 'diff-index', '--cached', '--numstat', '-z', 'HEAD'], entry.root),
        ]);
        worktree.numstat = { worktree: parseNumstatZ(worktreeNumstat.stdout), staged: parseNumstatZ(stagedNumstat.stdout) };
        worktree.binary_paths = binaryPaths(worktree.numstat.worktree, worktree.numstat.staged);
        worktree.binding = buildBinding({
          root: entry.root, gitCommonDir, headOid: worktree.head, scope,
          classified: worktree.changed, worktreeNumstat: worktree.numstat.worktree, stagedNumstat: worktree.numstat.staged,
        });
        delete worktree.numstat;
      } catch (error) {
        if (!(error instanceof CollectorUnavailable)) throw error;
        worktree.status = 'unavailable';
        worktree.reason = error.reason;
        worktree.changed = null;
        worktree.binding = null;
      }
      worktrees.push(worktree);
    }

    const commits = { status: 'observed', reason: null, observed: [], coverage: { reported: 0, total: null } };
    try {
      const logResult = await run('log-parents',
        ['--no-optional-locks', 'log', `--max-count=${commitLimit}`,
          '--format=%H%x1f%P%x1f%aI%x1f%cI%x1f%s%x1e'], subjectRoot);
      commits.observed = parseLog(logResult.stdout);
      const countResult = await run('rev-list-count', ['--no-optional-locks', 'rev-list', '--count', 'HEAD'], subjectRoot);
      commits.coverage = { reported: commits.observed.length, total: Number(countResult.stdout.toString('utf8').trim()) };
    } catch (error) {
      if (!(error instanceof CollectorUnavailable)) throw error;
      if (worktrees[0]?.head == null && error.reason === 'GIT_COMMAND_FAILED') {
        commits.status = 'unavailable'; commits.reason = 'NO_COMMITS';
      } else throw error;
    }

    // Capture stability: re-sample the primary worktree status and compare.
    // If content moved during collection the snapshot cannot establish a
    // stable verified result.
    let stable = null;
    if (primaryFirstStatusBytes != null) {
      const second = await run('status-stability-sample',
        ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch'], subjectRoot);
      stable = second.stdout.equals(primaryFirstStatusBytes);
    }

    const unmergedPaths = [];
    for (const worktree of worktrees) {
      if (worktree.status !== 'observed') continue;
      for (const item of worktree.changed.unmerged.paths) unmergedPaths.push({ path: item.path, xy: item.xy, worktree_root: worktree.root });
    }
    const changedByRoot = new Map();
    for (const worktree of worktrees) {
      if (worktree.status !== 'observed') continue;
      changedByRoot.set(worktree.root, worktree.changed);
    }
    const overlaps = [];
    for (const path of new Set([...changedByRoot.values()].flatMap(changed => [...changed.union.keys()]))) {
      const roots = [...changedByRoot].filter(([, changed]) => changed.union.has(path)).map(([root]) => root).sort();
      if (roots.length > 1) overlaps.push({ path, worktree_roots: roots });
    }
    overlaps.sort((a, b) => a.path.localeCompare(b.path));

    return {
      collector: LOCAL_COLLECTOR,
      status: 'observed',
      reason: null,
      observed_at: nowIso(),
      repository: { root: subjectRoot, git_dir: gitDir, git_common_dir: gitCommonDir },
      head: worktrees.find(worktree => worktree.current)?.head ?? null,
      source_scope: scope,
      worktrees,
      commits,
      binary_diff_counts: {
        status: 'unavailable',
        reason: 'BINARY_LINE_COUNTS_UNAVAILABLE',
        binary_paths: [...new Set(worktrees.flatMap(worktree => worktree.binary_paths ?? []))].sort(),
      },
      conflicts: {
        actual_unmerged_index: { status: 'observed', paths: unmergedPaths },
        predicted_merge_conflict: { status: 'unavailable', reason: 'MERGE_SIMULATION_EXCLUDED' },
        concurrent_edit_overlap: { status: 'observed', advisory: true, classification: 'inferred', overlaps },
        semantic_plan_conflict: {
          status: 'unavailable', reason: 'OUT_OF_SCOPE_OF_GIT_COLLECTOR', owned_by: 'project reconciliation',
          note: 'Semantic plan conflicts are assessed against baseline records, not Git state.',
        },
      },
      capture: { started_at: startedAt, ended_at: nowIso(), stable, method: 'status-sample-compare' },
      coverage: {
        worktrees_reported: worktrees.filter(worktree => worktree.status === 'observed').length,
        worktrees_total: listed.length,
        worktrees_truncated: listed.length > maxWorktrees,
      },
      limits: {
        ignored_paths_excluded: true,
        max_paths_per_class: maxPaths,
        commit_limit: commitLimit,
        untracked_in_scope_content_not_hashed: 'Untracked paths are unregistered content; the binding records their presence only.',
      },
      commands,
    };
  } catch (error) {
    if (!(error instanceof CollectorUnavailable)) throw error;
    return {
      collector: LOCAL_COLLECTOR, status: 'unavailable', reason: error.reason, detail: error.detail,
      observed_at: nowIso(), source_scope: scope, commands,
    };
  }
}

// Pure helper for stability tests: two raw status samples differ exactly when
// observable content moved between them.
export function statusSampleChanged(first, second) {
  return !Buffer.from(first).equals(Buffer.from(second));
}
