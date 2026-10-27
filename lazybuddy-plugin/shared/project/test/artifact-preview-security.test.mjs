import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArtifactPreview, sanitizeMarkdown } from '../artifacts/preview.mjs';

for (const [name, source] of [
  ['nested deletion', '<scr<script>discard</script>ipt>payload</script>'],
  ['repeated nested deletion', '<scr<scr<script>discard</script>ipt>discard</script>ipt>payload</script>'],
  ['unterminated opening tag', '<script src="payload"'],
  ['multiline dangerous block', '<script>\npayload\n</script>'],
  ['nested mixed-case tag', '<ScR<iframe>discard</iframe>iPt>payload</sCrIpT>'],
]) {
  test(`markdown omits dangerous prose when given ${name}`, () => {
    const preview = sanitizeMarkdown(`# Before\n${source}\n# After`);
    assert.deepEqual(preview.blocks, [
      { type: 'heading', level: 1, text: 'Before' },
      { type: 'heading', level: 1, text: 'After' },
    ]);
  });
}

test('markdown preserves encoded payloads and fenced examples as literal data', () => {
  const encoded = '&lt;script&gt;payload&lt;/script&gt; &#60;img src=x onerror=payload&#62;';
  const code = '<script>payload</script>\n[link](javascript:payload)';
  const preview = sanitizeMarkdown(`${encoded}\n\n\`\`\`html\n${code}\n\`\`\``);
  assert.deepEqual(preview.blocks, [
    { type: 'paragraph', text: encoded },
    { type: 'code', text: code },
  ]);
});

for (const [name, source] of [
  ['nested reconstruction', '<scr'.repeat(1000) + '<script>x</script>' + 'ipt>'.repeat(1000)],
  ['unterminated starts', '<script>'.repeat(1000)],
  ['large tagged prose', '<script>' + 'x'.repeat(65536)],
]) {
  test(`markdown refuses excessive ${name} before stripping`, () => {
    const preview = sanitizeMarkdown(source);
    assert.equal(preview.available, false);
    assert.equal(preview.reason, 'markdown_complexity_limit');
    assert.deepEqual(preview.blocks, []);
    assert.equal(preview.sanitization.removed_script_blocks, 0);
    assert.equal(preview.sanitization.removed_html_tags, 0);
  });
}

test('markdown preserves ordinary counters at the markup complexity boundary', () => {
  const preview = sanitizeMarkdown('<script>x</script>'.repeat(64));
  assert.equal(preview.reason, undefined);
  assert.deepEqual(preview.blocks, []);
  assert.equal(preview.sanitization.removed_script_blocks, 64);
});

test('markdown complexity guard excludes verbatim fenced examples', () => {
  const code = '<script>'.repeat(1000);
  const preview = sanitizeMarkdown('```html\n' + code + '\n```');
  assert.deepEqual(preview.blocks, [{ type: 'code', text: code }]);
});

test('markdown keeps large markup-free prose available', () => {
  const text = 'x'.repeat(65537);
  const preview = sanitizeMarkdown(text);
  assert.equal(preview.reason, undefined);
  assert.deepEqual(preview.blocks, [{ type: 'paragraph', text }]);
});

test('artifact preview exposes the complexity refusal instead of a partial available preview', async () => {
  const bytes = Buffer.from('<script>'.repeat(129));
  const preview = await renderArtifactPreview('/unused', {
    id: 'artifact:complex', path: 'docs/complex.md', status: 'available', bytes: bytes.length,
  }, { readFile: async () => ({ bytes }) });
  assert.equal(preview.available, false);
  assert.equal(preview.reason, 'markdown_complexity_limit');
  assert.deepEqual(preview.blocks, []);
  assert.equal(preview.original.link, 'docs/complex.md');
});

for (const source of ['['.repeat(80000), '[x]('.repeat(20000)]) {
  test(`markdown refuses an unresolved delimiter run starting ${source.slice(0, 4)}`, () => {
    const preview = sanitizeMarkdown(source);
    assert.equal(preview.available, false);
    assert.equal(preview.reason, 'markdown_complexity_limit');
    assert.deepEqual(preview.blocks, []);
    assert.deepEqual(preview.sanitization.links, []);
  });
}

test('markdown keeps many ordinary checkbox items and links', () => {
  const preview = sanitizeMarkdown('- [ ] [item](https://example.com/item)\n'.repeat(3000));
  assert.equal(preview.reason, undefined);
  assert.equal(preview.blocks.length, 3000);
  assert.equal(preview.blocks[0].text, '[ ] item');
  assert.equal(preview.sanitization.links.length, 3000);
  assert.deepEqual(preview.sanitization.links[0], { text: 'item', href: 'https://example.com/item' });
});

test('markdown refuses a long unresolved destination even below the delimiter-count limit', () => {
  const preview = sanitizeMarkdown('[x](' + 'x'.repeat(65537));
  assert.equal(preview.available, false);
  assert.equal(preview.reason, 'markdown_complexity_limit');
  assert.deepEqual(preview.blocks, []);
});

test('markdown sanitizes bounded soft lines before joining their literal paragraph text', () => {
  const line = '['.repeat(128);
  const preview = sanitizeMarkdown(Array(1000).fill(line).join('\n'));
  assert.equal(preview.reason, undefined);
  assert.deepEqual(preview.blocks, [{ type: 'paragraph', text: Array(1000).fill(line).join(' ') }]);
  assert.deepEqual(preview.sanitization.links, []);
});
