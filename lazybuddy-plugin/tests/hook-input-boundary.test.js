'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const hooks = path.join(root, 'scripts/hooks');
const product = path.basename(root);
const stateName = `.${product.replace(/-plugin$/, '')}`;
const limit = 1048576;
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-boundary-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const run = path.join(cwd, stateName, 'runs', 'active');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'state.json'), '{"status":"active"}\n');
  return { cwd, run };
}
function invoke(name, cwd, input) {
  return spawnSync('bash', [path.join(hooks, name)], { cwd, input, encoding: 'utf8', timeout: 20000 });
}
function payload(cwd, size, character = 'x') {
  const base = JSON.stringify({ cwd, tool_name: 'Read', tool_input: {}, padding: '' });
  const available = size - Buffer.byteLength(base);
  return Buffer.from(base.slice(0, -2) + character.repeat(Math.floor(available / Buffer.byteLength(character))) + ' '.repeat(available % Buffer.byteLength(character)) + '"}');
}
for (const [label, size, character] of [['large', 700000, 'x'], ['at-boundary', limit, 'x'], ['multibyte-boundary', limit, '界']]) {
  test(`records one event when valid input is ${label}`, (t) => {
    // Given: an active run and a valid event at the requested byte size.
    const { cwd, run } = fixture(t);
    const input = payload(cwd, size, character);
    assert.equal(input.length, size);
    // When: the real post-tool hook consumes stdin.
    const result = invoke('post-tool-use.sh', cwd, input);
    // Then: the event is recorded exactly once without argv failure.
    assert.equal(result.status, 0, result.stderr);
    const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.length, 1);
    assert.equal(events[0].tool, 'Read');
  });
}
const consumers = fs.readdirSync(hooks).filter(name => name.endsWith('.sh') && fs.readFileSync(path.join(hooks, name), 'utf8').includes('bounded-input.bash'));
for (const name of consumers) {
  test(`${name} rejects excess bytes before state changes`, (t) => {
    // Given: a valid oversized event and unchanged active state.
    const { cwd, run } = fixture(t);
    const before = fs.readFileSync(path.join(run, 'state.json'), 'utf8');
    const input = Buffer.concat([payload(cwd, limit), Buffer.from(' ')]);
    // When: a hook receives one byte beyond the inclusive boundary.
    const result = invoke(name, cwd, input);
    // Then: rejection is advisory, explicit, payload-free, and has no state effect.
    assert.equal(result.status, 0, result.stderr);
    if (name === 'user-prompt-submit.sh') assert.match(result.stdout, /blocked:malformed-input/);
    else assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error, 'hook_input_too_large');
    assert.equal(fs.readFileSync(path.join(run, 'state.json'), 'utf8'), before);
    assert.deepEqual(fs.readdirSync(run), ['state.json']);
    assert.deepEqual(fs.readdirSync(path.join(cwd, stateName)), ['runs']);
  });
}
test('post-tool ignores malformed JSON without state changes', (t) => {
  // Given: active state and malformed input.
  const { cwd, run } = fixture(t);
  // When: the post-tool hook receives malformed JSON.
  const result = invoke('post-tool-use.sh', cwd, '{broken');
  // Then: no event is appended and the advisory invocation succeeds.
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(run), ['state.json']);
});
test('post-tool preserves corrupt-state behavior', (t) => {
  // Given: corrupt active state and valid input.
  const { cwd, run } = fixture(t);
  fs.writeFileSync(path.join(run, 'state.json'), '{broken');
  // When: the post-tool hook tries to record an event.
  const result = invoke('post-tool-use.sh', cwd, payload(cwd, 1000));
  // Then: strict siblings fail with 70; advisory siblings warn and remain nonblocking.
  assert.equal(result.status, 70, result.stderr);
  assert.match(result.stderr, /active_state_(corrupt|unreadable)/);
  assert.equal(fs.readFileSync(path.join(run, 'state.json'), 'utf8'), '{broken');
  assert.deepEqual(fs.readdirSync(run), ['state.json']);
});

for (const name of ['lifecycle-event.js', 'permission-record.js'].filter(name => fs.existsSync(path.join(hooks, name)))) {
  test(`${name} rejects oversized input with its original exit contract`, (t) => {
    // Given: an active run and bytes beyond the native event contract limit.
    const { cwd, run } = fixture(t);
    // When: the real native event consumer reads the oversized stream.
    const result = spawnSync(process.execPath, [path.join(hooks, name)], { cwd, input: payload(cwd, limit + 1), encoding: 'utf8' });
    // Then: strict consumers reject with 65; advisory consumers return zero, without records.
    assert.equal(result.status, 65, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).reason, 'payload_too_large');
    assert.deepEqual(fs.readdirSync(run), ['state.json']);
    assert.deepEqual(fs.readdirSync(path.join(cwd, stateName)), ['runs']);
  });
}
