import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../../../', import.meta.url));
const MAX_ENTRIES = 5000;

export async function collectPackageInventory({ pluginRoot = defaultRoot, runtime = 'LazyBuddy' } = {}) {
  const root = resolve(pluginRoot);
  const safeStat = async relative => {
    let target = root;
    if (!(await lstat(root)).isDirectory()) throw new Error('PACKAGE_ROOT_UNAVAILABLE');
    for (const part of relative.split('/')) {
      if (!part || part === '.' || part === '..') throw new Error('INVALID_PACKAGE_PATH');
      target = join(target, part);
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error('LINKED_PACKAGE_ENTRY');
    }
    return lstat(target);
  };
  const json = async relative => {
    const stat = await safeStat(relative);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('PACKAGE_FILE_UNAVAILABLE');
    return JSON.parse(await readFile(join(root, relative), 'utf8'));
  };
  const entries = []; const coverage = [];
  const add = (kind, name, path, state) => entries.push({ id: `${kind}:${name}`, kind, name, path,
    package_state: state, runtime_state: 'unobserved', detail: 'Package definition only. Host loading, enablement and current activity need a matching session observation.' });
  const kinds = [
    ['skill', runtime === 'LazyKimi' ? ['.kimi-code/skills', 'skills'] : runtime === 'LazyTrae' ? ['.trae/skills'] : ['skills']],
    ['subagent', runtime === 'LazyTrae' ? ['.trae/agents'] : ['agents']],
  ];
  for (const [kind, paths] of kinds) {
    let directory = null;
    for (const path of paths) { if (await safeStat(path).then(stat => stat.isDirectory()).catch(() => false)) { directory = path; break; } }
    if (!directory) { coverage.push({ kind, state: 'unavailable', detail: 'No readable package directory.' }); continue; }
    const names = (await readdir(join(root, directory), { withFileTypes: true }))
      .filter(entry => kind === 'skill' ? entry.isDirectory() : entry.isFile() && /\.(md|yaml|yml|json)$/.test(entry.name))
      .map(entry => entry.name).sort();
    coverage.push({ kind, state: 'observed', total: names.length, shown: Math.min(names.length, MAX_ENTRIES) });
    for (const name of names.slice(0, MAX_ENTRIES)) {
      const path = `${directory}/${name}${kind === 'skill' ? '/SKILL.md' : ''}`;
      const present = await safeStat(path).then(stat => stat.isFile()).catch(() => false);
      add(kind, name.replace(/\.(md|yaml|yml|json)$/, ''), path, present ? 'present' : 'missing');
    }
  }
  const hookPath = runtime === 'LazyTrae' ? '.trae/hooks.json' : 'hooks/hooks.json';
  const hooks = await json(hookPath).catch(() => null);
  if (hooks?.hooks && typeof hooks.hooks === 'object') {
    const events = Object.keys(hooks.hooks).sort();
    for (const name of events.slice(0, MAX_ENTRIES)) add('hook', name, hookPath, 'declared');
    coverage.push({ kind: 'hook', state: 'observed', total: events.length, shown: Math.min(events.length, MAX_ENTRIES) });
  } else {
    const directory = runtime === 'LazyTrae' ? '.trae/hooks' : 'hooks';
    const names = await safeStat(directory).then(() => readdir(join(root, directory), { withFileTypes: true }))
      .then(values => values.filter(entry => entry.isFile() && /\.(sh|bash|js|mjs|py)$/.test(entry.name)).map(entry => entry.name).sort()).catch(() => null);
    coverage.push({ kind: 'hook', state: names ? 'observed' : 'unavailable', total: names?.length ?? null, shown: names ? Math.min(names.length, MAX_ENTRIES) : null });
    for (const name of (names ?? []).slice(0, MAX_ENTRIES)) add('hook', name, `${directory}/${name}`, 'present');
  }
  let config = null; let configPath = null;
  for (const path of ['.mcp.json', '.kimi-code/mcp.json', '.trae/mcp.json']) {
    const value = await json(path).catch(() => null);
    if (value?.mcpServers && typeof value.mcpServers === 'object') { config = value; configPath = path; break; }
  }
  const servers = config ? Object.keys(config.mcpServers).sort() : null;
  coverage.push({ kind: 'mcp', state: servers ? 'observed' : 'unavailable', total: servers?.length ?? null, shown: servers ? Math.min(servers.length, MAX_ENTRIES) : null });
  for (const name of (servers ?? []).slice(0, MAX_ENTRIES)) add('mcp', name, configPath, 'declared');
  return { scope: 'serving-package', observed_at: new Date().toISOString(), runtime, entries, coverage };
}

export async function collectPackageHealth(options) {
  return packageHealth({ ...options, inventory: await collectPackageInventory(options) });
}

export function packageHealth({ runtime, packageVersion, capabilities, inventory = null, observedAt = new Date().toISOString() }) {
  const features = [
    ['browser', 'Browser dashboard'], ['project_platform', 'Project plans and requirements'],
    ['project_source_editing', 'Revision-checked source editing'], ['project_telemetry', 'Recorded execution observations'],
    ['context_copy', 'Copy context to your agent chat'],
  ];
  const sections = [
    { id: 'package', title: 'Running dashboard package', items: [
      { id: 'runtime', label: 'Adapter', status: 'ok', observed: runtime, detail: 'The authenticated service is handling this request.' },
      { id: 'package-version', label: 'Package version', status: packageVersion ? 'ok' : 'unavailable', observed: packageVersion ?? null,
        detail: 'Read from this adapter package. This is not the installed host app version.' },
      { id: 'node-version', label: 'Node.js runtime', status: 'ok', observed: process.versions.node },
    ] },
    { id: 'features', title: 'Packaged dashboard capabilities', items: features.map(([id, label]) => ({
      id, label, status: capabilities[id] === 'available' ? 'ok' : 'unavailable', observed: capabilities[id] ?? null,
      detail: 'Package capability declaration. This does not prove host activation or agent consumption.',
    })) },
    { id: 'host', title: 'Native app connection', items: [
      { id: 'activation', label: 'Native host readiness', status: 'unavailable', observed: null,
        detail: 'A fresh host-session receipt is required to verify hooks, tools, permissions and agent revision consumption.' },
      { id: 'upstream-version', label: 'Newest host version', status: 'unavailable', observed: null,
        detail: 'This offline package check does not contact an update service or upgrade your installed app.' },
    ] },
  ];
  const summary = { ok: 0, warn: 0, unavailable: 0 };
  for (const item of sections.flatMap(section => section.items)) summary[item.status] += 1;
  return { schema: 'lazybuddy/plugin-health@1', collector: 'dashboard/package-health@1', subject: { plugin: runtime, version: packageVersion }, observed_at: observedAt, sections, summary, inventory };
}
