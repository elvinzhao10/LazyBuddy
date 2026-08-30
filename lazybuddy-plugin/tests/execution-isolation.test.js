'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquire, release, renew } = require('../scripts/execution-isolation');

const MINUTE = 60_000;

function fixture(root, taskId, session, now, overrides = {}) {
  return acquire(root, {
    taskId,
    session,
    ownerPid: overrides.ownerPid ?? process.pid,
    workspace: root,
    direct: overrides.direct ?? true,
    mutationRequiresWorktree: overrides.mutationRequiresWorktree ?? false,
  }, {
    now: () => now,
    isPidAlive: overrides.isPidAlive ?? (() => true),
    isWorkspaceClean: overrides.isWorkspaceClean ?? (() => true),
  });
}

test('task isolation assigns distinct task-owned paths and ports', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-distinct-'));
  try {
    const first = fixture(root, 'task-a', 'session-a', 1_700_000_000_000);
    const second = fixture(root, 'task-b', 'session-b', 1_700_000_000_000);
    for (const key of ['evidence', 'build', 'cache', 'state', 'worktree']) {
      assert.notEqual(first.namespace.paths[key], second.namespace.paths[key]);
      assert.equal(first.namespace.paths[key].startsWith(first.namespace.root), true);
      assert.equal(second.namespace.paths[key].startsWith(second.namespace.root), true);
    }
    assert.notEqual(first.namespace.port, second.namespace.port);
    assert.equal(first.execution.actors, 1);
    assert.equal(first.execution.worktree_provisioned, false);
    assert.equal(fs.existsSync(first.namespace.paths.worktree), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task isolation renews a fifteen minute lease inside its five minute renewal window', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-renew-'));
  const acquiredAt = 1_700_000_000_000;
  try {
    const lease = fixture(root, 'task-renew', 'session-renew', acquiredAt);
    const renewed = renew(root, 'task-renew', { session: 'session-renew', ownerPid: process.pid }, {
      now: () => acquiredAt + (11 * MINUTE), isPidAlive: () => true,
    });
    assert.equal(renewed.acquired_at, lease.acquired_at);
    assert.equal(renewed.renewed_at, new Date(acquiredAt + (11 * MINUTE)).toISOString());
    assert.equal(renewed.expires_at, new Date(acquiredAt + (26 * MINUTE)).toISOString());
    assert.equal(renewed.renewal_due_at, new Date(acquiredAt + (21 * MINUTE)).toISOString());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task isolation blocks live, expired-live, and expired-dirty collisions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-block-'));
  const acquiredAt = 1_700_000_000_000;
  try {
    fixture(root, 'task-shared', 'owner-session', acquiredAt, { ownerPid: 4242 });
    assert.throws(() => fixture(root, 'task-shared', 'contender-a', acquiredAt + MINUTE, {
      ownerPid: 5252, isPidAlive: () => true,
    }), error => error.code === 'LEASE_COLLISION');
    assert.throws(() => fixture(root, 'task-shared', 'contender-b', acquiredAt + (16 * MINUTE), {
      ownerPid: 5252, isPidAlive: () => true,
    }), error => error.code === 'LEASE_EXPIRED_OWNER_LIVE');
    assert.throws(() => fixture(root, 'task-shared', 'contender-c', acquiredAt + (16 * MINUTE), {
      ownerPid: 5252, isPidAlive: () => false, isWorkspaceClean: () => false,
    }), error => error.code === 'LEASE_EXPIRED_WORKSPACE_DIRTY');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task isolation recovers only an expired dead clean lease and cleans its namespace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-recover-'));
  const acquiredAt = 1_700_000_000_000;
  try {
    const stale = fixture(root, 'task-recover', 'old-session', acquiredAt, { ownerPid: 4242 });
    fs.writeFileSync(path.join(stale.namespace.paths.build, 'stale.txt'), 'stale');
    const recovered = fixture(root, 'task-recover', 'new-session', acquiredAt + (16 * MINUTE), {
      ownerPid: 5252, isPidAlive: () => false, isWorkspaceClean: () => true,
    });
    assert.equal(recovered.owner.session, 'new-session');
    assert.equal(fs.existsSync(path.join(recovered.namespace.paths.build, 'stale.txt')), false);
    release(root, 'task-recover', { session: 'new-session', ownerPid: 5252 });
    assert.equal(fs.existsSync(recovered.namespace.root), false);
    assert.equal(fs.existsSync(path.join(root, 'lazybuddy', 'ports', `${recovered.namespace.port}.json`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task isolation rejects malformed identifiers before filesystem mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-id-'));
  try {
    assert.throws(() => fixture(root, '../escape', 'session', 1_700_000_000_000), /taskId/);
    assert.throws(() => fixture(root, 'task', '..', 1_700_000_000_000), /session/);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('task isolation refuses dirty inheritance when a mutation needs a worktree namespace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-isolation-dirty-inheritance-'));
  try {
    assert.throws(() => fixture(root, 'task-dirty', 'session-dirty', 1_700_000_000_000, {
      mutationRequiresWorktree: true,
      isWorkspaceClean: () => false,
    }), error => error.code === 'WORKSPACE_DIRTY');
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
