import { createHash } from 'node:crypto';
import {
  ARTIFACT_FILE_LIMIT, IMAGE_MIME, PREVIEW_IMAGE_LIMIT, PREVIEW_TEXT_LIMIT, readArtifactFile,
} from './paths.mjs';

// Safe artifact previews. Rendered output is JSON data only: text arrives as string
// values that consumers must treat as inert content, never as markup to execute.
// Untrusted Markdown is content, not permission to run commands or widen access.

const sha256Bytes = bytes => createHash('sha256').update(bytes).digest('hex');
const DANGEROUS_BLOCK = /<\s*(script|iframe|object|embed|style|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DANGEROUS_VOID = /<\s*(?:script|iframe|object|embed|style|svg|math)\b[^>]*\/?>/gi;
const ANY_TAG = /<\s*\/?\s*[A-Za-z][^>]*>/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\(\s*([^)\s]+)\s*(?:"[^"]*"|'[^']*')?\)/g;
const UNSAFE_URL_SCHEME = /^\s*(?:javascript|vbscript|data):/i;

export function previewProfile(relativePath) {
  const name = relativePath.toLowerCase().split('/').pop() ?? '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (extension === '.md' || extension === '.markdown') return { kind: 'markdown', mime: null };
  if (IMAGE_MIME.has(extension)) return { kind: 'image', mime: IMAGE_MIME.get(extension) };
  if (extension === '.json') return { kind: 'json', mime: 'application/json' };
  if (extension === '.txt' || extension === '.log') return { kind: 'text', mime: 'text/plain' };
  return { kind: null, mime: null };
}

function stripTags(text, report) {
  return text.replace(ANY_TAG, () => { report.removed_html_tags += 1; return ''; });
}

function inlineSanitize(text, report) {
  let value = stripTags(text, report);
  value = value.replace(MARKDOWN_LINK, (match, label, href) => {
    if (UNSAFE_URL_SCHEME.test(href)) {
      report.removed_js_urls += 1;
      return label;
    }
    report.links.push({ text: label, href });
    return label;
  });
  return value;
}

// Splits fenced code regions out first so their bytes stay verbatim data, then removes
// whole dangerous elements (including their bodies) from the remaining prose.
function segment(source) {
  const segments = [];
  let prose = [];
  let fence = null;
  let code = [];
  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        segments.push({ kind: 'code', text: code.join('\n') });
        code = []; fence = null;
      } else code.push(line);
      continue;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      if (prose.length) { segments.push({ kind: 'prose', lines: prose }); prose = []; }
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    prose.push(line);
  }
  if (fence && code.length) segments.push({ kind: 'code', text: code.join('\n') });
  if (prose.length) segments.push({ kind: 'prose', lines: prose });
  return segments;
}

export function sanitizeMarkdown(source) {
  const report = { removed_html_tags: 0, removed_script_blocks: 0, removed_js_urls: 0, links: [] };
  const blocks = [];
  const emitProse = lines => {
    let paragraph = [];
    const flush = () => {
      if (paragraph.length) {
        const text = paragraph.join(' ').trim();
        if (text) blocks.push({ type: 'paragraph', text });
        paragraph = [];
      }
    };
    for (const raw of lines) {
      const bare = raw.trim();
      if (!bare) { flush(); continue; }
      let line = bare.replace(DANGEROUS_BLOCK, (match, tag) => {
        report.removed_script_blocks += 1;
        return '';
      });
      line = line.replace(DANGEROUS_VOID, () => { report.removed_script_blocks += 1; return ''; });
      line = stripTags(line, report);
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, text: inlineSanitize(heading[2], report).trim() }); continue; }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) { flush(); blocks.push({ type: 'quote', text: inlineSanitize(quote[1], report).trim() }); continue; }
      const item = line.match(/^[-*+]\s+(.*)$/) ?? line.match(/^\d+[.)]\s+(.*)$/);
      if (item) { flush(); blocks.push({ type: 'list_item', text: inlineSanitize(item[1], report).trim() }); continue; }
      paragraph.push(inlineSanitize(line, report).trim());
    }
    flush();
  };
  for (const part of segment(source)) {
    if (part.kind === 'code') {
      if (part.text.trim()) blocks.push({ type: 'code', text: part.text });
    } else emitProse(part.lines);
  }
  return { sanitized: true, blocks, sanitization: report };
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function renderArtifactPreview(root, entry) {
  const original = { path: entry.path, link: entry.path };
  const profile = previewProfile(entry.path);
  const base = { artifact_id: entry.id, source_path: entry.path, original, status: entry.status, sanitized: true };
  if (entry.status !== 'available') {
    return { ...base, kind: profile.kind, available: false, reason: `artifact_${entry.status}` };
  }
  if (!profile.kind) return { ...base, kind: null, available: false, reason: 'unsupported_preview_kind' };
  if (profile.kind === 'image') {
    if (entry.bytes > PREVIEW_IMAGE_LIMIT) {
      return { ...base, kind: 'image', available: false, reason: 'image_too_large', total_bytes: entry.bytes };
    }
    const { bytes } = await readArtifactFile(root, entry.path, PREVIEW_IMAGE_LIMIT);
    return { ...base, kind: 'image', available: true,
      image: { mime: profile.mime, bytes: bytes.length, sha256: sha256Bytes(bytes),
        data_url: `data:${profile.mime};base64,${bytes.toString('base64')}` } };
  }
  const { bytes } = await readArtifactFile(root, entry.path, ARTIFACT_FILE_LIMIT);
  const totalBytes = bytes.length;
  if (profile.kind === 'markdown') {
    const rendered = sanitizeMarkdown(bytes.toString('utf8'));
    return { ...base, kind: 'markdown', available: true, ...rendered, total_bytes: totalBytes };
  }
  if (profile.kind === 'json') {
    try {
      const parsed = JSON.parse(bytes.toString('utf8'));
      let canonical = canonicalJSON(parsed);
      const truncated = canonical.length > PREVIEW_TEXT_LIMIT;
      if (truncated) canonical = canonical.slice(0, PREVIEW_TEXT_LIMIT);
      return { ...base, kind: 'json', available: true, total_bytes: totalBytes,
        json: { canonical, truncated, total_bytes: totalBytes } };
    } catch {
      const text = bytes.subarray(0, PREVIEW_TEXT_LIMIT).toString('utf8');
      return { ...base, kind: 'json', available: true, total_bytes: totalBytes, parse_error: 'INVALID_JSON',
        text: { content: text, truncated: totalBytes > PREVIEW_TEXT_LIMIT, total_bytes: totalBytes } };
    }
  }
  const text = bytes.subarray(0, PREVIEW_TEXT_LIMIT).toString('utf8');
  return { ...base, kind: 'text', available: true, total_bytes: totalBytes,
    text: { content: text, truncated: totalBytes > PREVIEW_TEXT_LIMIT, total_bytes: totalBytes } };
}
