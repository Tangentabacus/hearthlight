const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');

function game() {
  const context = vm.createContext({ sfx() {}, centerCam() {}, buildBuildMenu() {}, setStatus() {} });
  vm.runInContext(source, context);
  vm.runInContext("Math.random = mulberry32(123); newGame('balance');", context);
  return code => vm.runInContext(code, context);
}

function household(run) {
  run(`
    G.villagers = G.villagers.slice(0, 2);
    const cabin = { id: 100, type: 'cabin', x: 50, y: 48, built: true, lvl: 1 };
    G.builds = [cabin]; rebuildOcc(); assignHomes();
    G.happy = 60; G.res.food = 100;
  `);
}

test('worn routes keep their speed while off-path walking is moderately slower', () => {
  const run = game();
  const distances = run(`
    G.tiles = G.tiles.map(() => ({ t: 'grass', amt: 0 }));
    [0, 4, 12].map(wear => {
      G.wear.fill(wear);
      const v = { x: 40.5, y: 40.5, dx: 60.5, dy: 40.5, path: [], pi: 0 };
      follow(v, 0.01, 100, false); return v.x - 40.5;
    });
  `);
  assert.ok(Math.abs(distances[0] - 0.8) < 1e-9);
  assert.ok(distances[1] > distances[0] && distances[1] < distances[2]);
  assert.ok(Math.abs(distances[2] - 1.35) < 1e-9);
});

test('ancient roads provide the full movement benefit without needing wear', () => {
  const run = game();
  run(`G.tiles[idx(40, 40)].t = 'road'; G.wear.fill(0);
    const walker = { x: 40.5, y: 40.5, dx: 60.5, dy: 40.5, path: [], pi: 0 };
    follow(walker, 0.01, 100, false);`);
  assert.ok(Math.abs(run('walker.x - 40.5') - 1.35) < 1e-9);
});

test('daily tending restores noticeable fire recession for three wood', () => {
  const run = game();
  run(`G.fire.fuel = 100; const radius = effLight(); const wood = G.res.wood; updateFire(1);`);
  assert.ok(run('G.fire.fuel >= 75 && G.fire.fuel <= 80'));
  assert.ok(run('effLight() < radius'));
  run('stoke();');
  assert.equal(run('G.fire.fuel'), 100);
  assert.equal(run('wood - G.res.wood'), 3);
});

test('missing a daily tending is survivable, including an ordinary winter', () => {
  for (const day of [1, 37]) {
    const run = game();
    run(`G.day = ${day}; G.fire.fuel = 100; updateFire(2);`);
    assert.ok(run('G.fire.lit && G.fire.fuel > 35'));
  }
});

test('emergency tending preserves low fire without an excessive wood charge', () => {
  const run = game();
  run(`G.fire.fuel = 28; G.villagers[0].x = HX + 0.5; G.villagers[0].y = HY + 0.5;
    const wood = G.res.wood; updateFire(1);`);
  assert.ok(run('G.fire.lit && G.fire.fuel <= 28'));
  assert.ok(run('wood - G.res.wood > 0 && wood - G.res.wood <= 3'));
});

test('healthy housed couples conceive more readily and deliver after twelve days', () => {
  const run = game(); household(run);
  run('Math.random = () => 0.022; conceptions(1);');
  assert.equal(run('G.villagers[0].pregnant'), 12);
  run('gestate(11);');
  assert.equal(run('pop()'), 2);
  run('gestate(1);');
  assert.equal(run('pop()'), 3);
  assert.equal(run('G.villagers[2].age'), 0);
  assert.equal(run('G.villagers[2].mom === G.villagers[0].id'), true);
  assert.equal(run('G.villagers[2].home'), 100);
  assert.equal(run('JOB_TYPES.every(j => G.villagers[2].apt[j] >= Math.max(G.villagers[0].apt[j], G.villagers[1].apt[j]))'), true);
});

test('existing saves keep pregnancy progress and receive the new movement and age rules', () => {
  const run = game(); household(run);
  run(`G.villagers[0].pregnant = 16; const oldSave = serialize();`);
  assert.equal(run('deserialize(oldSave)'), true);
  assert.equal(run('G.villagers[0].pregnant'), 16);
  run('gestate(12);');
  assert.equal(run('pop()'), 2);
  assert.equal(run('G.villagers[0].pregnant'), 4);
  run('gestate(4);');
  assert.equal(run('pop()'), 3);
  assert.doesNotThrow(() => run('tick(0.001)'));
});

test('pregnancies reserve the last bed in a shared cabin', () => {
  const run = game(); household(run);
  run(`const a = spawnVillager({ sex: 'f', family: 'Other' });
    const b = spawnVillager({ sex: 'm', family: 'Other' });
    a.spouse = b.id; b.spouse = a.id; a.bearer = true;
    assignHomes(); G.villagers[0].pregnant = 4;
    Math.random = () => 0; conceptions(1);`);
  assert.equal(run('G.villagers.filter(v => v.pregnant > 0).length'), 1);
});

test('ruined homes cannot start pregnancies', () => {
  const run = game(); household(run);
  run('G.builds[0].ruined = true; Math.random = () => 0; conceptions(1);');
  assert.equal(run('G.villagers[0].pregnant'), 0);
});

test('couple formation uses elapsed game time at every speed', () => {
  const run = game();
  run(`G.villagers = G.villagers.slice(0, 2); G.day = 0.85;
    G.villagers.forEach((v, i) => { v.spouse = null; v.state = 'gather'; v.family = 'Family' + i; });
    Math.random = () => 0.015; familyStep(0.0001);`);
  assert.equal(run('G.villagers[0].spouse'), null);
  run('familyStep(0.001);');
  assert.equal(run('G.villagers[0].spouse === G.villagers[1].id'), true);
});

test('children help from age one and join the workforce at three', () => {
  const run = game(); household(run);
  run(`const child = spawnVillager({ age: 0, mom: G.villagers[0].id, family: G.villagers[0].family });`);
  assert.equal(run('isHelper(child) || canWork(child)'), false);
  run('child.age = 1;');
  assert.equal(run('isHelper(child) && !canWork(child)'), true);
  run(`child.age = 2; G.happy = 0; onNewYear();`);
  assert.equal(run('canWork(child) && !isHelper(child)'), true);
  assert.equal(run('G.log.some(e => e.msg.includes(child.name) && e.msg.includes("come of age"))'), true);
});

test('brazier light extends beyond the Hearth and follows fuel, ruin, and reload state', () => {
  const run = game();
  run(`G.tiles = G.tiles.map(() => ({ t: 'grass', amt: 0 }));
    G.builds = [{ id: 100, type: 'torch', x: 55, y: 48, built: true, lvl: 1, fuel: 24, hp: 6 }];
    rebuildOcc();`);
  assert.equal(run('isLit(59, 48)'), true);
  assert.equal(run('placeInfo("cabin", 59, 48).ok'), true);
  assert.equal(run('isLit(60, 48)'), false);
  assert.ok(run('brightnessAt(59.5, 48.5)') > 0);
  run('G.builds[0].fuel = 0;');
  assert.equal(run('isLit(59, 48)'), false);
  assert.equal(run('feedBrazier(G.builds[0])'), true);
  assert.equal(run('isLit(59, 48)'), true);
  assert.equal(run('deserialize(serialize())'), true);
  assert.equal(run('isLit(59, 48)'), true);
  run('G.builds[0].ruined = true;');
  assert.equal(run('isLit(59, 48)'), false);
});
