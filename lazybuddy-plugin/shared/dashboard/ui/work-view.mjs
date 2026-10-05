import { button, element, statusChip, taskCard } from './components.mjs';
import { layeredDAGLayout } from './graph-layout.mjs';

const executionRole = { not_started: 'neutral', running: 'active', finished: 'neutral', failed: 'failed', cancelled: 'neutral' };
const verificationRole = { unverified: 'neutral', verifying: 'active', verified: 'verified', failed: 'failed', stale: 'stale', unavailable: 'unavailable' };
const titleCase = value => value.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());

function readiness(task, byId) {
  return task.execution === 'not_started' && task.depends_on.every(id => byId.get(id)?.execution === 'finished');
}

export function deriveWorkSummary(snapshot, connection = 'connected') {
  const running = snapshot.tasks.filter(task => task.execution === 'running');
  const current = running.length === 1 ? `${running[0].title}${running[0].attempts.at(-1) ? ` · ${running[0].attempts.at(-1).id}` : ''}` :
    running.length > 1 ? `${running.length} tasks observed running` : 'No running task observed';
  const attention = [];
  for (const decision of snapshot.decisions.filter(item => item.state === 'proposed')) attention.push({ id: decision.id, taskId: null, title: decision.title, detail: decision.rationale, priority: 5 });
  for (const task of snapshot.tasks) {
    if (task.blocker) attention.push({ id: task.id, taskId: task.id, title: task.title, detail: task.blocker, priority: 4 + task.priority });
    else if (task.execution === 'failed') attention.push({ id: task.id, taskId: task.id, title: task.title, detail: 'Execution failed; inspect the observed attempt.', priority: 3 + task.priority });
    else if (['failed', 'stale', 'unavailable'].includes(task.verification)) attention.push({ id: task.id, taskId: task.id, title: task.title, detail: `Verification is ${task.verification}.`, priority: 2 + task.priority });
  }
  attention.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return { now: connection === 'disconnected' ? `Last observed: ${current}` : current,
    runningCount: running.length, attention: attention.slice(0, 3), attentionRemaining: Math.max(0, attention.length - 3), queue: snapshot.queue.slice(0, 3) };
}

function taskPresentation(task, byId) {
  const progress = `${task.progress.verified} of ${task.progress.total} required checks${readiness(task, byId) ? ' · Parallel-ready' : ''}`;
  return { id: task.id, title: task.title,
    execution: { state: executionRole[task.execution], label: titleCase(task.execution) },
    verification: { state: verificationRole[task.verification], label: titleCase(task.verification) }, progress };
}

function edgePath(edge) {
  const bend = Math.max(32, (edge.x2 - edge.x1) / 2);
  return `M ${edge.x1} ${edge.y1} C ${edge.x1 + bend} ${edge.y1}, ${edge.x2 - bend} ${edge.y2}, ${edge.x2} ${edge.y2}`;
}

export function createWorkView({ snapshot, callbacks = {}, context = {} }) {
  let current = snapshot;
  let selectedTaskId = context.selectedTaskId ?? null;
  let mode = context.mode === 'list' ? 'list' : 'graph';
  const manualPositions = {};
  const root = element('section', 'work-view stack');
  root.dataset.testid = 'work-view';

  function select(taskId, trigger) {
    selectedTaskId = taskId;
    for (const node of root.querySelectorAll('[data-task-id]')) node.setAttribute('aria-pressed', String(node.dataset.taskId === taskId));
    callbacks.onSelect?.({ taskId, trigger });
  }

  function render() {
    const graphViewport = root.querySelector('.graph-viewport');
    const viewport = { left: graphViewport?.scrollLeft ?? 0, top: graphViewport?.scrollTop ?? 0 };
    const focused = root.contains(document.activeElement) ? { taskId: document.activeElement.dataset.taskId, view: document.activeElement.dataset.view } : null;
    root.replaceChildren();
    const summary = deriveWorkSummary(current, context.connection ?? 'connected');
    const contextBar = element('header', 'context-bar panel');
    const identity = element('div', 'stack');
    identity.append(element('span', 'meta', `${current.project_id} / ${current.run_id}`), element('strong', '', `Revision ${current.revision} · plan ${current.plan_revision}`));
    const connection = element('div'); connection.dataset.testid = 'connection-status';
    connection.append(statusChip({ state: context.connection === 'disconnected' ? 'attention' : 'neutral', label: context.connection === 'disconnected' ? 'Disconnected' : 'Snapshot connected' }));
    contextBar.append(identity, connection);
    const now = element('div', 'now-line panel');
    now.append(element('span', 'meta', 'Now'), element('strong', '', summary.now), element('span', 'meta', `${summary.runningCount} observed running`));
    root.append(contextBar, now);
    if (summary.attention.length) {
      const section = element('section', 'attention-panel panel');
      section.append(element('h2', '', 'Needs attention'));
      const list = element('ol', 'attention-list');
      for (const item of summary.attention) {
        const row = element('li'); const control = button(item.title, event => item.taskId ? select(item.taskId, event.currentTarget) : callbacks.onAttention?.({ id: item.id, trigger: event.currentTarget }));
        if (item.taskId) control.dataset.taskId = item.taskId; control.dataset.view = 'attention'; row.append(control, element('p', 'meta', item.detail)); list.append(row);
      }
      section.append(list);
      if (summary.attentionRemaining) section.append(element('p', 'meta', `${summary.attentionRemaining} more item${summary.attentionRemaining === 1 ? '' : 's'}`));
      root.append(section);
    }
    const body = element('section', 'work-body stack');
    const bodyHeader = element('header', 'cluster spread');
    bodyHeader.append(element('h2', '', 'Work'));
    const switcher = element('div', 'view-switcher cluster');
    for (const value of ['graph', 'list']) {
      const control = button(titleCase(value), () => { mode = value; callbacks.onModeChange?.({ mode }); render(); });
      control.setAttribute('aria-pressed', String(mode === value)); control.dataset.mode = value; switcher.append(control);
    }
    bodyHeader.append(switcher); body.append(bodyHeader);
    const byId = new Map(current.tasks.map(task => [task.id, task]));
    const layout = layeredDAGLayout(current.tasks, manualPositions);
    const graph = element('div', 'graph-viewport'); graph.hidden = mode !== 'graph'; graph.tabIndex = 0; graph.setAttribute('aria-label', 'Task dependency graph');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('work-graph'); svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`); svg.setAttribute('width', layout.width); svg.setAttribute('height', layout.height);
    const edgeLayer = document.createElementNS(svg.namespaceURI, 'g'); edgeLayer.classList.add('graph-edges');
    for (const edge of layout.edges) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.dataset.edgeId = edge.id; path.setAttribute('d', edgePath(edge)); edgeLayer.append(path); }
    const nodeLayer = document.createElementNS(svg.namespaceURI, 'g');
    const mutable = new Map(layout.nodes.map(node => [node.id, { ...node }]));
    function syncGeometry(taskId) {
      const node = mutable.get(taskId); const foreign = nodeLayer.querySelector(`[data-graph-id="${CSS.escape(taskId)}"]`);
      foreign.setAttribute('x', node.x); foreign.setAttribute('y', node.y);
      for (const edge of layout.edges.filter(item => item.source === taskId || item.target === taskId)) {
        const source = mutable.get(edge.source); const target = mutable.get(edge.target);
        const geometry = { ...edge, x1: source.x + source.width, y1: source.y + source.height / 2, x2: target.x, y2: target.y + target.height / 2 };
        edgeLayer.querySelector(`[data-edge-id="${CSS.escape(edge.id)}"]`).setAttribute('d', edgePath(geometry));
      }
    }
    for (const node of layout.nodes) {
      const foreign = document.createElementNS(svg.namespaceURI, 'foreignObject'); foreign.dataset.graphId = node.id;
      foreign.setAttribute('x', node.x); foreign.setAttribute('y', node.y); foreign.setAttribute('width', node.width); foreign.setAttribute('height', node.height);
      let dragged = false; let drag;
      const control = taskCard({ ...taskPresentation(byId.get(node.id), byId), selected: selectedTaskId === node.id, onSelect(event) { if (dragged) { dragged = false; return; } select(node.id, event.currentTarget); } });
      control.dataset.view = 'graph';
      control.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, nodeX: mutable.get(node.id).x, nodeY: mutable.get(node.id).y }; control.setPointerCapture(event.pointerId); });
      control.addEventListener('pointermove', event => { if (!drag) return; const dx = event.clientX - drag.x; const dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true; if (!dragged) return; Object.assign(mutable.get(node.id), { x: Math.max(0, drag.nodeX + dx), y: Math.max(0, drag.nodeY + dy) }); syncGeometry(node.id); });
      control.addEventListener('pointerup', event => { if (!drag) return; control.releasePointerCapture(event.pointerId); if (dragged) { const point = mutable.get(node.id); manualPositions[node.id] = { x: point.x, y: point.y }; callbacks.onLayoutChange?.({ taskId: node.id, ...manualPositions[node.id] }); } drag = null; });
      foreign.append(control); nodeLayer.append(foreign);
    }
    svg.append(edgeLayer, nodeLayer); graph.append(svg); body.append(graph);
    const list = element('div', 'task-list stack'); list.hidden = mode !== 'list';
    for (const task of current.tasks) { const control = taskCard({ ...taskPresentation(task, byId), selected: selectedTaskId === task.id, onSelect: event => select(task.id, event.currentTarget) }); control.dataset.view = 'list'; list.append(control); }
    body.append(list); root.append(body);
    const next = element('section', 'next-panel panel stack'); next.append(element('h2', '', 'Next'));
    const queue = element('ol', 'queue'); queue.dataset.testid = 'queue-list';
    for (const plan of summary.queue) { const row = element('li'); row.append(element('strong', '', plan.title), statusChip({ state: plan.readiness === 'held' ? 'attention' : 'neutral', label: `${titleCase(plan.readiness)} · priority ${plan.priority}` })); queue.append(row); }
    if (!summary.queue.length) queue.append(element('li', 'meta', 'No queued plans.'));
    next.append(queue, element('p', 'meta', 'Queue order does not authorize execution.')); root.append(next);
    const restored = root.querySelector(`.graph-viewport`); restored.scrollLeft = viewport.left; restored.scrollTop = viewport.top;
    if (focused?.taskId) root.querySelector(`[data-view="${focused.view}"][data-task-id="${CSS.escape(focused.taskId)}"]`)?.focus();
  }
  render();
  return { element: root, update(nextSnapshot) { current = nextSnapshot; if (selectedTaskId && !current.tasks.some(task => task.id === selectedTaskId)) selectedTaskId = null; render(); },
    select(taskId) { const trigger = root.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`); if (trigger) select(taskId, trigger); }, getState() { return { selectedTaskId, mode, positions: structuredClone(manualPositions) }; } };
}
