const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8');
const nightFunction = ui.slice(ui.indexOf('function nightAlpha()'), ui.indexOf('/* each building type'));

test('visual darkness follows the simulation clock: night at midnight, light at noon', () => {
  const context = vm.createContext({ G: { day: 0 }, clamp: (x, a, b) => Math.max(a, Math.min(b, x)) });
  vm.runInContext(nightFunction, context);
  const shade = day => { context.G.day = day; return vm.runInContext('nightAlpha()', context); };
  assert.equal(shade(0), 1);
  assert.equal(shade(0.5), 0);
  assert.ok(shade(0.1) > shade(0.25));
  assert.ok(shade(0.25) > shade(0.4));
  assert.ok(shade(0.9) > shade(0.75));
  assert.ok(Math.abs(shade(0.25) - shade(0.75)) < 1e-9);
  assert.equal(shade(48.5), shade(0.5));
});

// A one-pixel Canvas compositor checks the resulting light, not just the presence
// of a circle. Both shadow removal and the warm color pass must affect the ground.
function pixelContext(x, y, initial = [0, 0, 0, 0]) {
  const rgba = value => value.match(/[\d.]+/g).map(Number);
  const blend = (dst, src) => {
    const a = src[3] + dst[3] * (1 - src[3]);
    return a ? [0, 1, 2].map(i => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a).concat(a) : [0, 0, 0, 0];
  };
  return {
    pixel: initial, globalCompositeOperation: 'source-over', setTransform() {},
    clearRect() { this.pixel = [0, 0, 0, 0]; },
    createRadialGradient(cx, cy, inner, _x, _y, outer) {
      const stops = [];
      return {
        addColorStop(t, color) { stops.push([t, rgba(color)]); },
        sample() {
          const t = Math.max(0, Math.min(1, (Math.hypot(x - cx, y - cy) - inner) / (outer - inner)));
          const hi = stops.findIndex(s => s[0] >= t);
          if (hi === 0) return stops[0][1];
          const [loT, loC] = stops[hi - 1], [hiT, hiC] = stops[hi];
          return loC.map((v, i) => v + (hiC[i] - v) * (t - loT) / (hiT - loT));
        },
      };
    },
    fillRect(left, top, width, height) {
      if (x < left || y < top || x >= left + width || y >= top + height) return;
      const src = typeof this.fillStyle === 'string' ? rgba(this.fillStyle) : this.fillStyle.sample();
      if (this.globalCompositeOperation === 'destination-out') this.pixel[3] *= 1 - src[3];
      else this.pixel = blend(this.pixel, src);
    },
    drawImage(image) { this.pixel = blend(this.pixel, image.context.pixel); },
  };
}

function illuminate(x, sources, night) {
  const darknessCtx = pixelContext(x, 100);
  const ctx = pixelContext(x, 100, [40, 52, 30, 1]);
  const context = vm.createContext({
    canvas: { width: 1000, height: 300 }, darknessCanvas: { width: 1000, height: 300, context: darknessCtx },
    darknessCtx, ctx, dpr: 1, sources, night,
  });
  vm.runInContext(nightFunction, context);
  vm.runInContext('drawLightSources(1000, 300, sources, night)', context);
  return { color: ctx.pixel, shadow: darknessCtx.pixel[3] };
}

test('an isolated brazier illuminates and warms its interior as well as the Hearth', () => {
  const hearth = { x: 200, y: 100, r: 100, power: 0.8 };
  const brazier = { x: 700, y: 100, r: 50, power: 0.8 };
  for (const night of [0, 1]) {
    const a = illuminate(250, [hearth], night);
    const b = illuminate(725, [brazier], night);
    assert.ok(b.shadow < 0.2, 'the middle of the usable circle must not stay in heavy shadow');
    assert.ok(b.color[0] > 50, 'firelight must visibly warm the ground');
    assert.deepEqual(b.color, a.color, 'the same relative position gets the same light profile');
    assert.ok(illuminate(700, [], night).color[0] < 10, 'an extinguished source leaves dark ground');
  }
});

test('overlapping flames remove shadow and light fades toward the edge', () => {
  const left = { x: 200, y: 100, r: 100, power: 0.8 };
  const right = { x: 300, y: 100, r: 100, power: 0.8 };
  const single = illuminate(250, [left], 1);
  const overlap = illuminate(250, [left, right], 1);
  assert.ok(overlap.shadow < single.shadow);
  assert.ok(overlap.color[0] > single.color[0]);
  const samples = [200, 265, 285, 295, 300].map(x => illuminate(x, [left], 1));
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].shadow > samples[i - 1].shadow, 'shadow must increase toward the rim');
    assert.ok(samples[i].color[0] < samples[i - 1].color[0], 'warmth must fade toward the rim');
  }
});
