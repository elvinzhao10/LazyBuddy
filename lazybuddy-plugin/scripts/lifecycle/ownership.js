'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { LifecycleError } = require('./errors');
const { safeFile } = require('./files');
const { contained } = require('./paths');

const ORIGINS = {
  LazyTrae: 'https://github.com/elvinzhao10/LazyTrae.git',
  LazyBuddy: 'https://github.com/elvinzhao10/LazyBuddy.git',
};

function verifyProjectDeclarations(receipt) {
  for (const declaration of receipt.registered_project_declarations) {
    const target = path.resolve(declaration.project_root, declaration.path);
    const file = contained(declaration.project_root, target) ? safeFile(target) : null;
    const digest = file && crypto.createHash('sha256').update(file.bytes).digest('hex');
    if (digest !== declaration.managed_entry_sha256) {
      throw new LifecycleError('OWNERSHIP_REFUSED', `project declaration changed: ${target}`);
    }
  }
}

module.exports = { ORIGINS, verifyProjectDeclarations };
