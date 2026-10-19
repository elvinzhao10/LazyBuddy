// T15 browser host binding for the project and plan editors. The page owns no
// authority: commands POST to the served route that runs the real shared
// command route (service-http.mjs /api/project/commands), captures and
// transition assessments are the service's project reads, and the view module
// stays free of any file or execution access. Route shapes mirror
// ui/connection.mjs (the served dashboard's own client): GET /api/project,
// GET /api/project/sources/<id>, POST /api/project/commands and
// POST /api/project/plan-transition-assessment; the caller supplies a fetch
// implementation that already carries the session Authorization header.
import { createProjectEditor } from './editor-views.mjs';

async function fetchJson(fetchImpl, path, body) {
  const response = await fetchImpl(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw { code: value?.reason ?? value?.code ?? 'HOST_ROUTE_FAILED' };
  return value;
}

export async function mountEditorPage({ fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('mountEditorPage requires a fetch implementation');
  const snapshot = (await fetchJson(fetchImpl, '/api/project')).project;
  const editor = createProjectEditor({
    snapshot,
    assessTransition: (state, planId, toLifecycle, payload) =>
      fetchJson(fetchImpl, '/api/project/plan-transition-assessment', { plan_id: planId, to_lifecycle: toLifecycle, payload }),
    sendCommand: command => fetchJson(fetchImpl, '/api/project/commands', command),
    captureSource: sourceId => fetchJson(fetchImpl, `/api/project/sources/${encodeURIComponent(sourceId)}`),
  });
  const host = document.querySelector('#editor-root');
  host.replaceChildren(editor.element);
  // Narrow widths switch to the equivalent hierarchical list automatically.
  const narrowQuery = matchMedia('(max-width: 700px)');
  const applyNarrow = () => editor.setNarrow(narrowQuery.matches);
  narrowQuery.addEventListener('change', applyNarrow);
  applyNarrow();
  await editor.ready;
  document.documentElement.dataset.editorReady = 'true';
  return editor;
}
