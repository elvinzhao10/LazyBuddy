// V2-T5 plugin self-health collector (doctor style). Every item is an
// OBSERVED fact read from this plugin package, this process or the bound
// project root at collection time: manifest parses, referenced files exist,
// pinned vendor bytes re-hash to the recorded pins, `--version` probes really
// executed, journal tails really inspected. Nothing is inferred: a fact this
// collector cannot observe (host activation of hooks/MCP servers, an
// uninitialized project store) renders as an explicit `unavailable` item,
// never as a zero, never as healthy. No credential bytes, tokens, session
// material or host settings are read or emitted — the snapshot is safe to
// serve to an authenticated dashboard reader verbatim.
import { execFile } from 'node:child_process';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPackageInventory } from './package-health.mjs';

export const HEALTH_SNAPSHOT_SCHEMA = 'lazybuddy/plugin-health@1';
export const HEALTH_COLLECTOR = 'dashboard/adapters/health@1';
const DEFAULT_PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const VENDOR_FAMILIES = Object.freeze([
  { id: 'dashboard', manifest: 'scripts/dashboard-vendor-manifest.v1.json', tree: 'shared/dashboard',
    sidecar: 'shared/dashboard.vendor.json' },
  { id: 'project', manifest: 'scripts/project-vendor-manifest.v1.json', tree: 'shared/project',
    sidecar: 'shared/project.vendor.json' },
]);
const DASHBOARD_MCP_SERVER = 'status-dashboard';
// The dashboard-facing and project-facing tool names the status-dashboard MCP
// server must register for the served dashboard to function.
const REQUIRED_MCP_TOOLS = Object.freeze({ dashboard: 'dashboard_service', project: 'project' });
const PROBE_TIMEOUT_MS = 3000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LIST_ITEMS = 32;

export class HealthCollectorError extends Error {
  constructor(code) { super(code); this.name = 'HealthCollectorError'; this.code = code; }
}

const ok = (id, label, detail, observed) => ({ id, label, status: 'ok', detail, observed });
const warn = (id, label, code, detail, observed = null) => ({ id, label, status: 'warn', detail, observed, code });
const unavailable = (id, label, code, detail, observed = null) =>
  ({ id, label, status: 'unavailable', detail, observed, code });

const absolute = value => typeof value === 'string' && value.startsWith(sep) && resolve(value) === value;

async function readRegular(file, limit = MAX_FILE_BYTES) {
  const stat = await lstat(file);
  if (!stat.isFile()) throw new HealthCollectorError('IRREGULAR_FILE');
  if (stat.size > limit) throw new HealthCollectorError('FILE_TOO_LARGE');
  return readFile(file);
}

async function readJSONFile(file) {
  return JSON.parse((await readRegular(file, 1024 * 1024)).toString('utf8'));
}

const boundedList = names => (names.length > MAX_LIST_ITEMS
  ? `${names.slice(0, MAX_LIST_ITEMS).join(', ')} (+${names.length - MAX_LIST_ITEMS} more)` : names.join(', '));

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stableJSON = value => `${JSON.stringify(value, null, 2)}\n`;

// Bounded `--version` probe (hung-command class): the collector races the
// caller-supplied (or real) exec against its own deadline, so a hanging or
// wedged interpreter can never wedge the health route.
const defaultExec = (file, args) => new Promise((resolveExec, rejectExec) => {
  execFile(file, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: 4096, killSignal: 'SIGKILL' },
    (error, stdout) => { if (error) rejectExec(error); else resolveExec(stdout); });
});
async function boundedExec(exec, file, args) {
  let timer;
  try {
    return await Promise.race([
      exec(file, args),
      new Promise(resolveTimeout => { timer = setTimeout(() => resolveTimeout({ timedOut: true }), PROBE_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}
const versionLine = text => (typeof text === 'string' ? text.trim().split('\n')[0] : '');
const printable = value => typeof value === 'string' && value.length <= 64 && /^[\x20-\x7e]+$/.test(value);

/* -- Section collectors ---------------------------------------------------- */

async function collectPluginPackage(pluginRoot) {
  const items = [];
  let manifest = null;
  try { manifest = await readJSONFile(join(pluginRoot, '.workbuddy-plugin/plugin.json')); }
  catch { items.push(unavailable('plugin-manifest', 'Plugin manifest', 'PLUGIN_MANIFEST_UNREADABLE',
    'the plugin manifest is absent or unreadable; the declared surfaces below stay unobserved')); }
  if (manifest) {
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string'
      || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version)) {
      items.push(warn('plugin-manifest', 'Plugin manifest', 'PLUGIN_MANIFEST_MALFORMED',
        'the manifest parsed but name/version are not well-formed'));
    } else {
      items.push(ok('plugin-manifest', 'Plugin manifest', `manifest parsed for ${manifest.name}`, manifest.version));
    }
    for (const [surface, declared] of [['skills', manifest.skills], ['commands', manifest.commands],
      ['agents', manifest.agents], ['hooks', manifest.hooks], ['mcpServers', manifest.mcpServers]]) {
      // The manifest declares each surface either as a path string or as a
      // one-path array ("./skills/"); both shapes name one observed target.
      const path = typeof declared === 'string' ? declared
        : Array.isArray(declared) && declared.length === 1 && typeof declared[0] === 'string' ? declared[0] : null;
      if (path === null) continue;
      const target = join(pluginRoot, path.replace(/^\.\//, '').replace(/\/$/, ''));
      const present = await lstat(target).then(stat => stat.isFile() || stat.isDirectory()).catch(() => false);
      items.push(present
        ? ok(`surface:${surface}`, `Declared ${surface}`, `declared path present: ${path}`, path)
        : warn(`surface:${surface}`, `Declared ${surface}`, 'DECLARED_SURFACE_MISSING',
          `manifest declares ${path} but no such file or directory exists`, path));
    }
  }
  return { id: 'plugin-package', title: 'Plugin package', items };
}

async function collectEntryPoints(pluginRoot, repoRoot) {
  const items = [];
  const entrypoints = await vendorEntryPoints(repoRoot);
  if (!entrypoints.length) {
    items.push(unavailable('entrypoints', 'Vendored entry points', 'ENTRYPOINT_SET_UNOBSERVED',
      'no vendor manifest is readable, so the entry-point set stays unobserved'));
    return { id: 'entry-points', title: 'Entry points', items };
  }
  for (const entry of entrypoints) {
    const present = await lstat(join(pluginRoot, entry.path)).then(stat => stat.isFile()).catch(() => false);
    items.push(present
      ? ok(`entrypoint:${entry.family}:${entry.path}`, `Entry point (${entry.family})`,
        `${entry.family} family entry point present`, entry.path)
      : warn(`entrypoint:${entry.family}:${entry.path}`, `Entry point (${entry.family})`, 'ENTRYPOINT_MISSING',
        `${entry.family} family entry point missing from the plugin tree`, entry.path));
  }
  return { id: 'entry-points', title: 'Entry points', items };
}

async function collectMcpTools(pluginRoot) {
  const items = [];
  let config = null;
  try { config = await readJSONFile(join(pluginRoot, '.mcp.json')); }
  catch { items.push(unavailable('mcp-config', 'MCP server declarations', 'MCP_CONFIG_UNREADABLE',
    'the MCP server declaration file is absent or unreadable')); }
  const servers = config?.mcpServers && typeof config.mcpServers === 'object' ? Object.keys(config.mcpServers) : [];
  let toolNames = new Map();
  if (servers.length) {
    toolNames = await mcpToolNames(pluginRoot, servers);
    for (const server of servers) {
      const entry = mcpEntryPath(pluginRoot, config.mcpServers[server]);
      const present = entry ? await lstat(entry).then(stat => stat.isFile()).catch(() => false) : false;
      const names = toolNames.get(server) ?? null;
      if (!present) items.push(warn(`mcp:${server}`, `MCP server ${server}`, 'MCP_ENTRY_MISSING',
        'the declared entry script is missing from the plugin tree', server));
      else if (names == null) items.push(ok(`mcp:${server}`, `MCP server ${server}`,
        `entry script present; tool list is declared by the implementation (not a static bash list)`, server));
      else items.push(ok(`mcp:${server}`, `MCP server ${server}`,
        `entry script present; ${names.length} tool name(s) statically registered: ${boundedList(names)}`, server));
    }
  }
  const dashboardNames = toolNames.get(DASHBOARD_MCP_SERVER);
  if (dashboardNames == null) {
    if (servers.includes(DASHBOARD_MCP_SERVER)) {
      items.push(unavailable('mcp:dashboard-tool', 'Dashboard MCP tool', 'MCP_TOOL_NAMES_UNEXTRACTED',
        'the status-dashboard server declares its tools in its implementation; static extraction found no list'));
    } else {
      items.push(warn('mcp:dashboard-tool', 'Dashboard MCP tool', 'MCP_DASHBOARD_SERVER_UNDECLARED',
        'no status-dashboard server is declared', DASHBOARD_MCP_SERVER));
    }
  } else if (dashboardNames.includes(REQUIRED_MCP_TOOLS.dashboard)) {
    items.push(ok('mcp:dashboard-tool', 'Dashboard MCP tool', 'tool name registered by the server script',
      REQUIRED_MCP_TOOLS.dashboard));
  } else {
    items.push(warn('mcp:dashboard-tool', 'Dashboard MCP tool', 'MCP_TOOL_UNREGISTERED',
      `the server's registered tool names do not include ${REQUIRED_MCP_TOOLS.dashboard}`,
      REQUIRED_MCP_TOOLS.dashboard));
  }
  if (dashboardNames != null) {
    items.push(dashboardNames.includes(REQUIRED_MCP_TOOLS.project)
      ? ok('mcp:project-tool', 'Project MCP tool', 'tool name registered by the server script',
        REQUIRED_MCP_TOOLS.project)
      : warn('mcp:project-tool', 'Project MCP tool', 'MCP_TOOL_UNREGISTERED',
        `the server's registered tool names do not include ${REQUIRED_MCP_TOOLS.project}`,
        REQUIRED_MCP_TOOLS.project));
  }
  // The service process cannot see the host; host activation stays honestly
  // unobserved (package facts only) — never reported as installed-and-running.
  items.push(unavailable('mcp:host-activation', 'MCP host activation', 'HOST_ACTIVATION_UNOBSERVED',
    'whether a host actually loaded these servers is not observable from the service process'));
  return { id: 'mcp-tools', title: 'MCP tool registration', items };
}

function mcpEntryPath(pluginRoot, declaration) {
  const arg = Array.isArray(declaration?.args) ? declaration.args.find(value => typeof value === 'string'
    && value.includes('/')) : null;
  if (typeof arg !== 'string') return null;
  const relative = arg.replace('${CODEBUDDY_PLUGIN_ROOT}/', '');
  return relative.startsWith('/') ? null : join(pluginRoot, relative);
}

// Extracts the statically registered tool names from a bash MCP server
// script's embedded `tools/list` reply. The reply is a single-quoted bash
// literal (`reply '{"tools":[ … ]}'`), so the segment runs from the opening
// literal to the closing `]}'` — nested `]` inside inputSchema/enum arrays
// must not cut the list short. This is a read of the shipped bytes — no
// server is launched (launching would need a host project binding and is not
// observable honestly from here).
async function mcpToolNames(pluginRoot, servers) {
  const names = new Map();
  for (const server of servers) {
    const script = join(pluginRoot, 'mcp', server, 'server.sh');
    let text;
    try { text = (await readRegular(script, 1024 * 1024)).toString('utf8'); } catch { continue; }
    const start = text.indexOf(`'{"tools":[`);
    if (start === -1) continue;
    const end = text.indexOf(`]}'`, start);
    if (end === -1) continue;
    const found = [...text.slice(start, end).matchAll(/"name":\s*"([^"\\]{1,128})"/g)].map(match => match[1]);
    if (found.length) names.set(server, [...new Set(found)]);
  }
  return names;
}

async function collectHooks(pluginRoot) {
  const items = [];
  let hooks = null;
  try { hooks = await readJSONFile(join(pluginRoot, 'hooks/hooks.json')); }
  catch { items.push(unavailable('hooks-manifest', 'Hook manifest', 'HOOK_MANIFEST_UNREADABLE',
    'the hook manifest is absent or unreadable')); }
  if (hooks?.hooks && typeof hooks.hooks === 'object') {
    const events = Object.keys(hooks.hooks);
    const references = [];
    for (const event of events) {
      for (const matcher of hooks.hooks[event] ?? []) {
        for (const hook of matcher.hooks ?? []) {
          const match = /\$\{CODEBUDDY_PLUGIN_ROOT\}\/(scripts\/hooks\/[A-Za-z0-9._-]+)/.exec(hook.command ?? '');
          if (match) references.push(match[1]);
        }
      }
    }
    const unique = [...new Set(references)].sort();
    const missing = [];
    for (const relative of unique) {
      const present = await lstat(join(pluginRoot, relative)).then(stat => stat.isFile()).catch(() => false);
      if (!present) missing.push(relative);
    }
    items.push(missing.length
      ? warn('hook-scripts', 'Hook scripts', 'HOOK_SCRIPT_MISSING',
        `${missing.length} referenced hook script(s) missing: ${boundedList(missing)}`, unique.length - missing.length)
      : ok('hook-scripts', 'Hook scripts', `${events.length} event type(s) installed in the manifest`,
        `${unique.length} script(s) present`));
  } else if (hooks) {
    items.push(warn('hooks-manifest', 'Hook manifest', 'HOOK_MANIFEST_MALFORMED',
      'the hook manifest parsed but has no usable hooks object'));
  }
  items.push(unavailable('hooks-host-active', 'Hook host activity', 'HOST_ACTIVATION_UNOBSERVED',
    'whether a host actually fires these hooks is not observable from the service process'));
  return { id: 'hooks', title: 'Hooks', items };
}

async function collectSkills(pluginRoot) {
  const items = [];
  let names = [];
  try {
    names = (await readdir(join(pluginRoot, 'skills'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch { /* observed as empty below */ }
  const incomplete = [];
  for (const name of names) {
    const present = await lstat(join(pluginRoot, 'skills', name, 'SKILL.md')).then(stat => stat.isFile()).catch(() => false);
    if (!present) incomplete.push(name);
  }
  if (!names.length) items.push(warn('bundled-skills', 'Bundled skills', 'SKILL_MANIFEST_EMPTY',
    'the skills directory is absent or empty (observed exact zero; a whole plugin bundle is expected to carry skills)', 0));
  else if (incomplete.length) items.push(warn('bundled-skills', 'Bundled skills', 'SKILL_INCOMPLETE',
    `skill(s) without SKILL.md: ${boundedList(incomplete)}`, names.length - incomplete.length));
  else items.push(ok('bundled-skills', 'Bundled skills', `${names.length} bundled skill(s), each with a SKILL.md`,
    names.length));
  if (names.length) items.push(ok('bundled-skill-list', 'Bundled skill list', boundedList(names), names.length));
  return { id: 'skills', title: 'Skills', items };
}

async function collectRuntimes(options) {
  const exec = options.exec ?? defaultExec;
  const probes = [['runtime:node', 'Node runtime', process.execPath || 'node'],
    ['runtime:python', 'Python runtime', options.python ?? 'python3']];
  // The probes run concurrently so a wedged interpreter costs one bounded
  // deadline, not one per runtime — the health route stays well inside the
  // serving response timeouts.
  const results = await Promise.all(probes.map(async ([id, label, file]) => {
    let outcome;
    try { outcome = await boundedExec(exec, file, ['--version']); }
    catch (error) { outcome = { failed: error?.code ?? 'EXEC_FAILED' }; }
    if (outcome.timedOut === true) {
      return warn(id, label, 'RUNTIME_PROBE_TIMEOUT',
        `the --version probe did not answer within ${PROBE_TIMEOUT_MS}ms and was abandoned`, file);
    }
    if (outcome.failed) {
      return warn(id, label, 'RUNTIME_PROBE_FAILED', `the --version probe failed (${outcome.failed})`, file);
    }
    const version = versionLine(outcome);
    return printable(version)
      ? ok(id, label, `executed ${file} --version`, version)
      : warn(id, label, 'RUNTIME_PROBE_UNPARSEABLE',
        'the probe answered but the first line is not a printable version string', file);
  }));
  return { id: 'runtimes', title: 'Runtime probes', items: results };
}

async function vendorEntryPoints(repoRoot) {
  const entrypoints = [];
  for (const family of VENDOR_FAMILIES) {
    try {
      const manifest = await readJSONFile(join(repoRoot, family.manifest));
      for (const path of manifest?.boundary?.entrypoints ?? []) {
        if (typeof path === 'string') entrypoints.push({ family: family.id, path: `${family.tree}/${path}` });
      }
    } catch { /* the integrity section reports the unreadable manifest */ }
  }
  return entrypoints;
}

async function collectVendorIntegrity(pluginRoot, repoRoot) {
  const items = [];
  for (const family of VENDOR_FAMILIES) {
    const id = `vendor:${family.id}`;
    let manifest;
    try { manifest = await readJSONFile(join(repoRoot, family.manifest)); }
    catch { items.push(unavailable(id, `Vendor integrity (${family.id})`, 'VENDOR_MANIFEST_ABSENT',
      `the pin manifest ${family.manifest} is not readable here (vendored sibling trees carry the sidecar only)`,
      family.tree)); continue; }
    if (!Array.isArray(manifest?.files) || manifest.files.length === 0
      || !/^[a-f0-9]{64}$/.test(manifest.source?.treeSha256 ?? '')) {
      items.push(warn(id, `Vendor integrity (${family.id})`, 'VENDOR_MANIFEST_MALFORMED',
        'the pin manifest parsed but its file inventory or tree hash is malformed')); continue;
    }
    const drift = [];
    const records = [];
    for (const pin of manifest.files) {
      const file = join(pluginRoot, family.tree, pin.path);
      let bytes;
      try { bytes = await readRegular(file); }
      catch (error) {
        // Typed findings only: an unreadable pin (absent, irregular, symlink,
        // oversized) is VENDOR_FILE_MISSING; the collector's own typed codes
        // pass through unchanged.
        drift.push({ code: error instanceof HealthCollectorError ? error.code : 'VENDOR_FILE_MISSING', path: pin.path });
        continue;
      }
      const digest = sha256(bytes);
      records.push(`${pin.path}\0${bytes.length}\0${digest}\n`);
      if (bytes.length !== pin.bytes || digest !== pin.sha256) drift.push({ code: 'VENDOR_BYTE_DRIFT', path: pin.path });
    }
    const treeSha256 = sha256(records.join(''));
    if (treeSha256 !== manifest.source.treeSha256) drift.push({ code: 'VENDOR_TREE_MISMATCH', path: family.tree });
    let sidecar = 'unobserved';
    try {
      const sidecarBytes = await readRegular(join(pluginRoot, family.sidecar), 1024 * 1024);
      sidecar = Buffer.compare(sidecarBytes, Buffer.from(stableJSON(manifest))) === 0 ? 'match' : 'drift';
    } catch { sidecar = 'absent'; }
    if (sidecar !== 'match') drift.push({ code: 'VENDOR_SIDECAR_DRIFT', path: family.sidecar });
    if (drift.length) {
      const byCode = new Map();
      for (const finding of drift) byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
      const codeSummary = [...byCode.entries()].map(([code, count]) => `${code}×${count}`).join(', ');
      items.push(warn(id, `Vendor integrity (${family.id})`, drift[0].code,
        `${drift.length} integrity finding(s) [${codeSummary}]; first: ${drift[0].code} at ${drift[0].path}`,
        `${manifest.files.length} pinned file(s)`));
    } else {
      items.push(ok(id, `Vendor integrity (${family.id})`,
        `${manifest.files.length} pinned file(s) re-hashed byte-identical; tree hash and sidecar match`,
        manifest.files.length));
    }
  }
  return { id: 'vendor-integrity', title: 'Vendor manifest integrity', items };
}

async function collectProjectStore(options) {
  const items = [];
  const projectRoot = options.projectRoot;
  if (projectRoot === undefined) {
    items.push(unavailable('store:binding', 'Project store binding', 'PROJECT_ROOT_UNBOUND',
      'this service binding carries no project root, so the project store stays unobserved'));
    return { id: 'project-store', title: 'Project store', items };
  }
  if (!absolute(projectRoot)) throw new HealthCollectorError('INVALID_PROJECT_ROOT');
  const store = join(projectRoot, '.lazybuddy/project');
  let owner = null;
  try { owner = await readJSONFile(join(store, 'owner.json')); }
  catch { /* reported below */ }
  if (!owner) {
    items.push(unavailable('store:owner', 'Project store owner', 'STORE_NOT_INITIALIZED',
      'no .lazybuddy/project/owner.json exists — this project root was never initialized; nothing is implied about plugin health',
      'absent'));
  } else if (owner.owner !== 'LazyBuddy/project') {
    items.push(warn('store:owner', 'Project store owner', 'STORE_NAMESPACE_UNEXPECTED',
      `owner.json names a different namespace: ${String(owner.owner)}`, String(owner.owner ?? '')));
  } else if (typeof options.projectId === 'string' && owner.project_id !== options.projectId) {
    items.push(warn('store:owner', 'Project store owner', 'PROJECT_ID_MISMATCH',
      `owner.json binds ${String(owner.project_id)} but this service serves ${options.projectId}`,
      String(owner.project_id ?? '')));
  } else {
    items.push(ok('store:owner', 'Project store owner', 'namespace and project identity match this binding',
      String(owner.project_id ?? options.projectId ?? '')));
  }
  let state = null;
  try { state = await readJSONFile(join(store, 'state.json')); }
  catch { /* reported below */ }
  if (!state) {
    items.push(unavailable('store:state', 'Accepted project state', 'STATE_ABSENT',
      'no accepted state.json exists yet (never initialized or never mutated)', 'absent'));
  } else if (typeof state.schema_version !== 'number' || typeof state.revision !== 'number') {
    items.push(warn('store:state', 'Accepted project state', 'STATE_MALFORMED',
      'state.json parsed but schema_version/revision are not well-formed'));
  } else {
    items.push(ok('store:state', 'Accepted project state',
      `state.json parses (schema v${state.schema_version}, ${state.runtime ?? 'runtime unreported'})`,
      `revision ${state.revision}`));
  }
  const journal = join(projectRoot, '.lazybuddy/project-observations/journal.jsonl');
  let bytes = null;
  try { bytes = await readRegular(journal, 16 * 1024 * 1024); }
  catch { /* reported below */ }
  if (bytes === null) {
    items.push(unavailable('store:observation-journal', 'Observation journal', 'OBSERVATION_JOURNAL_ABSENT',
      'no observation journal exists yet — zero observations were never reported, the journal is simply unobserved here',
      'absent'));
  } else {
    const text = bytes.toString('utf8');
    const torn = text !== '' && !text.endsWith('\n');
    const lines = text.split('\n').filter(line => line !== '');
    const parseable = lines.every(line => { try { JSON.parse(line); return true; } catch { return false; } });
    if (torn || !parseable) {
      items.push(warn('store:observation-journal', 'Observation journal', torn
        ? 'OBSERVATION_JOURNAL_TORN' : 'OBSERVATION_JOURNAL_CORRUPT',
        torn ? 'the journal tail is a torn (partial) line — the reader drops it on next append'
          : 'a journal line is not parseable JSON', lines.length));
    } else {
      items.push(ok('store:observation-journal', 'Observation journal',
        `complete tail; ${lines.length} record(s) parse`, lines.length));
    }
  }
  return { id: 'project-store', title: 'Project store', items };
}

function collectServiceProcess(now) {
  const uptime = Math.max(0, Math.floor(process.uptime()));
  return { id: 'service-process', title: 'Service process', items: [
    ok('process:uptime', 'Service uptime', `process started ${new Date(now - uptime * 1000).toISOString()}`,
      `${uptime}s`),
    ok('process:runtime', 'Service runtime', `service process executes ${process.execPath || 'node'}`,
      process.version),
    ok('process:pid', 'Service process id', 'observed from inside the serving process', process.pid),
  ] };
}

function summarize(sections) {
  const counts = { ok: 0, warn: 0, unavailable: 0 };
  for (const section of sections) for (const item of section.items) counts[item.status] += 1;
  return counts;
}

// Collects the plugin self-health snapshot. `options` is the serving
// option bag: projectRoot/projectId bind the project store section; the rest
// is read from the plugin package this module ships in. Tests may inject
// pluginRoot/repoRoot/exec/now to point the same observations at a fixture
// tree or a bounded probe. The only typed refusals are malformed bindings
// (INVALID_PROJECT_ROOT / INVALID_PLUGIN_ROOT); every per-fact failure is an
// honest warn/unavailable item, never a thrown error and never a fake zero.
export async function collectProjectHealth(options = {}, actor) {
  const pluginRoot = options.pluginRoot ?? DEFAULT_PLUGIN_ROOT;
  if (!absolute(pluginRoot)) throw new HealthCollectorError('INVALID_PLUGIN_ROOT');
  const repoRoot = options.repoRoot ?? dirname(pluginRoot);
  if (!absolute(repoRoot)) throw new HealthCollectorError('INVALID_REPO_ROOT');
  const now = options.now ? options.now() : Date.now();
  const sections = [
    await collectPluginPackage(pluginRoot),
    await collectEntryPoints(pluginRoot, repoRoot),
    await collectMcpTools(pluginRoot),
    await collectHooks(pluginRoot),
    await collectSkills(pluginRoot),
    await collectRuntimes(options),
    await collectVendorIntegrity(pluginRoot, repoRoot),
    await collectProjectStore(options),
    collectServiceProcess(now),
  ];
  void actor;
  const summary = summarize(sections);
  return {
    schema: HEALTH_SNAPSHOT_SCHEMA,
    observed_at: new Date(now).toISOString(),
    collector: HEALTH_COLLECTOR,
    subject: { plugin: 'lazybuddy', root: pluginRoot },
    summary,
    sections,
    inventory: await collectPackageInventory({ pluginRoot, runtime: 'LazyBuddy' }),
  };
}
