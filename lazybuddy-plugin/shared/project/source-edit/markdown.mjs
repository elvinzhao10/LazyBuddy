import { createHash } from 'node:crypto';
import { fail } from '../contract.mjs';

// Line-addressed Markdown model for registered original documents. Edits splice
// only their target lines, so fenced examples and unrelated prose keep their
// exact bytes, and every line keeps its original ending.
const FENCE_MARKER = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_MARKER = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/;
const TASK_MARKER = /^([ \t]*)([-*+]|\d+[.])([ \t]+)\[( |x|X)\]([ \t]*)(.*)$/;

const sha256Text = value => createHash('sha256').update(value, 'utf8').digest('hex');

export function normalizeHeadingTitle(title) {
  return String(title).replace(/\s+/g, ' ').trim();
}

export function headingFingerprint(title) {
  return sha256Text(normalizeHeadingTitle(title));
}

export function parseDocument(content) {
  if (typeof content !== 'string') fail('INVALID_VALUE', 'A source document must be text');
  const lines = []; const headings = []; const fences = []; const tasks = [];
  let fence = null; let fenceFrom = -1; let offset = 0;
  const raw = content.match(/[^\n]*(?:\n|$)/g) ?? [];
  // A trailing newline yields one phantom empty match; it is the last line's
  // ending, not a line, so structural moves never manufacture blank lines.
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index];
    const eol = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
    const text = line.slice(0, line.length - eol.length);
    lines.push({ text, eol, start: offset });
    const marker = text.match(FENCE_MARKER);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        fences.push({ from: fenceFrom, to: index }); fence = null;
      }
    } else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length }; fenceFrom = index;
    } else {
      const heading = text.match(HEADING_MARKER);
      if (heading) {
        const title = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
        if (title) headings.push({ level: heading[1].length, title, lineIndex: index, start: offset });
      }
      const task = text.match(TASK_MARKER);
      if (task) tasks.push({ lineIndex: index, indent: task[1], marker: task[2], gap: task[3],
        checked: task[4] !== ' ', box: task[4], gapAfterBox: task[5], text: task[6] });
    }
    offset += line.length;
  }
  if (fence) fences.push({ from: fenceFrom, to: lines.length - 1 });
  let crlf = 0; let bare = 0;
  for (const line of lines) { if (line.eol === '\r\n') crlf += 1; else if (line.eol === '\n') bare += 1; }
  return { content, lines, headings, fences, tasks, dominantEol: crlf > bare ? '\r\n' : '\n' };
}

export function renderDocument(document) {
  return document.lines.map(line => line.text + line.eol).join('');
}

export function sectionsOf(document) {
  return document.headings.map((heading, index) => {
    const next = document.headings.find(candidate =>
      candidate.lineIndex > heading.lineIndex && candidate.level <= heading.level);
    return { headingIndex: index, heading, startLine: heading.lineIndex,
      endLine: next ? next.lineIndex : document.lines.length };
  });
}

// After a structural move, only the end-of-file line may keep an empty ending;
// a line pulled into the middle adopts the document's dominant ending.
export function repairLineEndings(document) {
  for (let index = 0; index < document.lines.length - 1; index += 1) {
    if (document.lines[index].eol === '') document.lines[index].eol = document.dominantEol;
  }
}

// The formatting-insensitive skeleton: fenced segments stay byte-significant,
// everything else only whitespace-normalized. Equal skeletons mean a change
// outside fences was formatting-only; any other difference is material.
export function skeletonText(content) {
  const document = parseDocument(content);
  const fenced = new Set();
  for (const fence of document.fences) {
    for (let index = fence.from; index <= fence.to; index += 1) fenced.add(index);
  }
  const parts = []; let prose = [];
  const flush = () => {
    if (prose.length) parts.push('\u0001' + prose.join(' ').replace(/\s+/g, ' ').trim());
    prose = [];
  };
  for (let index = 0; index < document.lines.length; index += 1) {
    if (fenced.has(index)) { flush(); parts.push('\u0002' + document.lines[index].text); }
    else prose.push(document.lines[index].text);
  }
  flush();
  return parts.join('');
}

export function skeletonDigest(content) {
  return sha256Text(skeletonText(content));
}

export function fenceSpans(content) {
  const document = parseDocument(content);
  return document.fences.map(fence => ({
    start: document.lines[fence.from].start,
    end: (document.lines[fence.to].start + document.lines[fence.to].text.length),
    text: document.lines.slice(fence.from, fence.to + 1).map(line => line.text).join('\n'),
  }));
}

// Import-anchor reading shared with the pure model. Ambiguous anchors fail closed.
export function headings(content) {
  const document = parseDocument(content);
  return document.headings.map(heading => ({ title: heading.title, level: heading.level,
    start: document.lines[heading.lineIndex].start }));
}

export function extractSourceAnchor(content, anchorId, sourcePath = 'document.md') {
  if (typeof content !== 'string' || typeof anchorId !== 'string') fail('INVALID_ANCHOR', 'Source content and anchor must be text');
  const entries = headings(content);
  if (anchorId === 'document') {
    if (!content.trim()) fail('EMPTY_SOURCE', 'An empty source cannot establish project intent');
    return { title: entries[0]?.title ?? sourcePath.split('/').pop(), text: content };
  }
  if (!anchorId.startsWith('heading:') || !anchorId.slice(8).trim()) fail('INVALID_ANCHOR', 'Unsupported source anchor');
  const matches = entries.filter(entry => entry.title === anchorId.slice(8));
  if (!matches.length) fail('ANCHOR_NOT_FOUND', 'The requested heading was not found');
  if (matches.length !== 1) fail('AMBIGUOUS_ANCHOR', 'The requested heading is not unique');
  const selected = matches[0];
  const next = entries.find(entry => entry.start > selected.start && entry.level <= selected.level);
  return { title: selected.title, text: content.slice(selected.start, next?.start ?? content.length) };
}

// Unified patch from a line-origin map: null origins (and lines whose bytes or
// order changed) are additions; originals never consumed are deletions. A move
// therefore renders as its delete and insert parts.
export function buildPatch(sourcePath, original, final, origin, contextLines = 3) {
  const before = parseDocument(original);
  const after = parseDocument(final);
  const tokens = [];
  const consumed = new Map();
  let lastConsumed = -1;
  for (let index = 0; index < after.lines.length; index += 1) {
    const candidate = origin[index];
    if (candidate === null || candidate === undefined || candidate <= lastConsumed) continue;
    const source = before.lines[candidate];
    if (!source || source.text !== after.lines[index].text || source.eol !== after.lines[index].eol) continue;
    consumed.set(candidate, index); lastConsumed = candidate;
  }
  let finalIndex = 0;
  for (let originalIndex = 0; originalIndex < before.lines.length; originalIndex += 1) {
    if (consumed.has(originalIndex)) {
      const target = consumed.get(originalIndex);
      while (finalIndex < target) tokens.push({ kind: 'add', final: finalIndex++ });
      tokens.push({ kind: 'same', original: originalIndex, final: finalIndex++ });
    } else tokens.push({ kind: 'delete', original: originalIndex });
  }
  while (finalIndex < after.lines.length) tokens.push({ kind: 'add', final: finalIndex++ });

  // Complete both coordinates so hunk headers stay exact for pure insertions.
  let priorOriginal = -1; let priorFinal = -1;
  for (const token of tokens) {
    if (token.kind === 'add') token.position = priorOriginal + 1;
    else token.position = priorFinal + 1;
    if (token.kind === 'same') { priorOriginal = token.original; priorFinal = token.final; }
    if (token.kind === 'delete') priorOriginal = token.original;
    if (token.kind === 'add') priorFinal = token.final;
  }
  const changes = tokens.map((token, index) => token.kind === 'same' ? -1 : index).filter(index => index >= 0);
  const header = `--- ${sourcePath}\n+++ ${sourcePath}\n`;
  if (!changes.length) return header;
  const hunks = [];
  let firstChange = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const gap = index + 1 < changes.length ? changes[index + 1] - changes[index] - 1 : Infinity;
    if (gap > 2 * contextLines || index + 1 === changes.length) {
      const from = Math.max(0, changes[firstChange] - contextLines);
      const to = Math.min(tokens.length - 1, changes[index] + contextLines);
      hunks.push(tokens.slice(from, to + 1));
      firstChange = index + 1;
    }
  }
  return header + hunks.map(hunk => renderHunk(hunk, before, after)).join('');
}

function renderHunk(hunk, before, after) {
  let originalCount = 0; let finalCount = 0;
  for (const token of hunk) {
    if (token.kind === 'delete') originalCount += 1;
    else if (token.kind === 'add') finalCount += 1;
    else { originalCount += 1; finalCount += 1; }
  }
  const first = hunk[0];
  const originalAt = first.kind === 'add' ? first.position : first.original;
  const finalAt = first.kind === 'delete' ? first.position : first.final;
  const originalLabel = originalCount === 0 ? originalAt : originalAt + 1;
  const finalLabel = finalCount === 0 ? finalAt : finalAt + 1;
  const lines = [];
  for (const token of hunk) {
    if (token.kind === 'delete') {
      const line = before.lines[token.original];
      lines.push('-' + line.text + (line.eol ? '' : '\n\\ No newline at end of file'));
    } else if (token.kind === 'add') {
      const line = after.lines[token.final];
      lines.push('+' + line.text + (line.eol ? '' : '\n\\ No newline at end of file'));
    } else lines.push(' ' + before.lines[token.original].text);
  }
  return `@@ -${originalLabel},${originalCount} +${finalLabel},${finalCount} @@\n` +
    lines.join('\n') + '\n';
}
