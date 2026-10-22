import assert from 'node:assert/strict';
import test from 'node:test';
import { createMiniDom } from './fixtures/mini-dom.mjs';

// T11 graph motion proof: keyboard pan/zoom animate along the motion tokens
// through an injectable frame clock (eased interpolation, clamped bounds),
// pointer drags release into inertia that is bounded and cancelled by
// interaction, reduced motion resolves instantly, and the viewport state
// survives a polling re-bind (no reset). V2-T3: the toolbar cluster is gone
// — pointer, keyboard and programmatic fit-on-mount are the whole surface.

const dom = createMiniDom();
globalThis.document = dom.document;

const { createGraphViewportController, GRAPH_INERTIA_LIMITS, GRAPH_VIEWPORT_LIMITS } = await import('../ui/graph-viewport.mjs');

function frameClock() {
  let now = 0;
  const pending = [];
  return {
    now: () => now,
    requestFrame: tick => { pending.push(tick); return pending.length; },
    cancelFrame: handle => { pending.splice(handle - 1, 1); },
    advance(ms) {
      now += ms;
      const tick = pending.shift();
      if (tick) tick();
      return Boolean(tick);
    },
    drain(maxFrames = 200) { let frames = 0; while (this.advance(16) && frames < maxFrames) frames += 1; return frames; },
    pendingCount: () => pending.length,
  };
}

function regionFixture(width = 640, height = 400) {
  const region = dom.document.createElement('div');
  region.classList.add('graph-viewport');
  region.clientWidth = width;
  region.clientHeight = height;
  region.scrollWidth = width * 3;
  region.scrollHeight = height * 3;
  const svg = dom.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1200 800');
  region.append(svg);
  dom.document.body.append(region);
  return { region, svg };
}

function controller(options = {}) {
  const clock = frameClock();
  const events = [];
  // Views resolve the region through the live DOM on every access, so a
  // re-render is transparent to the controller. The holder mirrors that.
  const current = regionFixture();
  const controllerInstance = createGraphViewportController({
    getRegion: () => current.region,
    getSvg: () => current.svg,
    onChange: event => events.push(event),
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    now: clock.now,
    ...options,
  });
  controllerInstance.bind(current.region, current.svg, 1200, 800);
  return {
    controller: controllerInstance, clock, events,
    region: current.region, svg: current.svg,
    swapRegion() { const next = regionFixture(); current.region = next.region; current.svg = next.svg; return next; },
  };
}

test('toolbar zoom eases along the motion curve and clamps at the maximum', () => {
  const { controller: viewport, clock, events, region } = controller();
  viewport.zoomByAnimated(GRAPH_VIEWPORT_LIMITS.step);
  assert.equal(clock.pendingCount() > 0, true, 'an animation is scheduled');
  const mid = [];
  let guard = 0;
  while (clock.pendingCount() > 0 && guard < 100) { clock.advance(20); mid.push(viewport.getState().scale); guard += 1; }
  assert.equal(viewport.getState().scale, 1.25, 'the eased zoom lands exactly on the step');
  const strictlyInside = mid.slice(0, -1).every((value, index) => value > 1 && value < mid[index + 1]);
  assert.equal(strictlyInside, true, 'intermediate frames interpolate monotonically between start and target');
  assert.equal(events.at(-1).reason, 'zoom-animated', 'the animation reports once on completion');

  viewport.zoomByAnimated(10);
  clock.drain();
  assert.equal(viewport.getState().scale, GRAPH_VIEWPORT_LIMITS.max, 'zoom clamps at the token maximum');
  region.remove();
});

test('keyboard pan and zoom still work and animate to their targets', () => {
  const { controller: viewport, clock, events, region } = controller();
  region.focus();
  region.dispatchEvent({ type: 'keydown', key: 'ArrowRight', target: region });
  clock.drain();
  assert.equal(viewport.getState().scrollLeft, GRAPH_VIEWPORT_LIMITS.pan, 'keyboard pan reaches the full step');
  assert.equal(events.some(event => event.reason === 'keyboard-pan'), true);

  region.dispatchEvent({ type: 'keydown', key: '+', target: region });
  clock.drain();
  assert.equal(viewport.getState().scale, 1.25, 'keyboard zoom remains available');
  region.dispatchEvent({ type: 'keydown', key: '0', target: region });
  clock.drain();
  // fit scale for a 640x400 viewport over a 1200x800 layout: min(1, 624/1200, 384/800)
  assert.ok(Math.abs(viewport.getState().scale - 0.48) < 1e-9, 'keyboard fit restores the fit scale');
  region.remove();
});

test('pointer drags glide with bounded inertia and any interaction cancels it', () => {
  const { controller: viewport, clock, region } = controller();
  region.dispatchEvent({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 300, clientY: 200 });
  // A real flick: 80px leftwards across two sampled frames (>8ms apart).
  region.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 260, clientY: 200 });
  clock.advance(50);
  region.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 180, clientY: 200 });
  clock.advance(50);
  const atRelease = viewport.getState().scrollLeft;
  region.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 180, clientY: 200 });
  assert.equal(clock.pendingCount() > 0, true, 'the release schedules the inertia glide');
  clock.drain();
  const glided = viewport.getState().scrollLeft;
  assert.ok(glided > atRelease, 'inertia continues the pan direction');
  assert.ok(glided <= atRelease + GRAPH_INERTIA_LIMITS.maxDistance + 1e-6, 'the glide never exceeds the bounded distance');

  // A slow release (below the speed threshold) never starts inertia.
  region.dispatchEvent({ type: 'pointerdown', pointerId: 2, button: 0, clientX: 300, clientY: 200 });
  region.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 290, clientY: 200 });
  clock.advance(400);
  region.dispatchEvent({ type: 'pointermove', pointerId: 2, clientX: 288, clientY: 200 });
  const beforeSlow = viewport.getState().scrollLeft;
  region.dispatchEvent({ type: 'pointerup', pointerId: 2, clientX: 288, clientY: 200 });
  assert.equal(clock.pendingCount(), 0, 'a slow pointer release does not glide');

  // A keypress during the glide freezes it in place.
  region.dispatchEvent({ type: 'pointerdown', pointerId: 3, button: 0, clientX: 300, clientY: 200 });
  region.dispatchEvent({ type: 'pointermove', pointerId: 3, clientX: 240, clientY: 200 });
  clock.advance(50);
  region.dispatchEvent({ type: 'pointermove', pointerId: 3, clientX: 150, clientY: 200 });
  clock.advance(50);
  region.dispatchEvent({ type: 'pointerup', pointerId: 3, clientX: 150, clientY: 200 });
  clock.advance(16);
  const frozen = viewport.getState().scrollLeft;
  region.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', target: region });
  const afterKey = viewport.getState().scrollLeft;
  clock.drain();
  assert.ok(afterKey <= frozen + GRAPH_VIEWPORT_LIMITS.pan + 1e-6, 'keyboard interaction takes over from the glide');
  region.remove();
});

test('reduced motion resolves zooms instantly and never glides', () => {
  const { controller: viewport, clock, events, region } = controller({ reducedMotion: () => true });
  viewport.zoomByAnimated(GRAPH_VIEWPORT_LIMITS.step);
  assert.equal(clock.pendingCount(), 0, 'no frames are scheduled under reduced motion');
  assert.equal(viewport.getState().scale, 1.25, 'the zoom resolves in a single step');
  assert.equal(events.at(-1).reason, 'zoom-animated');

  region.dispatchEvent({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 300, clientY: 200 });
  region.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 220, clientY: 200 });
  clock.advance(50);
  region.dispatchEvent({ type: 'pointermove', pointerId: 1, clientX: 140, clientY: 200 });
  clock.advance(50);
  const atRelease = viewport.getState().scrollLeft;
  region.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 140, clientY: 200 });
  assert.equal(clock.pendingCount(), 0, 'reduced motion disables the inertia glide');
  assert.equal(viewport.getState().scrollLeft, atRelease);
  region.remove();
});

test('pan and zoom state survive a polling re-bind (no viewport reset)', () => {
  const { controller: viewport, clock, swapRegion, region } = controller();
  viewport.setViewport({ scale: 1.5, scrollLeft: 240, scrollTop: 120 }, 'poll');
  clock.drain();
  const before = viewport.getState();
  const fresh = swapRegion(); // the re-render replaced the DOM subtree
  viewport.bind(fresh.region, fresh.svg, 1200, 800);
  assert.equal(fresh.region.scrollLeft, before.scrollLeft, 'scroll position is restored after re-render');
  assert.equal(fresh.region.scrollTop, before.scrollTop);
  assert.equal(fresh.region.dataset.zoom, String(before.scale), 'zoom level is restored');
  assert.deepEqual(viewport.getState(), before, 'presentation state is unchanged by the poll');
  region.remove();
  fresh.region.remove();
});

test('the motion durations come from the computed token layer when available', () => {
  const clock = frameClock();
  const { region, svg } = regionFixture();
  const ownerView = { getComputedStyle: () => ({ getPropertyValue: token => (token === '--motion-base' ? '0ms' : '') }) };
  region.ownerDocument = { defaultView: ownerView };
  const events = [];
  const viewport = createGraphViewportController({
    getRegion: () => region, getSvg: () => svg, onChange: event => events.push(event),
    requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: clock.now,
  });
  viewport.bind(region, svg, 1200, 800);
  viewport.zoomByAnimated(GRAPH_VIEWPORT_LIMITS.step);
  assert.equal(clock.pendingCount(), 0, 'a 0ms token (reduced motion) skips animation entirely');
  assert.equal(viewport.getState().scale, 1.25);
  region.ownerDocument = undefined;
  region.remove();
});
