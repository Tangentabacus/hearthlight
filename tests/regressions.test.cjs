const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8');

test('entry page loads each script once in simulation/UI order', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /^(?:<{7}|={7}|>{7})/m);
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1].split('?')[0]);
  assert.deepEqual(scripts, ['game.js', 'ui.js']);
});

function game() {
  const context = vm.createContext({
    sfx() {}, centerCam() {}, buildBuildMenu() {}, setStatus() {},
    localStorage: { getItem() { return null; } },
  });
  vm.runInContext(core, context);
  vm.runInContext("newGame('regression');", context);
  return code => vm.runInContext(code, context);
}

test('gatherers return to the same resource after a night at home', () => {
  const run = game();
  run(`
    G.tiles = G.tiles.map(() => ({ t: 'grass', amt: 0 }));
    const b = { id: 100, type: 'woodcutter', x: 50, y: 48, built: true, lvl: 1, tx: idx(52, 48) };
    G.builds.push(b); rebuildOcc();
    const v = G.villagers[0];
    Object.assign(v, { job: b.id, chrono: 0, age: 6, injured: 0, pregnant: 0, nursing: false,
      x: 52.5, y: 48.5, equipped: true, workTi: b.tx });
    G.day = 0.5; updateVillager(v, 0.001);
    G.day = 0.95; updateVillager(v, 0.1);
    G.day = 1.5; updateVillager(v, 0.1); updateVillager(v, 0.1);
  `);
  assert.equal(run('v.dx'), 52.5);
  assert.equal(run('v.dy'), 48.5);
  assert.equal(run('v.state'), 'work');
});

test('zero crew prevents automatic repair assignments', () => {
  const run = game();
  run(`G.builds.push({ id: 100, type: 'watch', x: 50, y: 48, built: true, lvl: 1, hp: 2, maxCrew: 0 }); assignJobs();`);
  assert.equal(run('G.villagers.filter(v => v.job === 100).length'), 0);
});

test('malformed save cannot replace the active village', () => {
  const run = game();
  run(`const original = G; const originalId = nextId;
    const bad = JSON.parse(serialize()); delete bad.G.builds;
    let accepted; try { accepted = deserialize(JSON.stringify(bad)); } catch { accepted = false; }`);
  assert.equal(run('accepted'), false);
  assert.equal(run('G === original'), true);
  assert.equal(run('nextId === originalId'), true);
  assert.doesNotThrow(() => run('tick(0.001)'));
});

test('save round trip preserves the village and migrates older building data', () => {
  const run = game();
  run(`G.builds.push({ id: 100, type: 'torch', x: 50, y: 48, built: true, lvl: 1 });
    const saved = serialize(); const seed = G.seedStr;`);
  assert.equal(run('deserialize(saved)'), true);
  assert.equal(run('G.seedStr === seed'), true);
  assert.equal(run('G.builds[0].fuel'), 20);
  assert.equal(run('G.builds[0].hp'), 6);
  assert.doesNotThrow(() => run('tick(0.001)'));
});

test('migration failure rolls back state and building lookup', () => {
  const run = game();
  run(`G.builds.push({ id: 100, type: 'cabin', x: 50, y: 48, built: true, lvl: 1 }); rebuildOcc();
    const original = G; const originalId = nextId; const bad = JSON.parse(serialize());
    bad.G.monsters = {}; bad.nextId = 12345;`);
  assert.equal(run('deserialize(JSON.stringify(bad))'), false);
  assert.equal(run('G === original && nextId === originalId'), true);
  assert.equal(run('buildAt(50, 48) === G.builds[0]'), true);
  assert.equal(run('deserialize("not json")'), false);
  assert.equal(run('deserialize("null")'), false);
});

test('successful import clears interactions belonging to the previous village', () => {
  const run = game();
  run(`const saved = serialize(); selected = { kind: 'build', id: 999 }; buildMode = 'cabin'; uiMode = 'focus';`);
  assert.equal(run('deserialize(saved)'), true);
  assert.equal(run('selected === null && buildMode === null && uiMode === null'), true);
});

test('default crew still repairs a damaged cabin', () => {
  const run = game();
  run(`G.builds.push({ id: 100, type: 'cabin', x: 50, y: 48, built: true, lvl: 1, hp: 2 }); assignJobs();`);
  assert.equal(run('G.villagers.filter(v => v.job === 100).length'), 1);
});

function touchUI() {
  const handlers = {}, timers = new Map();
  let timerId = 0, taps = 0, menus = 0;
  const context = vm.createContext({
    canvas: { addEventListener(name, fn) { handlers[name] = fn; } },
    mouse: { x: 0, y: 0 }, cam: { x: 0, y: 0 }, navigator: {},
    $: () => ({ classList: { toggle() { menus++; } } }),
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }, handleTap() { taps++; },
    clamp: (n, a, b) => Math.max(a, Math.min(b, n)), minZoom: () => 1,
    zoomTarget: 2, zoomAnchor: null,
  });
  vm.runInContext(ui.slice(ui.indexOf('const touches ='), ui.indexOf('function hoverStatus()')), context);
  const touch = (identifier, clientX = 100, clientY = 100) => ({ identifier, clientX, clientY });
  return {
    send(name, ...points) { handlers[name]({ preventDefault() {}, changedTouches: points }); },
    hold() { for (const fn of timers.values()) fn(); timers.clear(); },
    touch, taps: () => taps, menus: () => menus,
  };
}

test('long press opens the menu without also tapping the world', () => {
  const ui = touchUI(); const finger = ui.touch(1);
  ui.send('touchstart', finger); ui.hold(); ui.send('touchend', finger);
  assert.equal(ui.menus(), 1); assert.equal(ui.taps(), 0);
});

test('two-finger gesture never becomes a tap even without movement', () => {
  const ui = touchUI(); const a = ui.touch(1), b = ui.touch(2, 200);
  ui.send('touchstart', a); ui.send('touchstart', b);
  ui.send('touchend', b); ui.send('touchend', a);
  assert.equal(ui.taps(), 0);
});

test('cancelled touch is cleared and a subsequent tap works', () => {
  const ui = touchUI(); const a = ui.touch(1), b = ui.touch(2);
  ui.send('touchstart', a); ui.send('touchcancel', a); ui.hold();
  ui.send('touchstart', b); ui.send('touchend', b);
  assert.equal(ui.menus(), 0); assert.equal(ui.taps(), 1);
});
