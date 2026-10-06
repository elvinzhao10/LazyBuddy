// T15 project and plan editors — DOM view over registered original documents.
// Rendered / structured / source / baseline parity per spec §4.2 through the
// shared command route of §6.1: every mutation is a typed command composed here
// and executed by the caller-provided sendCommand (source.edit.preview,
// source.edit, amend_baseline, plan.transition). The view never writes files,
// never grants verification and never composes execution operations.
import { button, element, statusChip } from './components.mjs';

export const EDITOR_MODES = Object.freeze(['rendered', 'structured', 'source', 'baseline']);
// Candidate lifecycle targets for the legality display. The values mirror
// PLAN_LIFECYCLES in project/contract.mjs; legality itself is always decided by
// the injected assessTransition (the real assessPlanTransition), never here.
const LIFECYCLES = Object.freeze(['draft', 'planned', 'active', 'paused', 'completed', 'superseded', 'abandoned']);
const MODE_LABELS = Object.freeze({ rendered: 'Rendered', structured: 'Structured', source: 'Source', baseline: 'Baseline' });

const FENCE_MARKER = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_MARKER = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/;
const TASK_MARKER = /^([ \t]*)([-*+]|\d+[.])([ \t]+)\[( |x|X)\]([ \t]*)(.*)$/;

let commandSequence = 0;
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

function option(value, label) {
  const node = element('option');
  node.value = value;
  node.textContent = label;
  return node;
}
function field(label, control, fieldId) {
  const wrapper = element('label', 'editor-field stack');
  wrapper.append(element('span', 'meta', label), control);
  if (fieldId) wrapper.dataset.field = fieldId;
  return wrapper;
}
function input(type = 'text') { const control = element('input'); control.type = type; return control; }
function factsTable(entries) {
  const facts = element('dl', 'editor-facts stack');
  for (const [term, value] of entries) {
    const row = element('div', 'cluster spread');
    row.append(element('dt', 'meta', term), element('dd', '', value));
    facts.append(row);
  }
  return facts;
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
  const status = element('p', 'meta editor-status', statusText);
  status.dataset.testid = 'editor-status';
  status.dataset.state = statusState;
  status.setAttribute('role', 'status');

  const sourceSelect = element('select');
  sourceSelect.dataset.testid = 'source-select';
  sourceSelect.setAttribute('aria-label', 'Registered source');
  const sourceMeta = element('p', 'meta', '');
  sourceMeta.dataset.testid = 'source-meta';
  const modeBar = element('div', 'cluster editor-modes');
  modeBar.setAttribute('role', 'tablist');
  modeBar.setAttribute('aria-label', 'Editor surface');
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

  // ---- structured surface: plan records + transition legality ----
  const planSelect = element('select');
  planSelect.dataset.testid = 'plan-select';
  planSelect.setAttribute('aria-label', 'Plan record');
  const planDetail = element('section', 'panel stack');
  planDetail.dataset.testid = 'plan-detail';
  const transitionBody = element('div', 'stack');
  const transitionReason = input();
  transitionReason.dataset.testid = 'transition-reason';
  const transitionSuccessor = element('select');
  transitionSuccessor.dataset.testid = 'transition-successor';

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
      const row = element('div', 'editor-transition stack');
      row.dataset.testid = 'transition-option';
      row.dataset.to = to;
      const action = button(`Move to ${to}`, () => applyTransition(to), { disabled: !assessment?.allowed });
      const reasons = element('ul', 'editor-reasons stack');
      reasons.id = `transition-reasons-${to}`;
      action.setAttribute('aria-describedby', reasons.id);
      for (const reason of assessment?.reasons ?? []) {
        const item = element('li', 'meta', `${reason.code} — ${reason.detail}`);
        item.dataset.code = reason.code;
        reasons.append(item);
      }
      if (!assessment) reasons.append(element('li', 'meta', 'ASSESSMENT_PENDING — legality is being assessed'));
      row.append(action, reasons);
      transitionBody.append(row);
    }
    transitionBody.append(field('Retirement reason', transitionReason, 'transition-reason'),
      field('Successor plan', transitionSuccessor, 'transition-successor'));
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
          await refresh();
        } else {
          setStatus('conflict', `conflict · ${outcome.receipt.reason ?? 'REVISION_CONFLICT'} · nothing changed`);
        }
      } catch (error) {
        setStatus('refused', `refused · ${error.typedCode} · nothing changed`);
      }
    });
  }

  // ---- source surface: anchor addressing + preview/apply ----
  const anchorSelect = element('select');
  anchorSelect.dataset.testid = 'anchor-select';
  anchorSelect.setAttribute('aria-label', 'Document anchor');
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
  const previewPane = element('section', 'panel stack');
  previewPane.dataset.testid = 'edit-preview';
  const previewButton = button('Preview edit · real patch', () => previewEdit());
  previewButton.dataset.testid = 'edit-preview-button';
  const applyButton = button('Apply edit through the route', () => applyEdit(), { disabled: true });
  applyButton.dataset.testid = 'edit-apply-button';
  applyButton.classList.add('primary');

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
    if (!drafts.authority.trim()) {
      previews.edit = null;
      setStatus('refused', 'refused · AUTHORITY_REQUIRED · an edit preview names its authority; nothing was sent');
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
    previewPane.dataset.state = state ?? 'empty';
    previewPane.replaceChildren();
    if (!previews.edit) {
      previewPane.append(element('p', 'meta', 'No preview yet. A preview shows the actual unified patch before anything is applied.'));
      applyButton.disabled = true;
      return;
    }
    const { result, stale } = previews.edit;
    previewPane.append(element('h4', '', stale ? 'Preview (stale after a conflict)' : 'Preview'));
    previewPane.append(element('p', 'meta', `authority ${result.authority} · ${result.current_sha256?.slice(0, 12)}… → ${result.next_sha256?.slice(0, 12)}…`));
    const patch = element('pre', 'editor-patch', result.patch_text ?? '');
    patch.dataset.testid = 'edit-patch';
    previewPane.append(patch);
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
    previewPane.append(affected);
    applyButton.disabled = !(result.status === 'valid' && !stale);
  }

  // ---- baseline surface: amendment comparison + acceptance through authority ----
  const itemSelect = element('select');
  itemSelect.dataset.testid = 'item-select';
  itemSelect.setAttribute('aria-label', 'Baseline item');
  const itemMeta = element('p', 'meta', '');
  itemMeta.dataset.testid = 'item-meta';
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
  const amendPreviewPane = element('section', 'panel stack');
  amendPreviewPane.dataset.testid = 'amend-preview';
  const amendPreviewButton = button('Preview amendment · exact patch and invalidations', () => previewAmendment());
  amendPreviewButton.dataset.testid = 'amend-preview-button';
  const amendAcceptButton = button('Accept amendment through authority', () => acceptAmendment(), { disabled: true });
  amendAcceptButton.dataset.testid = 'amend-accept-button';
  amendAcceptButton.classList.add('primary');

  const itemAnchorFor = item => mapped.anchors.find(anchor => (anchor.linked_item_ids ?? []).includes(item.id)) ?? null;
  function amendEdits() {
    const anchor = selectedItem() ? itemAnchorFor(selectedItem()) : null;
    return [{ kind: 'set_task_text', anchor_id: anchor?.anchor_id ?? anchorSelect.value,
      item: Number(drafts.amendTaskIndex), text: drafts.amendText }];
  }
  async function previewAmendment() {
    const item = selectedItem();
    if (!item) { setStatus('refused', 'refused · ITEM_REQUIRED · select the baseline item being amended'); return; }
    if (!drafts.amendAuthority.trim()) {
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
    });
  }
  async function acceptAmendment() {
    const item = selectedItem();
    if (!previews.amend) { setStatus('refused', 'refused · PREVIEW_REQUIRED · acceptance needs a current valid preview'); return; }
    if (!drafts.amendAuthority.trim()) {
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
    amendPreviewPane.dataset.state = state ?? 'empty';
    amendPreviewPane.replaceChildren();
    if (!previews.amend) {
      amendPreviewPane.append(element('p', 'meta', 'No amendment preview yet. Acceptance shows the exact patch and its consequences before authority is used.'));
    } else {
      const result = previews.amend.result;
      amendPreviewPane.append(element('h4', '', 'Amendment comparison'));
      amendPreviewPane.append(element('p', 'meta', `${result.current_sha256?.slice(0, 12)}… → ${result.next_sha256?.slice(0, 12)}… · authority ${result.authority}`));
      const patch = element('pre', 'editor-patch', result.patch_text ?? '');
      patch.dataset.testid = 'amend-patch';
      amendPreviewPane.append(patch, element('h4', '', 'Predicted invalidations'));
      amendPreviewPane.append(invalidationRows(predictedInvalidations(current.snapshot, selectedItem()?.id, (selectedItem()?.revision ?? 0) + 1), false));
    }
    if (previews.receiptInvalidations?.length) {
      amendPreviewPane.append(element('h4', '', 'Invalidations from the accepted receipt'));
      amendPreviewPane.append(invalidationRows(previews.receiptInvalidations, true));
    }
    amendAcceptButton.disabled = !(previews.amend && drafts.amendAuthority.trim().length > 0);
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
    if (!capture.content) { pane.append(element('p', 'meta', 'The registered original has not been captured yet.')); return; }
    pane.append(element('h3', '', 'Rendered original'));
    pane.append(element('p', 'meta', `${capture.path} · ${capture.sha256?.slice(0, 12)}… · fenced examples render as authored content`));
    const article = element('article', 'editor-document stack');
    for (const block of parseMarkdownView(capture.content).blocks) {
      if (block.kind === 'heading') {
        const heading = element(`h${Math.min(6, block.level)}`, 'editor-heading', block.title);
        heading.dataset.level = String(block.level);
        heading.dataset.line = String(block.line);
        article.append(heading);
      } else if (block.kind === 'fence') {
        const fence = element('pre', 'editor-fence', block.text);
        fence.dataset.line = String(block.line);
        article.append(fence);
      } else if (block.kind === 'task') {
        const row = element('div', 'editor-task cluster');
        row.dataset.checked = String(block.checked);
        row.dataset.line = String(block.line);
        row.append(statusChip({ state: block.checked ? 'verified' : 'neutral', label: block.checked ? 'done' : 'open' }),
          element('span', '', block.text));
        article.append(row);
      } else article.append(element('p', '', block.text));
    }
    pane.append(article);
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
  function renderStructured() {
    const plans = plansOfSource();
    const previous = selection.planId;
    planSelect.replaceChildren(...plans.map(plan => option(plan.id, `${plan.id} · ${plan.title}`)));
    if (plans.some(plan => plan.id === previous)) { planSelect.value = previous; }
    else { selection.planId = plans[0]?.id ?? null; planSelect.value = selection.planId ?? ''; }
    const plan = selectedPlan();
    if (!plan) { planDetail.replaceChildren(element('p', 'meta', 'No plan record is bound to this source.')); return; }
    planDetail.replaceChildren();
    planDetail.append(element('h4', '', plan.title), element('code', '', plan.id));
    planDetail.append(factsTable([
      ['Declared lifecycle', plan.declared_lifecycle],
      ['Plan revision', `r${plan.revision}`],
      ['Baseline references', plan.baseline_refs.map(ref => `${ref.item_id}@r${ref.item_revision}`).join(', ') || 'unassessed'],
      ['Native runs', plan.native_runs.length ? plan.native_runs.map(run => run.run_id).join(', ') : 'none linked'],
      ['Original anchor', plan.source.anchor_id]]));
    const planTasks = element('ul', 'editor-tasklist stack');
    const anchorTitleOfPlan = plan.source.anchor_id === 'document' ? null : plan.source.anchor_id.replace(/^heading:/, '');
    const tasks = sectionTasks(capture.content, anchorTitleOfPlan);
    tasks.forEach((task, index) => {
      const row = element('li', 'cluster');
      row.dataset.checked = String(task.checked);
      row.dataset.index = String(index);
      row.append(statusChip({ state: task.checked ? 'verified' : 'neutral', label: task.checked ? 'done' : 'open' }),
        element('span', '', task.text));
      planTasks.append(row);
    });
    if (!tasks.length) planTasks.append(element('li', 'meta', 'The original carries no checklist under this plan.'));
    planDetail.append(element('h4', '', 'Original checklist'), planTasks);
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
    if (!item) { itemMeta.textContent = 'No baseline item is bound to this source.'; amendCarry.replaceChildren(); return; }
    const anchor = itemAnchorFor(item);
    const linkedPlans = (current.snapshot.plans ?? []).filter(plan => plan.baseline_refs.some(ref => ref.item_id === item.id));
    itemMeta.textContent = `${item.kind} · ${item.state} · r${item.revision} · ${item.source.anchor_id}`
      + (anchor ? ` · section anchor ${anchor.anchor_id}` : ' · no unique section anchor')
      + (linkedPlans.length ? ` · linked plans: ${linkedPlans.map(plan => plan.id).join(', ')}` : ' · no linked plans');
    amendCarry.replaceChildren(element('span', 'meta', 'Carry linked plan references forward inside this acceptance; unchecked plans stay pending reconciliation'));
    for (const plan of linkedPlans) {
      const historical = ['completed', 'superseded', 'abandoned'].includes(plan.declared_lifecycle);
      const toggle = button(`${plan.id}${historical ? ' · historical (immutable)' : ''}`, historical ? null : () => {
        if (drafts.carry.has(plan.id)) drafts.carry.delete(plan.id); else drafts.carry.add(plan.id);
        renderCarry();
      }, { disabled: historical });
      toggle.dataset.planId = plan.id;
      toggle.setAttribute('aria-pressed', String(drafts.carry.has(plan.id)));
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
              () => { chooseItem(item.id); setMode('baseline'); }, `${item.kind} · r${item.revision}`);
          }
        }
      }
    }
    if (focused) narrowList.querySelector(`.editor-row-control[data-node-id="${focused}"]`)?.focus();
  }
  function renderModes() {
    for (const mode of EDITOR_MODES) panes[mode].hidden = mode !== selection.mode;
    narrowList.hidden = !selection.narrow;
    for (const node of modeBar.querySelectorAll('[data-mode]')) {
      node.setAttribute('aria-pressed', String(node.dataset.mode === selection.mode));
      node.setAttribute('aria-selected', String(node.dataset.mode === selection.mode));
    }
    root.dataset.narrow = String(selection.narrow);
  }
  function renderAll() {
    renderSourceSelect();
    renderSourceMeta();
    renderRendered();
    renderAnchorSurface();
    renderStructured();
    renderBaseline();
    renderTransitions();
    renderPreview(previews.edit ? statusState : 'empty');
    renderAmendPreview(previews.amend ? statusState : 'empty');
    renderNarrow();
    renderModes();
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
  for (const mode of EDITOR_MODES) {
    const control = button(MODE_LABELS[mode], () => setMode(mode));
    control.dataset.mode = mode;
    control.setAttribute('role', 'tab');
    modeBar.append(control);
  }
  planSelect.addEventListener('change', () => choosePlan(planSelect.value));
  itemSelect.addEventListener('change', () => chooseItem(itemSelect.value));
  anchorSelect.addEventListener('change', () => renderAnchorSurface());
  for (const [control, key] of [[taskIndex, 'taskIndex'], [textInput, 'text'], [titleInput, 'title'], [authorityInput, 'authority']]) {
    control.addEventListener('input', () => { drafts[key] = control.value; });
  }
  kindSelect.addEventListener('change', () => { drafts.kind = kindSelect.value; });
  stateSelect.addEventListener('change', () => { drafts.stateValue = stateSelect.value; });
  beforeSelect.addEventListener('change', () => { drafts.before = beforeSelect.value; });
  amendTaskIndex.addEventListener('input', () => { drafts.amendTaskIndex = amendTaskIndex.value; });
  amendText.addEventListener('input', () => { drafts.amendText = amendText.value; });
  amendAuthority.addEventListener('input', () => {
    drafts.amendAuthority = amendAuthority.value;
    amendAcceptButton.disabled = !(previews.amend && drafts.amendAuthority.trim().length > 0);
  });
  transitionReason.addEventListener('input', () => {
    drafts.reason = transitionReason.value;
    track(async () => { await refreshAssessments(); renderTransitions(); });
  });
  transitionSuccessor.addEventListener('change', () => {
    drafts.successor = transitionSuccessor.value;
    track(async () => { await refreshAssessments(); renderTransitions(); });
  });
  textInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); previewEdit(); }
  });
  function onKeydown(event) {
    const target = event.target;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (target.dataset?.view !== 'narrow') {
      const index = ['1', '2', '3', '4'].indexOf(event.key);
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

  // ---- shell ----
  (function buildShell() {
    const head = element('header', 'stack');
    const titleRow = element('div', 'cluster spread');
    titleRow.append(element('h2', '', 'Project and plan editors'),
      element('span', 'meta', 'Edits land on the registered original through the shared command route; nothing here runs a plan.'));
    head.append(titleRow, field('Registered source', sourceSelect), sourceMeta);
    root.append(head, modeBar, status);
    panes.structured.append(element('h3', '', 'Structured plan record'), field('Plan record', planSelect), planDetail,
      element('h4', '', 'Lifecycle transitions'), transitionBody);
    const editGrid = element('div', 'cluster editor-grid');
    editGrid.append(field('Anchor', anchorSelect), field('Checklist item', taskIndex), field('Edit kind', kindSelect));
    const valueGrid = element('div', 'cluster editor-grid');
    valueGrid.append(field('State', stateSelect), field('New text', textInput), field('New heading title', titleInput), field('Move before', beforeSelect));
    const actionRow = element('div', 'cluster');
    actionRow.append(previewButton, applyButton);
    panes.source.append(element('h3', '', 'Source text over the registered original'), anchorMeta, editGrid, valueGrid,
      field('Authority reference (required)', authorityInput), expectedLine, anchorTasks, actionRow, previewPane);
    const amendGrid = element('div', 'cluster editor-grid');
    amendGrid.append(field('Baseline item', itemSelect), field('Checklist item', amendTaskIndex), field('New behavioral text', amendText));
    const amendActions = element('div', 'cluster');
    amendActions.append(amendPreviewButton, amendAcceptButton);
    panes.baseline.append(element('h3', '', 'Baseline comparison and amendment'), itemMeta, amendGrid,
      field('Acceptance authority (required)', amendAuthority), amendCarry, amendActions, amendPreviewPane,
      element('p', 'meta', 'Acceptance updates the source and linked records through amend authority; it never launches, queues or verifies a plan.'));
    for (const mode of EDITOR_MODES) root.append(panes[mode]);
    root.append(narrowList);
  })();

  const ready = selectSource(selection.sourceId);

  return {
    element: root,
    ready,
    settled: () => pending.then(() => {}),
    setMode,
    setNarrow(narrow) { selection.narrow = Boolean(narrow); renderNarrow(); renderModes(); },
    selectSource: id => selectSource(id),
    selectPlan: id => choosePlan(id),
    selectItem: id => chooseItem(id),
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
      if (options.refetch) track(refresh);
    },
    getState() {
      return { sourceId: selection.sourceId, planId: selection.planId, itemId: selection.itemId,
        mode: selection.mode, narrow: selection.narrow, status: { state: statusState, text: statusText },
        drafts: { ...drafts, carry: [...drafts.carry] } };
    },
  };
}
