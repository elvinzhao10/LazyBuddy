import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoots = new Set(['.lazybuddy', '.lazytrae', '.lazyqoder', '.lazyzcode', '.lazykimi', '.lazydeepseek']);
const hash = value => createHash('sha256').update(value).digest('hex');
function git(root, args) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}
function sample(root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const tracked = git(root, ['ls-files', '-z']);
  const others = git(root, ['ls-files', '-z', '--others', '--exclude-standard']);
  if (!head || !tracked || !others) return null;
  const files = [...new Set(Buffer.concat([tracked, others]).toString('utf8').split('\0').filter(Boolean))]
    .filter(name => !runtimeRoots.has(name.split('/')[0])).sort();
  if (files.length > 5000) return null;
  const entries = []; let total = 0;
  for (const name of files) {
    const parts = name.split('/');
    if (path.isAbsolute(name) || parts.some(part => part === '..' || part === '.git')) return null;
    let absolute = root;
    for (const part of parts) {
      absolute = path.join(absolute, part);
      try { if (lstatSync(absolute).isSymbolicLink()) return null; }
      catch (error) { if (error.code !== 'ENOENT') throw error; absolute = null; break; }
    }
    if (!absolute) { entries.push([name, null]); continue; }
    if (!lstatSync(absolute).isFile()) return null;
    const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd); total += stat.size;
      if (!stat.isFile() || total > 32 * 1024 * 1024) return null;
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) {
        const read = readSync(fd, bytes, length, bytes.length - length, null);
        if (!read) break; length += read;
      }
      const after = fstatSync(fd);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) return null;
      entries.push([name, stat.mode & 0o111, hash(bytes.subarray(0, length))]);
    } finally { closeSync(fd); }
  }
  return hash(JSON.stringify({ root, head: head.toString('utf8').trim(), entries }));
}

export function captureReviewSource(repositoryRoot) {
  try {
    const root = realpathSync(repositoryRoot); const first = sample(root);
    return first && first === sample(root) ? first : null;
  } catch (error) {
    if (['ENOENT', 'EACCES', 'ELOOP', 'ENOTDIR', 'EINVAL'].includes(error.code)) return null;
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(captureReviewSource(process.argv[2]))}\n`);
}
