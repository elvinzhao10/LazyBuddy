import test from 'node:test';
import assert from 'node:assert/strict';
import { createMiniDom } from './fixtures/mini-dom.mjs';
import { createVerificationView } from '../ui/verification-view.mjs';

test('a changed polling snapshot preserves table scrolling and evidence focus', () => {
  // Given: a horizontally scrolled verification table with a focused evidence link.
  const dom = createMiniDom(); globalThis.document = dom.document; globalThis.CSS = { escape: value => value };
  const snapshot = { project_id: 'project:ui', run_id: 'run', revision: 1, plan_revision: 1, decisions: [], tasks: [{ id: 'T1', title: 'Task',
    criteria: [{ id: 'C1', version: 1, requirement: 'Check the artifact', applicability: 'required', verification: 'unverified',
      scenarios: [], result_ids: [], history: [], current_attempt_id: 'A1' }],
    attempts: [{ id: 'A1', criterion_id: 'C1', source_revision: 'source:one', execution: 'finished', evidence: [{ path: 'proof.txt' }] }] }] };
  const view = createVerificationView({ snapshot }); dom.document.body.append(view.element);
  const scroller = view.element.querySelector('.table-scroll'); scroller.scrollLeft = 127; scroller.scrollTop = 19;
  view.element.querySelector('[data-evidence-path="proof.txt"]').focus();
  // When: the real view factory receives changed live data.
  const next = structuredClone(snapshot); next.revision = 2; next.tasks[0].criteria[0].verification = 'stale'; view.update(next);
  // Then: the user's reading position and evidence focus survive the DOM update.
  const current = view.element.querySelector('.table-scroll');
  assert.equal(current.scrollLeft, 127); assert.equal(current.scrollTop, 19);
  assert.equal(dom.document.activeElement.dataset.evidencePath, 'proof.txt');
});
