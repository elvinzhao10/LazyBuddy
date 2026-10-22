#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const evidence = process.argv[2]; const browserPath = process.argv[3]; const omowrightModule = process.argv[4];
if (!evidence || !browserPath || !omowrightModule) throw new Error('usage: ui-live-browser.mjs EVIDENCE_DIR BROWSER_PATH OMOWRIGHT_MODULE');
const plugin = fileURLToPath(new URL('../../../', import.meta.url));
const serviceCLI = join(plugin, 'shared/dashboard/service.mjs'); const producer = join(plugin, 'shared/dashboard/producers.mjs');
const workload = join(plugin, 'shared/dashboard/test/producer-workload.mjs');
const python = '/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const node = process.execPath; const env = { ...process.env, PATH: `${dirname(node)}:${dirname(python)}:/usr/bin:/bin:/usr/sbin:/sbin` };
const actions = []; const resources = []; const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
await mkdir(join(evidence, 'screenshots'), { recursive: true });

function call(label, argv, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: fixture, env: { ...env, CWD: fixture }, stdio: ['pipe', 'pipe', 'pipe'] }); resources.push({ kind: label, pid: child.pid, state: 'registered' });
    let stdout = ''; let stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); actions.push({ label, argv, code, signal, stderr }); resolve({ code, signal, stdout, stderr }); }); child.stdin.end(input);
  });
}
function http(origin, route, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', timeout: 10000,
      headers: { ...(body === undefined ? {} : { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...options.headers } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, value }); });
    }); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('HTTP_TIMEOUT'))); req.end(body);
  });
}
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
async function waitFor(check, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch {} await sleep(100); } throw new Error(`timeout: ${label}`); }
async function fill(page, selector, value) { await page.locator(selector).fill(value); }
async function text(page, selector) { return page.locator(selector).evaluate(node => node.textContent); }
function absent(pid) { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }

const fixture = await realpath(await mkdtemp(join(tmpdir(), 'c1-live-browser-'))); resources.push({ kind: 'fixture-root', root: fixture, state: 'registered' });
const profile = await mkdtemp(join(tmpdir(), 'c1-live-profile-')); resources.push({ kind: 'browser-profile', root: profile, state: 'registered' });
let live; let browser; let page; let stopped = false; let passed = false;
const serviceArgs = port => [node, serviceCLI, 'start', '--project-root', fixture, '--project-id', 'project:live', '--run-id', 'probe', '--python', python, ...(port ? ['--port', String(port)] : [])];
const stopArgs = () => [node, serviceCLI, 'stop', '--project-root', fixture, '--project-id', 'project:live', '--run-id', 'probe', '--python', python];
try {
  for (const [label, argv] of [['git:init', ['git', '-C', fixture, 'init', '-q']], ['git:name', ['git', '-C', fixture, 'config', 'user.name', 'C1 Live QA']], ['git:email', ['git', '-C', fixture, 'config', 'user.email', 'c1@example.invalid']]]) assert.equal((await call(label, argv)).code, 0);
  await writeFile(join(fixture, '.gitignore'), '.lazybuddy/\n'); assert.equal((await call('git:add', ['git', '-C', fixture, 'add', '.gitignore'])).code, 0); assert.equal((await call('git:commit', ['git', '-C', fixture, 'commit', '-qm', 'fixture'])).code, 0);
  const head = (await call('git:head', ['git', '-C', fixture, 'rev-parse', 'HEAD'])).stdout.trim();
  assert.equal((await call('run:create', ['bash', join(plugin, 'scripts/state/create-run.sh'), 'probe', 'C1 live browser QA'])).code, 0);
  const run = join(fixture, '.lazybuddy/runs/probe'); const artifact = join(run, 'artifact-c.txt');
  const plan = '# Live plan\n- [x] [C1] Browser amended criterion is independently verified\n';
  const commands = [[node, workload, 'write', artifact, 'verified-live'], [node, workload, 'verify', artifact, 'verified-live']]; const commandBytes = `${JSON.stringify(commands)}\n`;
  const statePath = join(run, 'state.json'); const state = JSON.parse(await readFile(statePath));
  state.status = 'active'; state.dashboard_project_id = 'project:live'; state.plan_reference = '.lazybuddy/runs/probe/plan.md'; state.plan_revision = 1; state._approved_plan_sha256 = hash(plan);
  state.tasks = [{ id: 'P', title: 'Authoritative parent', scope: 'Trusted dispatch remains in chat.', priority: 0, status: 'running', depends_on: [], execution_authority: { repo_head: head,
    criterion_ids: ['C1'], plan_reference: state.plan_reference, plan_sha256: hash(plan), plan_commands_path: '.lazybuddy/runs/probe/commands.json', plan_commands_sha256: hash(commandBytes) } },
  { id: 'C', title: 'Prerequisite proof', scope: 'Produce and verify the required artifact.', priority: 0, status: 'queued', depends_on: [], criteria: [{ id: 'C1', task_id: 'C', version: 1,
    requirement: 'Original browser criterion', applicability: 'required', verification: 'unverified', scenarios: [], result_ids: [], history: [] }] },
  { id: 'J', title: 'Blocked join', scope: 'Wait for prerequisite proof.', priority: 1, status: 'blocked', depends_on: ['C'], criteria: [] }];
  await mkdir(join(run, 'checkpoints'), { recursive: true }); await Promise.all([writeFile(join(run, 'plan.md'), plan), writeFile(join(run, 'checkpoints/plan-revision.md'), plan), writeFile(join(run, 'commands.json'), commandBytes), writeFile(statePath, JSON.stringify(state))]);

  const started = await call('service:start', serviceArgs()); assert.equal(started.code, 0, started.stderr); live = JSON.parse(started.stdout); resources.push({ kind: 'dashboard-service', pid: live.identity.pid, port: live.identity.port, state: 'registered' });
  const credential = await readFile(live.credential_file, 'utf8'); const session = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } }); assert.equal(session.status, 200);
  let authorization = `Bearer ${session.value.token}`; actions.push({ label: 'session-for-competing-edit', status: 200, credential: '[REDACTED]', token_recorded: false });
  const api = (route, options = {}) => http(live.url, route, { ...options, headers: { authorization, ...options.headers } });

  const { loadOmowright } = await import(omowrightModule); const { omowright } = await loadOmowright();
  browser = await omowright.connectPipe({ browserPath, browserArgs: ['--headless=new', '--no-first-run', '--disable-background-networking', `--user-data-dir=${profile}`], storageRoot: profile, dialogPolicy: { accept: false } });
  page = await browser.newTab(live.url); await omowright.repinViewport(page, { width: 1440, height: 900 });
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.dashboardReady === 'true'), 'dashboard module ready');
  await fill(page, '[data-testid="access-key"]', credential); actions.push({ label: 'browser:connect', selector: '[data-testid="access-key"]', value: '[REDACTED]' }); await page.locator('[data-testid="connect-submit"]').click();
  await waitFor(async () => (await text(page, '[data-testid="connection-status"]')).includes('Connected'), 'browser connected');
  assert.equal(await page.locator('[data-testid="access-key"]').evaluate(node => node.value), ''); assert.equal(await page.locator('#connect-form').evaluate(node => node.hidden), true);
  assert.notEqual(await page.locator('.graph-viewport').evaluate(node => getComputedStyle(node).display), 'none');
  await page.locator('[data-testid="task-node"][data-task-id="J"]').click(); assert.equal(await page.locator('[data-testid="task-inspector"]').evaluate(node => node.open), true);
  assert.match(await text(page, '[data-testid="task-inspector"]'), /Blocked|prerequisite/i); await page.keyboard.press('Escape'); actions.push({ label: 'browser:blocked-join', pass: true });

  await page.locator('#editing-tab').click(); await page.locator('select[aria-label="Task"]').selectOption('C');
  await fill(page, '[data-field="priority"]', '2'); const stale = (await api('/api/snapshot')).value.snapshot;
  const competitor = { schema_version: 1, command_id: 'competing-priority', target: { project_id: 'project:live', run_id: 'probe', id: 'P' }, expected_revision: stale.revision, operation: 'amend_task', payload: { priority: 1 } };
  assert.equal((await api('/api/commands', { body: competitor })).status, 200); await page.locator('[data-testid="edit-submit"]').click();
  await waitFor(async () => (await text(page, '[data-testid="edit-status"]')).includes('Conflict'), 'browser CAS conflict'); assert.equal(await page.locator('[data-field="priority"]').evaluate(node => node.value), '2'); actions.push({ label: 'browser:conflict-draft-retained', pass: true });
  await sleep(900); await fill(page, '[data-field="priority"]', '0'); await fill(page, '[data-field="dependency"]', 'missing'); await page.locator('[data-testid="edit-submit"]').click();
  assert.match(await text(page, '[data-testid="edit-status"]'), /Unknown task ID/); await page.locator('select[aria-label="Task"]').selectOption('C'); await fill(page, '[data-field="dependency"]', 'J'); await page.locator('[data-testid="edit-submit"]').click();
  assert.match(await text(page, '[data-testid="edit-status"]'), /cycle/); actions.push({ label: 'browser:dependency-guards', pass: true });

  await page.locator('select[aria-label="Task"]').selectOption('C'); await fill(page, '[data-field="priority"]', '0'); await fill(page, '[data-field="dependency"]', '');
  await fill(page, '[data-field="requirement"]', 'Browser amended criterion is independently verified'); await fill(page, '[data-field="scenario-id"]', ''); await page.locator('[data-testid="edit-submit"]').click();
  await waitFor(async () => (await text(page, '[data-testid="edit-status"]')).includes('Pending agent'), 'criterion pending acknowledgement'); await sleep(850);
  await fill(page, '[data-field="scenario-id"]', 'scenario:browser'); await fill(page, '[data-field="scenario-requirement"]', 'Distinct verifier approves actual artifact');
  await fill(page, '[data-field="verifier-ref"]', 'producer:verify'); await page.locator('[data-testid="edit-submit"]').click();
  await waitFor(async () => (await text(page, '[data-testid="edit-status"]')).includes('Pending agent'), 'scenario pending acknowledgement'); actions.push({ label: 'browser:criterion-scenario-pending', pass: true });

  for (const [id, title] of [['plan:one', 'First queued plan'], ['plan:two', 'Second queued plan']]) {
    await fill(page, '[data-field="queue-id"]', id); await fill(page, '[data-field="queue-title"]', title); await page.locator('[data-action="queue-create"]').click();
    await waitFor(async () => (await text(page, '[data-testid="edit-status"]')).includes('saved'), `queue create ${id}`); await sleep(850);
  }
  await page.locator('[data-plan-id="plan:one"] [data-action="queue-edit"]').click(); await fill(page, '[data-field="queue-title"]', 'First queued plan (edited)');
  await page.locator('[data-action="queue-save"]').click(); await waitFor(async () => (await text(page, '[data-testid="edit-status"]')).includes('saved'), 'queue edit'); await sleep(850);
  await page.locator('[data-plan-id="plan:two"] [data-action="queue-up"]').click(); await sleep(850);
  const queueBefore = (await api('/api/snapshot')).value.snapshot.queue.map(item => ({ id: item.id, title: item.title })); assert.deepEqual(queueBefore.map(item => item.id), ['plan:two', 'plan:one']); assert.match(queueBefore[1].title, /edited/);
  actions.push({ label: 'browser:queue-create-edit-reorder', queueBefore });

  await fill(page, '[data-field="requirement"]', 'Unsaved continuity draft'); await page.locator('[data-field="requirement"]').evaluate(node => node.focus()); const scrollBefore = await page.evaluate(() => { const graph = document.querySelector('.graph-viewport'); graph.scrollLeft = 64; return graph.scrollLeft; });
  const stoppedResult = await call('service:stop', stopArgs()); assert.equal(stoppedResult.code, 0); stopped = true;
  await waitFor(async () => (await text(page, '[data-testid="connection-status"]')).includes('Disconnected'), 'disconnect observation'); assert.equal(await page.locator('[data-field="requirement"]').evaluate(node => node.value), 'Unsaved continuity draft');
  const restarted = await call('service:restart-same-port', serviceArgs(live.identity.port)); assert.equal(restarted.code, 0, restarted.stderr); live = JSON.parse(restarted.stdout); stopped = false;
  await waitFor(async () => !(await page.locator('#connect-form').evaluate(node => node.hidden)), 'reauth prompt'); await fill(page, '[data-testid="access-key"]', credential); actions.push({ label: 'browser:reauth', selector: '[data-testid="access-key"]', value: '[REDACTED]' }); await page.locator('[data-testid="connect-submit"]').click();
  await waitFor(async () => (await text(page, '[data-testid="connection-status"]')).includes('Connected'), 'same-origin reconnect');
  const inspectionSession = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } }); assert.equal(inspectionSession.status, 200); authorization = `Bearer ${inspectionSession.value.token}`;
  assert.equal(await page.locator('[data-field="requirement"]').evaluate(node => node.value), 'Unsaved continuity draft'); assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'requirement');
  assert.equal(await page.evaluate(() => document.querySelector('.graph-viewport').scrollLeft), scrollBefore); const queueAfter = await page.evaluate(() => [...document.querySelectorAll('[data-testid="queue-list"] li strong')].map(node => node.textContent)); assert.deepEqual(queueAfter.slice(0, 2), ['Second queued plan', 'First queued plan (edited)']);
  actions.push({ label: 'browser:same-origin-restart-continuity', port: live.identity.port, draft: true, focus: 'requirement', viewport: scrollBefore, queue: queueAfter });

  async function context(name, action, attempt, worker, index) {
    const argv = [node, producer, 'context', '--project-root', fixture, '--project-id', 'project:live', '--run-id', 'probe', '--actor', 'chat:c1', '--parent-task-id', 'P', '--task-id', 'C', '--criterion-id', 'C1', '--attempt-id', attempt, '--worker-id', worker, '--plan-commands-file', join(run, 'commands.json'), '--command-index', String(index), '--python', python];
    const result = await call(`producer:context:${name}`, argv); assert.equal(result.code, 0, result.stderr); const file = join(fixture, '.lazybuddy', `${name}.json`); await writeFile(file, result.stdout); return file;
  }
  const executorContext = await context('executor', 'execute', 'C:actual', 'worker:C-actual', 0);
  const common = ['--project-root', fixture, '--project-id', 'project:live', '--run-id', 'probe', '--actor', 'chat:c1', '--python', python, '--timeout', '30'];
  const executed = await call('producer:execute', [node, producer, 'execute', ...common, '--context-file', executorContext, '--artifact-path', '.lazybuddy/runs/probe/artifact-c.txt']); assert.equal(executed.code, 0, executed.stderr);
  const verifierContext = await context('verifier', 'verify', 'V:actual', 'worker:V-actual', 1);
  const verified = await call('producer:verify', [node, producer, 'verify', ...common, '--context-file', verifierContext, '--artifact-path', '.lazybuddy/runs/probe/artifact-c.txt', '--executor-id', 'worker:C-actual', '--executor-attempt-id', 'C:actual']); assert.equal(verified.code, 0, verified.stderr);
  const proofSnapshot = await api('/api/snapshot'); const proofUpdate = await api('/api/updates', { headers: { 'x-dashboard-cursor': proofSnapshot.value.cursor } });
  const snapshotProof = proofSnapshot.value.snapshot.tasks.find(item => item.id === 'C').verification;
  const updateProof = proofUpdate.value.snapshot.tasks.find(item => item.id === 'C').verification;
  await save('raw/cursor-proof-baseline.json', { snapshot: snapshotProof, update: updateProof, same: snapshotProof === updateProof, cursor: '[REDACTED-BOUND-CURSOR]' });
  if (snapshotProof !== updateProof) throw new Error(`CURSOR_PROOF_DIVERGENCE:${snapshotProof}:${updateProof}`);
  await page.locator('#verification-tab').click(); await waitFor(async () => (await page.locator('[data-testid="evidence-link"]').count()) > 0, 'evidence link', 20000);
  await waitFor(async () => (await text(page, '[data-testid="verification-view"]')).includes('verified'), 'verified requirement row', 20000);
  const href = await page.locator('[data-testid="evidence-link"]').evaluate(node => node.getAttribute('href')); assert.match(href, /^\/api\/evidence\/[a-f0-9]{64}$/);
  // V2-T8: the verification table re-renders on every poll tick; a click that
  // resolves the anchor and then lands inside a swap tick can miss it (the
  // dialog never opens and the gate flakes). Click the CURRENT anchor until
  // the preview opens — one fresh click per waitFor poll, bounded by its
  // timeout — instead of betting the whole gate on a single race.
  await waitFor(async () => { await page.locator('[data-testid="evidence-link"]').click().catch(() => {}); return await page.locator('#evidence-preview').evaluate(node => node.open); }, 'authenticated evidence preview'); assert.match(await text(page, '#evidence-preview pre'), /verified-live/); await page.locator('[data-action="close-evidence"]').click();
  const finalSnapshot = (await api('/api/snapshot')).value.snapshot; const ack = finalSnapshot.acknowledgements.find(item => item.status === 'applied'); assert.ok(ack); assert.equal(finalSnapshot.tasks.find(item => item.id === 'C').verification, 'verified');
  actions.push({ label: 'trusted:execute-distinct-verify', executor: 'worker:C-actual', verifier: 'worker:V-actual', acknowledgement: ack.status, evidence_href: href });

  await page.locator('#theme').selectOption('light'); await omowright.repinViewport(page, { width: 1440, height: 900 }); const wide = await page.screenshot({ type: 'png' }); await writeFile(join(evidence, 'screenshots/1440-light-applied.png'), wide);
  await omowright.repinViewport(page, { width: 390, height: 844 }); await page.locator('#theme').selectOption('dark'); await page.locator('#work-tab').click(); assert.equal(await page.locator('.graph-viewport').evaluate(node => getComputedStyle(node).display), 'none');
  await page.locator('[data-view="list"][data-task-id="C"]').focus(); await page.keyboard.press('Enter'); const narrow = await page.screenshot({ type: 'png' }); await writeFile(join(evidence, 'screenshots/390-dark-keyboard.png'), narrow); await page.keyboard.press('Escape');
  await waitFor(() => page.evaluate(() => document.activeElement.dataset.taskId === 'C'), 'inspector focus return');
  const sessionId = await page.resolveSessionId(); await page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId); assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fast').trim()), '0ms');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); const errors = (await page.console.logs()).filter(item => item.type === 'error'); assert.deepEqual(errors, []);
  actions.push({ label: 'browser:representative-responsive-motion', wide: '1440 light', narrow: '390 dark keyboard', reduced_motion: '0ms', console_errors: 0 });
  passed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (live && !stopped) { const result = await call('service:final-stop', stopArgs()); stopped = result.code === 0; }
  const serviceAbsent = live ? absent(live.identity.pid) : true; await rm(profile, { recursive: true, force: true }); await rm(fixture, { recursive: true, force: true });
  resources.push({ kind: 'cleanup-audit', browser_closed: Boolean(browser), profile_removed: await access(profile).then(() => false, () => true), fixture_removed: await access(fixture).then(() => false, () => true), service_absent: serviceAbsent, suite_passed: passed });
  await save('browser-actions.json', { engine: 'owned omowright after CUA reported browser unavailable', actions }); await save('registered-resources.json', resources);
}
assert.equal(passed, true); process.stdout.write(`${JSON.stringify({ status: 'pass', actions: actions.length, resources: resources.length })}\n`);
