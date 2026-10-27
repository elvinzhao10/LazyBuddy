import { button, element } from './components.mjs';
import { createExecutionView as createNestedExecutionView } from './execution-view.mjs';
import { liveExecutionProjection } from './live-execution-model.mjs';
import { emptyState } from './project-view-primitives.mjs';
export function createExecutionDestination(project, { runElement, runId, runSnapshot: initialRunSnapshot,
  onRunUnavailable, onBackPlan }) {
  const root = element('section', 'execution-live stack');
  let selection = null;
  let runSnapshot = initialRunSnapshot;
  let selectedTaskId = null;
  let nestedView = null;
  let nestedLevel = null;
  let controlsOpen = false;

  function richExecution() {
    if (!runSnapshot || runSnapshot.run_id !== runId || !runSnapshot.tasks?.length) return null;
    if (selectedTaskId && !runSnapshot.tasks.some(task => task.id === selectedTaskId && task.attempts?.length)) selectedTaskId = null;
    const projection = liveExecutionProjection(runSnapshot, { taskId: selectedTaskId });
    const level = selectedTaskId ? 'task' : 'run';
    if (!nestedView || nestedLevel !== level) {
      nestedView = createNestedExecutionView({ document: projection.document, timeline: projection.timeline,
        mode: typeof matchMedia === 'function' && matchMedia('(max-width: 48rem)').matches ? 'list' : 'graph',
        callbacks: {
          onDrill({ focusId }) { selectedTaskId = focusId; render(); },
          onNavigate({ level: target }) {
            if (target === 'batch') { selectedTaskId = null; render(); }
            else if (target === 'plan' && selection) onBackPlan?.(selection.planId);
          },
        } });
      nestedLevel = level;
    } else nestedView.applyUpdate(projection.document, projection.timeline);
    return nestedView.element;
  }

  function render() {
    root.replaceChildren();
    const head = element('header', 'stack');
    // The shell page header carries the destination title and the back
    // affordance (T20a); the view states only its run binding. The plan
    // return stays available through the nested breadcrumbs below.
    head.append(element('p', 'meta', selection
      ? `Native run ${selection.runId}`
      : `Authenticated run dashboard · ${runId ?? 'no run binding'}`));
    let controls = null;
    if (runElement && runId && (!selection || selection.runId === runId)) {
      controls = element('details', 'panel stack execution-run-controls');
      controls.open = controlsOpen;
      controls.addEventListener('toggle', () => { controlsOpen = controls.open; });
      const summary = element('summary', '', 'Run verification and plan editing controls');
      controls.append(summary, runElement);
      const openControls = button('Open run verification and evidence controls', () => {
        controlsOpen = true; controls.open = true; controls.scrollIntoView?.({ block: 'start' }); summary.focus?.();
      });
      openControls.dataset.action = 'open-run-controls';
      head.append(openControls);
    }
    root.append(head);
    if (selection && selection.runId !== runId) {
      root.append(emptyState('Run not bound to this service', `Open the authenticated dashboard service for run ${selection.runId} to inspect its tasks and verification records.`));
      onRunUnavailable?.(selection); return;
    }
    const rich = richExecution();
    if (rich) root.append(rich);
    else root.append(emptyState('No observed task execution', runId
      ? 'The bound native run has no task snapshot to project. Verification and plan controls remain available below.'
      : 'This service has no run projection. Project plans and documents remain available.'));
    if (controls) root.append(controls);
  }
  const openRun = next => { selection = next; selectedTaskId = null; nestedView = null; nestedLevel = null; render(); };
  render(); return { element: root, update(next) { project = next; render(); },
    updateRun(next) { runSnapshot = next; render(); }, openRun };
}
