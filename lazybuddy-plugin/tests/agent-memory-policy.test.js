'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateAgentDirectory } = require('../scripts/validate-agent-frontmatter.js');
const agents = path.resolve(__dirname, '../agents');

function withMemory(value, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lazybuddy-memory-'));
  try {
    fs.cpSync(agents, root, { recursive: true });
    const file = path.join(root, 'lazybuddy-orchestrator.md');
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, original.replace(/^memory:.*\n/m, value === undefined ? '' : `memory: ${value}\n`));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const scope of ['user', 'project', 'local', undefined]) {
  test(`native agent memory accepts ${scope ?? 'omission'}`, () => {
    withMemory(scope, (root) => {
      const report = validateAgentDirectory(root);
      assert.equal(report.agents.find((agent) => agent.name === 'lazybuddy-orchestrator').memory, scope);
    });
  });
}

for (const value of ['true', 'false', 'global']) {
  test(`native agent memory rejects ${value}`, () => {
    withMemory(value, (root) => assert.throws(() => validateAgentDirectory(root), /memory/));
  });
}
