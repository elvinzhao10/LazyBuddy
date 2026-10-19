// T14 project shell page bootstrap — browser wiring only. Loads the read-only
// projection bundle (built from a real initialized fixture project by the
// evidence harness) and mounts the shell. `?state=uninitialized` composes the
// pre-init state (no project destinations, IO-2) for comparison captures.
import { createProjectShell } from './project-shell.mjs';
import { installNativeExperience } from './components.mjs';

// T11 native experience layer: focus system (Tab ring, j/k, /, Escape),
// density control, tooltips, announcer. Idempotent — safe on every page.
const native = installNativeExperience();

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('#theme');
function updateTheme() {
  document.documentElement.dataset.theme = themeControl.value === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeControl.value;
}
themeControl.addEventListener('change', updateTheme);
systemTheme.addEventListener('change', updateTheme);
themeControl.disabled = false;

const root = document.querySelector('#shell-root');
const loadStatus = document.querySelector('#load-status');
const uninitialized = new URLSearchParams(location.search).get('state') === 'uninitialized';
let bundle = null;

try {
  if (!uninitialized) {
    const response = await fetch('/overview-bundle.json');
    if (!response.ok) throw new Error(`bundle ${response.status}`);
    bundle = await response.json();
  }
} catch (error) {
  loadStatus.textContent = `The projection bundle could not load (${error.message}). No live run is connected.`;
}

const shell = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' }, callbacks: {
  // Drilling a plan node in the macro map navigates in place; without a live
  // plans surface the plans destination states its unavailable case honestly.
  onPlanDrill({ nodeId }) {
    if ((bundle?.snapshot?.plans ?? []).some(plan => plan.id === nodeId)) shell.openPlan(nodeId);
  },
} });
root.append(shell.element);
// The T11 density control re-homes into the shell's identity footer (T20a):
// one theme control and one density control, both in the rail.
const footerHost = shell.element.querySelector('[data-testid="shell-footer-controls"]');
if (footerHost && !footerHost.contains(native.control.element)) footerHost.append(native.control.element);
loadStatus.textContent = uninitialized
  ? 'Shell composed without an initialized project record (pre-init state).'
  : 'Shell ready — projection bundle loaded.';
document.documentElement.dataset.shellReady = 'true';

// Cached-shell usability measurement (plan §9.4): medians over repeated mounts
// from the already-fetched bundle — the recorded perf target, not a gate.
window.__shellMeasure = async function measure() {
  const median = values => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  const runs = 5;
  const mount = [];
  if (uninitialized) return { state: 'uninitialized', note: 'no bundle to measure' };
  for (let index = 0; index < runs; index += 1) {
    shell.element.remove();
    const started = performance.now();
    const next = createProjectShell({ projectionProvider: () => bundle, product: { name: 'LazyBuddy' } });
    root.append(next.element);
    await new Promise(resolve => setTimeout(resolve, 80));
    mount.push(performance.now() - started);
    next.element.remove();
  }
  root.append(shell.element);
  return { userAgent: navigator.userAgent, runs, cachedShellMountMsMedian: Number(median(mount).toFixed(1)),
    planCount: bundle.snapshot.plans.length, bundleBytes: JSON.stringify(bundle).length };
};
