// T15 project and plan editors — DOM view over registered original documents.
// Rendered / structured / source surfaces per spec §4.2 through the shared
// command route of §6.1: every mutation is a typed command composed here and
// executed by the caller-provided sendCommand (source.edit.preview,
// source.edit, amend_baseline, plan.transition). The view never writes files,
// never grants verification and never composes execution operations.
//
// Shell integration (T12b/T15 redesign): the surface switch is a T11
// segmented control in the editor toolbar; baseline comparison and amendment
// impact open as T12 dock panels from toolbar actions; unsaved drafts mark
// the hosting shell tab with a dirty dot and guard its close behind a native
// confirm dialog. None of this adds authority: the tab chrome is presentation
// over the same command route, and the guard only ever clears local drafts.
import {
  button, element, statusChip, segmentedControl, card, dataTable, rowList,
  formField, createDockPanel, emptyState, announce,
} from './components.mjs';
import { createDocumentView } from './document-view.mjs';

export const EDITOR_MODES = Object.freeze(['rendered', 'structured', 'source']);
// Candidate lifecycle targets for the legality display. The values mirror
// PLAN_LIFECYCLES in project/contract.mjs; legality itself is always decided by
// the injected assessTransition (the real assessPlanTransition), never here.
const LIFECYCLES = Object.freeze(['draft', 'planned', 'active', 'paused', 'completed', 'superseded', 'abandoned']);
// Retiring targets consume the plan record; their transition buttons carry the
// danger treatment and an explicit confirm (audit FO-3). Undoing a retirement
// through the route is not generally legal, so confirm — not a fake undo — is
// the honest destructive affordance here.
const RETIRING_LIFECYCLES = Object.freeze(['completed', 'superseded', 'abandoned']);
const MODE_LABELS = Object.freeze({ rendered: 'Rendered', structured: 'Structured', source: 'Source' });

const FENCE_MARKER = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_MARKER = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/;
const TASK_MARKER = /^([ \t]*)([-*+]|\d+[.])([ \t]+)\[( |x|X)\]([ \t]*)(.*)$/;
const HUNK_MARKER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

let commandSequence = 0;
let fieldNoteSequence = 0;
const nextCommandId = () => `dashboard-editor-${Date.now().toString(36)}-${commandSequence += 1}`;

// Same line grammar as project/source-edit/markdown.mjs so the rendered view,
// the structured task list and the transactional editor agree on one document.
export function parseMarkdownView(content) {
  const raw = String(content).match(/[^\n]*(?:\n|$)/g) ?? [];
  if (raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const blocks = [];
  let fence = null; let fenceLines = []; let prose = []; let proseLine = 0;
  const closeProse = () => {
    if (prose.length) blocks.push({ kind: 'paragraph', text: prose.join(' '), line: proseLine });
    prose = [];
  };
  for (let index = 0; index < raw.length; index += 1) {
    const eol = raw[index].endsWith('\r\n') ? '\r\n' : raw[index].endsWith('\n') ? '\n' : '';
    const text = raw[index].slice(0, raw[index].length - eol.length);
    const marker = text.match(FENCE_MARKER);
    if (fence) {
      fenceLines.push(text);
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        blocks.push({ kind: 'fence', text: fenceLines.join('\n'), line: fence });
        fence = null; fenceLines = [];
      }
      continue;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      closeProse();
      fence = { character: marker[1][0], length: marker[1].length, line: index };
      fenceLines = [text];
      continue;
    }
    const heading = text.match(HEADING_MARKER);
    const task = text.match(TASK_MARKER);
    if (heading) {
      closeProse();
      const title = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      if (title) blocks.push({ kind: 'heading', level: heading[1].length, title, line: index });
      continue;
    }
    if (task) {
      closeProse();
      blocks.push({ kind: 'task', checked: task[4] !== ' ', text: task[6], indent: task[1].length, line: index });
      continue;
    }
    if (!text.trim()) { closeProse(); continue; }
    if (!prose.length) proseLine = index;
    prose.push(text.trim());
  }
  if (fence) { blocks.push({ kind: 'fence', text: fenceLines.join('\n'), line: fence.line }); }
  closeProse();
  const headings = blocks.map((block, index) => ({ ...block, index })).filter(block => block.kind === 'heading');
  const sections = headings.map(heading => {
    const next = headings.find(candidate => candidate.index > heading.index && candidate.level <= heading.level);
    return { title: heading.title, from: heading.index, to: next ? next.index : blocks.length };
  });
  return { blocks, sections };
}

// Tasks of one heading section (the anchor's checklist), or of the whole
// document when no heading is addressed.
export function sectionTasks(content, anchorTitle) {
  const view = parseMarkdownView(content);
  if (anchorTitle == null) return view.blocks.filter(block => block.kind === 'task');
  const section = view.sections.find(candidate => candidate.title === anchorTitle);
  if (!section) return [];
  return view.blocks.slice(section.from, section.to).filter(block => block.kind === 'task');
}

// Preview-derived invalidation facts in the amend_baseline receipt shape. These
// are a preview from the current snapshot's references; the authoritative facts
// arrive with the accepted receipt and replace this display.
export function predictedInvalidations(snapshot, itemId, toRevision) {
  const affected = (snapshot.plans ?? [])
    .filter(plan => (plan.baseline_refs ?? []).some(reference => reference.item_id === itemId && reference.item_revision < toRevision))
    .map(plan => ({ plan_id: plan.id,
      considered_revision: plan.baseline_refs.find(reference => reference.item_id === itemId).item_revision,
      carried_forward: false }));
  if (!affected.length) return [];
  return [{ item_id: itemId, from_revision: Math.min(...affected.map(entry => entry.considered_revision)),
    to_revision: toRevision, reason: 'BEHAVIORAL_REQUIREMENT_CHANGE', affected }];
}

// Route outcomes map onto the typed display vocabulary: an accepted command is
// `saved`, a revision-checked refusal is `conflict`, a query is `valid` /
// `invalid`, and a typed route error surfaces as `refused` with its code. There
// is no path from a failure to a success-looking state.
export function commandResultState(outcome) {
  if (outcome?.receipt) return outcome.receipt.status === 'saved' ? 'saved' : outcome.receipt.status;
  if (outcome?.result) return outcome.result.status === 'ok' ? 'valid' : outcome.result.status;
  return 'unknown';
}

// ---- unified-patch presentation (display only; the route stays the author) --

/** Parse the route's unified patch into ordered add/remove/context rows (with hunk ids). */
export function parseUnifiedPatch(patchText) {
  const lines = String(patchText ?? '').split('\n');
  const rows = [];
  let hunk = 0;
  let originalLine = 0; let editedLine = 0; let inHunk = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const header = HUNK_MARKER.exec(line);
    if (header) {
      hunk += 1; inHunk = true;
      originalLine = Number(header[1]); editedLine = Number(header[3]);
      continue;
    }
    if (!inHunk) continue;
    // A trailing empty line from split('\n') is not a context row.
    if (line === '' && index === lines.length - 1) continue;
    if (line.startsWith('\\')) { rows.push({ kind: 'note', text: line, hunk, originalLine: null, editedLine: null }); continue; }
    if (line.startsWith('+')) { rows.push({ kind: 'add', text: line.slice(1), hunk, originalLine: null, editedLine }); editedLine += 1; continue; }
    if (line.startsWith('-')) { rows.push({ kind: 'remove', text: line.slice(1), hunk, originalLine, editedLine: null }); originalLine += 1; continue; }
    rows.push({ kind: 'context', text: line.slice(1), hunk, originalLine, editedLine });
    originalLine += 1; editedLine += 1;
  }
  return rows;
}

/** Reconstruct the edited document by applying the route's own patch. Pure presentation: on any unmappable hunk it returns null rather than guessing. */
export function applyUnifiedPatch(original, patchText) {
  try {
    const source = String(original).replace(/\r\n?/g, '\n').split('\n');
    const rows = parseUnifiedPatch(patchText);
    const out = [];
    let cursor = 0; // next unconsumed line of the original
    let currentHunk = 0; let hunkStart = null; let hunkRows = [];
    const flush = () => {
      if (!hunkRows.length) return;
      const kept = hunkRows.filter(row => row.kind !== 'add').length;
      const produced = hunkRows.filter(row => row.kind !== 'remove').map(row => row.text);
      const start = hunkStart ?? source.length + 1; // add-only hunk: append at the end
      if (start - 1 < cursor) throw new Error('overlapping hunks');
      if (start - 1 > source.length) throw new Error('unmapped hunk');
      out.push(...source.slice(cursor, start - 1));
      out.push(...produced);
      cursor = start - 1 + kept;
      hunkRows = []; hunkStart = null;
    };
    for (const row of rows) {
      if (row.kind === 'note') continue;
      if (row.hunk !== currentHunk) { flush(); currentHunk = row.hunk; }
      if (hunkStart == null && row.originalLine != null) hunkStart = row.originalLine;
      hunkRows.push(row);
    }
    flush();
    out.push(...source.slice(cursor));
    return out.join('\n');
  } catch { return null; }
}

/** Pair removes/adds of one change into aligned original-vs-edited diff rows. */
export function diffRows(patchText) {
  const rows = [];
  let removes = []; let adds = [];
  const flush = () => {
    const count = Math.max(removes.length, adds.length);
    for (let index = 0; index < count; index += 1) {
      rows.push({ original: removes[index] ?? null, edited: adds[index] ?? null,
        change: removes[index] != null && adds[index] != null ? 'changed' : removes[index] != null ? 'removed' : 'added' });
    }
    removes = []; adds = [];
  };
  for (const row of parseUnifiedPatch(patchText)) {
    if (row.kind === 'remove') removes.push(row.text);
    else if (row.kind === 'add') adds.push(row.text);
    else if (row.kind === 'context') { flush(); rows.push({ original: row.text, edited: row.text, change: 'context' }); }
  }
  flush();
  return rows;
}

// ---- DOM helpers -----------------------------------------------------------

function option(value, label) {
  const node = element('option');
  node.value = value;
  node.textContent = label;
  return node;
}
function input(type = 'text') { const control = element('input'); control.type = type; return control; }
function fieldRow(labelText, control, fieldId, { help = '', required = false } = {}) {
  const wrapper = formField({ label: labelText, name: fieldId ?? '', control, help, required });
  wrapper.classList.add('editor-field');
  if (fieldId) wrapper.dataset.field = fieldId;
  return wrapper;
}
// Adds, updates or clears the inline error slot of a formField wrapper with
// the aria-invalid / aria-describedby wiring the audit (FO-2) requires.
function setFieldError(wrapper, message) {
  if (!wrapper) return;
  const control = wrapper.querySelector('input, select, textarea');
  const help = wrapper.querySelector('.lb-field-help');
  let errorNode = wrapper.querySelector('.lb-field-error');
  if (!message) {
    errorNode?.remove();
    wrapper.removeAttribute('data-invalid');
    control?.removeAttribute('aria-invalid');
    if (help?.id) control?.setAttribute('aria-describedby', help.id);
    else control?.removeAttribute('aria-describedby');
    return;
  }
  if (!errorNode) {
    errorNode = element('span', 'lb-field-error');
    errorNode.dataset.testid = 'field-error';
    errorNode.id = `editor-field-error-${++fieldNoteSequence}`;
    wrapper.append(errorNode);
  }
  errorNode.textContent = message;
  const described = [help?.id, errorNode.id].filter(Boolean).join(' ');
  if (described) control?.setAttribute('aria-describedby', described);
  wrapper.dataset.invalid = 'true';
  control?.setAttribute('aria-invalid', 'true');
}
function factsTable(entries) {
  const facts = element('dl', 'editor-facts stack');
  for (const [term, value] of entries) {
    const row = element('div', 'cluster spread');
    row.append(element('dt', 'meta', term), element('dd', '', value));
    facts.append(row);
  }
  return facts;
}
// Walk up from a node (mini-DOM safe: no Element.closest dependency).
function closestNode(node, predicate) {
  let current = node;
  while (current) {
    if (current.nodeType === 1 && predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
}
function reportStatus(message) {
  try { announce(String(message)); } catch { /* detached or exotic host: the visible line still carries the text */ }
}

// Native <dialog> confirm (audit FO-4: platform dialogs, not custom chrome).
// Works on real dialogs and degrades to a hidden-toggle on minimal hosts.
// `onConfirm` runs only on the confirm action; `onCancel` (T20) runs whenever
// the dialog closes without confirming (cancel button, Escape, native cancel)
// so guard callers can resolve their "keep editing" branch on every host.
function createConfirmDialog({ testid, cancelLabel = 'Cancel' }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'editor-dialog';
  dialog.dataset.testid = testid;
  dialog.hidden = true;
  const heading = element('h2', '');
  const headingId = `editor-dialog-${++fieldNoteSequence}`;
  heading.id = headingId;
  dialog.setAttribute('aria-labelledby', headingId);
  const detail = element('p', 'meta', '');
  const cancelControl = button(cancelLabel, () => api.close());
  cancelControl.dataset.testid = `${testid}-cancel`;
  let confirmed = false; // the confirm path marks itself so close-without-confirm runs onCancel
  // V2-T7 (T9 residual fix): the confirm control is created named ("Confirm")
  // so it never sits in the DOM as an unnamed icon-only button between mounts;
  // ask() replaces the label with the action-specific confirmLabel, so the
  // visible label and the accessible name can never disagree.
  const confirmControl = button('Confirm', () => { const action = onConfirm; onConfirm = null; confirmed = true; api.close(); action?.(); });
  confirmControl.dataset.testid = `${testid}-confirm`;
  confirmControl.classList.add('lb-destructive');
  const actions = element('div', 'cluster editor-dialog-actions');
  actions.append(cancelControl, confirmControl);
  dialog.append(heading, detail, actions);
  let invoker = null;
  let onConfirm = null;
  let onCancelCallback = null;
  const settleCancel = () => {
    const cancelAction = onCancelCallback;
    onCancelCallback = null;
    if (!confirmed && cancelAction) cancelAction();
  };
  const api = {
    element: dialog,
    ask({ title, detail: text, confirmLabel, trigger = null, onConfirm: action, onCancel: cancelAction }) {
      heading.textContent = title; detail.textContent = text; confirmControl.textContent = confirmLabel;
      invoker = trigger; onConfirm = action; onCancelCallback = cancelAction; confirmed = false;
      if (api.isOpen()) return dialog;
      dialog.hidden = false;
      if (typeof dialog.showModal === 'function') {
        try { dialog.showModal(); } catch { /* already open or unsupported: the hidden toggle carries it */ }
      }
      cancelControl.focus(); // the safe answer is the focused one
      return dialog;
    },
    close() {
      if (!api.isOpen()) return false;
      if (typeof dialog.close === 'function') dialog.close();
      dialog.hidden = true;
      const target = invoker; invoker = null; onConfirm = null;
      settleCancel();
      target?.focus?.();
      return true;
    },
    isOpen: () => (typeof dialog.open === 'boolean' ? dialog.open : !dialog.hidden),
  };
  dialog.addEventListener('close', () => { dialog.hidden = true; const target = invoker; invoker = null; onConfirm = null; settleCancel(); target?.focus?.(); });
  dialog.addEventListener('cancel', event => { event.preventDefault?.(); api.close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault?.(); api.close(); } });
  return api;
}

export function createProjectEditor({ snapshot, sendCommand, captureSource, assessTransition, initial = {} }) {
  if (!snapshot || typeof sendCommand !== 'function' || typeof captureSource !== 'function'
    || typeof assessTransition !== 'function') {
    throw new TypeError('createProjectEditor requires snapshot, sendCommand, captureSource and assessTransition');
  }
  const current = { snapshot };
  const selection = {
    sourceId: initial.sourceId ?? snapshot.sources[0]?.id ?? null,
    mode: EDITOR_MODES.includes(initial.mode) ? initial.mode : 'rendered',
    planId: null, itemId: null, narrow: false,
  };
  const capture = { path: null, sha256: null, content: '' };
  const mapped = { anchors: [], observation: null, sha256: null };
  const drafts = { taskIndex: '0', kind: 'set_task_state', stateValue: 'checked', text: '', title: '', before: '',
    authority: '', amendTaskIndex: '0', amendText: '', amendAuthority: '', reason: '', successor: '', carry: new Set() };
  const previews = { edit: null, amend: null, receiptInvalidations: null };
  let statusState = 'pending';
  let statusText = 'Loading the registered original…';
  let assessments = new Map();
  let pending = Promise.resolve();
  const track = work => { pending = pending.then(work, work); return pending; };

  const sources = () => current.snapshot.sources ?? [];
  const sourceRecord = () => sources().find(entry => entry.id === selection.sourceId) ?? null;
  const plansOfSource = () => (current.snapshot.plans ?? []).filter(plan => plan.source.source_id === selection.sourceId);
  const itemsOfSource = () => (current.snapshot.items ?? []).filter(item => item.source.source_id === selection.sourceId);
  const selectedPlan = () => plansOfSource().find(plan => plan.id === selection.planId) ?? null;
  const selectedItem = () => itemsOfSource().find(item => item.id === selection.itemId) ?? null;

  const root = element('section', 'editor-root stack');
  root.dataset.testid = 'project-editor';
  // One visible status line; the polite announcement rides the single T11
  // announcer (audit IK-7: no duplicate live regions).
  const status = element('p', 'meta editor-status', statusText);
  status.dataset.testid = 'editor-status';
  status.dataset.state = statusState;

  const sourceSelect = element('select');
  sourceSelect.dataset.testid = 'source-select';
  const sourceMeta = element('p', 'meta', '');
  sourceMeta.dataset.testid = 'source-meta';

  const panes = {};
  for (const mode of EDITOR_MODES) {
    const pane = element('section', 'editor-pane stack');
    pane.dataset.testid = `editor-${mode}`;
    pane.dataset.mode = mode;
    panes[mode] = pane;
  }
  const narrowList = element('ol', 'editor-narrow-list stack');
  narrowList.dataset.testid = 'editor-narrow';

  function setStatus(state, text) {
    statusState = state;
    statusText = text;
    status.dataset.state = state;
    status.textContent = text;
    reportStatus(text);
  }
  async function send(command) {
    try {
      const outcome = await sendCommand(command);
      if (outcome?.snapshot) current.snapshot = outcome.snapshot;
      return outcome;
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code) ? error.code : 'COMMAND_FAILED';
      const failure = new Error(code);
      failure.typedCode = code;
      throw failure;
    }
  }

  // ---- dirty state + shell-tab chrome (dot + close guard) ------------------
  const tabChrome = { tab: null, installed: false, suppressed: false };
  const closeGuard = createConfirmDialog({ testid: 'editor-close-guard', cancelLabel: 'Keep editing' });
  closeGuard.element.querySelector('[data-testid="editor-close-guard-confirm"]').classList.remove('lb-destructive');
  closeGuard.element.querySelector('[data-testid="editor-close-guard-confirm"]').textContent = 'Discard changes and close';
  let closeIntent = null;
  // T20 single-surface navigation guard (same FO-3 confirm pattern): leaving
  // the dirty editor destination asks first. Keep editing is the safe default
  // and preserves every draft; only the explicit Discard clears them.
  const leaveGuard = createConfirmDialog({ testid: 'editor-leave-guard', cancelLabel: 'Keep editing' });
  leaveGuard.element.querySelector('[data-testid="editor-leave-guard-confirm"]').classList.remove('lb-destructive');
  leaveGuard.element.querySelector('[data-testid="editor-leave-guard-confirm"]').textContent = 'Discard changes and leave';
  let dirtyChip = null; // the in-surface header chip (built with the shell below)

  function computeDirty() {
    return Boolean(drafts.text.trim() || drafts.title.trim() || drafts.authority.trim()
      || drafts.amendText.trim() || drafts.amendAuthority.trim() || drafts.reason.trim()
      || drafts.successor || drafts.carry.size > 0 || previews.edit || previews.amend);
  }
  function clearDrafts() {
    drafts.text = ''; drafts.title = ''; drafts.authority = '';
    drafts.amendText = ''; drafts.amendAuthority = ''; drafts.reason = ''; drafts.successor = '';
    drafts.carry.clear();
    textInput.value = ''; titleInput.value = ''; authorityInput.value = '';
    amendText.value = ''; amendAuthority.value = ''; transitionReason.value = '';
    transitionSuccessor.value = '';
    previews.edit = null; previews.amend = null;
    setFieldError(authorityField, '');
    setFieldError(taskIndexField, '');
    setFieldError(amendAuthorityField, '');
    updateDirty();
    renderPreview('empty');
    renderAmendPreview('empty');
  }
  function dirtySummary() {
    const parts = [];
    if (drafts.text.trim() || drafts.title.trim()) parts.push('a composed source edit');
    if (drafts.authority.trim()) parts.push('an unsent authority reference');
    if (previews.edit) parts.push('a pending edit preview');
    if (drafts.amendText.trim() || drafts.amendAuthority.trim() || previews.amend) parts.push('a baseline amendment in progress');
    if (drafts.reason.trim() || drafts.successor || drafts.carry.size) parts.push('transition choices');
    return parts.length ? parts.join(', ') : 'unsaved changes';
  }
  function proceedWithClose() {
    clearDrafts();
    tabChrome.suppressed = true;
    try {
      const intent = closeIntent;
      if (!intent) return;
      if (intent.type === 'click') intent.target.click?.();
      else intent.target.dispatchEvent?.({ type: 'keydown', key: intent.key, bubbles: true, cancelable: true });
    } finally { tabChrome.suppressed = false; }
  }
  function guardIntercept(event) {
    if (tabChrome.suppressed || !computeDirty()) return false;
    if (closeGuard.isOpen()) { event.preventDefault?.(); event.stopPropagation?.(); return true; }
    const stop = event.stopPropagation?.bind(event);
    event.preventDefault?.();
    stop?.();
    // Real hosts also honor capture: block remaining same-node listeners.
    event.stopImmediatePropagation?.();
    closeIntent = { type: event.type === 'click' ? 'click' : 'keydown', target: event.target, key: event.key };
    closeGuard.ask({
      title: 'Close with unsaved changes?',
      detail: `This editor tab holds ${dirtySummary()}. Closing discards them; nothing has been sent through the command route yet.`,
      confirmLabel: 'Discard changes and close',
      trigger: event.target,
      onConfirm: proceedWithClose,
    });
    return true;
  }
  function installTabGuard(tab) {
    const tablist = tab.parentNode;
    if (!tablist?.addEventListener) return;
    const touchesOwnTab = target => Boolean(target) && (target === tab || closestNode(target, node => node === tab));
    tablist.addEventListener('click', event => {
      if (!touchesOwnTab(event.target)) return;
      guardIntercept(event);
    }, true);
    tablist.addEventListener('keydown', event => {
      if (!['Delete', 'Backspace'].includes(event.key)) return;
      if (!touchesOwnTab(event.target)) return;
      guardIntercept(event);
    }, true);
  }
  function syncTabChrome() {
    if (!tabChrome.installed) {
      const panel = closestNode(root, node => node.matches?.('[role="tabpanel"]'));
      const tabId = panel?.getAttribute('aria-labelledby') ?? '';
      const tab = panel && tabId
        ? (document.getElementById?.(tabId) ?? document.querySelector(`[id="${tabId}"]`) ?? null)
        : null;
      if (!tab) return;
      tabChrome.tab = tab;
      tabChrome.installed = true;
      installTabGuard(tab);
      const label = tab.querySelector('.lb-tab-label');
      if (label) {
        const dot = element('span', 'lb-tab-dirty');
        dot.dataset.testid = 'tab-dirty';
        dot.setAttribute('role', 'img');
        dot.setAttribute('aria-label', 'Unsaved changes');
        label.append(dot);
        tabChrome.dot = dot;
      }
    }
    if (!tabChrome.tab) return;
    const dirty = computeDirty();
    tabChrome.tab.dataset.dirty = String(dirty);
    if (tabChrome.dot) tabChrome.dot.hidden = !dirty;
  }
  function updateDirty() {
    const dirty = computeDirty();
    root.dataset.dirty = String(dirty);
    if (dirtyChip) dirtyChip.hidden = !dirty;
    syncTabChrome();
  }

  // T20 navigation guard surface: the shell asks before it replaces this
  // surface in place. `needsLeaveGuard` stays synchronous so clean editors
  // never defer navigation; `confirmLeave` resolves once the dialog settles.
  function needsLeaveGuard() {
    return computeDirty();
  }
  function confirmLeave({ trigger = null } = {}) {
    if (!computeDirty()) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      const done = ok => {
        if (settled) return;
        settled = true;
        if (ok) clearDrafts(); // only the explicit Discard ever spends drafts
        resolve(ok);
      };
      leaveGuard.ask({
        title: 'Leave with unsaved changes?',
        detail: `This editor holds ${dirtySummary()}. Leaving this surface discards them; nothing has been sent through the command route yet.`,
        confirmLabel: 'Discard changes and leave',
        trigger,
        onConfirm: () => done(true),
        onCancel: () => done(false),
      });
    });
  }

  // ---- structured surface: plan records + transition legality ----
  const planSelect = element('select');
  planSelect.dataset.testid = 'plan-select';
  const planDetailHost = element('div', 'stack');
  planDetailHost.dataset.testid = 'plan-detail';
  const transitionBody = element('div', 'stack');
  const transitionReason = input();
  transitionReason.dataset.testid = 'transition-reason';
  const transitionSuccessor = element('select');
  transitionSuccessor.dataset.testid = 'transition-successor';
  const retireGuard = createConfirmDialog({ testid: 'transition-confirm', cancelLabel: 'Keep the lifecycle' });

  async function refreshAssessments() {
    const plan = selectedPlan();
    assessments = new Map();
    if (!plan) return;
    const payload = { reason: drafts.reason.trim() || undefined, successor_plan_id: drafts.successor || undefined };
    for (const to of LIFECYCLES.filter(value => value !== plan.declared_lifecycle)) {
      assessments.set(to, await Promise.resolve(assessTransition(current.snapshot, plan.id, to, payload)));
    }
  }

  function renderTransitions() {
    const plan = selectedPlan();
    transitionBody.replaceChildren();
    if (!plan) {
      transitionBody.append(element('p', 'meta', 'No plan record is bound to this source.'));
      return;
    }
    transitionBody.append(element('p', 'meta', 'Read-only legality assessment through the shared lifecycle rules; the transition itself is a command through the route.'));
    for (const to of LIFECYCLES.filter(value => value !== plan.declared_lifecycle)) {
      const assessment = assessments.get(to);
      const retiring = RETIRING_LIFECYCLES.includes(to);
      const body = element('div', 'stack');
      const action = button(`Move to ${to}`, () => {
        if (retiring) {
          retireGuard.ask({
            title: `Retire ${plan.id} to ${to}?`,
            detail: `Moving to ${to} closes this plan record through plan.transition under the shared lifecycle rules.`
              + (to === 'superseded' ? ' The successor link is part of the command.' : ' Retirement is not automatically reversible; a new plan record replaces retired work.'),
            confirmLabel: `Retire to ${to}`,
            trigger: action,
            onConfirm: () => applyTransition(to),
          });
          return;
        }
        applyTransition(to);
      }, { disabled: !assessment?.allowed });
      if (retiring) action.classList.add('lb-destructive');
      const reasons = element('ul', 'editor-reasons stack');
      reasons.id = `transition-reasons-${to}`;
      action.setAttribute('aria-describedby', reasons.id);
      if (!assessment?.allowed) action.title = retiring
        ? `Retiring to ${to} needs legality (reasons listed) and an explicit confirmation.`
        : `Moving to ${to} is currently illegal; the reasons are listed.`;
      else action.removeAttribute('title');
      for (const reason of assessment?.reasons ?? []) {
        const item = element('li', 'meta', `${reason.code} — ${reason.detail}`);
        item.dataset.code = reason.code;
        reasons.append(item);
      }
      if (!assessment) reasons.append(element('li', 'meta', 'ASSESSMENT_PENDING — legality is being assessed'));
      body.append(action, reasons);
      const row = card({ body });
      row.dataset.testid = 'transition-option';
      row.dataset.to = to;
      transitionBody.append(row);
    }
    transitionBody.append(fieldRow('Retirement reason', transitionReason, 'transition-reason',
        { help: 'Required for superseded and abandoned; recorded with the command.' }),
      fieldRow('Successor plan', transitionSuccessor, 'transition-successor',
        { help: 'Required for superseded; the plan that takes over the scope.' }));
  }

  async function applyTransition(to) {
    const plan = selectedPlan();
    if (!plan) return;
    setStatus('pending', `Assessing transition to ${to}…`);
    await track(async () => {
      const assessment = await Promise.resolve(assessTransition(current.snapshot, plan.id, to,
        { reason: drafts.reason.trim() || undefined, successor_plan_id: drafts.successor || undefined }));
      if (!assessment.allowed) {
        setStatus('refused', `refused · ${assessment.reasons[0]?.code ?? 'INVALID_TRANSITION'} · nothing changed`);
        return;
      }
      try {
        const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
          expected_revision: current.snapshot.revision, operation: 'plan.transition',
          payload: { plan_id: plan.id, to_lifecycle: to, ...(drafts.reason.trim() ? { reason: drafts.reason.trim() } : {}),
            ...(drafts.successor ? { successor_plan_id: drafts.successor } : {}) } });
        if (commandResultState(outcome) === 'saved') {
          setStatus('saved', `saved · plan.transition · ${plan.id} → ${to} · revision ${outcome.receipt.revision}`);
          drafts.reason = ''; transitionReason.value = '';
          drafts.successor = ''; transitionSuccessor.value = '';
          updateDirty();
          await refresh();
        } else {
          setStatus('conflict', `conflict · ${outcome.receipt.reason ?? 'REVISION_CONFLICT'} · nothing changed`);
        }
      } catch (error) {
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
    });
  }

  // ---- source surface: anchor addressing + staged preview/apply -----------
  const anchorSelect = element('select');
  anchorSelect.dataset.testid = 'anchor-select';
  const anchorMeta = element('p', 'meta', '');
  anchorMeta.dataset.testid = 'anchor-meta';
  const anchorTasks = element('ul', 'editor-tasklist stack');
  const taskIndex = input('number');
  taskIndex.min = '0'; taskIndex.step = '1'; taskIndex.value = drafts.taskIndex;
  taskIndex.dataset.testid = 'edit-task-index';
  const kindSelect = element('select');
  kindSelect.append(option('set_task_state', 'Set checklist state'), option('set_task_text', 'Set checklist text'),
    option('rename_heading', 'Rename heading'), option('move_section', 'Move section'));
  kindSelect.value = drafts.kind;
  kindSelect.dataset.testid = 'edit-kind';
  const stateSelect = element('select');
  stateSelect.append(option('checked'), option('unchecked'));
  stateSelect.dataset.testid = 'edit-state';
  const textInput = input();
  textInput.dataset.testid = 'edit-text';
  const titleInput = input();
  titleInput.dataset.testid = 'edit-title';
  const beforeSelect = element('select');
  beforeSelect.dataset.testid = 'edit-before';
  const authorityInput = input();
  authorityInput.dataset.testid = 'edit-authority';
  authorityInput.setAttribute('autocomplete', 'off');
  const expectedLine = element('p', 'meta', '');
  expectedLine.dataset.testid = 'edit-expected';
  const applyNote = element('span', 'native-note');
  applyNote.id = `editor-apply-note-${++fieldNoteSequence}`;
  applyNote.textContent = 'Apply needs a current valid preview composed against the same revisions.';
  const previewButton = button('Preview edit · real patch', () => previewEdit());
  previewButton.dataset.testid = 'edit-preview-button';
  const applyButton = button('Apply edit through the route', () => applyEdit(), { disabled: true });
  applyButton.dataset.testid = 'edit-apply-button';
  applyButton.classList.add('primary');
  applyButton.setAttribute('aria-describedby', applyNote.id);

  // Form wrappers (label + control + help + inline-error slots, audit FO-1/2).
  const anchorField = fieldRow('Anchor', anchorSelect, 'anchor', { help: 'The heading section of the registered original this edit addresses.' });
  const taskIndexField = fieldRow('Checklist item', taskIndex, 'edit-task-index', { help: 'Zero-based position of the checklist item inside the anchor section.' });
  const kindField = fieldRow('Edit kind', kindSelect, 'edit-kind', { help: 'Syntax-aware edit kinds the route validates.' });
  const stateField = fieldRow('State', stateSelect, 'edit-state', { help: 'checked or unchecked — the checklist state to set.' });
  const textField = fieldRow('New text', textInput, 'edit-text', { help: 'Applied verbatim to the addressed checklist line.' });
  const titleField = fieldRow('New heading title', titleInput, 'edit-title', { help: 'The renamed heading keeps its anchor identity through the route.' });
  const beforeField = fieldRow('Move before', beforeSelect, 'edit-before', { help: 'The section this one moves ahead of; end of document by default.' });
  const authorityField = fieldRow('Authority reference', authorityInput, 'edit-authority',
    { help: 'Required. Names the authority the edit is sent through; recorded in the journal.', required: true });

  // Split view hosts: registered original vs staged edit + the route diff.
  const splitOriginal = element('figure', 'editor-split-card');
  splitOriginal.dataset.testid = 'edit-split-original';
  const splitEdited = element('figure', 'editor-split-card');
  splitEdited.dataset.testid = 'edit-split-edited';
  const previewCard = card({ title: 'Preview through source.edit.preview',
    meta: 'Nothing is applied until the explicit apply command.', body: element('div', 'stack') });
  previewCard.dataset.testid = 'edit-preview';
  previewCard.dataset.state = 'empty';
  const diffHost = element('div', 'stack');
  const diffTableHost = element('div', '');
  diffTableHost.dataset.testid = 'edit-diff';

  const currentAnchor = () => mapped.anchors.find(anchor => anchor.anchor_id === anchorSelect.value) ?? null;
  function buildEdit() {
    if (drafts.kind === 'set_task_state') return { kind: 'set_task_state', anchor_id: anchorSelect.value, item: Number(drafts.taskIndex), state: drafts.stateValue };
    if (drafts.kind === 'set_task_text') return { kind: 'set_task_text', anchor_id: anchorSelect.value, item: Number(drafts.taskIndex), text: drafts.text };
    if (drafts.kind === 'rename_heading') return { kind: 'rename_heading', anchor_id: anchorSelect.value, title: drafts.title };
    return { kind: 'move_section', anchor_id: anchorSelect.value, before_anchor_id: drafts.before || null };
  }
  function sourceEditPayload() {
    const record = sourceRecord();
    return { authority: drafts.authority, source_id: selection.sourceId,
      expected_sha256: record.accepted_sha256, expected_source_revision: record.revision, edits: [buildEdit()] };
  }
  async function previewEdit() {
    setFieldError(authorityField, '');
    setFieldError(taskIndexField, '');
    // Validate every field first: the composer shows all inline problems at
    // once (FO-2) instead of leaking them one refusal at a time.
    const problems = [];
    if (!/^\d+$/.test(drafts.taskIndex.trim())) {
      setFieldError(taskIndexField, 'Checklist item must be a whole number (0 for the first item).');
      problems.push('INVALID_ITEM_INDEX');
    }
    if (!drafts.authority.trim()) {
      setFieldError(authorityField, 'Authority reference is required — name the authority this edit is sent through.');
      problems.push('AUTHORITY_REQUIRED');
    }
    if (problems.length) {
      setStatus('refused', `refused · ${problems.join(' + ')} · nothing was sent`);
      previews.edit = null;
      renderPreview('refused');
      return;
    }
    setStatus('pending', 'Composing the real patch through source.edit.preview…');
    await track(async () => {
      try {
        const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
          expected_revision: current.snapshot.revision, operation: 'source.edit.preview', payload: sourceEditPayload() });
        previews.edit = outcome.result.status === 'valid' ? { result: outcome.result } : null;
        if (outcome.result.status === 'valid') setStatus('valid', `valid · source.edit.preview · authority ${outcome.result.authority} · ${outcome.result.changed_ids.length} identities touched`);
        else setStatus('invalid', `invalid · ${outcome.result.reason ?? 'INVALID'} · nothing changed`);
      } catch (error) {
        previews.edit = null;
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
      renderPreview(statusState);
      updateDirty();
    });
  }
  async function applyEdit() {
    if (previews.edit?.result?.status !== 'valid') {
      setStatus('refused', 'refused · PREVIEW_REQUIRED · apply needs a current valid preview');
      return;
    }
    setStatus('pending', 'Applying through source.edit…');
    await track(async () => {
      try {
        const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
          expected_revision: current.snapshot.revision, operation: 'source.edit', payload: sourceEditPayload() });
        if (commandResultState(outcome) === 'saved') {
          setStatus('saved', `saved · source.edit · revision ${outcome.receipt.revision} · changed ${outcome.receipt.changed_ids.join(', ') || 'nothing'}`);
          previews.edit = null;
          drafts.text = ''; textInput.value = '';
          drafts.authority = ''; authorityInput.value = '';
          setFieldError(authorityField, '');
          updateDirty();
          await refresh();
        } else {
          previews.edit = { result: previews.edit.result, stale: true };
          setStatus('conflict', `conflict · ${outcome.receipt.reason ?? 'REVISION_CONFLICT'} · the preview is stale; nothing changed`);
          renderPreview('stale');
        }
      } catch (error) {
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
    });
  }
  function renderPreview(state) {
    previewCard.dataset.state = state ?? 'empty';
    const body = previewCard.querySelector('.lb-card-body') ?? previewCard;
    body.replaceChildren(diffHost, applyNote);
    diffHost.replaceChildren();
    if (!previews.edit) {
      diffHost.append(element('p', 'meta', 'No preview yet. A preview shows the actual unified patch before anything is applied.'));
      applyButton.disabled = true;
      applyButton.title = 'A current valid preview is required before apply.';
      renderSplit();
      return;
    }
    const { result, stale } = previews.edit;
    diffHost.append(element('p', 'meta', stale
      ? `stale · the preview was composed against older revisions · authority ${result.authority}`
      : `authority ${result.authority} · ${result.current_sha256?.slice(0, 12)}… → ${result.next_sha256?.slice(0, 12)}…`));
    const table = dataTable({
      columns: [{ key: 'original', label: 'Registered original' }, { key: 'edited', label: 'Staged edit' }],
      rows: diffRows(result.patch_text ?? '').map(row => [
        diffCell(row.original, row.change === 'removed' || row.change === 'changed' ? 'removed' : 'context'),
        diffCell(row.edited, row.change === 'added' || row.change === 'changed' ? 'added' : 'context'),
      ]),
    });
    diffTableHost.replaceChildren(table);
    const patch = element('pre', 'editor-patch', result.patch_text ?? '');
    patch.dataset.testid = 'edit-patch';
    const affected = element('div', 'stack');
    affected.dataset.testid = 'edit-affected';
    affected.append(factsTable([
      ['Affected plans', result.affected?.plans.map(entry => `${entry.plan_id}@${entry.anchor_id}`).join(', ') || 'none'],
      ['Affected criteria', result.affected?.criteria.map(entry => `${entry.item_id}@${entry.anchor_id} (r${entry.revision})`).join(', ') || 'none'],
      ['Affected dependencies', result.affected?.dependencies.map(entry => `${entry.plan_id} ← ${entry.item_ids.join(' ')}`).join(', ') || 'none'],
      ['Affected evidence', [...(result.affected?.evidence?.observation_ids ?? []).map(id => `observation ${id}`),
        ...(result.affected?.evidence?.artifact_ids ?? []).map(id => `artifact ${id}`)].join(', ') || 'none'],
      ['Changed identities', result.changed_ids.join(', ') || 'none'],
      ['Anchors', `${result.anchors?.before?.length ?? 0} before → ${result.anchors?.after?.length ?? 0} after`]]));
    diffHost.append(diffTableHost, patch, affected);
    applyButton.disabled = !(result.status === 'valid' && !stale);
    if (applyButton.disabled) applyButton.title = 'A current valid preview is required before apply.';
    else applyButton.removeAttribute('title');
    renderSplit();
  }
  function diffCell(text, change) {
    const cell = element('span', 'editor-diff-line', text ?? '');
    cell.dataset.change = change;
    if (text == null) cell.dataset.empty = 'true';
    return cell;
  }
  function renderSplit() {
    splitOriginal.replaceChildren(element('figcaption', 'meta', 'Registered original'));
    splitEdited.replaceChildren(element('figcaption', 'meta', 'Staged edit — reconstructed from the route patch'));
    if (!capture.content) {
      splitOriginal.append(element('p', 'meta', 'The registered original has not been captured yet.'));
      splitEdited.append(emptyState({ icon: 'list', title: 'No staged edit', detail: 'Capture a registered source, compose an edit and preview it through the route.' }));
      return;
    }
    const originalPre = element('pre', 'editor-source-pre');
    originalPre.textContent = capture.content;
    splitOriginal.append(originalPre);
    const preview = previews.edit?.result;
    if (preview?.patch_text) {
      const edited = applyUnifiedPatch(capture.content, preview.patch_text);
      if (edited != null) {
        const editedPre = element('pre', 'editor-source-pre');
        editedPre.textContent = edited;
        splitEdited.append(editedPre);
        return;
      }
    }
    splitEdited.append(emptyState({ icon: 'list', title: 'No staged edit yet',
      detail: 'A valid preview shows the edited document here, reconstructed from the route patch — never guessed locally.' }));
  }

  // ---- baseline surface: comparison + amendment impact as dock panels -----
  const itemSelect = element('select');
  itemSelect.dataset.testid = 'item-select';
  const itemMeta = element('p', 'meta', '');
  itemMeta.dataset.testid = 'item-meta';
  const comparisonHost = element('div', 'stack');
  comparisonHost.dataset.testid = 'baseline-comparison';
  const amendTaskIndex = input('number');
  amendTaskIndex.min = '0'; amendTaskIndex.step = '1'; amendTaskIndex.value = drafts.amendTaskIndex;
  amendTaskIndex.dataset.testid = 'amend-task-index';
  const amendText = input();
  amendText.dataset.testid = 'amend-text';
  const amendAuthority = input();
  amendAuthority.dataset.testid = 'amend-authority';
  amendAuthority.setAttribute('autocomplete', 'off');
  const amendCarry = element('div', 'stack');
  amendCarry.dataset.testid = 'amend-carry';
  const amendNote = element('span', 'native-note');
  amendNote.id = `editor-amend-note-${++fieldNoteSequence}`;
  amendNote.textContent = 'Acceptance needs a current valid amendment preview and a named authority.';
  const amendPreviewButton = button('Preview amendment · exact patch and invalidations', () => previewAmendment());
  amendPreviewButton.dataset.testid = 'amend-preview-button';
  const amendAcceptButton = button('Accept amendment through authority', () => acceptAmendment(), { disabled: true });
  amendAcceptButton.dataset.testid = 'amend-accept-button';
  amendAcceptButton.classList.add('primary');
  amendAcceptButton.setAttribute('aria-describedby', amendNote.id);
  const amendTaskIndexField = fieldRow('Checklist item', amendTaskIndex, 'amend-task-index', { help: 'Zero-based position inside the item’s anchored section.' });
  const amendTextField = fieldRow('New behavioral text', amendText, 'amend-text', { help: 'The amended requirement text carried into the baseline revision.' });
  const amendAuthorityField = fieldRow('Acceptance authority', amendAuthority, 'amend-authority',
    { help: 'Required. The authority recorded with the amend_baseline acceptance.', required: true });
  const amendPreviewCard = card({ title: 'Amendment preview',
    meta: 'Acceptance shows the exact patch and its consequences before authority is used.', body: element('div', 'stack') });
  amendPreviewCard.dataset.testid = 'amend-preview';
  amendPreviewCard.dataset.state = 'empty';

  const baselineDock = createDockPanel({
    title: 'Baseline comparison',
    content: (() => {
      const body = element('div', 'stack');
      body.append(fieldRow('Baseline item', itemSelect, 'item-select', { help: 'The baseline record compared against the registered original.' }),
        itemMeta, comparisonHost, amendCarry,
        element('p', 'meta', 'Comparison is a read: the record and the original stay exactly as registered.'));
      return body;
    })(),
    footer: element('p', 'meta', 'Escape collapses the dock; focus returns to the invoking control.'),
    onClose: () => syncDockTriggers(),
  });
  const impactDock = createDockPanel({
    title: 'Amendment impact',
    content: (() => {
      const body = element('div', 'stack');
      const amendGrid = element('div', 'editor-form-grid');
      amendGrid.append(amendTaskIndexField, amendTextField, amendAuthorityField);
      const amendActions = element('div', 'cluster');
      amendActions.append(amendPreviewButton, amendAcceptButton);
      body.append(amendGrid, amendActions, amendPreviewCard, amendNote,
        element('p', 'meta', 'Acceptance updates the source and linked records through amend authority; it never launches, queues or verifies a plan.'));
      return body;
    })(),
    footer: element('p', 'meta', 'Predicted invalidations are preview facts; the accepted receipt replaces them.'),
    onClose: () => syncDockTriggers(),
  });

  function setDockOpen(dock, trigger, open) {
    if (open) dock.open(trigger);
    else dock.close('trigger');
    syncDockTriggers();
  }
  function syncDockTriggers() {
    if (baselineDockTrigger) baselineDockTrigger.setAttribute('aria-pressed', String(baselineDock.isOpen()));
    if (impactDockTrigger) impactDockTrigger.setAttribute('aria-pressed', String(impactDock.isOpen()));
  }
  baselineDock.element.dataset.testid = 'baseline-dock';
  impactDock.element.dataset.testid = 'impact-dock';

  const itemAnchorFor = item => mapped.anchors.find(anchor => (anchor.linked_item_ids ?? []).includes(item.id)) ?? null;
  function amendEdits() {
    const anchor = selectedItem() ? itemAnchorFor(selectedItem()) : null;
    return [{ kind: 'set_task_text', anchor_id: anchor?.anchor_id ?? anchorSelect.value,
      item: Number(drafts.amendTaskIndex), text: drafts.amendText }];
  }
  async function previewAmendment() {
    setFieldError(amendAuthorityField, '');
    const item = selectedItem();
    if (!item) { setStatus('refused', 'refused · ITEM_REQUIRED · select the baseline item being amended'); return; }
    if (!drafts.amendAuthority.trim()) {
      setFieldError(amendAuthorityField, 'Acceptance authority is required — name the authority behind this amendment.');
      setStatus('refused', 'refused · AUTHORITY_REQUIRED · acceptance names its authority; nothing was sent');
      renderAmendPreview('refused');
      return;
    }
    const record = sourceRecord();
    setStatus('pending', 'Composing the amendment preview through source.edit.preview…');
    await track(async () => {
      try {
        const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
          expected_revision: current.snapshot.revision, operation: 'source.edit.preview',
          payload: { authority: drafts.amendAuthority, source_id: selection.sourceId,
            expected_sha256: record.accepted_sha256, expected_source_revision: record.revision, edits: amendEdits() } });
        previews.amend = outcome.result.status === 'valid' ? { result: outcome.result } : null;
        setStatus(outcome.result.status === 'valid' ? 'valid' : 'invalid',
          outcome.result.status === 'valid' ? `valid · amendment preview · ${outcome.result.changed_ids.length} identities touched`
            : `invalid · ${outcome.result.reason ?? 'INVALID'} · nothing changed`);
      } catch (error) {
        previews.amend = null;
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
      renderAmendPreview(statusState);
      updateDirty();
    });
  }
  async function acceptAmendment() {
    const item = selectedItem();
    if (!previews.amend) { setStatus('refused', 'refused · PREVIEW_REQUIRED · acceptance needs a current valid preview'); return; }
    if (!drafts.amendAuthority.trim()) {
      setFieldError(amendAuthorityField, 'Acceptance authority is required — name the authority behind this amendment.');
      setStatus('refused', 'refused · AUTHORITY_REQUIRED · acceptance names its authority; nothing was sent');
      return;
    }
    const record = sourceRecord();
    const toRevision = item.revision + 1;
    setStatus('pending', 'Accepting through amend_baseline…');
    await track(async () => {
      const itemInput = { id: item.id, kind: item.kind, state: item.state,
        ...(item.strength ? { strength: item.strength } : {}),
        source: { source_id: selection.sourceId, sha256: previews.amend.result.next_sha256, anchor_id: item.source.anchor_id } };
      const planUpdates = plansOfSource()
        .filter(plan => drafts.carry.has(plan.id))
        .map(plan => ({ plan_id: plan.id,
          baseline_refs: plan.baseline_refs.map(reference => reference.item_id === item.id
            ? { ...reference, item_revision: toRevision } : reference) }));
      try {
        const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
          expected_revision: current.snapshot.revision, operation: 'amend_baseline',
          payload: { authority: drafts.amendAuthority,
            source: { source_id: selection.sourceId, expected_sha256: record.accepted_sha256, expected_source_revision: record.revision },
            edits: previews.amend.result.edits, items: [itemInput], plan_updates: planUpdates } });
        if (commandResultState(outcome) === 'saved') {
          previews.receiptInvalidations = outcome.receipt.invalidations ?? [];
          setStatus('saved', `saved · amend_baseline · baseline revision ${outcome.receipt.baseline_revision} · no plan was run`);
          previews.amend = null;
          drafts.amendText = ''; amendText.value = '';
          drafts.amendAuthority = ''; amendAuthority.value = '';
          setFieldError(amendAuthorityField, '');
          updateDirty();
          await refresh();
        } else {
          setStatus('conflict', `conflict · ${outcome.receipt.reason ?? 'REVISION_CONFLICT'} · nothing changed`);
        }
      } catch (error) {
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
    });
  }
  function invalidationRows(facts, authoritative) {
    const list = element('ul', 'editor-invalidations stack');
    list.dataset.testid = 'amend-invalidations';
    if (!facts.length) {
      list.append(element('li', 'meta', 'no invalidation facts · no linked plan cites an older revision'));
      return list;
    }
    for (const fact of facts) {
      const item = element('li', 'stack');
      item.append(element('span', 'meta', `${fact.item_id} · ${fact.reason} · r${fact.from_revision} → r${fact.to_revision}`
        + (authoritative ? ' · from the accepted receipt' : ' · preview · derived from current references')));
      const plans = element('ul', '');
      for (const entry of fact.affected) {
        plans.append(element('li', 'meta', `${entry.plan_id} · considered ${entry.considered_revision} · carried_forward: ${entry.carried_forward}`));
      }
      item.append(plans);
      list.append(item);
    }
    return list;
  }
  function renderAmendPreview(state) {
    amendPreviewCard.dataset.state = state ?? 'empty';
    const body = amendPreviewCard.querySelector('.lb-card-body') ?? amendPreviewCard;
    body.replaceChildren();
    if (!previews.amend) {
      body.append(element('p', 'meta', 'No amendment preview yet. Acceptance shows the exact patch and its consequences before authority is used.'));
    } else {
      const result = previews.amend.result;
      body.append(element('p', 'meta', `${result.current_sha256?.slice(0, 12)}… → ${result.next_sha256?.slice(0, 12)}… · authority ${result.authority}`));
      const patch = element('pre', 'editor-patch', result.patch_text ?? '');
      patch.dataset.testid = 'amend-patch';
      body.append(patch, element('h4', '', 'Predicted invalidations'));
      body.append(invalidationRows(predictedInvalidations(current.snapshot, selectedItem()?.id, (selectedItem()?.revision ?? 0) + 1), false));
    }
    if (previews.receiptInvalidations?.length) {
      body.append(element('h4', '', 'Invalidations from the accepted receipt'));
      body.append(invalidationRows(previews.receiptInvalidations, true));
    }
    amendAcceptButton.disabled = !(previews.amend && drafts.amendAuthority.trim().length > 0);
    if (amendAcceptButton.disabled) amendAcceptButton.title = 'Acceptance needs a current valid preview and a named authority.';
    else amendAcceptButton.removeAttribute('title');
  }

  // ---- rendering ----
  function renderSourceSelect() {
    const previous = selection.sourceId;
    sourceSelect.replaceChildren(...sources().map(source => option(source.id, `${source.id} · ${source.role}`)));
    sourceSelect.value = sources().some(source => source.id === previous) ? previous : sources()[0]?.id ?? '';
  }
  function renderSourceMeta() {
    const record = sourceRecord();
    if (!record) { sourceMeta.textContent = 'No registered source.'; return; }
    const observation = current.snapshot.sources.find(source => source.id === record.id)?.observation?.status ?? 'unobserved';
    const drift = capture.sha256 && capture.sha256 !== record.accepted_sha256;
    sourceMeta.textContent = `${record.path} · role ${record.role} · source revision ${record.revision} · observation ${observation}`
      + (drift ? ` · capture diverged (${capture.sha256.slice(0, 8)}… vs accepted ${record.accepted_sha256.slice(0, 8)}…)` : '');
  }
  function renderRendered() {
    const pane = panes.rendered;
    pane.replaceChildren();
    if (!capture.content) {
      pane.append(emptyState({ icon: 'list', title: 'The registered original has not been captured yet',
        detail: 'Select a registered source; the capture loads through the native source authority.' }));
      return;
    }
    pane.append(element('p', 'meta', `${capture.path} · ${capture.sha256?.slice(0, 12)}… · fenced examples render as authored content`));
    const reading = createDocumentView({ markdown: capture.content, title: capture.path ?? 'Registered original', chrome: false });
    reading.element.classList.add('editor-document');
    pane.append(reading.element);
  }
  function renderAnchorSurface() {
    const anchorOptions = mapped.anchors.map(anchor => option(anchor.anchor_id ?? 'unassigned',
      `${anchor.title}${anchor.ambiguous ? ' (ambiguous)' : ''}`
      + (anchor.linked_plan_ids?.length ? ` · plans: ${anchor.linked_plan_ids.join(', ')}` : '')
      + (anchor.linked_item_ids?.length ? ` · criteria: ${anchor.linked_item_ids.join(', ')}` : '')));
    const previous = anchorSelect.value;
    anchorSelect.replaceChildren(...anchorOptions);
    anchorSelect.value = anchorOptions.some(node => node.value === previous) ? previous : anchorOptions[0]?.value ?? '';
    // Fresh nodes: appending the same option elsewhere would move it out of the
    // anchor selector (DOM nodes have exactly one parent).
    beforeSelect.replaceChildren(option('', 'end of document'), ...mapped.anchors.map(anchor => option(anchor.anchor_id ?? 'unassigned',
      `${anchor.title}${anchor.ambiguous ? ' (ambiguous)' : ''}`)));
    const anchor = currentAnchor();
    anchorMeta.textContent = anchor
      ? `${anchor.title} · ${anchor.anchor_id ?? 'unassigned anchor'} · capture ${mapped.observation ?? 'unobserved'}`
        + (anchor.linked_plan_ids?.length ? ` · linked plans: ${anchor.linked_plan_ids.join(', ')}` : '')
        + (anchor.linked_item_ids?.length ? ` · linked criteria: ${anchor.linked_item_ids.join(', ')}` : '')
      : 'No anchor selected.';
    anchorTasks.replaceChildren();
    const tasks = sectionTasks(capture.content, anchor?.title ?? null);
    tasks.forEach((task, index) => {
      const row = element('li', 'cluster');
      row.dataset.testid = 'anchor-task';
      row.dataset.index = String(index);
      row.dataset.checked = String(task.checked);
      row.append(statusChip({ state: task.checked ? 'verified' : 'neutral', label: task.checked ? 'done' : 'open' }),
        element('span', '', task.text));
      anchorTasks.append(row);
    });
    if (!tasks.length) anchorTasks.append(element('li', 'meta', 'No checklist item in this section.'));
    const record = sourceRecord();
    expectedLine.textContent = record
      ? `project revision ${current.snapshot.revision} · source revision ${record.revision} · expected sha ${record.accepted_sha256.slice(0, 12)}…`
      : 'no source';
  }
  function renderKindFields() {
    stateField.hidden = drafts.kind !== 'set_task_state';
    textField.hidden = drafts.kind !== 'set_task_text';
    titleField.hidden = drafts.kind !== 'rename_heading';
    beforeField.hidden = drafts.kind !== 'move_section';
  }
  function renderStructured() {
    const plans = plansOfSource();
    const previous = selection.planId;
    planSelect.replaceChildren(...plans.map(plan => option(plan.id, `${plan.id} · ${plan.title}`)));
    if (plans.some(plan => plan.id === previous)) { planSelect.value = previous; }
    else { selection.planId = plans[0]?.id ?? null; planSelect.value = selection.planId ?? ''; }
    const plan = selectedPlan();
    if (!plan) { planDetailHost.replaceChildren(element('p', 'meta', 'No plan record is bound to this source.')); return; }
    const anchorTitleOfPlan = plan.source.anchor_id === 'document' ? null : plan.source.anchor_id.replace(/^heading:/, '');
    const tasks = sectionTasks(capture.content, anchorTitleOfPlan);
    planDetailHost.replaceChildren(card({
      title: plan.title,
      meta: plan.id,
      body: (() => {
        const body = element('div', 'stack');
        body.append(factsTable([
          ['Declared lifecycle', plan.declared_lifecycle],
          ['Plan revision', `r${plan.revision}`],
          ['Baseline references', plan.baseline_refs.map(ref => `${ref.item_id}@r${ref.item_revision}`).join(', ') || 'unassessed'],
          ['Native runs', plan.native_runs.length ? plan.native_runs.map(run => run.run_id).join(', ') : 'none linked'],
          ['Original anchor', plan.source.anchor_id]]));
        body.append(element('h4', '', 'Original checklist'));
        if (tasks.length) {
          body.append(rowList({
            items: tasks.map(task => ({ title: task.text,
              trailing: { state: task.checked ? 'verified' : 'neutral', label: task.checked ? 'done' : 'open' } })),
          }));
        } else body.append(element('p', 'meta', 'The original carries no checklist under this plan.'));
        return body;
      })(),
    }));
    transitionSuccessor.replaceChildren(option('', 'none'),
      ...(current.snapshot.plans ?? []).filter(candidate => candidate.id !== plan.id)
        .map(candidate => option(candidate.id, candidate.id)));
    transitionSuccessor.value = [...transitionSuccessor.childNodes].some(node => node.value === drafts.successor)
      ? drafts.successor : '';
  }
  function renderBaseline() {
    const items = itemsOfSource();
    const previous = selection.itemId;
    itemSelect.replaceChildren(...items.map(item => option(item.id, `${item.id} · ${item.title}`)));
    if (items.some(item => item.id === previous)) { itemSelect.value = previous; }
    else { selection.itemId = items[0]?.id ?? null; itemSelect.value = selection.itemId ?? ''; }
    const item = selectedItem();
    if (!item) { itemMeta.textContent = 'No baseline item is bound to this source.'; amendCarry.replaceChildren(); comparisonHost.replaceChildren(); return; }
    const anchor = itemAnchorFor(item);
    const linkedPlans = (current.snapshot.plans ?? []).filter(plan => plan.baseline_refs.some(ref => ref.item_id === item.id));
    itemMeta.textContent = `${item.kind} · ${item.state} · r${item.revision} · ${item.source.anchor_id}`
      + (anchor ? ` · section anchor ${anchor.anchor_id}` : ' · no unique section anchor')
      + (linkedPlans.length ? ` · linked plans: ${linkedPlans.map(plan => plan.id).join(', ')}` : ' · no linked plans');
    const anchorTitle = anchor?.title ?? null;
    const originalTask = sectionTasks(capture.content, anchorTitle)[Number(drafts.amendTaskIndex)] ?? null;
    comparisonHost.replaceChildren(card({
      title: 'Record versus registered original',
      meta: `baseline revision r${item.revision}`,
      body: (() => {
        const body = element('div', 'stack');
        body.append(dataTable({
          caption: 'The baseline record as accepted, next to the original text it was accepted from.',
          columns: [{ key: 'side', label: 'Source' }, { key: 'text', label: 'Requirement text' }, { key: 'state', label: 'State' }],
          rows: [
            ['Recorded in the baseline', item.text ?? item.title ?? '', `${item.kind} · ${item.state} · r${item.revision}`],
            [originalTask ? 'In the registered original now' : 'Original anchor', originalTask ? originalTask.text : 'not addressed by the current anchor',
              originalTask ? (originalTask.checked ? 'done' : 'open') : 'unavailable'],
          ],
        }));
        return body;
      })(),
    }));
    amendCarry.replaceChildren(element('span', 'meta', 'Carry linked plan references forward inside this acceptance; unchecked plans stay pending reconciliation'));
    for (const plan of linkedPlans) {
      const historical = ['completed', 'superseded', 'abandoned'].includes(plan.declared_lifecycle);
      const toggle = button(`${plan.id}${historical ? ' · historical (immutable)' : ''}`, historical ? null : () => {
        if (drafts.carry.has(plan.id)) drafts.carry.delete(plan.id); else drafts.carry.add(plan.id);
        renderCarry();
        updateDirty();
      }, { disabled: historical });
      toggle.dataset.planId = plan.id;
      toggle.setAttribute('aria-pressed', String(drafts.carry.has(plan.id)));
      if (historical) toggle.title = 'Historical plans keep the revisions they considered; they cannot carry forward.';
      amendCarry.append(toggle);
    }
  }
  function renderCarry() {
    for (const toggle of amendCarry.querySelectorAll('button[data-plan-id]')) {
      toggle.setAttribute('aria-pressed', String(drafts.carry.has(toggle.dataset.planId)));
    }
  }
  function renderNarrow() {
    const focused = document.activeElement?.dataset?.view === 'narrow' ? document.activeElement.dataset.nodeId : null;
    narrowList.replaceChildren();
    if (selection.narrow) {
      const push = (id, label, kind, depth, onSelect, summary) => {
        const row = element('li', `editor-row kind-${kind}`);
        row.dataset.nodeId = id;
        row.dataset.kind = kind;
        row.setAttribute('aria-level', String(depth + 1));
        const control = button(label, onSelect);
        control.dataset.testid = 'editor-row';
        control.dataset.nodeId = id;
        control.dataset.view = 'narrow';
        control.className = 'editor-row-control';
        row.append(control, element('span', 'meta', summary));
        narrowList.append(row);
      };
      for (const source of sources()) {
        push(source.id, `${source.id} — ${source.role} source`, 'source', 0, () => selectSource(source.id), `${source.path} · r${source.revision}`);
        if (source.id !== selection.sourceId) continue;
        for (const plan of plansOfSource()) {
          push(plan.id, `${plan.title} (${plan.id})`, 'plan', 1,
            () => { choosePlan(plan.id); setMode('structured'); }, `${plan.declared_lifecycle} · r${plan.revision}`);
          if (plan.id !== selection.planId) continue;
          for (const item of itemsOfSource()) {
            push(item.id, `${item.title} — ${item.text.replace(/\s+/g, ' ').trim().slice(0, 120)}`, 'item', 2,
              () => { chooseItem(item.id); setDockOpen(baselineDock, null, true); }, `${item.kind} · r${item.revision}`);
          }
        }
      }
    }
    if (focused) narrowList.querySelector(`.editor-row-control[data-node-id="${focused}"]`)?.focus();
  }
  function renderModes() {
    for (const mode of EDITOR_MODES) panes[mode].hidden = mode !== selection.mode;
    narrowList.hidden = !selection.narrow;
    modeSwitcher.setCurrent(selection.mode);
    root.dataset.narrow = String(selection.narrow);
  }
  function renderAll() {
    renderSourceSelect();
    renderSourceMeta();
    renderRendered();
    renderAnchorSurface();
    renderKindFields();
    renderStructured();
    renderBaseline();
    renderTransitions();
    renderPreview(previews.edit ? statusState : 'empty');
    renderAmendPreview(previews.amend ? statusState : 'empty');
    renderNarrow();
    renderModes();
    updateDirty();
  }

  async function loadSource(sourceId, { keepStatus = false } = {}) {
    selection.sourceId = sourceId;
    if (!keepStatus) setStatus('pending', `Capturing ${sourceId}…`);
    if (!sources().some(source => source.id === sourceId)) {
      capture.content = ''; mapped.anchors = [];
      setStatus('refused', 'refused · UNKNOWN_SOURCE · select a registered source');
      renderAll();
      return;
    }
    try {
      const captured = await captureSource(sourceId);
      capture.path = captured.path; capture.sha256 = captured.sha256; capture.content = captured.content;
    } catch (error) {
      capture.content = '';
      setStatus('refused', `refused · ${/^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? '') ? error.code : 'SOURCE_UNAVAILABLE'} · the original could not be captured`);
      renderAll();
      return;
    }
    try {
      const outcome = await send({ schema_version: 1, command_id: nextCommandId(), project_id: current.snapshot.project_id,
        expected_revision: current.snapshot.revision, operation: 'source.map', payload: { source_id: sourceId } });
      mapped.anchors = outcome.result.anchors ?? [];
      mapped.observation = outcome.result.observation ?? null;
      mapped.sha256 = outcome.result.sha256 ?? null;
      if (!keepStatus) setStatus('valid', `captured · ${capture.path} · ${mapped.anchors.length} anchors mapped`);
    } catch (error) {
      mapped.anchors = [];
      setStatus('refused', `refused · ${error.typedCode} · anchors unavailable`);
    }
    selection.planId = plansOfSource()[0]?.id ?? null;
    selection.itemId = itemsOfSource()[0]?.id ?? null;
    previews.edit = null; previews.amend = null;
    await refreshAssessments();
    renderAll();
  }
  // selectSource queues onto the command lane; refresh loads directly because
  // it already runs inside a tracked command's work (re-queuing would deadlock).
  function selectSource(sourceId, options = {}) {
    return track(() => loadSource(sourceId, options));
  }
  function refresh() {
    return loadSource(selection.sourceId, { keepStatus: true });
  }
  function setMode(mode) {
    if (!EDITOR_MODES.includes(mode)) return;
    selection.mode = mode;
    renderModes();
  }
  async function choosePlan(planId) {
    selection.planId = planId;
    planSelect.value = planId;
    await track(async () => { await refreshAssessments(); renderStructured(); renderTransitions(); renderNarrow(); });
  }
  function chooseItem(itemId) {
    selection.itemId = itemId;
    itemSelect.value = itemId;
    renderBaseline();
    renderAmendPreview(previews.amend ? statusState : 'empty');
    renderNarrow();
  }

  // ---- events ----
  sourceSelect.addEventListener('change', () => selectSource(sourceSelect.value));
  planSelect.addEventListener('change', () => choosePlan(planSelect.value));
  itemSelect.addEventListener('change', () => chooseItem(itemSelect.value));
  anchorSelect.addEventListener('change', () => renderAnchorSurface());
  for (const [control, key] of [[taskIndex, 'taskIndex'], [textInput, 'text'], [titleInput, 'title'], [authorityInput, 'authority']]) {
    control.addEventListener('input', () => {
      drafts[key] = control.value;
      if (key === 'taskIndex') setFieldError(taskIndexField, '');
      if (key === 'authority') setFieldError(authorityField, '');
      updateDirty();
    });
  }
  kindSelect.addEventListener('change', () => { drafts.kind = kindSelect.value; renderKindFields(); });
  stateSelect.addEventListener('change', () => { drafts.stateValue = stateSelect.value; });
  beforeSelect.addEventListener('change', () => { drafts.before = beforeSelect.value; });
  amendTaskIndex.addEventListener('input', () => { drafts.amendTaskIndex = amendTaskIndex.value; renderBaseline(); });
  amendText.addEventListener('input', () => { drafts.amendText = amendText.value; updateDirty(); });
  amendAuthority.addEventListener('input', () => {
    drafts.amendAuthority = amendAuthority.value;
    setFieldError(amendAuthorityField, '');
    amendAcceptButton.disabled = !(previews.amend && drafts.amendAuthority.trim().length > 0);
    updateDirty();
  });
  transitionReason.addEventListener('input', () => {
    drafts.reason = transitionReason.value;
    updateDirty();
    track(async () => { await refreshAssessments(); renderTransitions(); });
  });
  transitionSuccessor.addEventListener('change', () => {
    drafts.successor = transitionSuccessor.value;
    updateDirty();
    track(async () => { await refreshAssessments(); renderTransitions(); });
  });
  textInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); previewEdit(); }
  });
  function onKeydown(event) {
    const target = event.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (target.dataset?.view !== 'narrow') {
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index >= 0) { event.preventDefault(); setMode(EDITOR_MODES[index]); }
      return;
    }
    const controls = [...narrowList.querySelectorAll('.editor-row-control')];
    const position = controls.indexOf(target);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = controls[position + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      target.click();
    }
  }
  // The tree-local listener serves detached hosts (mini-DOM tests); a connected
  // page also gets the shortcuts when focus sits outside the editor tree.
  root.addEventListener('keydown', onKeydown);
  document.addEventListener('keydown', event => {
    if (!root.isConnected) return;
    if (root.contains(event.target)) return;
    onKeydown(event);
  });

  // ---- toolbar (segmented surface switch + dock actions) ----
  const modeSwitcher = segmentedControl({
    label: 'Editor surface',
    options: EDITOR_MODES.map(mode => ({ value: mode, label: MODE_LABELS[mode] })),
    current: selection.mode,
    onChange: next => setMode(next),
  });
  modeSwitcher.element.dataset.testid = 'editor-modes';
  for (const control of modeSwitcher.element.querySelectorAll('button')) control.dataset.editorMode = control.dataset.segment;
  const baselineDockTrigger = button('Baseline comparison', () => setDockOpen(baselineDock, baselineDockTrigger, !baselineDock.isOpen()));
  baselineDockTrigger.dataset.testid = 'baseline-dock-trigger';
  baselineDockTrigger.setAttribute('aria-pressed', 'false');
  baselineDockTrigger.setAttribute('aria-label', 'Open the baseline comparison dock');
  const impactDockTrigger = button('Amendment impact', () => setDockOpen(impactDock, impactDockTrigger, !impactDock.isOpen()));
  impactDockTrigger.dataset.testid = 'impact-dock-trigger';
  impactDockTrigger.setAttribute('aria-pressed', 'false');
  impactDockTrigger.setAttribute('aria-label', 'Open the amendment impact preview dock');

  // ---- shell ----
  (function buildShell() {
    const head = element('header', 'stack');
    const titleRow = element('div', 'cluster spread');
    // T20 in-surface dirty indicator: the hosting tab's dot degrades silently
    // in the tab-less shell, so the editor's own page header carries the chip.
    dirtyChip = statusChip({ state: 'attention', label: 'Unsaved changes' });
    dirtyChip.dataset.testid = 'editor-dirty-chip';
    dirtyChip.setAttribute('role', 'img');
    dirtyChip.setAttribute('aria-label', 'Unsaved changes');
    dirtyChip.title = 'Unsaved drafts — leaving this surface asks before discarding.';
    dirtyChip.hidden = true;
    titleRow.append(element('h2', '', 'Project and plan editors'), dirtyChip,
      element('span', 'meta', 'Edits land on the registered original through the shared command route; nothing here runs a plan.'));
    head.append(titleRow, fieldRow('Registered source', sourceSelect, 'source-select',
      { help: 'The registered original every surface below reads and edits.' }), sourceMeta);
    const toolbar = element('div', 'editor-toolbar cluster spread');
    toolbar.dataset.testid = 'editor-toolbar';
    const dockActions = element('div', 'cluster');
    dockActions.append(baselineDockTrigger, impactDockTrigger);
    toolbar.append(modeSwitcher.element, dockActions);
    root.append(head, toolbar, status);

    panes.structured.append(element('h3', '', 'Structured plan record'), fieldRow('Plan record', planSelect, 'plan-select',
      { help: 'The native plan record registered against this source.' }), planDetailHost,
      element('h3', '', 'Lifecycle transitions'), transitionBody);

    const composeCard = card({
      title: 'Compose the staged edit',
      meta: 'Syntax-aware: the edit addresses an anchor and a checklist item; the route validates the grammar.',
      body: (() => {
        const body = element('div', 'stack');
        const addressGrid = element('div', 'editor-form-grid');
        addressGrid.append(anchorField, taskIndexField, kindField);
        const valueGrid = element('div', 'editor-form-grid');
        valueGrid.append(stateField, textField, titleField, beforeField);
        const checklistHost = element('div', 'stack');
        checklistHost.append(element('h4', '', 'Addressed checklist'), anchorTasks);
        body.append(addressGrid, valueGrid, authorityField, checklistHost);
        return body;
      })(),
      footer: (() => {
        const foot = element('div', 'cluster');
        foot.append(previewButton, applyButton, expectedLine);
        return foot;
      })(),
    });
    const split = element('div', 'editor-split');
    split.append(splitOriginal, splitEdited);
    panes.source.append(element('h3', '', 'Staged source edit'), anchorMeta, composeCard,
      element('h3', '', 'Original versus staged edit'), split, previewCard);

    for (const mode of EDITOR_MODES) root.append(panes[mode]);
    root.append(narrowList);
    root.append(baselineDock.element, impactDock.element, closeGuard.element, retireGuard.element, leaveGuard.element);
  })();

  const ready = selectSource(selection.sourceId).then(() => { syncTabChrome(); });

  return {
    element: root,
    ready,
    settled: () => pending.then(() => { syncTabChrome(); }),
    setMode,
    setNarrow(narrow) { selection.narrow = Boolean(narrow); renderNarrow(); renderModes(); },
    selectSource: id => selectSource(id),
    selectPlan: id => choosePlan(id),
    selectItem: id => chooseItem(id),
    openBaselineComparison(trigger) { setDockOpen(baselineDock, trigger ?? baselineDockTrigger, true); },
    openImpactPreview(trigger) { setDockOpen(impactDock, trigger ?? impactDockTrigger, true); },
    needsLeaveGuard,
    confirmLeave,
    update(nextSnapshot, options = {}) {
      if (!nextSnapshot || nextSnapshot.project_id !== current.snapshot.project_id) return;
      current.snapshot = nextSnapshot;
      renderSourceSelect();
      renderSourceMeta();
      renderAnchorSurface();
      renderStructured();
      renderBaseline();
      renderTransitions();
      renderNarrow();
      updateDirty();
      if (options.refetch) track(refresh);
    },
    getState() {
      return { sourceId: selection.sourceId, planId: selection.planId, itemId: selection.itemId,
        mode: selection.mode, narrow: selection.narrow, status: { state: statusState, text: statusText },
        dirty: computeDirty(), drafts: { ...drafts, carry: [...drafts.carry] } };
    },
  };
}
