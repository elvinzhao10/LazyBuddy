import { button, element, statusChip } from './components.mjs';

export const emptyState = (title, detail) => {
  const panel = element('section', 'panel notice stack');
  panel.append(statusChip({ state: 'unavailable', label: title }), element('p', 'meta', detail));
  return panel;
};

export const list = (values, render) => {
  const node = element('ul', 'project-record-list stack');
  for (const value of values) { const item = element('li', ''); item.append(render(value)); node.append(item); }
  return node;
};

export function scopePage(fixture, nav, page) {
  const key = nav.scope === 'global' ? 'global' : `${nav.scope}:${nav.id}`;
  return fixture.scopePages[key]?.pages[page - 1] ?? fixture.scopePages[key]?.pages.at(-1);
}

export function createLazyDetail({ label, load, compose }) {
  const root = element('section', 'panel stack project-detail-loader');
  let view = null; let pending = null; let loadedRevision = null; let projectRevision = null;
  // The shell page header names the destination (T20a); the lazy surface
  // carries only its status and load control.
  const status = element('p', 'meta', `${label} loads from its bounded native collector when opened.`);
  status.setAttribute('role', 'status');
  const action = button(`Load ${label}`, () => activate(true));
  root.append(status, action);
  async function activate(force = false) {
    if (pending) return pending;
    if (view && !force && loadedRevision === projectRevision) return view;
    action.disabled = true; status.textContent = `Loading ${label}…`;
    pending = (async () => {
      const payload = await load();
      const next = compose(payload);
      view?.element?.remove(); view = next; loadedRevision = projectRevision;
      root.append(next.element); status.textContent = `${label} ready from native project revision ${projectRevision}.`;
      action.textContent = `Refresh ${label}`; return next;
    })().catch(error => {
      status.textContent = `${label} unavailable · ${error.message}`;
      return null;
    }).finally(() => { action.disabled = false; pending = null; });
    return pending;
  }
  return { element: root, activate, getView: () => view, update(project) {
    projectRevision = project.revision;
    if (view && loadedRevision !== projectRevision) status.textContent = `${label} is retained from revision ${loadedRevision}; refresh to load revision ${projectRevision}.`;
  } };
}
