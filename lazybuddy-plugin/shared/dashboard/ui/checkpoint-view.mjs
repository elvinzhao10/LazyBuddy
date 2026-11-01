import { button, element } from './components.mjs';

export function createCheckpointView(onQuery) {
  const root = element('details', 'panel stack verification-checkpoints');
  root.append(element('summary', '', 'Compare archived run and plan checkpoints'));
  const body = element('div', 'stack'); const status = element('p', 'meta'); status.setAttribute('role', 'status');
  const controls = element('div', 'verification-toolbar');
  const before = document.createElement('select'); before.setAttribute('aria-label', 'Earlier run checkpoint');
  const after = document.createElement('select'); after.setAttribute('aria-label', 'Later run checkpoint');
  const output = element('div', 'stack'); let offset = 0; let total = 0;
  const label = (name, control) => { const node = element('label', 'stack'); node.append(element('span', 'meta', name), control); return node; };
  controls.append(label('Earlier run checkpoint', before), label('Later run checkpoint', after));
  const paging = element('div', 'cluster');
  async function load() {
    if (!onQuery) { status.textContent = 'Checkpoint history is unavailable on this connection.'; return; }
    try {
      const result = await onQuery({ operation: 'index', offset, limit: 25 }); total = result.total;
      for (const control of [before, after]) {
        const selected = control.value; control.replaceChildren();
        const current = element('option', '', `Current native revision ${result.revision}`); current.value = 'current'; control.append(current);
        for (const entry of result.entries) {
          const option = element('option', '', `Before revision ${entry.id} · ${entry.operation}`); option.value = String(entry.id); control.append(option);
        }
        control.value = result.entries.some(entry => String(entry.id) === selected) ? selected : 'current';
      }
      if (before.value === 'current' && result.entries.length) before.value = String(result.entries[0].id);
      status.textContent = `${total ? offset + 1 : 0}–${Math.min(offset + 25, total)} of ${total} archived command checkpoints · source records only`;
      previous.disabled = offset === 0; next.disabled = offset + 25 >= total;
    } catch (error) { status.textContent = `History unavailable · ${error.message}`; }
  }
  const loadButton = button('Load run checkpoints', load);
  const previous = button('Newer checkpoints', async () => { offset = Math.max(0, offset - 25); await load(); }); previous.disabled = true;
  const next = button('Older checkpoints', async () => { offset += 25; await load(); }); next.disabled = true;
  paging.append(previous, next);
  const compare = button('Compare selected checkpoints', async () => {
    if (!onQuery) return;
    try {
      const result = await onQuery({ operation: 'compare', before: before.value === 'current' ? null : Number(before.value), after: after.value === 'current' ? null : Number(after.value) });
      const value = result.comparison;
      output.replaceChildren(element('p', '', `Plan ${value.before_plan_revision} → ${value.after_plan_revision} · ${value.tasks.length} changed tasks · ${value.decisions.length} changed decisions`),
        element('p', 'meta', 'These are retained source and state differences. They grant no current verification.'));
      const changes = [...value.tasks.map(change => ({ kind: 'Task', ...change })), ...value.decisions.map(change => ({ kind: 'Decision', ...change }))];
      const list = element('div', 'stack'); const remaining = element('p', 'meta'); let shown = 0;
      const more = button('Show more checkpoint changes', append);
      function append() {
        for (const change of changes.slice(shown, shown + 25)) {
          const disclosure = element('details'); disclosure.append(element('summary', '', `${change.kind} ${change.id}`),
            element('pre', 'mono', JSON.stringify({ before: change.before, after: change.after }, null, 2))); list.append(disclosure);
        }
        shown = Math.min(shown + 25, changes.length); remaining.textContent = `${shown} of ${changes.length} changes shown`; more.hidden = shown >= changes.length;
      }
      output.append(list, remaining, more); append();
    } catch (error) { status.textContent = `Comparison unavailable · ${error.message}`; }
  });
  body.append(loadButton, status, paging, controls, compare, output); root.append(body);
  return root;
}
