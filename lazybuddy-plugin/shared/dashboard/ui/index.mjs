import { createDashboardConnection } from './connection.mjs';
import { createPlanningEditor } from './editing.mjs';
import { createTaskInspector } from './inspector-view.mjs';
import { createVerificationView } from './verification-view.mjs';
import { createWorkView } from './work-view.mjs';

const connection = createDashboardConnection();
const connectionStatus = document.querySelector('[data-testid="connection-status"]');
const connectForm = document.querySelector('#connect-form');
const accessKey = document.querySelector('[data-testid="access-key"]');
const tabs = document.querySelector('#view-tabs');
const evidencePreview = document.querySelector('#evidence-preview'); let evidenceObjectUrl = null;
const roots = { work: document.querySelector('#work-root'), verification: document.querySelector('#verification-root'), editing: document.querySelector('#editing-root') };
let envelope; let work; let verification; let inspector; let editor; let pollTimer;
let resumeField = null;
const viewContext = { connection: 'disconnected' };
let savedDraft = null; try { savedDraft = JSON.parse(sessionStorage.getItem('lazybuddy-draft')); } catch { savedDraft = null; }
const evidenceHref = evidence => {
  const reference = envelope?.evidence.find(item => item.path === evidence.path && (!evidence.sha256 || item.sha256 === evidence.sha256));
  return reference && !reference.unavailable_reason ? `/api/evidence/${reference.id}` : '#';
};
async function openEvidence(evidence, href) {
  try {
    const blob = await connection.evidence(new URL(href, location.href).pathname); if (evidenceObjectUrl) URL.revokeObjectURL(evidenceObjectUrl); evidenceObjectUrl = URL.createObjectURL(blob);
    evidencePreview.querySelector('[data-evidence-name]').textContent = evidence.path; evidencePreview.querySelector('pre').textContent = await blob.text();
    evidencePreview.querySelector('[data-action="download-evidence"]').href = evidenceObjectUrl; evidencePreview.showModal();
  } catch (error) { state(`Evidence unavailable · ${error.message}`, 'failed'); }
}
evidencePreview.querySelector('[data-action="close-evidence"]').addEventListener('click', () => evidencePreview.close());
function state(label, value = 'neutral') { connectionStatus.textContent = label; connectionStatus.dataset.state = value; }
function showView(name) {
  for (const [key, root] of Object.entries(roots)) root.hidden = key !== name;
  for (const key of Object.keys(roots)) document.querySelector(`#${key}-tab`).setAttribute('aria-pressed', String(key === name));
}
for (const name of Object.keys(roots)) document.querySelector(`#${name}-tab`).addEventListener('click', () => showView(name));
function apply(next) {
  envelope = next; viewContext.connection = 'connected'; state(`Connected · revision ${next.snapshot.revision}`, 'verified');
  const readOnlyReason = next.editability?.supported === false ? next.editability.reason : null;
  if (!work) {
    const saved = localStorage.getItem('lazybuddy-work-mode'); const mode = matchMedia('(max-width: 44rem)').matches ? 'list' : (saved === 'list' ? 'list' : 'graph');
    inspector = createTaskInspector({ snapshot: next.snapshot, context: { evidenceHref, openEvidence } }); document.body.append(inspector.element);
    editor = createPlanningEditor({ snapshot: next.snapshot, initialDraft: savedDraft, onDraftChange: draft => sessionStorage.setItem('lazybuddy-draft', JSON.stringify(draft)),
      onCommand: async command => { const result = await connection.command(command); schedule(80); return result; } });
    const callbacks = { onSelect({ taskId, trigger }) { editor.select(taskId); inspector.open(taskId, trigger); }, onLayoutChange() { state('Layout changed locally. No authority command sent.', 'neutral'); }, onModeChange({ mode: nextMode }) { localStorage.setItem('lazybuddy-work-mode', nextMode); } };
    work = createWorkView({ snapshot: next.snapshot, callbacks, context: { ...viewContext, mode } });
    verification = createVerificationView({ snapshot: next.snapshot, callbacks, context: { evidenceHref, openEvidence } });
    roots.work.append(work.element); roots.verification.append(verification.element); roots.editing.append(editor.element); tabs.hidden = false;
  } else { work.update(next.snapshot); verification.update(next.snapshot); inspector.update(next.snapshot); }
  editor.update(next.snapshot, { readOnlyReason });
}
function schedule(delay = 700) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, delay); }
async function poll() {
  try { apply(await connection.updates()); schedule(); }
  catch (error) {
    viewContext.connection = 'disconnected'; state(`Disconnected · last observation retained · ${error.message}`, 'attention');
    if (envelope) { work.update(envelope.snapshot); editor.update(envelope.snapshot); }
    if (error.status === 401) { resumeField = document.activeElement?.dataset?.field ?? resumeField; connection.disconnect(); connectForm.hidden = false; accessKey.focus(); }
    schedule(1200);
  }
}
connectForm.addEventListener('submit', async event => {
  event.preventDefault(); const key = accessKey.value; accessKey.value = ''; state('Connecting…', 'active');
  try { await connection.connect(key); connectForm.hidden = true; apply(await connection.snapshot()); if (resumeField) document.querySelector(`[data-field="${CSS.escape(resumeField)}"]`)?.focus(); resumeField = null; schedule(); }
  catch (error) { connection.disconnect(); connectForm.hidden = false; state(`Connection rejected · ${error.message}`, 'failed'); accessKey.focus(); }
});
const systemTheme = matchMedia('(prefers-color-scheme: dark)'); const theme = document.querySelector('#theme');
function applyTheme() { document.documentElement.dataset.theme = theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value; }
theme.addEventListener('change', applyTheme); systemTheme.addEventListener('change', applyTheme);
window.addEventListener('pagehide', () => { clearTimeout(pollTimer); if (evidenceObjectUrl) URL.revokeObjectURL(evidenceObjectUrl); if (editor?.getState().dirty) sessionStorage.setItem('lazybuddy-draft', JSON.stringify(editor.getState())); });
document.documentElement.dataset.dashboardReady = 'true';
