#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, plugin } from '../test/command-fixture.mjs';

const evidence = process.argv[2]; const browserPath = process.argv[3]; const omowrightModule = process.argv[4];
if (!evidence || !browserPath || !omowrightModule) throw new Error('usage: ui-queue-edit-browser.mjs EVIDENCE_DIR BROWSER_PATH OMOWRIGHT_MODULE');
await mkdir(join(evidence, 'screenshots'), { recursive: true });
const node = process.execPath; const python = '/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const service = join(plugin, 'shared/dashboard/service.mjs'); const env = { ...process.env, PATH: `${dirname(node)}:${dirname(python)}:/usr/bin:/bin:/usr/sbin:/sbin` };
const actions = []; const resources = []; const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
const save = (name, value) => writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
function call(label, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] }); resources.push({ kind: label, pid: child.pid, state: 'registered' });
    let stdout = ''; let stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); actions.push({ label, argv, code, signal, stderr }); resolve({ code, signal, stdout, stderr }); });
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
async function waitFor(check, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const value = await check(); if (value) return value; } catch {} await sleep(100); } throw new Error(`timeout: ${label}`); }
function absent(pid) { try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }

const f = await fixture(); resources.push({ kind: 'fixture-root', root: f.root, state: 'registered' });
const profile = await mkdtemp(join(tmpdir(), 'c1-queue-edit-profile-')); resources.push({ kind: 'browser-profile', root: profile, state: 'registered' });
const serviceArgs = port => [node, service, 'start', '--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId, '--python', python, ...(port ? ['--port', String(port)] : [])];
const stopArgs = () => [node, service, 'stop', '--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId, '--python', python];
let live; let browser; let stopped = true; let passed = false;
try {
  const started = await call('service:start', serviceArgs()); assert.equal(started.code, 0, started.stderr); live = JSON.parse(started.stdout); stopped = false;
  resources.push({ kind: 'dashboard-service', pid: live.identity.pid, port: live.identity.port, state: 'registered' });
  const credential = await readFile(live.credential_file, 'utf8');
  const session = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } }); assert.equal(session.status, 200);
  let authorization = `Bearer ${session.value.token}`; const api = (route, options = {}) => http(live.url, route, { ...options, headers: { authorization, ...options.headers } });
  actions.push({ label: 'service:session', status: 200, credential: '[REDACTED]', token_recorded: false });

  const { loadOmowright } = await import(omowrightModule); const { omowright } = await loadOmowright();
  browser = await omowright.connectPipe({ browserPath, browserArgs: ['--headless=new', '--no-first-run', '--disable-background-networking', `--user-data-dir=${profile}`], storageRoot: profile, dialogPolicy: { accept: false } });
  const page = await browser.newTab(live.url); await omowright.repinViewport(page, { width: 1440, height: 900 });
  await waitFor(() => page.evaluate(() => document.documentElement.dataset.dashboardReady === 'true'), 'dashboard ready');
  await page.locator('[data-testid="access-key"]').fill(credential); actions.push({ label: 'browser:connect', value: '[REDACTED]' }); await page.locator('[data-testid="connect-submit"]').click();
  await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="connection-status"]').textContent.includes('Connected')), 'connected');
  await page.locator('#editing-tab').click();

  for (const [id, title] of [['plan:one', 'Original one'], ['plan:two', 'Original two']]) {
    await page.locator('[data-field="queue-id"]').fill(id); await page.locator('[data-field="queue-title"]').fill(title); await page.locator('[data-action="queue-create"]').click();
    await waitFor(() => page.evaluate(value => Boolean(document.querySelector(`[data-plan-id="${value}"]`)), id), `create ${id}`);
  }
  let snapshot = (await api('/api/snapshot')).value.snapshot; assert.equal(snapshot.queue_revision, 2);
  const metadata = { schema_version: 1, command_id: 'queue-meta', target: { project_id: f.options.projectId, run_id: null, id: 'plan:one' }, expected_revision: 2,
    operation: 'amend_queued_plan', payload: { prerequisites: ['plan:two'] } };
  assert.equal((await api('/api/commands', { body: metadata })).status, 200); await sleep(900);

  await page.locator('[data-plan-id="plan:one"] [data-action="queue-edit"]').click();
  assert.equal(await page.locator('[data-field="queue-id"]').evaluate(nodeValue => nodeValue.value), 'plan:one');
  assert.equal(await page.locator('[data-field="queue-id"]').evaluate(nodeValue => nodeValue.readOnly), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'queue-title');
  await page.locator('[data-field="queue-title"]').fill('Chosen launch title'); await page.locator('[data-field="queue-priority"]').fill('7'); await page.locator('[data-field="queue-readiness"]').selectOption('held');
  await page.locator('[data-action="queue-save"]').click(); await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="edit-status"]').textContent.includes('saved')), 'chosen queue edit saved');
  snapshot = (await api('/api/snapshot')).value.snapshot; const chosen = snapshot.queue.find(plan => plan.id === 'plan:one');
  assert.deepEqual({ title: chosen.title, priority: chosen.priority, readiness: chosen.readiness, prerequisites: chosen.prerequisites, decision_id: chosen.decision_id },
    { title: 'Chosen launch title', priority: 7, readiness: 'held', prerequisites: ['plan:two'], decision_id: null });
  actions.push({ label: 'browser:user-chosen-edit', plan: { id: chosen.id, title: chosen.title, priority: chosen.priority, readiness: chosen.readiness }, metadata_preserved: true });
  await writeFile(join(evidence, 'screenshots/1440-queue-chosen.png'), await page.screenshot({ type: 'png' }));

  await page.locator('[data-plan-id="plan:two"] [data-action="queue-up"]').click(); await sleep(900);
  await page.locator('[data-field="queue-id"]').fill('plan:three'); await page.locator('[data-field="queue-title"]').fill('Created after edit'); await page.locator('[data-action="queue-create"]').click();
  await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-plan-id="plan:three"]'))), 'create after edit');
  snapshot = (await api('/api/snapshot')).value.snapshot; assert.deepEqual(snapshot.queue.map(plan => plan.id), ['plan:two', 'plan:one', 'plan:three']);
  actions.push({ label: 'browser:create-and-reorder-retained', order: snapshot.queue.map(plan => plan.id) });

  await page.locator('[data-plan-id="plan:one"] [data-action="queue-edit"]').click();
  await page.locator('[data-field="queue-title"]').fill('Unsaved conflict draft'); await page.locator('[data-field="queue-priority"]').fill('9'); await page.locator('[data-field="queue-readiness"]').selectOption('ready');
  await page.locator('[data-field="queue-title"]').focus();
  const editBaseRevision = snapshot.queue_revision; const competitor = { schema_version: 1, command_id: 'queue-competitor', target: { project_id: f.options.projectId, run_id: null, id: 'plan:two' }, expected_revision: editBaseRevision,
    operation: 'amend_queued_plan', payload: { priority: 8 } };
  assert.equal((await api('/api/commands', { body: competitor })).status, 200); await sleep(900);
  assert.equal(await page.locator('[data-field="queue-title"]').evaluate(nodeValue => nodeValue.value), 'Unsaved conflict draft'); assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'queue-title');
  await page.locator('[data-action="queue-save"]').click();
  await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="edit-status"]').textContent.includes('Conflict')), 'queue conflict');
  assert.equal(await page.locator('[data-field="queue-title"]').evaluate(nodeValue => nodeValue.value), 'Unsaved conflict draft');
  assert.equal((await api('/api/snapshot')).value.snapshot.queue.find(plan => plan.id === 'plan:one').title, 'Chosen launch title');
  actions.push({ label: 'browser:stale-edit-conflict', base_revision: editBaseRevision, draft_retained: true });
  await page.locator('[data-field="queue-title"]').focus();

  const port = live.identity.port; const stop = await call('service:stop', stopArgs()); assert.equal(stop.code, 0, stop.stderr); stopped = true;
  await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="connection-status"]').textContent.includes('Disconnected')), 'disconnect');
  const restart = await call('service:restart', serviceArgs(port)); assert.equal(restart.code, 0, restart.stderr); live = JSON.parse(restart.stdout); stopped = false;
  resources.push({ kind: 'dashboard-service-restart', pid: live.identity.pid, port: live.identity.port, state: 'registered' });
  await waitFor(() => page.evaluate(() => !document.querySelector('#connect-form').hidden), 'reauth prompt'); await page.locator('[data-testid="access-key"]').fill(credential); await page.locator('[data-testid="connect-submit"]').click();
  await waitFor(() => page.evaluate(() => document.querySelector('[data-testid="connection-status"]').textContent.includes('Connected')), 'reconnected');
  const inspection = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } }); assert.equal(inspection.status, 200); authorization = `Bearer ${inspection.value.token}`;
  assert.equal(await page.locator('[data-field="queue-id"]').evaluate(nodeValue => nodeValue.value), 'plan:one'); assert.equal(await page.locator('[data-field="queue-id"]').evaluate(nodeValue => nodeValue.readOnly), true);
  assert.equal(await page.locator('[data-field="queue-title"]').evaluate(nodeValue => nodeValue.value), 'Unsaved conflict draft'); assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'queue-title');
  actions.push({ label: 'browser:same-origin-queue-draft', port, id: 'plan:one', title: 'Unsaved conflict draft', focus: 'queue-title' });

  await page.locator('[data-action="queue-cancel"]').click(); assert.equal(await page.locator('[data-field="queue-id"]').evaluate(nodeValue => nodeValue.readOnly), false); assert.equal(await page.locator('[data-action="queue-create"]').count(), 1);
  await omowright.repinViewport(page, { width: 390, height: 844 }); await page.locator('[data-plan-id="plan:one"] [data-action="queue-edit"]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.field), 'queue-title'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await writeFile(join(evidence, 'screenshots/390-queue-keyboard.png'), await page.screenshot({ type: 'png' }));
  const errors = (await page.console.logs()).filter(entry => entry.type === 'error'); assert.deepEqual(errors, []);
  actions.push({ label: 'browser:narrow-keyboard', width: 390, focused: 'queue-title', overflow_free: true, console_errors: 0 }); passed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (live && !stopped) { const result = await call('service:final-stop', stopArgs()); stopped = result.code === 0; }
  const serviceAbsent = live ? absent(live.identity.pid) : true; await rm(profile, { recursive: true, force: true }); await f.cleanup();
  resources.push({ kind: 'cleanup-audit', browser_closed: Boolean(browser), profile_removed: await access(profile).then(() => false, () => true), fixture_removed: await access(f.root).then(() => false, () => true), service_absent: serviceAbsent, suite_passed: passed });
  await save('browser-actions.json', { source_head: process.env.C1_SOURCE_HEAD ?? null, engine: 'owned omowright after CUA IAB unavailable', actions, passed }); await save('registered-resources.json', resources);
}
assert.equal(passed, true); process.stdout.write(`${JSON.stringify({ status: 'pass', actions: actions.length, resources: resources.length })}\n`);
