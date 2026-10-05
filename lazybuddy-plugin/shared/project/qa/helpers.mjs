import fs from 'node:fs';
import os from 'node:os';
import { after } from 'node:test';
import path from 'node:path';
import crypto from 'node:crypto';

const temporaryRoot = fs.realpathSync(os.tmpdir());
export const suiteRoot = fs.mkdtempSync(path.join(temporaryRoot, 'lazybuddy-project-review-'));
const ownedRoot = fs.lstatSync(suiteRoot);
after(() => {
  const current = fs.lstatSync(suiteRoot);
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== ownedRoot.dev || current.ino !== ownedRoot.ino) {
    throw new Error('Refusing cleanup because the fixture root identity changed');
  }
  fs.rmSync(suiteRoot, { recursive: true });
});
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export function fixture(name) {
  const root = path.join(suiteRoot, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function write(root, relative, value = 'sentinel\n') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
}

export function inventory(root, prefix = '') {
  if (!fs.existsSync(root)) return null;
  const output = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    if (entry.isSymbolicLink()) output[relative] = { type: 'symlink', target: fs.readlinkSync(absolute) };
    else if (entry.isDirectory()) {
      output[relative] = { type: 'directory', mode: stat.mode };
      Object.assign(output, inventory(absolute, relative));
    } else if (entry.isFile()) output[relative] = { type: 'file', sha256: sha256(fs.readFileSync(absolute)), mode: stat.mode };
    else output[relative] = { type: 'special', mode: stat.mode };
  }
  return output;
}

export function seedNative(root) {
  const files = {
    '.lazybuddy/runs/run-old/state.json': '{"dashboard_project_id":"native-old","run_id":"run-old","plan_reference":"old-plan.md","revision":4}\n',
    '.lazybuddy/runs/run-old/plan.md': '# Native old plan\n- [x] old task\n',
    '.lazybuddy/runs/run-old/events.jsonl': '{"event_id":"old-1","type":"confirmed"}\n',
    '.lazybuddy/runs/run-old/receipts/verifier.json': '{"result":"confirmed","subject":"old-content"}\n',
    '.lazybuddy/dashboard/service.json': '{"credential":"review-secret-fixture-only","owner":"native"}\n',
    '.lazybuddy/dashboard-queue/queue.json': '{"project_id":"native-old","revision":5,"plans":[]}\n',
    '.lazybuddy/dashboard-queue/revision': '5\n',
    '.codebuddy/settings.local.json': '{"preserve":true}\n'
  };
  for (const [relative, contents] of Object.entries(files)) write(root, relative, contents);
  return Object.fromEntries(Object.keys(files).map(relative => [relative, sha256(fs.readFileSync(path.join(root, relative)))]));
}

export function checkNative(root, expected) {
  const mismatches = [];
  for (const [relative, hash] of Object.entries(expected)) {
    const target = path.join(root, relative);
    if (!fs.existsSync(target) || !fs.lstatSync(target).isFile() || sha256(fs.readFileSync(target)) !== hash) mismatches.push(relative);
  }
  return mismatches;
}
