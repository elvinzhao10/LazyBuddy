import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { assertRelativeSourcePath } from '../contract.mjs';

// Artifact path policy and bounded, symlink-refusing reads for the evidence index.
// The relative-path rules themselves are the shared project contract's, reused verbatim,
// so registration refusals match the model/CLI boundary codes exactly.

export const ARTIFACT_FILE_LIMIT = 8 * 1024 * 1024;
export const PREVIEW_IMAGE_LIMIT = 2 * 1024 * 1024;
export const PREVIEW_TEXT_LIMIT = 64 * 1024;
export const ARTIFACT_PATH_LIMIT = 1024;
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
export const EVIDENCE_DIRECTORIES = Object.freeze(['artifacts', 'evidence', 'verification']);
export const SCAN_FILE_BUDGET = 4096;
export const SCAN_DEPTH_LIMIT = 8;

export const IMAGE_MIME = Object.freeze(new Map([
  ['.bmp', 'image/bmp'], ['.gif', 'image/gif'], ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'],
]));

export class ArtifactIndexError extends Error {
  constructor(code, message = code) { super(message); this.name = 'ArtifactIndexError'; this.code = code; }
}
export const artifactFail = (code, message) => { throw new ArtifactIndexError(code, message); };

// Reuses the contract's protected-path rules (relative-only, no traversal, no `.git`,
// no `.lazybuddy/{dashboard,project}` native storage) and additionally protects the
// neutral `.lazyseries` registry namespace, which is identity storage, not evidence.
export function assertRegistrableArtifactPath(value, label = 'artifact.path') {
  if (typeof value !== 'string' || !value.length || value.length > ARTIFACT_PATH_LIMIT || value.includes('\0')) {
    artifactFail('UNSAFE_ARTIFACT_PATH', `${label} must be bounded nonempty text`);
  }
  assertRelativeSourcePath(value, label);
  if (value.toLowerCase().split('/')[0] === '.lazyseries') {
    artifactFail('PROTECTED_ARTIFACT_PATH', `${label} is protected neutral registry storage`);
  }
  return value;
}

export async function readArtifactFile(root, relative, limit = ARTIFACT_FILE_LIMIT) {
  if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) {
    artifactFail('UNSAFE_ROOT', 'The artifact root must be an absolute canonical path');
  }
  assertRelativeSourcePath(relative, 'artifact.path');
  let ancestor = root;
  for (const part of relative.split('/').slice(0, -1)) {
    ancestor = join(ancestor, part);
    let metadata;
    try {
      metadata = await lstat(ancestor);
    } catch (error) {
      artifactFail(error.code === 'ENOENT' ? 'ARTIFACT_MISSING' : 'ARTIFACT_INACCESSIBLE',
        'An artifact ancestor is not readable');
    }
    if (metadata.isSymbolicLink()) artifactFail('ARTIFACT_SYMLINK_REFUSED', 'An artifact ancestor is a symbolic link');
    if (!metadata.isDirectory()) artifactFail('ARTIFACT_INACCESSIBLE', 'An artifact ancestor is not a directory');
  }
  const target = join(root, relative);
  let metadata;
  try {
    metadata = await lstat(target);
  } catch (error) {
    artifactFail(error.code === 'ENOENT' ? 'ARTIFACT_MISSING' : 'ARTIFACT_INACCESSIBLE', 'The artifact is not readable');
  }
  if (metadata.isSymbolicLink()) artifactFail('ARTIFACT_SYMLINK_REFUSED', 'The artifact is a symbolic link');
  if (!metadata.isFile()) artifactFail('ARTIFACT_INACCESSIBLE', 'The artifact is not a regular file');
  if (metadata.size > limit) artifactFail('ARTIFACT_TOO_LARGE', `The artifact exceeds the ${limit}-byte read limit`);
  const handle = await open(target, 'r').catch(() =>
    artifactFail('ARTIFACT_INACCESSIBLE', 'The artifact cannot be opened'));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.ino !== metadata.ino || before.size !== metadata.size) {
      artifactFail('ARTIFACT_CHANGED', 'The artifact was replaced while being read');
    }
    if (before.size > limit) artifactFail('ARTIFACT_TOO_LARGE', `The artifact exceeds the ${limit}-byte read limit`);
    const bytes = Buffer.alloc(before.size);
    if (before.size) await handle.read(bytes, 0, before.size, 0);
    const after = await handle.stat();
    if (after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
      artifactFail('ARTIFACT_CHANGED', 'The artifact changed while being read');
    }
    return { bytes, size: before.size, modified_at: new Date(before.mtimeMs).toISOString() };
  } finally {
    await handle.close();
  }
}
