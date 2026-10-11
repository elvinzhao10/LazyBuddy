// T15 browser host binding for the project and plan editors. The page owns no
// authority: commands POST to the host route that runs the real shared command
// route (cli.mjs), captures and transition assessments are host-provided reads,
// and the view module stays free of any file or execution access.
import { createProjectEditor } from './editor-views.mjs';

async function fetchJson(fetchImpl, origin, path, body) {
  const response = await fetchImpl(`${origin}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw { code: value?.code ?? 'HOST_ROUTE_FAILED' };
  return value;
}

export async function mountEditorPage({ fetchImpl = globalThis.fetch?.bind(globalThis), origin = '' } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('mountEditorPage requires a fetch implementation');
  const snapshot = await fetchJson(fetchImpl, origin, '/api/project/read');
  const editor = createProjectEditor({
    snapshot,
    assessTransition: (state, planId, toLifecycle, payload) =>
      fetchJson(fetchImpl, origin, '/api/project/assess-transition', { plan_id: planId, to_lifecycle: toLifecycle, ...payload }),
    sendCommand: command => fetchJson(fetchImpl, origin, '/api/project/command', command),
    captureSource: sourceId => fetchJson(fetchImpl, origin, `/api/project/capture/${encodeURIComponent(sourceId)}`),
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
