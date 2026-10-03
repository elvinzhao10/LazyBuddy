#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { verifyFloor } from './shared/floor-runner.mjs';

process.exitCode = verifyFloor({
  root: fileURLToPath(new URL('..', import.meta.url)),
  defaultSurface: 'core',
  surfaces: {"core":"20.0.0"},
  exercises: {
  "package": [
    "--test",
    "tests/lifecycle-core.test.js"
  ],
  "install": [
    "--test",
    "tests/lifecycle-bootstrap.test.js"
  ],
  "onboarding": [
    "--test",
    "tests/lifecycle-entrypoint.test.js"
  ],
  "lsp-provider": []
},
});
