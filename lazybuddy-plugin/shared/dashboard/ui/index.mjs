import { createDashboardConnection } from './connection.mjs';
import { installNativeExperience } from './components.mjs';
import { createPlanningEditor } from './editing.mjs';
import { createTaskInspector } from './inspector-view.mjs';
import { createVerificationView } from './verification-view.mjs';
import { createWorkView } from './work-view.mjs';
import { createLiveProjectAdapter } from './live-project-adapter.mjs';
import { createLiveProjectViews } from './project-live-views.mjs';
import { createProjectShell } from './project-shell.mjs';

const connection = createDashboardConnection();
const connectionStatus = document.querySelector('[data-testid="connection-status"]');
const connectForm = document.querySelector('#connect-form');
const accessKey = document.querySelector('[data-testid="access-key"]');
const tabs = document.querySelector('#view-tabs');
const runDashboard = document.querySelector('#run-dashboard');
const projectRoot = document.querySelector('#project-root');
const evidencePreview = document.querySelector('#evidence-preview'); let evidenceObjectUrl = null;
const roots = { work: document.querySelector('#work-root'), verification: document.querySelector('#verification-root'), editing: document.querySelector('#editing-root') };
let envelope; let work; let verification; let inspector; let editor; let pollTimer;
let projectShell; let projectViews; let projectReadPending = null; let projectReadAt = 0;
let runBound = true;
const projectAdapter = createLiveProjectAdapter({ connection });
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
    roots.work.append(work.element); roots.verification.append(verification.element); roots.editing.append(editor.element); tabs.hidden = false; runDashboard.hidden = false;
  } else { work.update(next.snapshot); verification.update(next.snapshot); inspector.update(next.snapshot); }
  editor.update(next.snapshot, { readOnlyReason });
  projectViews?.updateRun(next.snapshot);
}
async function refreshProject({ force = false } = {}) {
  if (projectReadPending) return projectReadPending;
  if (!force && Date.now() - projectReadAt < 5000) return projectAdapter.current;
  projectReadPending = (async () => {
    const project = await projectAdapter.read(); projectReadAt = Date.now();
    if (project) document.title = `${project.runtime} · ${project.project_id}`.slice(0, 160);
    if (!projectShell) {
      if (project) {
        projectViews = createLiveProjectViews({ project, adapter: projectAdapter, runElement: runDashboard,
          runId: envelope?.snapshot?.run_id ?? null, runSnapshot: envelope?.snapshot ?? null,
          onDestinationRequest: destination => projectShell?.selectDestination(destination) });
      }
      projectShell = createProjectShell({ projectionProvider: () => projectAdapter.bundle(), product: { name: project?.runtime ?? 'LazySeries' },
        views: projectViews?.views ?? {}, callbacks: { onPlanDrill({ nodeId, drill }) {
          const planId = project?.plans.some(plan => plan.id === nodeId) ? nodeId : drill;
          if (planId) projectViews?.openPlan(planId);
        } } });
      projectRoot.replaceChildren(projectShell.element);
    } else if (project) {
      projectViews?.update(project); projectShell.update();
    }
    if (!project) {
      projectShell?.update();
      if (!runDashboard.isConnected) projectRoot.after(runDashboard);
      runDashboard.hidden = false;
    }
    return project;
  })().finally(() => { projectReadPending = null; });
  return projectReadPending;
}
function schedule(delay = 700) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, delay); }
async function poll() {
  try {
    if (runBound) apply(await connection.updates());
    await refreshProject({ force: !runBound }); schedule(runBound ? 700 : 5000);
  }
  catch (error) {
    viewContext.connection = 'disconnected'; state(`Disconnected · last observation retained · ${error.message}`, 'attention');
    if (envelope) { work.update(envelope.snapshot); editor.update(envelope.snapshot, { readOnlyReason: 'DISCONNECTED' }); }
    if (error.status === 401) { resumeField = document.activeElement?.dataset?.field ?? resumeField; connection.disconnect(); connectForm.hidden = false; accessKey.focus(); }
    schedule(1200);
  }
}
connectForm.addEventListener('submit', async event => {
  event.preventDefault(); const key = accessKey.value; accessKey.value = ''; state('Connecting…', 'active');
  try {
    await connection.connect(key); connectForm.hidden = true;
    try { apply(await connection.snapshot()); runBound = true; }
    catch (error) {
      if (error.body?.code !== 'RUN_NOT_BOUND') throw error;
      runBound = false; viewContext.connection = 'connected'; runDashboard.hidden = true;
      state('Connected · project record · no run bound', 'verified');
    }
    await refreshProject({ force: true });
    if (resumeField) document.querySelector(`[data-field="${CSS.escape(resumeField)}"]`)?.focus();
    resumeField = null; schedule(runBound ? 700 : 5000);
  }
  catch (error) { connection.disconnect(); connectForm.hidden = false; state(`Connection rejected · ${error.message}`, 'failed'); accessKey.focus(); }
});
const systemTheme = matchMedia('(prefers-color-scheme: dark)'); const theme = document.querySelector('#theme');
function applyTheme() { document.documentElement.dataset.theme = theme.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme.value; }
theme.addEventListener('change', applyTheme); systemTheme.addEventListener('change', applyTheme);
window.addEventListener('pagehide', () => { clearTimeout(pollTimer); if (evidenceObjectUrl) URL.revokeObjectURL(evidenceObjectUrl); if (editor?.getState().dirty) sessionStorage.setItem('lazybuddy-draft', JSON.stringify(editor.getState())); });
installNativeExperience(); // T11 native layer: focus system, density, tooltips (idempotent with theme-init)
document.documentElement.dataset.dashboardReady = 'true';
