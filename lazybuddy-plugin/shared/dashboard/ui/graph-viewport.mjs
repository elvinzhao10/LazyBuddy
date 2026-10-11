// Shared DOM/SVG viewport controls for the project and execution graphs.
// The controller owns only presentation state: it never changes graph data or layout.
import { button, element } from './components.mjs';

const SCALE_MIN = 0.25;
const SCALE_MAX = 2;
const SCALE_STEP = 0.25;
const PAN_STEP = 160;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createGraphViewportController({ label = 'Graph', getRegion, getSvg, onChange } = {}) {
  let state = { scale: 1, scrollLeft: 0, scrollTop: 0 };
  let zoomOutput = null;
  let drag = null;

  function isInteractiveTarget(target, region) {
    let current = target;
    while (current && current !== region) {
      if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(current.tagName)
        || current.getAttribute?.('role') === 'button') return true;
      current = current.parentNode;
    }
    return false;
  }

  function capture() {
    const region = getRegion?.();
    if (region) {
      state.scrollLeft = finite(region.scrollLeft, state.scrollLeft);
      state.scrollTop = finite(region.scrollTop, state.scrollTop);
    }
    return { ...state };
  }

  function apply(reason, notify = true) {
    const region = getRegion?.();
    const svg = getSvg?.();
    if (svg) {
      const width = finite(svg.dataset.layoutWidth, finite(svg.getAttribute('width'), 0));
      const height = finite(svg.dataset.layoutHeight, finite(svg.getAttribute('height'), 0));
      if (width > 0) svg.setAttribute('width', String(Math.round(width * state.scale * 1000) / 1000));
      if (height > 0) svg.setAttribute('height', String(Math.round(height * state.scale * 1000) / 1000));
    }
    if (region) {
      region.scrollLeft = state.scrollLeft;
      region.scrollTop = state.scrollTop;
      region.dataset.zoom = String(state.scale);
    }
    if (zoomOutput) zoomOutput.textContent = `${Math.round(state.scale * 100)}%`;
    if (notify) onChange?.({ ...state, reason });
    return { ...state };
  }

  function setViewport(next = {}, reason = 'api', notify = true) {
    const previous = capture();
    const scale = clamp(finite(next.scale, previous.scale), SCALE_MIN, SCALE_MAX);
    const region = getRegion?.();
    const width = finite(region?.clientWidth, 0);
    const height = finite(region?.clientHeight, 0);
    const ratio = scale / previous.scale;
    const centredLeft = width > 0 ? (previous.scrollLeft + width / 2) * ratio - width / 2 : previous.scrollLeft;
    const centredTop = height > 0 ? (previous.scrollTop + height / 2) * ratio - height / 2 : previous.scrollTop;
    state = {
      scale,
      scrollLeft: Math.max(0, finite(next.scrollLeft, centredLeft)),
      scrollTop: Math.max(0, finite(next.scrollTop, centredTop)),
    };
    return apply(reason, notify);
  }

  function panBy(left, top, reason = 'pan') {
    const current = capture();
    return setViewport({ scrollLeft: current.scrollLeft + left, scrollTop: current.scrollTop + top }, reason);
  }

  function zoomBy(delta, reason = 'zoom') {
    return setViewport({ scale: capture().scale + delta }, reason);
  }

  function fit(reason = 'fit') {
    const region = getRegion?.();
    const svg = getSvg?.();
    const layoutWidth = finite(svg?.dataset.layoutWidth, finite(svg?.getAttribute('viewBox')?.split(/\s+/)[2], 0));
    const layoutHeight = finite(svg?.dataset.layoutHeight, finite(svg?.getAttribute('viewBox')?.split(/\s+/)[3], 0));
    const availableWidth = finite(region?.clientWidth, 0);
    const availableHeight = finite(region?.clientHeight, 0);
    const scale = layoutWidth > 0 && layoutHeight > 0 && availableWidth > 0 && availableHeight > 0
      ? clamp(Math.min(1, (availableWidth - 16) / layoutWidth, (availableHeight - 16) / layoutHeight), SCALE_MIN, SCALE_MAX)
      : 1;
    return setViewport({ scale, scrollLeft: 0, scrollTop: 0 }, reason);
  }

  function bind(region, svg, layoutWidth, layoutHeight) {
    svg.dataset.layoutWidth = String(layoutWidth);
    svg.dataset.layoutHeight = String(layoutHeight);
    region.addEventListener('scroll', () => {
      capture();
      onChange?.({ ...state, reason: 'scroll' });
    });
    region.addEventListener('pointerdown', event => {
      if ((event.button ?? 0) !== 0 || isInteractiveTarget(event.target, region)) return;
      const current = capture();
      drag = { pointerId: event.pointerId, x: finite(event.clientX, 0), y: finite(event.clientY, 0),
        scrollLeft: current.scrollLeft, scrollTop: current.scrollTop, moved: false };
      region.classList.add('is-panning');
      region.setPointerCapture?.(event.pointerId);
    });
    region.addEventListener('pointermove', event => {
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const left = Math.max(0, drag.scrollLeft - (finite(event.clientX, drag.x) - drag.x));
      const top = Math.max(0, drag.scrollTop - (finite(event.clientY, drag.y) - drag.y));
      drag.moved ||= Math.abs(left - drag.scrollLeft) + Math.abs(top - drag.scrollTop) > 3;
      state = { ...state, scrollLeft: left, scrollTop: top };
      apply('pointer-pan');
      event.preventDefault();
    });
    const endDrag = event => {
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      region.releasePointerCapture?.(event.pointerId);
      region.classList.remove('is-panning');
      drag = null;
    };
    region.addEventListener('pointerup', endDrag);
    region.addEventListener('pointercancel', endDrag);
    region.addEventListener('keydown', event => {
      if (event.target !== region) return;
      const actions = {
        ArrowLeft: () => panBy(-PAN_STEP, 0, 'keyboard-pan'),
        ArrowRight: () => panBy(PAN_STEP, 0, 'keyboard-pan'),
        ArrowUp: () => panBy(0, -PAN_STEP, 'keyboard-pan'),
        ArrowDown: () => panBy(0, PAN_STEP, 'keyboard-pan'),
        '+': () => zoomBy(SCALE_STEP, 'keyboard-zoom'),
        '=': () => zoomBy(SCALE_STEP, 'keyboard-zoom'),
        '-': () => zoomBy(-SCALE_STEP, 'keyboard-zoom'),
        '0': () => fit('keyboard-fit'),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    });
    apply('render', false);
  }

  function controls() {
    const toolbar = element('div', 'graph-viewport-controls cluster');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', `${label} viewport controls`);
    const action = (text, ariaLabel, handler) => {
      const control = button(text, handler);
      control.className = 'graph-viewport-action';
      control.setAttribute('aria-label', ariaLabel);
      control.title = ariaLabel;
      return control;
    };
    toolbar.append(
      action('←', 'Pan graph left', () => panBy(-PAN_STEP, 0)),
      action('↑', 'Pan graph up', () => panBy(0, -PAN_STEP)),
      action('↓', 'Pan graph down', () => panBy(0, PAN_STEP)),
      action('→', 'Pan graph right', () => panBy(PAN_STEP, 0)),
      action('−', 'Zoom graph out', () => zoomBy(-SCALE_STEP)),
      action('+', 'Zoom graph in', () => zoomBy(SCALE_STEP)),
      action('Fit', 'Fit graph to viewport', () => fit()),
    );
    zoomOutput = element('output', 'meta graph-viewport-zoom', `${Math.round(state.scale * 100)}%`);
    zoomOutput.setAttribute('aria-label', 'Graph zoom');
    toolbar.append(zoomOutput);
    return toolbar;
  }

  return { bind, capture, controls, fit, panBy, setViewport, zoomBy, getState: capture };
}

export const GRAPH_VIEWPORT_LIMITS = Object.freeze({ min: SCALE_MIN, max: SCALE_MAX, step: SCALE_STEP, pan: PAN_STEP });
