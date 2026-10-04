import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, rename, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { serviceFixture, serviceCLI, resource, http } from './service-fixture.mjs';
import { fixture, processCall, filesBelow } from './command-fixture.mjs';
import { binding } from '../service-lifecycle.mjs';
import { safeRead } from '../service-files.mjs';
import { secret } from '../service-auth.mjs';
import { started, sign } from '../service-identity.mjs';

test('repeated interrupted initialization before promotion closes each owned child and port', async () => {
  const f = await fixture(); await resource({ action: 'registered', root: f.root, cleanup: 'interruption fixture removal' });
  try {
    const options = await binding(f.options);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const child = fork(serviceCLI, ['serve'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      await resource({ action: 'registered', pid: child.pid, attempt, cleanup: 'IPC disconnect before promotion' });
      const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      try {
        const ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('child readiness timeout')), 8000);
          child.once('message', message => { clearTimeout(timer); resolve(message); });
        });
        child.send({ action: 'initialize', options, credential: secret() });
        const message = await ready; assert.equal(message.ready, true);
        await resource({ action: 'registered', pid: child.pid, port: message.identity.port, attempt });
        child.disconnect();
        const result = await exit; assert.equal(result.code, 0); assert.equal(await started(child.pid), null);
        await assert.rejects(http(`http://127.0.0.1:${message.identity.port}`, '/'));
        await resource({ action: 'removed', pid: child.pid, port: message.identity.port, attempt, result });
      } finally { if (child.connected) child.disconnect(); await exit; }
    }
  } finally { await f.cleanup(); await resource({ action: 'removed', root: f.root }); }
});

test('descriptor-pinned evidence reads never return outside bytes during ancestor replacement', async () => {
  const f = await fixture(); await resource({ action: 'registered', root: f.root, cleanup: 'replacement-race fixture removal' });
  const inside = join(f.root, 'inside'); const outside = join(f.root, 'outside');
  await mkdir(inside); await mkdir(outside); await writeFile(join(inside, 'proof'), 'inside'); await writeFile(join(outside, 'proof'), 'OUTSIDE_SECRET');
  let stop = false; let races = 0;
  const toggler = (async () => {
    while (!stop) {
      await rename(inside, join(f.root, 'held')); await symlink(outside, inside);
      await new Promise(resolve => setTimeout(resolve, 1));
      await unlink(inside); await rename(join(f.root, 'held'), inside); races += 1;
    }
  })();
  try {
    for (let index = 0; index < 20; index += 1) {
      try { assert.equal((await safeRead(f.root, 'inside/proof')).toString(), 'inside'); }
      catch (error) { assert.equal(error.code, 'UNSAFE_REFERENCE'); }
    }
    assert.ok(races > 0);
  } finally { stop = true; await toggler; await f.cleanup(); await resource({ action: 'removed', root: f.root, races }); }
});

test('signed stale and PID-start-forged receipts cannot authorize stop; idle socket flood stays bounded', async () => {
  const f = await serviceFixture(); const sockets = [];
  try {
    const original = await readFile(f.receiptPath(), 'utf8'); const credential = await readFile(f.live.credential_file, 'utf8');
    try {
      for (const patch of [{ started: 'forged start' }, { pid: 99999999 }]) {
        const receipt = JSON.parse(original); Object.assign(receipt.identity, patch); receipt.signature = sign(credential, receipt.identity);
        await writeFile(f.receiptPath(), JSON.stringify(receipt)); assert.equal((await f.cli('status')).code, 65); assert.equal((await f.cli('stop')).code, 65);
        assert.equal((await f.request('/api/snapshot')).status, 200);
      }
    } finally { await writeFile(f.receiptPath(), original); }
    for (let index = 0; index < 36; index += 1) {
      const socket = createConnection(Number(new URL(f.live.url).port), '127.0.0.1'); socket.on('error', () => {}); sockets.push(socket);
    }
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert.equal((await f.request('/api/snapshot')).status, 200);
    await resource({ action: 'socket-flood-complete', connections: sockets.length, snapshot_status: 200 });
  } finally { for (const socket of sockets) socket.destroy(); await f.cleanup(); }
});

test('CLI interruption while waiting for authority preflight releases lifecycle lock without promotion', async () => {
  const f = await fixture(); await resource({ action: 'registered', root: f.root, cleanup: 'preflight-interruption fixture removal' });
  const args = ['--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId];
  const before = await filesBelow(f.run);
  try {
    const options = await binding(f.options);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const child = spawn(process.execPath, [serviceCLI, 'start', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      await resource({ action: 'registered', pid: child.pid, attempt, cleanup: 'SIGTERM own CLI during preflight' });
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
      const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      const deadline = Date.now() + 3000;
      let found = false;
      while (!found && Date.now() < deadline) {
        try { await readFile(join(options.directory, 'credential')); throw new Error('credential promoted before probe'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await import('node:fs/promises').then(fs => fs.lstat(join(options.directory, 'lock'))); found = true; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      assert.equal(found, true); child.kill('SIGTERM'); const result = await exit;
      assert.equal(result.code, 65, stderr);
      assert.equal(JSON.parse(stderr).code, 'START_INTERRUPTED');
      const status = await processCall([process.execPath, serviceCLI, 'status', ...args]); assert.equal(status.code, 0); assert.equal(JSON.parse(status.stdout).status, 'stopped');
      await resource({ action: 'removed', pid: child.pid, attempt, result });
    }
    assert.deepEqual(await filesBelow(f.run), before);
  } finally { await f.cleanup(); await resource({ action: 'removed', root: f.root }); }
});
