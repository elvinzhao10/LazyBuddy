// Shared DOM/SVG viewport controls for the project and execution graphs.
// The controller owns only presentation state: it never changes graph data or layout.
//
// T11 native motion: pan and zoom animate along the design motion tokens
// (--motion-base/--motion-slow with the --motion-ease curve, read from the
// live computed style so prefers-reduced-motion collapses them to 0ms and the
// animation resolves instantly). Pointer drags release into a bounded inertia
// glide (exponential decay, capped distance and duration); any pointer, key or
// programmatic interaction cancels it. Presentation state (scale + scroll)
// lives in the controller, so re-binding after a polling re-render restores
// the viewport instead of resetting it.
import { button, element } from './components.mjs';

const SCALE_MIN = 0.25;
const SCALE_MAX = 2;
const SCALE_STEP = 0.25;
const PAN_STEP = 160;

// Bounded inertia: decay constant, minimum release speed (px/ms) and the
// hard cap on total glide distance (four keyboard pan steps).
const INERTIA_TAU = 160;
const INERTIA_MIN_SPEED = 0.05;
const INERTIA_MAX_SPEED = 5;
const INERTIA_MAX_DISTANCE = PAN_STEP * 4;
// Pointer coalescing can deliver moves far faster than frames; only sample
// velocity across spans a rendered frame could produce, so a synthetic or
// paused pointer never reads as a flick.
const INERTIA_MIN_SAMPLE_MS = 8;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function prefersReducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// cubic-bezier(0.2, 0, 0, 1) — mirrors the --motion-ease token.
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = t => ((ax * t + bx) * t + cx) * t;
  const sampleY = t => ((ay * t + by) * t + cy) * t;
  const sampleSlope = t => (3 * ax * t + 2 * bx) * t + cx;
  return progress => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let step = 0; step < 8; step += 1) {
      const error = sampleX(t) - progress;
      if (Math.abs(error) < 1e-6) break;
      const slope = sampleSlope(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return sampleY(t);
  };
}
const MOTION_EASE = cubicBezier(0.2, 0, 0, 1);

export function createGraphViewportController({
  label = 'Graph', getRegion, getSvg, onChange,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
  reducedMotion = null,
} = {}) {
  const isReduced = () => (typeof reducedMotion === 'function' ? reducedMotion() : prefersReducedMotion());
  let state = { scale: 1, scrollLeft: 0, scrollTop: 0 };
  let zoomOutput = null;
  let drag = null;
  let animation = null;

  function motionDuration(token, fallback) {
    if (isReduced()) return 0;
    try {
      const region = getRegion?.();
      const view = region?.ownerDocument?.defaultView;
      const value = view?.getComputedStyle?.(region)?.getPropertyValue(token);
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    } catch { /* no computed style available: token default */ }
    return fallback;
  }

  function stopAnimation() {
    if (!animation) return;
    animation.cancelled = true;
    if (animation.handle != null && cancelFrame) cancelFrame(animation.handle);
    animation = null;
  }

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

  function computeViewport(next, previous) {
    const scale = clamp(finite(next.scale, previous.scale), SCALE_MIN, SCALE_MAX);
    const region = getRegion?.();
    const width = finite(region?.clientWidth, 0);
    const height = finite(region?.clientHeight, 0);
    const ratio = scale / previous.scale;
    const centredLeft = width > 0 ? (previous.scrollLeft + width / 2) * ratio - width / 2 : previous.scrollLeft;
    const centredTop = height > 0 ? (previous.scrollTop + height / 2) * ratio - height / 2 : previous.scrollTop;
    return {
      scale,
      scrollLeft: Math.max(0, finite(next.scrollLeft, centredLeft)),
      scrollTop: Math.max(0, finite(next.scrollTop, centredTop)),
    };
  }

  function setViewport(next = {}, reason = 'api', notify = true) {
    stopAnimation();
    const previous = capture();
    state = computeViewport(next, previous);
    return apply(reason, notify);
  }

  // Eased motion to a computed viewport along the motion tokens. Reduced
  // motion (or a 0ms token) resolves immediately in one apply.
  function animateTo(next, reason, token, fallbackDuration) {
    stopAnimation();
    const start = capture();
    const target = computeViewport(next, start);
    const duration = motionDuration(token, fallbackDuration);
    if (duration <= 0 || !requestFrame) {
      state = target;
      return apply(reason);
    }
    const from = { ...start };
    const beganAt = now();
    animation = { cancelled: false, handle: null };
    animation.cancel = () => { animation.cancelled = true; if (animation.handle != null && cancelFrame) cancelFrame(animation.handle); };
    const tick = () => {
      if (!animation || animation.cancelled) return;
      const progress = Math.min(1, (now() - beganAt) / duration);
      const eased = MOTION_EASE(progress);
      state = {
        scale: from.scale + (target.scale - from.scale) * eased,
        scrollLeft: from.scrollLeft + (target.scrollLeft - from.scrollLeft) * eased,
        scrollTop: from.scrollTop + (target.scrollTop - from.scrollTop) * eased,
      };
      apply(reason, false);
      if (progress >= 1) { animation = null; onChange?.({ ...state, reason }); return; }
      animation.handle = requestFrame(tick);
    };
    animation.handle = requestFrame(tick);
    return { ...state };
  }

  function panBy(left, top, reason = 'pan') {
    const current = capture();
    return setViewport({ scrollLeft: current.scrollLeft + left, scrollTop: current.scrollTop + top }, reason);
  }

  function panByAnimated(left, top, reason = 'pan-animated') {
    const current = capture();
    return animateTo({ scrollLeft: current.scrollLeft + left, scrollTop: current.scrollTop + top }, reason, '--motion-base', 200);
  }

  function zoomBy(delta, reason = 'zoom') {
    return setViewport({ scale: capture().scale + delta }, reason);
  }

  function zoomByAnimated(delta, reason = 'zoom-animated') {
    return animateTo({ scale: capture().scale + delta }, reason, '--motion-base', 200);
  }

  function fit(reason = 'fit') {
    return fitViewport(reason, false);
  }

  function fitAnimated(reason = 'fit-animated') {
    return fitViewport(reason, true);
  }

  function fitViewport(reason, animated) {
    const region = getRegion?.();
    const svg = getSvg?.();
    const layoutWidth = finite(svg?.dataset.layoutWidth, finite(svg?.getAttribute('viewBox')?.split(/\s+/)[2], 0));
    const layoutHeight = finite(svg?.dataset.layoutHeight, finite(svg?.getAttribute('viewBox')?.split(/\s+/)[3], 0));
    const availableWidth = finite(region?.clientWidth, 0);
    const availableHeight = finite(region?.clientHeight, 0);
    const scale = layoutWidth > 0 && layoutHeight > 0 && availableWidth > 0 && availableHeight > 0
      ? clamp(Math.min(1, (availableWidth - 16) / layoutWidth, (availableHeight - 16) / layoutHeight), SCALE_MIN, SCALE_MAX)
      : 1;
    const next = { scale, scrollLeft: 0, scrollTop: 0 };
    return animated ? animateTo(next, reason, '--motion-slow', 320) : setViewport(next, reason);
  }

  // Bounded inertia glide after a pointer drag release.
  function startInertia(velocityX, velocityY) {
    if (isReduced()) return false;
    const speed = Math.hypot(velocityX, velocityY);
    if (!Number.isFinite(speed) || speed < INERTIA_MIN_SPEED) return false;
    const current = capture();
    const region = getRegion?.();
    let distanceX = velocityX * INERTIA_TAU;
    let distanceY = velocityY * INERTIA_TAU;
    const magnitude = Math.hypot(distanceX, distanceY);
    if (magnitude > INERTIA_MAX_DISTANCE) {
      distanceX *= INERTIA_MAX_DISTANCE / magnitude;
      distanceY *= INERTIA_MAX_DISTANCE / magnitude;
    }
    const maxLeft = finite(region?.scrollWidth, 0) > 0 && finite(region?.clientWidth, 0) > 0
      ? Math.max(0, region.scrollWidth - region.clientWidth) : Number.MAX_SAFE_INTEGER;
    const maxTop = finite(region?.scrollHeight, 0) > 0 && finite(region?.clientHeight, 0) > 0
      ? Math.max(0, region.scrollHeight - region.clientHeight) : Number.MAX_SAFE_INTEGER;
    animateTo({
      scrollLeft: clamp(current.scrollLeft - distanceX, 0, maxLeft),
      scrollTop: clamp(current.scrollTop - distanceY, 0, maxTop),
    }, 'inertia', '--motion-base', 4 * INERTIA_TAU);
    return true;
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
      stopAnimation();
      const current = capture();
      drag = { pointerId: event.pointerId, x: finite(event.clientX, 0), y: finite(event.clientY, 0),
        scrollLeft: current.scrollLeft, scrollTop: current.scrollTop, moved: false,
        lastX: finite(event.clientX, 0), lastY: finite(event.clientY, 0), lastT: now() };
      region.classList.add('is-panning');
      region.setPointerCapture?.(event.pointerId);
    });
    region.addEventListener('pointermove', event => {
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const left = Math.max(0, drag.scrollLeft - (finite(event.clientX, drag.x) - drag.x));
      const top = Math.max(0, drag.scrollTop - (finite(event.clientY, drag.y) - drag.y));
      drag.moved ||= Math.abs(left - drag.scrollLeft) + Math.abs(top - drag.scrollTop) > 3;
      const time = now();
      if (time - drag.lastT >= INERTIA_MIN_SAMPLE_MS) {
        const elapsed = time - drag.lastT;
        drag.velocityX = clamp((finite(event.clientX, drag.lastX) - drag.lastX) / elapsed, -INERTIA_MAX_SPEED, INERTIA_MAX_SPEED);
        drag.velocityY = clamp((finite(event.clientY, drag.lastY) - drag.lastY) / elapsed, -INERTIA_MAX_SPEED, INERTIA_MAX_SPEED);
        drag.lastX = finite(event.clientX, drag.lastX);
        drag.lastY = finite(event.clientY, drag.lastY);
        drag.lastT = time;
      }
      state = { ...state, scrollLeft: left, scrollTop: top };
      apply('pointer-pan');
      event.preventDefault();
    });
    const endDrag = event => {
      if (!drag || (drag.pointerId != null && event.pointerId !== drag.pointerId)) return;
      region.releasePointerCapture?.(event.pointerId);
      region.classList.remove('is-panning');
      const { velocityX = 0, velocityY = 0, moved } = drag;
      drag = null;
      if (moved) startInertia(velocityX, velocityY);
    };
    region.addEventListener('pointerup', endDrag);
    region.addEventListener('pointercancel', endDrag);
    region.addEventListener('keydown', event => {
      if (event.target !== region) return;
      const actions = {
        ArrowLeft: () => panByAnimated(-PAN_STEP, 0, 'keyboard-pan'),
        ArrowRight: () => panByAnimated(PAN_STEP, 0, 'keyboard-pan'),
        ArrowUp: () => panByAnimated(0, -PAN_STEP, 'keyboard-pan'),
        ArrowDown: () => panByAnimated(0, PAN_STEP, 'keyboard-pan'),
        '+': () => zoomByAnimated(SCALE_STEP, 'keyboard-zoom'),
        '=': () => zoomByAnimated(SCALE_STEP, 'keyboard-zoom'),
        '-': () => zoomByAnimated(-SCALE_STEP, 'keyboard-zoom'),
        '0': () => fitAnimated('keyboard-fit'),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      stopAnimation();
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
      action('←', 'Pan graph left', () => panByAnimated(-PAN_STEP, 0)),
      action('↑', 'Pan graph up', () => panByAnimated(0, -PAN_STEP)),
      action('↓', 'Pan graph down', () => panByAnimated(0, PAN_STEP)),
      action('→', 'Pan graph right', () => panByAnimated(PAN_STEP, 0)),
      action('−', 'Zoom graph out', () => zoomByAnimated(-SCALE_STEP)),
      action('+', 'Zoom graph in', () => zoomByAnimated(SCALE_STEP)),
      action('Fit', 'Fit graph to viewport', () => fitAnimated()),
    );
    zoomOutput = element('output', 'meta graph-viewport-zoom', `${Math.round(state.scale * 100)}%`);
    zoomOutput.setAttribute('aria-label', 'Graph zoom');
    toolbar.append(zoomOutput);
    return toolbar;
  }

  return { bind, capture, controls, fit, fitAnimated, panBy, panByAnimated, setViewport, zoomBy, zoomByAnimated,
    cancelMotion: stopAnimation, getState: capture };
}

export const GRAPH_VIEWPORT_LIMITS = Object.freeze({ min: SCALE_MIN, max: SCALE_MAX, step: SCALE_STEP, pan: PAN_STEP });
export const GRAPH_INERTIA_LIMITS = Object.freeze({ tau: INERTIA_TAU, minSpeed: INERTIA_MIN_SPEED, maxDistance: INERTIA_MAX_DISTANCE });
