import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const evidenceDir = process.argv[2];
if (!evidenceDir) throw new Error('Usage: node ui-components-browser.mjs EVIDENCE_DIR');
const url = process.argv[3] ?? 'http://127.0.0.1:41731/component-demo.html';
const browserPath = process.argv[4];
const omowrightModule = process.argv[5];
if (!browserPath || !omowrightModule) throw new Error('Browser executable and omowright module paths are required as arguments 4 and 5');
const profile = await mkdtemp(join(tmpdir(), 'lazyseries-c1-browser-'));
const screenshots = join(evidenceDir, 'screenshots');
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await mkdir(screenshots, { recursive: true });
const actions = [];
const record = (scenario, observable) => actions.push({ scenario, observable, pass: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const { loadOmowright } = await import(omowrightModule);
const { omowright } = await loadOmowright();
let browser;
let page;
let passed = false;
try {
  browser = await omowright.connectPipe({ browserPath, browserArgs: ['--headless=new', '--no-first-run', '--disable-background-networking', `--user-data-dir=${profile}`], storageRoot: profile, dialogPolicy: { accept: false } });
  page = await browser.newTab(url);
  await omowright.repinViewport(page, { width: 1440, height: 900 });
  await page.locator('#theme').selectOption('light');
  const snapshot = omowright.compactSnapshot(await page.snapshot());
  const snapshotText = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  assert.match(snapshotText, /Illustrative projected snapshot/);
  assert.match(snapshotText, /2 observed running/);
  record('wide light load', 'fixture label and two observed running tasks present');

  await page.locator('[data-view="graph"][data-task-id="join"]').click();
  assert.equal(await page.locator('[data-testid="task-inspector"]').evaluate(node => node.open), true);
  const wide = await page.screenshot({ type: 'png' });
  await writeFile(join(screenshots, '1440-light-inspector.png'), wide);
  record('graph selection', 'Join opens one contextual inspector');
  await page.locator('[data-testid="task-inspector"] button').click();

  const preserved = await page.evaluate(() => {
    const graph = document.querySelector('.graph-viewport');
    const task = document.querySelector('[data-view="graph"][data-task-id="join"]');
    graph.scrollLeft = 80; window.demo.work.select('join'); document.querySelector('[data-testid="task-inspector"]').close(); task.focus();
    const before = { selected: window.demo.work.getState().selectedTaskId, focus: document.activeElement.dataset.taskId, left: graph.scrollLeft };
    window.demo.applySnapshot();
    const nextGraph = document.querySelector('.graph-viewport');
    return { before, after: { selected: window.demo.work.getState().selectedTaskId, focus: document.activeElement.dataset.taskId, left: nextGraph.scrollLeft } };
  });
  assert.equal(preserved.after.selected, 'join'); assert.equal(preserved.after.focus, 'join'); assert.equal(preserved.after.left, preserved.before.left);
  record('snapshot update continuity', preserved);

  const dragTarget = page.locator('[data-view="graph"][data-task-id="remove"]');
  await dragTarget.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
  const box = await dragTarget.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 900);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, { steps: 6 }); await page.mouse.up();
  const dragState = await page.evaluate(() => ({ positions: window.demo.work.getState().positions, status: document.querySelector('#demo-status').textContent, revision: document.querySelector('.context-bar strong').textContent }));
  assert.ok(dragState.positions.remove); assert.match(dragState.status, /No command was sent/); assert.match(dragState.revision, /Revision 15/);
  record('layout drag authority boundary', dragState);

  await page.locator('#verification-tab').click();
  assert.equal(await page.locator('[data-testid="evidence-link"]').count(), 1);
  const verificationFocus = await page.evaluate(() => {
    const link = document.querySelector('[data-testid="evidence-link"]'); link.focus(); window.demo.applySnapshot();
    return { path: document.activeElement.dataset.evidencePath, revision: document.querySelector('#demo-status').textContent };
  });
  assert.equal(verificationFocus.path, 'evidence/removal.log');
  record('verification snapshot continuity', verificationFocus);
  const verification = await page.screenshot({ type: 'png' });
  await writeFile(join(screenshots, '1440-light-verification.png'), verification);
  record('verification evidence chain', 'requirements table exposes one contextual evidence link');

  await omowright.repinViewport(page, { width: 390, height: 844 });
  await page.locator('#theme').selectOption('dark'); await page.locator('#work-tab').click();
  assert.equal(await page.locator('.graph-viewport').evaluate(node => getComputedStyle(node).display), 'none');
  assert.notEqual(await page.locator('.task-list').evaluate(node => getComputedStyle(node).display), 'none');
  await page.locator('[data-view="list"][data-task-id="remove"]').click();
  const narrow = await page.screenshot({ type: 'png' });
  await writeFile(join(screenshots, '390-dark-inspector.png'), narrow);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.taskId), 'remove');
  record('narrow keyboard inspector', 'list fallback opens inspector; Escape returns focus to Remove');

  await omowright.repinViewport(page, { width: 1440, height: 900 });
  await page.locator('[data-view="graph"][data-task-id="remove"]').click();
  await omowright.repinViewport(page, { width: 720, height: 450 }, { deviceScaleFactor: 2 });
  const closeBox = await page.locator('[data-testid="task-inspector"] button').boundingBox();
  assert.ok(closeBox && closeBox.x >= 0 && closeBox.y >= 0 && closeBox.x + closeBox.width <= 720 && closeBox.y + closeBox.height <= 450);
  const zoomed = await page.screenshot({ type: 'png' });
  await writeFile(join(screenshots, '1440-dark-200pct-inspector.png'), zoomed);
  assert.equal(await page.locator('[data-testid="task-inspector"]').evaluate(node => node.open), true);
  record('200 percent inspector', { dialogOpen: true, closeControlBounds: closeBox });
  await page.keyboard.press('Escape');

  await omowright.repinViewport(page, { width: 1440, height: 900 });
  const sessionId = await page.resolveSessionId();
  await page.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  const motion = await page.evaluate(() => ({ token: getComputedStyle(document.documentElement).getPropertyValue('--fast').trim(), taskTransition: getComputedStyle(document.querySelector('[data-view="graph"][data-task-id="setup"]')).transitionDuration }));
  assert.equal(motion.token, '0ms'); assert.equal(motion.taskTransition, '0s');
  record('reduced motion', motion);

  const consoleEntries = await page.console.logs();
  const errors = consoleEntries.filter(entry => entry.type === 'error');
  assert.deepEqual(errors, []);
  const hashes = {};
  for (const name of ['1440-light-inspector.png', '1440-light-verification.png', '390-dark-inspector.png', '1440-dark-200pct-inspector.png']) hashes[name] = digest(await readFile(join(screenshots, name)));
  await writeFile(join(evidenceDir, 'browser-actions.json'), `${JSON.stringify({ source_head: sourceHead, engine: 'owned omowright connectPipe after in-app CUA unavailable in subagent', url, actions, screenshot_sha256: hashes, console_errors: errors }, null, 2)}\n`);
  passed = true;
} finally {
  if (browser) await browser.close();
  await rm(profile, { recursive: true, force: true });
  await writeFile(join(evidenceDir, 'browser-cleanup.json'), `${JSON.stringify({ source_head: sourceHead, browser_closed: Boolean(browser), profile, profile_removed: true, page_url: page?.url() ?? null, suite_passed: passed }, null, 2)}\n`);
}
