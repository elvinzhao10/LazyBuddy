import { request } from 'node:http';
import { readFile, mkdir, writeFile, appendFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { fixture, processCall, plugin } from './command-fixture.mjs';

export const serviceCLI = join(plugin, 'shared/dashboard/service.mjs');
export async function resource(value) {
  if (process.env.B3_EVIDENCE_DIR) await appendFile(join(process.env.B3_EVIDENCE_DIR, 'resources.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), ...value })}\n`);
}
export function http(origin, path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(`${origin}${path}`, { method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...options.headers }, timeout: 10000 }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: response.statusCode, headers: response.headers, value }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('HTTP_TIMEOUT'))); req.end(body);
  });
}
export async function serviceFixture() {
  const f = await fixture(); const assetRoot = join(f.root, 'explicit-temporary-qa-assets');
  await resource({ action: 'registered', root: f.root, cleanup: 'service stop then remove exact fixture root' });
  await mkdir(assetRoot); await writeFile(join(assetRoot, 'index.html'), '<!doctype html><title>B3 temporary QA asset</title>QA only; no C1 proof');
  const args = ['--project-root', f.root, '--project-id', f.options.projectId, '--run-id', f.options.runId, '--asset-root', assetRoot];
  const calls = [];
  async function cli(action, extra = []) {
    const result = await processCall([process.execPath, serviceCLI, action, ...args, ...extra]); calls.push(result); return result;
  }
  let live;
  async function start(port) {
    const result = await cli('start', port ? ['--port', String(port)] : []); assert.equal(result.code, 0, result.stderr); live = JSON.parse(result.stdout);
    await resource({ action: 'registered', root: f.root, pid: live.identity.pid, port: live.identity.port, instance: live.identity.instance });
    const credential = await readFile(live.credential_file, 'utf8');
    const response = await http(live.url, '/api/session', { body: {}, headers: { 'x-dashboard-bootstrap': credential } });
    assert.equal(response.status, 200); live.authorization = `Bearer ${response.value.token}`; return live;
  }
  try { await start(); } catch (error) { await cli('stop'); await f.cleanup(); throw error; }
  return { ...f, args, calls, cli, start, get live() { return live; },
    receiptPath: () => join(dirname(live.credential_file), 'receipt.json'),
    request: (path, options = {}) => http(live.url, path, { ...options, headers: { authorization: live.authorization, ...options.headers } }),
    cleanup: async () => {
      const result = await cli('stop'); assert.equal(result.code, 0, result.stderr); await f.cleanup();
      await assert.rejects(lstat(f.root), { code: 'ENOENT' });
      await resource({ action: 'removed', root: f.root, cleanup: JSON.parse(result.stdout), root_absent: true });
    } };
}
