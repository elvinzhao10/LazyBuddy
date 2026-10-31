import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createEvidenceDirectory(t, configuredDirectory) {
  if (configuredDirectory != null) return configuredDirectory;
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
