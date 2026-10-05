import { lstat, realpath, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

export class ServiceError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const protectedServiceArtifact = reference => typeof reference === 'string' &&
  reference.split('/').slice(0, 2).map(part => part.toLowerCase()).join('/') === '.lazybuddy/dashboard';
export async function canonicalDirectory(path) {
  if (typeof path !== 'string' || !path.startsWith(sep) || resolve(path) !== path) throw new ServiceError('CANONICAL_DIRECTORY_REQUIRED');
  let current = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ServiceError('UNSAFE_DIRECTORY');
  }
  if (await realpath(path) !== path) throw new ServiceError('UNSAFE_DIRECTORY');
  return path;
}
export async function privateDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await canonicalDirectory(path);
  const stat = await lstat(path);
  if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new ServiceError('PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
export async function safeRead(root, name, limit = 8 * 1024 * 1024) {
  if (typeof name !== 'string' || name.length > 1024 || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) throw new ServiceError('UNSAFE_REFERENCE', 409);
  const helper = fileURLToPath(new URL('./service-read.py', import.meta.url));
  return new Promise((resolveRead, reject) => {
    execFile('python3', [helper, root, name, String(limit)], { encoding: 'buffer', maxBuffer: limit + 1024, timeout: 5000 }, (error, stdout) => {
      if (error) reject(new ServiceError('UNSAFE_REFERENCE', 409)); else resolveRead(stdout);
    });
  });
}
export async function privateRead(root, name) {
  const bytes = await safeRead(root, name, 65536);
  const stat = await lstat(join(root, name));
  if ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new ServiceError('PRIVATE_FILE_REQUIRED');
  return bytes;
}
