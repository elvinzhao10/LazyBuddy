import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fixture, plugin } from '../test/command-fixture.mjs';

const [evidenceFile, browserPath, omowrightModule] = process.argv.slice(2);
if (!evidenceFile || !browserPath || !omowrightModule) throw new Error('evidence, browser, omowright required');
const node = process.execPath; const python = '/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const service = `${plugin}/shared/dashboard/service.mjs`; const env = { ...process.env, PATH: `${dirname(node)}:${dirname(python)}:/usr/bin:/bin` };
const call = argv => new Promise((resolve, reject) => {
  const child = spawn(argv[0], argv.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
});
const f = await fixture(); let live; let browser; const record = {};
try {
  const args = ['--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId, '--python', python];
  const started = await call([node, service, 'start', ...args]); assert.equal(started.code, 0, started.stderr); live = JSON.parse(started.stdout);
  const credential = await readFile(live.credential_file, 'utf8'); const { loadOmowright } = await import(omowrightModule); const { omowright } = await loadOmowright();
  browser = await omowright.connectPipe({ browserPath, browserArgs: ['--headless=new', '--no-first-run'], storageRoot: `${f.root}/browser`, dialogPolicy: { accept: false } });
  const page = await browser.newTab(live.url); await new Promise(resolve => setTimeout(resolve, 300)); await page.locator('[data-testid="access-key"]').fill(credential); await page.locator('[data-testid="connect-submit"]').click(); await new Promise(resolve => setTimeout(resolve, 1000));
  await omowright.repinViewport(page, { width: 390, height: 844 }); await new Promise(resolve => setTimeout(resolve, 200));
  record.before = await page.evaluate(() => ({ graphHidden: document.querySelector('.graph-viewport').hidden, graphDisplay: getComputedStyle(document.querySelector('.graph-viewport')).display,
    listHidden: document.querySelector('.task-list').hidden, listDisplay: getComputedStyle(document.querySelector('.task-list')).display,
    visibleListControls: [...document.querySelectorAll('[data-view="list"][data-task-id]')].filter(node => node.getClientRects().length).length }));
  const target = page.locator('[data-view="list"][data-task-id="T1"]'); await target.focus(); await page.keyboard.press('Enter'); await new Promise(resolve => setTimeout(resolve, 900));
  await writeFile(evidenceFile.replace(/\.json$/, '.png'), await page.screenshot({ type: 'png' })); await page.keyboard.press('Escape'); await new Promise(resolve => setTimeout(resolve, 100));
  record.after = await page.evaluate(() => ({ dialogOpen: document.querySelector('[data-testid="task-inspector"]').open, activeTag: document.activeElement.tagName,
    activeTaskId: document.activeElement.dataset.taskId ?? null, activeView: document.activeElement.dataset.view ?? null,
    activeText: document.activeElement.textContent?.trim().slice(0, 80) ?? '', selected: document.querySelector('[data-view="list"][data-task-id="T1"]')?.getAttribute('aria-pressed') }));
  await writeFile(evidenceFile, `${JSON.stringify(record, null, 2)}\n`);
  assert.equal(record.before.graphDisplay, 'none'); assert.equal(record.before.listDisplay, 'grid'); assert.ok(record.before.visibleListControls > 0);
  assert.deepEqual({ open: record.after.dialogOpen, task: record.after.activeTaskId, view: record.after.activeView, selected: record.after.selected }, { open: false, task: 'T1', view: 'list', selected: 'true' });
} finally {
  if (browser) await browser.close().catch(() => {}); if (live) await call([node, service, 'stop', '--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId, '--python', python]); await f.cleanup(); await rm(`${f.root}/browser`, { recursive: true, force: true }).catch(() => {});
}
