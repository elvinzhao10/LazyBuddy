'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_NAMES = new Set([
  'lazybuddy-context-indexer', 'lazybuddy-context-miner', 'lazybuddy-explorer', 'lazybuddy-gate-reviewer',
  'lazybuddy-implementer', 'lazybuddy-librarian', 'lazybuddy-migration-planner', 'lazybuddy-orchestrator',
  'lazybuddy-planner', 'lazybuddy-qa-executor', 'lazybuddy-reviewer', 'lazybuddy-security-auditor',
  'lazybuddy-verifier',
]);
const REQUIRED_FIELDS = new Set([
  'name', 'description', 'model', 'effort', 'maxTurns', 'tools', 'disallowedTools', 'skills', 'memory',
]);
const ALLOWED_FIELDS = new Set([...REQUIRED_FIELDS, 'isolation']);
const WORKTREE_NAMES = new Set(['lazybuddy-implementer', 'lazybuddy-orchestrator']);
const READONLY_NAMES = new Set([
  'lazybuddy-context-miner', 'lazybuddy-explorer', 'lazybuddy-gate-reviewer', 'lazybuddy-planner',
  'lazybuddy-reviewer', 'lazybuddy-security-auditor', 'lazybuddy-verifier',
]);
const MODELS = new Set(['lite', 'default', 'reasoning']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

class AgentPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentPolicyError';
  }
}

function refuse(message) {
  throw new AgentPolicyError(message);
}

function parseScalar(raw, filename, lineNumber) {
  const value = raw.trim();
  if (!value) refuse(`${filename}:${lineNumber}: scalar value is required`);
  if (value === '[]') return [];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value.startsWith('"') || value.startsWith("'")) refuse(`${filename}:${lineNumber}: unterminated quoted scalar`);
  return value;
}

function parseFrontmatter(text, filename) {
  if (!text.startsWith('---\n')) refuse(`${filename}: frontmatter must start with ---`);
  const closing = text.indexOf('\n---\n', 4);
  if (closing < 0) refuse(`${filename}: frontmatter closing delimiter is missing`);
  const data = {};
  let activeList = null;
  for (const [offset, line] of text.slice(4, closing).split('\n').entries()) {
    const lineNumber = offset + 2;
    if (!line) continue;
    if (line.startsWith('  - ')) {
      if (!activeList) refuse(`${filename}:${lineNumber}: list item without a list field`);
      const item = line.slice(4).trim();
      if (!item) refuse(`${filename}:${lineNumber}: list item is empty`);
      data[activeList].push(item);
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(line);
    if (!match) refuse(`${filename}:${lineNumber}: unsupported YAML syntax`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(data, key)) refuse(`${filename}:${lineNumber}: duplicate field ${key}`);
    if (rawValue.trim()) {
      data[key] = parseScalar(rawValue, filename, lineNumber);
      activeList = null;
    } else {
      data[key] = [];
      activeList = key;
    }
  }
  return { body: text.slice(closing + 5), data };
}

function requireString(value, field, filename, accepted) {
  if (typeof value !== 'string' || !value) refuse(`${filename}: ${field} must be a non-empty string`);
  if (accepted && !accepted.has(value)) refuse(`${filename}: unsupported ${field} ${value}`);
}

function requireList(value, field, filename, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some((item) => typeof item !== 'string' || !item)) {
    refuse(`${filename}: ${field} must be a${allowEmpty ? '' : ' non-empty'} string list`);
  }
  if (new Set(value).size !== value.length) refuse(`${filename}: ${field} must not contain duplicates`);
}

function validateAgent(filePath) {
  const filename = path.basename(filePath);
  const entry = fs.lstatSync(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) refuse(`${filename}: agent definition must be a regular file`);
  const { body, data } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'), filename);
  for (const key of Object.keys(data)) if (!ALLOWED_FIELDS.has(key)) refuse(`${filename}: unsupported frontmatter field ${key}`);
  for (const field of REQUIRED_FIELDS) if (!Object.hasOwn(data, field)) refuse(`${filename}: required field ${field} is missing`);
  requireString(data.name, 'name', filename);
  requireString(data.description, 'description', filename);
  requireString(data.model, 'model', filename, MODELS);
  requireString(data.effort, 'effort', filename, EFFORTS);
  if (!Number.isSafeInteger(data.maxTurns) || data.maxTurns <= 0) refuse(`${filename}: maxTurns must be a positive integer`);
  requireList(data.tools, 'tools', filename);
  requireList(data.disallowedTools, 'disallowedTools', filename, true);
  requireList(data.skills, 'skills', filename);
  if (typeof data.memory !== 'boolean') refuse(`${filename}: memory must be a boolean`);
  if (data.name !== filename.slice(0, -3)) refuse(`${filename}: name must match filename`);
  if (!EXPECTED_NAMES.has(data.name)) refuse(`${filename}: unexpected agent name ${data.name}`);
  if (Object.hasOwn(data, 'isolation') && data.isolation !== 'worktree') refuse(`${filename}: isolation must be the string worktree`);
  if (WORKTREE_NAMES.has(data.name)) {
    if (data.isolation !== 'worktree') refuse(`${filename}: ${data.name} requires isolation: worktree`);
  } else if (Object.hasOwn(data, 'isolation')) {
    refuse(`${filename}: only implementer and orchestrator may declare isolation`);
  }
  if (READONLY_NAMES.has(data.name)) {
    if (data.tools.includes('Write') || data.tools.includes('Edit')) refuse(`${filename}: read-only role must not expose Write or Edit`);
    if (!data.disallowedTools.includes('Write') || !data.disallowedTools.includes('Edit')) refuse(`${filename}: read-only role must deny Write and Edit`);
  }
  if (data.name === 'lazybuddy-implementer' && (!data.tools.includes('Write') || !data.tools.includes('Edit'))) {
    refuse(`${filename}: implementer must retain Write and Edit`);
  }
  if (data.name === 'lazybuddy-orchestrator'
    && (!body.includes('Subagents return a DoneClaim') || !body.includes('task-owned git worktree') || !body.includes('merge'))) {
    refuse(`${filename}: orchestrator worktree role requires an explicit return and merge path`);
  }
  return { ...data, file: filename };
}

function validateAgentDirectory(agentsDir) {
  const directory = path.resolve(agentsDir);
  const entry = fs.lstatSync(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) refuse('agents directory must be a real directory');
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.md')).sort();
  if (files.length !== EXPECTED_NAMES.size) refuse(`agents directory must contain ${EXPECTED_NAMES.size} Markdown files`);
  const agents = files.map((file) => validateAgent(path.join(directory, file)));
  const names = new Set(agents.map((agent) => agent.name));
  if (names.size !== agents.length) refuse('agent names must be unique');
  for (const expectedName of EXPECTED_NAMES) if (!names.has(expectedName)) refuse(`agents directory is missing ${expectedName}`);
  return { agents };
}

function main(argv) {
  const args = argv.slice(2);
  const agentsDir = args.length === 0 ? path.join(__dirname, '..', 'agents') : args.length === 2 && args[0] === '--agents-dir' ? args[1] : null;
  if (!agentsDir) {
    process.stderr.write('usage: validate-agent-frontmatter.js [--agents-dir <directory>]\n');
    return 2;
  }
  try {
    const report = validateAgentDirectory(agentsDir);
    process.stdout.write(`${JSON.stringify({ ok: true, agents: report.agents })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code: 'AGENT_POLICY_INVALID', message: error.message } })}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { AgentPolicyError, parseFrontmatter, validateAgentDirectory };
