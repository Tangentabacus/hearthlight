'use strict';
/* ============================================================
   HEARTHLIGHT — rendering, input, sound, HUD, boot
   ============================================================ */

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
/* older Safari and Edge lack roundRect — without this, one draw call
   kills the frame loop and the whole world freezes mid-flame */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(typeof r === 'number' ? r : 4, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}
let cam = { x: 0, y: 0, z: 2.6 };
let zoomTarget = 2.6, zoomAnchor = null;
let mouse = { x: 0, y: 0, down: false, dragged: false, sx: 0, sy: 0 };
let dpr = 1;
let lightAnim = BASE_LIGHT;
let pulse = null;
let chronTab = 'chron';
let settings = { sound: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SAVE_PREFIX + 'settings') || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem(SAVE_PREFIX + 'settings', JSON.stringify(settings)); } catch (e) {} }

/* ---------- sound: one-shots + a living ambient bed ---------- */
let AC = null, amb = null;
function ac() {
  if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  return AC;
}
function tone(freq, dur, type, vol, when) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.08, a.currentTime + (when || 0));
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (when || 0) + dur);
  o.connect(g); g.connect(a.destination);
  o.start(a.currentTime + (when || 0)); o.stop(a.currentTime + (when || 0) + dur + 0.05);
}
function noiseBurst(dur, vol, freq, q) {
  const a = ac(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = q ? 'bandpass' : 'lowpass'; f.frequency.value = freq || 600;
  if (q) f.Q.value = q;
  const g = a.createGain(); g.gain.value = vol || 0.1;
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start();
}
function sfx(name) {
  if (!settings.sound || !AC || AC.state !== 'running') return;
  try {
    if (name === 'click') tone(700, 0.06, 'square', 0.025);
    else if (name === 'thud') { tone(110, 0.18, 'triangle', 0.1); noiseBurst(0.12, 0.05, 300); }
    else if (name === 'whoosh') noiseBurst(0.35, 0.09, 900);
    else if (name === 'chime') { tone(1320, 0.5, 'sine', 0.06); tone(1760, 0.7, 'sine', 0.045, 0.12); }
    else if (name === 'growl') { tone(70, 0.5, 'sawtooth', 0.05); tone(55, 0.6, 'sawtooth', 0.04, 0.1); }
    else if (name === 'bell') { tone(660, 1.2, 'sine', 0.07); tone(440, 1.5, 'sine', 0.045, 0.05); }
    else if (name === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'sine', 0.06, i * 0.15));
    else if (name === 'chop') { tone(180, 0.07, 'triangle', 0.05); noiseBurst(0.05, 0.035, 1400, 2); }
    else if (name === 'splash') noiseBurst(0.2, 0.04, 1800, 1.5);
    else if (name === 'dig') noiseBurst(0.12, 0.04, 500);
  } catch (e) {}
}
function ambientInit() {
  const a = ac();
  if (amb || !a) return;
  const loop = (freq, q) => {
    const len = Math.floor(a.sampleRate * 2);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start();
    return { g, f };
  };
  amb = { fire: loop(420, 0.7), wind: loop(220, 0.35), water: loop(1100, 1.4), chirpAt: 0, popAt: 0 };
}
function ambientUpdate(dt, now) {
  if (!settings.sound || !AC || AC.state !== 'running') { if (amb) for (const k of ['fire', 'wind', 'water']) amb[k].g.gain.value = 0; return; }
  ambientInit();
  if (!amb || !G) return;
  // where is the player's eye?
  const r = canvas.getBoundingClientRect();
  const cx2 = (r.width / 2 - cam.x) / cam.z / TILE, cy2 = (r.height / 2 - cam.y) / cam.z / TILE;
  const dHearth = Math.hypot(cx2 - HX, cy2 - HY);
  const closeness = clamp(1 - dHearth / (effLight() + 6), 0, 1) * clamp(cam.z / 1.6, 0.3, 1);
  const power = G.fire.lit ? G.fire.fuel / FUEL_MAX : 0;
  const na = nightAlpha();
  // the fire's voice
  const fireV = 0.028 * power * closeness;
  amb.fire.g.gain.value += (fireV - amb.fire.g.gain.value) * Math.min(1, dt * 3);
  if (power > 0.4 && closeness > 0.3 && now > amb.popAt) {
    amb.popAt = now + 400 + Math.random() * 1800;
    noiseBurst(0.04, 0.05 * power * closeness, 2400, 3);            // a crackle-pop
  }
  // the land's voice
  const overWater = (() => {
    const tx = clamp(Math.floor(cx2), 0, W - 1), ty = clamp(Math.floor(cy2), 0, H - 1);
    return G.tiles[idx(tx, ty)].t === 'water';
  })();
  const windB = G.biome === 'alpine' ? 0.03 : G.biome === 'meadow' ? 0.022 : 0.012;
  amb.wind.g.gain.value += ((windB + na * 0.008) - amb.wind.g.gain.value) * Math.min(1, dt * 2);
  amb.wind.f.frequency.value = 180 + Math.sin(now / 4000) * 80;
  const waterB = (overWater ? 0.03 : 0) + (['coast', 'lakeland', 'riverlands'].includes(G.biome) ? 0.008 : 0);
  amb.water.g.gain.value += (waterB - amb.water.g.gain.value) * Math.min(1, dt * 2);
  // birds by day in the woods; crickets by night
  if (now > amb.chirpAt) {
    amb.chirpAt = now + 1500 + Math.random() * 5000;
    if (na < 0.3 && ['heartwood', 'riverlands', 'lakeland'].includes(G.biome) && Math.random() < 0.6) {
      const f0 = 2200 + Math.random() * 1400;
      tone(f0, 0.08, 'sine', 0.012); tone(f0 * 1.2, 0.07, 'sine', 0.01, 0.09);
    } else if (na > 0.7 && season() !== 3 && Math.random() < 0.7) {
      for (let i = 0; i < 3; i++) tone(3800, 0.03, 'sine', 0.006, i * 0.07);     // crickets
    }
  }
  // the sounds of work, drifting over the village
  if (closeness > 0.35 && Math.random() < dt * 0.8) {
    const w = G.villagers.filter(v => v.state === 'work' && v.job != null);
    if (w.length) {
      const t = byId(choice(w).job)?.type;
      if (t === 'woodcutter' || t === 'quarry') sfx('chop');
      else if (t === 'fisher' && Math.random() < 0.3) sfx('splash');
      else if (t === 'delver' && Math.random() < 0.4) sfx('dig');
    }
  }
}
window.addEventListener('pointerdown', () => { const a = ac(); if (a && a.state === 'suspended') a.resume(); }, { capture: true });

/* ---------- modal & panel helpers ---------- */
let modalOpenCount = () => !!document.querySelector('.modal-overlay:not(.hidden)');
function showModal(id) { $(id).classList.remove('hidden'); modalOpen = true; }
function hideModal(id) { $(id).classList.add('hidden'); modalOpen = modalOpenCount(); }
let statusTimer = 0;
function setStatus(s) { $('statusbar').textContent = s || ''; statusTimer = 4; }

function showGiftModal() {
  discover('first-gift');
  const pool = PERKS.filter(p => !G.perks.includes(p.id));
  const picks = [];
  while (picks.length < 3 && pool.length)
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  while (picks.length < 3) picks.push({ id: '_p' + Math.random(), name: 'Spark of Plenty', desc: 'At once: +30 food and +30 wood.', instant: true });
  const wrap = $('giftcards');
  wrap.innerHTML = '';
  for (const p of picks) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="cn">${p.name}</div><div class="cd">${p.desc}</div>`;
    el.onclick = () => {
      if (p.instant) { addRes('food', 30); addRes('wood', 30); }
      else G.perks.push(p.id);
      log(`Gift chosen: ${p.name}.`);
      hideModal('giftmodal');
      sfx('chime');
      uiDirty = true;
    };
    wrap.appendChild(el);
  }
  showModal('giftmodal');
}
function showChoice(title, text, options) {
  $('choicetitle').textContent = title;
  $('choicetext').textContent = text;
  const wrap = $('choicecards');
  wrap.innerHTML = '';
  for (const o of options) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="cn">${o.n}</div><div class="cd">${o.d || ''}</div>`;
    el.onclick = () => { hideModal('choicemodal'); o.fn(); uiDirty = true; };
    wrap.appendChild(el);
  }
  showModal('choicemodal');
}
function showVictory() {
  const deaths = G.log.filter(e => e.cls === 'death').length;
  showChoice('🌅 THE ETERNAL FLAME',
    `Year ${yearNum()}. ${pop()} souls. ${G.relics.length} relics raised from the ruins, ${G.lore.length} truths learned, ${deaths} dark nights survived. The fire your six travellers lit will never go out. The chronicle is complete — and the village goes on.`,
    [{ n: 'Keep playing', d: 'There is always another spring.', fn() {} }]);
}

/* ---------- HUD ---------- */
const RES_ICON = { wood: '🪵', stone: '🪨', ember: '✨', coin: '🪙', food: '🌾' };
function buildBuildMenu() {
  const menu = $('buildmenu');
  menu.innerHTML = '';
  for (const [type, def] of Object.entries(BUILDS)) {
    const el = document.createElement('button');
    el.className = 'bbtn';
    el.dataset.type = type;
    el.onclick = () => {
      if (def.unlock > G.hearth.level) return;
      buildMode = buildMode === type ? null : type;
      selected = null; uiMode = null;
      $('buildpop').classList.add('hidden');
      sfx('click');
      uiDirty = true;
    };
    el.onmouseenter = () => setStatus(`${def.name} — ${def.desc}`);
    menu.appendChild(el);
  }
}

function refreshUI() {
  if (!G) return;
  const cp = caps();
  const capTxt = k => (G.res[k] > cp[k] * 0.8 || G.builds.some(b => b.type === 'storehouse' && b.built))
    ? ` <span class="cap">/${cp[k]}</span>` : '';
  let rows =
    `<div>🌾 ${Math.floor(G.res.food)}${capTxt('food')}</div>` +
    `<div>🪵 ${Math.floor(G.res.wood)}${capTxt('wood')}</div>`;
  if (G.seen.stone) rows += `<div>🪨 ${Math.floor(G.res.stone)}${capTxt('stone')}</div>`;
  if (G.seen.ember) rows += `<div>✨ ${Math.floor(G.res.ember)}</div>`;
  if (G.seen.coin) rows += `<div>🪙 ${Math.floor(G.res.coin)}</div>`;
  $('storeshud').innerHTML = rows;

  const totalSlots = G.builds.reduce((s, b) => {
    if (!b.built || b.halt || !workplaceViable(b)) return s;
    let n = slotsOf(b);
    if (b.maxCrew != null) n = Math.min(n, b.maxCrew);
    return s + n;
  }, 0);
  const working = G.villagers.filter(v => v.job != null && byId(v.job) && byId(v.job).built).length;
  const militia = G.villagers.filter(isMilitia).length;
  const kids = G.villagers.filter(v => v.age < ADULT_AGE).length;
  const beds = housingCap();
  const bedClr = pop() > beds ? 'var(--bad)' : pop() > beds - 3 ? 'var(--ember)' : 'inherit';
  let vrows = `<div>👥 ${pop()} <span style="color:${bedClr}">· 🛏️ ${beds}</span></div>`;
  if (totalSlots > 0) vrows += `<div>🛠️ ${working}<span class="cap">/${totalSlots}</span></div>`;
  if (kids) vrows += `<div>👶 ${kids}</div>`;
  if (militia) vrows += `<div>🛡️ ${militia}</div>`;
  $('villagehud').innerHTML = vrows;

  // hearth: a yellow button and the fire itself — no meters, no prices
  const sb = $('stokebtn');
  if (!G.fire.lit) {
    sb.textContent = '🔥 Rekindle the fire';
    sb.disabled = G.res.wood < 15;
    sb.title = sb.disabled ? 'There is not enough wood left to catch.' : 'Coax it back to life.';
  } else {
    sb.textContent = 'Tend the fire';
    sb.disabled = G.res.wood < 10 || G.fire.fuel > FUEL_MAX - 3;
    sb.title = G.res.wood < 10 ? 'The woodpile is bare.' : 'Throw wood on. The fire will thank you.';
  }
  const fb = $('feedbtn');
  if (G.seen.ember && G.fire.lit && !(G.siege && !G.siege.done)) {
    fb.classList.remove('hidden');
    const fc = hearthCost();
    const extra = formExtra(G.hearth.level + 1);
    const extraTxt = extra ? ' + ' + Object.entries(extra).map(([k, v]) => `${v}${RES_ICON[k]}`).join(' ') : '';
    fb.textContent = `Offer embers ✨ ${Math.floor(G.res.ember)}/${fc}${extraTxt}`;
    fb.disabled = G.res.ember < fc || (extra && !canAfford(extra));
  } else fb.classList.add('hidden');

  // the chronicle scroll wears the village's mood
  const cb = $('chronbtn');
  cb.classList.remove('m0', 'm1', 'm2');
  cb.classList.add('m' + (G.moodTier == null ? 2 : G.moodTier));
  cb.classList.toggle('unread', (G.logSeq || 0) > (G.logRead || 0));

  $('ledgertab').classList.toggle('hidden', !G.leader);
  if (!$('chronpanel').classList.contains('hidden')) refreshChron();

  // build menu
  for (const el of $('buildmenu').children) {
    const type = el.dataset.type, def = BUILDS[type];
    const locked = def.unlock > G.hearth.level;
    el.style.display = locked ? 'none' : '';
    if (locked) continue;
    const cost = costOf(type);
    const costStr = Object.entries(cost).map(([k, v]) => `${RES_ICON[k]}${v}`).join(' ');
    el.className = 'bbtn' + (!canAfford(cost) ? ' unafford' : '') + (buildMode === type ? ' placing' : '');
    el.innerHTML = `<div class="bn">${def.emoji} ${def.name}</div><div class="bc">${costStr}</div>`;
  }
  canvas.classList.toggle('placing', !!buildMode || uiMode === 'focus');

  refreshBubble();

  for (const [id, val] of Object.entries(SPEEDS)) $(id).classList.toggle('active', G.speed === val);
}

/* the chronicle panel: chronicle, lore, ledger and help share one book */
function refreshChron() {
  if (chronTab === 'ledger' && (!G || !G.leader)) chronTab = 'chron';   // no leader, no ledger — ever
  $('chrondate').textContent = G ? `${vagueDate(G.day)} ${['🌸', '☀️', '🍂', '❄️'][season()]}` : '';
  for (const t of document.querySelectorAll('#chrontabs .tab')) t.classList.toggle('active', t.dataset.tab === chronTab);
  $('loglist').classList.toggle('hidden', chronTab !== 'chron');
  $('lorelist').classList.toggle('hidden', chronTab !== 'lore');
  $('ledgerrows').classList.toggle('hidden', chronTab !== 'ledger');
  $('helptext').classList.toggle('hidden', chronTab !== 'help');
  if (chronTab === 'chron') {
    const ll = $('loglist');
    const lkey = String(G.logSeq || G.log.length);
    if (ll.dataset.cache !== lkey) {
      ll.dataset.cache = lkey;
      ll.innerHTML = G.log.slice(0, 40).map(e =>
        `<div class="entry${e.loc ? ' loc' : ''}"${e.loc ? ` data-x="${e.loc[0]}" data-y="${e.loc[1]}" title="Show me"` : ''}>` +
        `<span class="ld">${vagueDate(e.d)}</span><br><span class="lm ${e.cls || ''}">${e.msg}</span></div>`).join('');
    }
  } else if (chronTab === 'lore') {
    let html = '';
    if (G.relics.length) {
      html += `<div class="lore"><div class="lt">🏺 Relics held</div><div class="lx">${G.relics.map(r => { const x = RELICS.find(q => q.id === r); return `<b>${x.name}</b> — ${x.desc}`; }).join('<br>')}</div></div>`;
    }
    if (G.perks.length) {
      html += `<div class="lore"><div class="lt">🔥 Gifts of the fire</div><div class="lx">${G.perks.map(p => { const x = PERKS.find(q => q.id === p); return x ? `<b>${x.name}</b> — ${x.desc}` : ''; }).join('<br>')}</div></div>`;
    }
    html += G.lore.length
      ? [...G.lore].reverse().map(id => `<div class="lore"><div class="lt">${LORE[id].t}</div><div class="lx">${LORE[id].x}</div></div>`).join('')
      : '<div class="lore"><div class="lx">Nothing yet. Live a little.</div></div>';
    $('lorelist').innerHTML = html;
  } else if (chronTab === 'ledger') {
    // the ledger speaks only of what the village has seen
    const p = G.flowPrev || {};
    const net = k => (p[k + 'In'] || 0) - (p[k + 'Out'] || 0);
    const fmt = n => `<span class="${n >= 0 ? 'pos' : 'neg'}">${n >= 0 ? '+' : ''}${n.toFixed(1)}</span>`;
    const preg = G.villagers.filter(v => v.pregnant > 0).length;
    const kids = G.villagers.filter(v => v.age < ADULT_AGE).length;
    let html =
      `<div class="lrow"><span>As of</span><span>${dateStr(G.day)}</span></div>` +
      `<div class="lrow"><span>Leader</span><span>${G.leader ? `${G.leader.name}, ${G.leader.title || ''}` : '—'}</span></div>` +
      `<div class="lrow"><span>Contentment</span><span>${G.happy}/100</span></div>` +
      `<div class="lrow"><span>Food /day</span><span>${fmt(net('food'))}</span></div>` +
      `<div class="lrow"><span>Wood /day</span><span>${fmt(net('wood'))}</span></div>` +
      `<div class="lrow"><span>The fire eats</span><span>${fireBurnRate().toFixed(1)} wood/day</span></div>`;
    if (G.seen.stone) html += `<div class="lrow"><span>Stone /day</span><span>${fmt(net('stone'))}</span></div>`;
    if (G.seen.ember) html += `<div class="lrow"><span>Embers /day</span><span>${fmt(net('ember'))}</span></div>`;
    if (G.seen.coin) html += `<div class="lrow"><span>Coin</span><span>${Math.floor(G.res.coin)}</span></div>`;
    html +=
      `<div class="lrow"><span>People</span><span>${adults().length} grown · ${kids} young${preg ? ` · ${preg} expecting` : ''}</span></div>` +
      `<div class="lrow"><span>Housing</span><span>${pop()}/${housingCap()}${G.crowded ? ` · ${G.crowded} crowded` : ''}${G.homeless ? ` · ${G.homeless} cold` : ''}</span></div>`;
    {
      // the working of the village, post by post
      const able = G.villagers.filter(v => canWork(v));
      const working = able.filter(v => v.job != null).length;
      const totalSlots = G.builds.reduce((s, b) => {
        if (!b.built && !b.halt) return s + 2;
        if (!b.built || b.halt || !workplaceViable(b)) return s;
        let n = slotsOf(b);
        if (b.maxCrew != null) n = Math.min(n, b.maxCrew);
        return s + n;
      }, 0);
      html +=
        `<div class="lrow"><span>Open posts</span><span>${Math.max(0, totalSlots - working)}</span></div>` +
        `<div class="lrow"><span>Without work</span><span>${able.length - working}</span></div>` +
        `<div class="lrow"><span>Posts changed yesterday</span><span>${G.jobChangesPrev || 0}</span></div>`;
    }
    if (G.trader.market && G.seen.coin) {
      const m = r => market(r) > 1.15 ? 'dear' : market(r) < 0.85 ? 'cheap' : 'fair';
      html += `<div class="lrow"><span>Trader's mood</span><span>${Object.keys(TRADE_GOODS).filter(r => r === 'food' || r === 'wood' || G.seen[r]).map(r => `${RES_ICON[r]}${m(r)}`).join(' ')}</span></div>`;
    }
    if (G.relics.length) html += `<div class="lrow"><span>Relics</span><span>${G.relics.length}</span></div>`;
    $('ledgerrows').innerHTML = html;
  }
}

/* selection bubble that floats over the thing itself */
function bubbleTarget() {
  if (!selected) return null;
  if (selected.kind === 'build') { const b = byId(selected.id); return b ? [b.x + 0.5, b.y, b] : null; }
  const v = G.villagers.find(x => x.id === selected.id);
  return v ? [v.x, v.y - 0.4, v] : null;
}
function refreshBubble() {
  const bub = $('bubble');
  const t = bubbleTarget();
  if (!t) { bub.classList.add('hidden'); bub.dataset.cache = ''; return; }
  bub.classList.remove('hidden');
  let inner = '', wire = null;
  if (selected.kind === 'build') {
    const b = t[2], def = BUILDS[b.type];
    const crew = G.villagers.filter(v => v.job === b.id);
    inner = `<h3>${def.emoji} ${def.name}${b.lvl > 1 ? ' ★' : ''}${b.halt ? ' · halted' : ''}${!b.built ? ' · rising' : ''}</h3>` +
      `<div class="sdesc">${def.desc}</div>`;
    if (!b.built) {
      inner += `<div class="srow"><span>Raised</span><b>${Math.round((b.progress || 0) / def.work * 100)}%</b></div>` +
        `<div class="sdesc">${crew.length ? crew.length + ' pair(s) of hands at work.' : 'No idle hands to build it.'}</div>` +
        `<div class="srow"><button class="btn" id="rushbtn">${b.rush ? 'Hastened ✓' : 'Hasten'}</button>` +
        `<button class="btn" id="demobtn">Strike scaffold</button></div>`;
      wire = () => {
        $('rushbtn').onclick = () => { b.rush = !b.rush; assignJobs(); uiDirty = true; };
        $('demobtn').onclick = () => demolish(b);
      };
    } else {
      const maxSlots = slotsOf(b);
      if (maxSlots) {
        const cap = b.maxCrew != null ? Math.min(b.maxCrew, maxSlots) : maxSlots;
        inner += `<div class="srow"><span>Crew</span><span>` +
          `<button class="btn crewbtn" id="crewminus">−</button>` +
          ` <b>${crew.length}/${cap}</b><span class="sdesc">${cap < maxSlots ? ` (of ${maxSlots})` : ''}</span> ` +
          `<button class="btn crewbtn" id="crewplus">+</button></span></div>`;
        inner += crew.slice(0, 5).map(v => `<div class="sdesc">· ${v.name} ${v.family}${(v.apt[b.type] || 1) > 1.12 ? ' — a deft hand' : ''}${nursing(v) ? ' — cradle-bound' : ''}</div>`).join('');
        if (!crew.length && !b.halt && workplaceViable(b)) inner += `<div class="sdesc" style="color:var(--bad)">No one works here yet.</div>`;
        if (!workplaceViable(b) && b.type !== 'farm') inner += `<div class="sdesc" style="color:var(--bad)">Nothing left to gather in reach.</div>`;
      }
      if (b.type === 'farm') {
        const ph = { fallow: season() === 3 ? 'frozen' : 'fallow', till: 'breaking ground', sow: 'sowing', grow: b.growth >= 1 ? 'ripe' : b.growth > 0.5 ? 'swelling' : 'green shoots', harvest: 'harvest!' }[b.phase || 'fallow'];
        inner += `<div class="srow"><span>Field</span><b>${ph}</b></div>`;
      }
      if (b.type === 'cabin') {
        const residents = G.villagers.filter(v => v.home === b.id);
        inner += `<div class="srow"><span>Beds</span><b>${residents.length}/${cabinCap(b)}</b></div>`;
        inner += residents.slice(0, 6).map(v => `<div class="sdesc">· ${v.name}${v.age < ADULT_AGE ? ' (young)' : ''}${v.pregnant > 0 ? ' (expecting)' : ''}</div>`).join('') ||
          `<div class="sdesc">Stands empty.</div>`;
      }
      const btns = [];
      if (maxSlots) btns.push(`<button class="btn" id="haltbtn">${b.halt ? 'Resume' : 'Halt'}</button>`);
      if (b.lvl === 1 && !['torch', 'palisade'].includes(b.type)) {
        const uc = upgradeCost(b);
        btns.push(`<button class="btn" id="upbtn" ${canAfford(uc) ? '' : 'disabled'}>★ ${Object.entries(uc).map(([k, v]) => `${RES_ICON[k]}${v}`).join(' ')}</button>`);
      }
      if (GATHER_KINDS[b.type] || b.type === 'hunter') btns.push(`<button class="btn" id="focusbtn">${uiMode === 'focus' ? 'Tap the map…' : 'Move work'}</button>`);
      btns.push(`<button class="btn" id="demobtn">Dismantle</button>`);
      inner += `<div class="srow">${btns.join('')}</div>`;
      wire = () => {
        const cm = $('crewminus'), cp2 = $('crewplus');
        if (cm) cm.onclick = () => {
          const cap = b.maxCrew != null ? b.maxCrew : slotsOf(b);
          b.maxCrew = Math.max(0, cap - 1);
          for (const v of G.villagers.filter(v => v.job === b.id).slice(b.maxCrew)) { v.job = null; v.equipped = false; }
          assignJobs(); uiDirty = true;
        };
        if (cp2) cp2.onclick = () => {
          const cap = b.maxCrew != null ? b.maxCrew : slotsOf(b);
          b.maxCrew = Math.min(slotsOf(b), cap + 1);
          if (b.maxCrew >= slotsOf(b)) b.maxCrew = null;
          assignJobs(); uiDirty = true;
        };
        const hb = $('haltbtn'); if (hb) hb.onclick = () => { b.halt = !b.halt; assignJobs(); uiDirty = true; };
        const ub = $('upbtn'); if (ub) ub.onclick = () => upgradeBuilding(b);
        const fcb = $('focusbtn'); if (fcb) fcb.onclick = () => { uiMode = uiMode === 'focus' ? null : 'focus'; uiDirty = true; setStatus('Tap a spot near the building to send its crew there.'); };
        const db = $('demobtn'); if (db) db.onclick = () => demolish(b);
      };
    }
  } else {
    const v = t[2];
    const stage = v.age < BABY_AGE ? 'little one' : v.age < ADULT_AGE ? 'child' : v.age >= ELDER_AGE ? 'elder' : 'adult';
    const job = v.injured > G.day ? 'healing' : isMilitia(v) ? 'militia' : v.job != null ? (BUILDS[byId(v.job)?.type]?.name || '—') : (v.age < ADULT_AGE ? 'underfoot' : 'no work');
    const sp2 = v.spouse != null ? G.villagers.find(o => o.id === v.spouse) : null;
    const knacks = JOB_TYPES.filter(j => (v.apt[j] || 1) >= 1.15);
    inner = `<h3>${v.age < ADULT_AGE ? '👶' : '🧍'} ${v.name} ${v.family}</h3>` +
      `<div class="sdesc">${stage} · ${job} · ${v.state}${v.pregnant > 0 ? ' · with child' : ''}${sp2 ? ` · bound to ${sp2.name}` : ''}</div>` +
      `<div class="thought">“${thoughtFor(v)}”</div>` +
      (knacks.length ? `<div class="sdesc">A knack for: ${knacks.map(j => BUILDS[j].name).join(', ')}</div>` : '') +
      (v.trait === 'gardener' ? `<div class="sdesc">✦ Feeds the village from bare dirt.</div>` : '');
    wire = () => {};
  }
  if (bub.dataset.cache !== inner) {
    bub.dataset.cache = inner;
    bub.innerHTML = inner;
    if (wire) wire();
  }
  // float it over the target
  const sx = t[0] * TILE * cam.z + cam.x;
  const sy = t[1] * TILE * cam.z + cam.y;
  const bw = bub.offsetWidth, bh = bub.offsetHeight;
  let left = clamp(sx - bw / 2, 8, window.innerWidth - bw - 8);
  let top = sy - bh - 16;
  const below = top < 56;
  if (below) top = sy + 24;
  bub.classList.toggle('below', below);
  bub.style.left = left + 'px';
  bub.style.top = clamp(top, 8, window.innerHeight - bh - 8) + 'px';
}
function refreshSlots() {
  $('setseed').textContent = G ? `${G.seedStr} (${BIOMES[G.biome] ? BIOMES[G.biome].name : ''})` : '—';
  $('soundtoggle').textContent = settings.sound ? 'On' : 'Off';
  let html = '';
  for (const slot of ['1', '2', '3']) {
    const info = slotInfo(slot);
    html += `<div class="setrow"><span>Slot ${slot}: ${info ? `${info.seed} — ${info.date}, ${info.pop} souls` : 'empty'}</span>` +
      `<span><button class="btn" data-save="${slot}">Save</button> <button class="btn" data-load="${slot}" ${info ? '' : 'disabled'}>Load</button></span></div>`;
  }
  $('slotrows').innerHTML = html;
}

/* ---------- camera & input ---------- */
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
function minZoom() {
  return Math.max(0.3, Math.min(window.innerWidth, window.innerHeight) / ((lightAnim * 2 + 16) * TILE));
}
function centerCam(zoomIn) {
  if (zoomIn) { cam.z = 2.6; zoomTarget = 2.6; }
  cam.z = clamp(cam.z, minZoom(), 4);
  zoomTarget = clamp(zoomTarget, minZoom(), 4);
  cam.x = window.innerWidth / 2 - (HX + 0.5) * TILE * cam.z;
  cam.y = window.innerHeight / 2 - (HY + 0.5) * TILE * cam.z;
}
function focusCam(x, y) {
  zoomTarget = Math.max(cam.z, 1.6);
  cam.z = zoomTarget;
  cam.x = window.innerWidth / 2 - (x + 0.5) * TILE * cam.z;
  cam.y = window.innerHeight / 2 - (y + 0.5) * TILE * cam.z;
  pulse = { x, y, until: performance.now() + 1600 };
}
const toWorld = (mx, my) => [(mx - cam.x) / cam.z / TILE, (my - cam.y) / cam.z / TILE];

function handleTap(mx, my, shiftHeld) {
  if (!G || modalOpen) return;
  const [wx, wy] = toWorld(mx, my);
  const x = Math.floor(wx), y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  if (uiMode === 'focus' && selected && selected.kind === 'build') {
    const b = byId(selected.id);
    if (b && Math.hypot(x - b.x, y - b.y) <= 7 && isLit(x, y)) {
      b.focus = [x, y]; b.tx = null;
      log(`${BUILDS[b.type].name}'s crew will work the ground near there now.`, '', [x, y]);
      uiMode = null; uiDirty = true;
    } else setStatus('Too far from the building, or outside the light.');
    return;
  }
  if (buildMode) {
    // one click, one building — hold shift to keep placing (desktop only)
    const before = G.builds.length;
    tryPlace(buildMode, x, y);
    if (G.builds.length > before && !shiftHeld) { buildMode = null; uiDirty = true; }
    return;
  }
  if (x === HX && y === HY) { stoke(); return; }
  const b = buildAt(x, y);
  const alreadyThis = b && selected && selected.kind === 'build' && selected.id === b.id;
  if (b && !alreadyThis) { selected = { kind: 'build', id: b.id }; uiMode = null; sfx('click'); uiDirty = true; return; }
  let pv = null, pd = 0.7;
  for (const v of G.villagers) {
    const d = Math.hypot(v.x - wx, v.y - wy);
    if (d < pd) { pd = d; pv = v; }
  }
  if (pv) selected = { kind: 'vill', id: pv.id };
  else selected = b ? { kind: 'build', id: b.id } : null;
  uiMode = null;
  uiDirty = true;
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  mouse.down = true; mouse.dragged = false;
  mouse.sx = mouse.x = e.clientX; mouse.sy = mouse.y = e.clientY;
});
window.addEventListener('mouseup', e => {
  if (e.button !== 0 || !mouse.down) return;
  mouse.down = false;
  if (mouse.dragged) return;
  handleTap(mouse.x, mouse.y, e.shiftKey);
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (buildMode) { buildMode = null; uiDirty = true; return; }
  if (uiMode) { uiMode = null; uiDirty = true; return; }
  if (selected) { selected = null; uiDirty = true; return; }
  $('buildpop').classList.toggle('hidden');
});
canvas.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.down) {
    const dx = e.clientX - mouse.sx, dy = e.clientY - mouse.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      mouse.dragged = true;
      cam.x += e.movementX; cam.y += e.movementY;
    }
  } else if (G) hoverStatus();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAnchor = [e.clientX, e.clientY];
  const f = e.deltaY < 0 ? 1.18 : 1 / 1.18;
  zoomTarget = clamp(zoomTarget * f, minZoom(), 4);
}, { passive: false });

/* touch: drag pans, pinch zooms, tap inspects, long-press opens the build menu */
const touches = new Map();
let pinchDist = 0, longPress = null, touchMoved = false;
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
  touchMoved = false;
  if (touches.size === 1) {
    const t = e.changedTouches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
    clearTimeout(longPress);
    longPress = setTimeout(() => {
      if (!touchMoved) { $('buildpop').classList.toggle('hidden'); if (navigator.vibrate) navigator.vibrate(15); }
    }, 480);
  } else if (touches.size === 2) {
    clearTimeout(longPress);
    const [a, b] = [...touches.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (touches.size === 1) {
    const t = e.changedTouches[0];
    const prev = touches.get(t.identifier);
    if (!prev) return;
    const dx = t.clientX - prev.x, dy = t.clientY - prev.y;
    if (Math.abs(t.clientX - mouse.x) + Math.abs(t.clientY - mouse.y) > 9) touchMoved = true;
    if (touchMoved) { cam.x += dx; cam.y += dy; clearTimeout(longPress); }
    touches.set(t.identifier, { x: t.clientX, y: t.clientY });
  } else if (touches.size === 2) {
    touchMoved = true;
    for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) {
      zoomAnchor = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      zoomTarget = clamp(zoomTarget * (d / pinchDist), minZoom(), 4);
    }
    pinchDist = d;
  }
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  clearTimeout(longPress);
  for (const t of e.changedTouches) touches.delete(t.identifier);
  if (touches.size === 0 && !touchMoved && e.changedTouches.length === 1) {
    const t = e.changedTouches[0];
    handleTap(t.clientX, t.clientY);
  }
  if (touches.size < 2) pinchDist = 0;
}, { passive: false });

function hoverStatus() {
  const [wx, wy] = toWorld(mouse.x, mouse.y);
  const x = Math.floor(wx), y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= W || y >= H || !isLit(x, y)) {
    if (buildMode) setStatus(`Placing ${BUILDS[buildMode].name} — click inside the light. Right-click to cancel.`);
    return;
  }
  for (const v of G.villagers) {
    if (Math.hypot(v.x - wx, v.y - wy) < 0.6 && !buildAt(x, y)) {
      setStatus(`${v.name} ${v.family} — ${v.state}.`);
      return;
    }
  }
  const t = tile(x, y);
  const names = {
    grass: G.wear[idx(x, y)] >= 12 ? 'A well-worn road' : G.wear[idx(x, y)] >= 4 ? 'A faint trail' : '',
    tree: t.amt < 4 ? 'Young trees' : 'Trees',
    berry: t.amt > 2 ? 'A berry thicket' : 'A picked-over thicket',
    stone: 'A stone outcrop', water: isWinter() ? 'Ice — solid enough to walk' : (t.fish && t.amt > 3 ? 'Something moves beneath the water' : 'Deep water'),
    ruin: 'Old ruins. Something faintly warm beneath.',
    ancient: 'An ancient tree. It glows from within.',
  };
  let s = names[t.t] ?? '';
  const b = buildAt(x, y);
  if (b) s = `${BUILDS[b.type].name}${!b.built ? ' (rising)' : ''}`;
  if (x === HX && y === HY) s = 'The Hearth. Click to throw wood on.';
  if (buildMode) {
    const info = placeInfo(buildMode, x, y);
    s = info.ok ? ghostAdvice(buildMode, x, y) : `${info.why}.`;
  }
  if (s) setStatus(s); else $('statusbar').textContent = '';
}
/* warn when a building is going somewhere unwise (#far from beds, #thin resources) */
function ghostAdvice(type, x, y) {
  const probs = [];
  const kinds = GATHER_KINDS[type];
  if (kinds || type === 'hunter') {
    let n = 0;
    for (const [dx, dy] of OFFS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const tt = G.tiles[idx(nx, ny)];
      if (type === 'hunter') { if (tt.t === 'tree' || tt.t === 'ancient') n++; }
      else if (kinds.includes(tt.t === 'water' ? (tt.fish ? 'fish' : 'water') : tt.t) && (tt.t === 'water' || tt.amt > 0)) n++;
    }
    if (n === 0) probs.push('nothing to work here');
    else if (n < 4 && type !== 'fisher') probs.push('slim pickings here');
  }
  let nearestBed = Math.abs(x - HX) + Math.abs(y - HY);
  for (const c of G.builds) if (c.type === 'cabin' && c.built)
    nearestBed = Math.min(nearestBed, Math.abs(x - c.x) + Math.abs(y - c.y));
  if (nearestBed > 16) probs.push('a long walk from any bed');
  return probs.length ? '⚠ ' + probs.join(' · ') : 'Good ground. Click to build.';
}

window.addEventListener('keydown', e => {
  if (modalOpen) {
    if (e.key === 'Escape') {
      if (!$('giftmodal').classList.contains('hidden') || !$('choicemodal').classList.contains('hidden') || !$('intromodal').classList.contains('hidden')) return;
      hideModal('settingsmodal');
    }
    return;
  }
  if (!G) return;
  const pan = 40;
  if (e.key === ' ') { e.preventDefault(); G.speed = G.speed === 0 ? 1 : 0; uiDirty = true; }
  else if (e.key === '1') { G.speed = 1; uiDirty = true; }
  else if (e.key === '2') { G.speed = 3; uiDirty = true; }
  else if (e.key === '3') { G.speed = 8; uiDirty = true; }
  else if (e.key === '+' || e.key === '=') { zoomAnchor = null; zoomTarget = clamp(zoomTarget * 1.18, minZoom(), 4); }
  else if (e.key === '-') { zoomAnchor = null; zoomTarget = clamp(zoomTarget / 1.18, minZoom(), 4); }
  else if (e.key === 'ArrowUp' || e.key === 'w') cam.y += pan;
  else if (e.key === 'ArrowDown' || e.key === 's') cam.y -= pan;
  else if (e.key === 'ArrowLeft' || e.key === 'a') cam.x += pan;
  else if (e.key === 'ArrowRight' || e.key === 'd') cam.x -= pan;
  else if (e.key === 'Escape') {
    if (buildMode) buildMode = null;
    else if (uiMode) uiMode = null;
    else if (!$('buildpop').classList.contains('hidden')) $('buildpop').classList.add('hidden');
    else if (!$('chronpanel').classList.contains('hidden')) $('chronpanel').classList.add('hidden');
    else selected = null;
    uiDirty = true;
  }
});

/* ---------- particles ---------- */
const sparks = [], smokes = [], flakes = [], critters = [], arrows = [];
function updateCritters(dt) {
  const lodges = G.builds.filter(b => b.type === 'hunter' && b.built);
  if (lodges.length && critters.length < 5 && Math.random() < dt * 0.7) {
    const L = choice(lodges);
    const [fx, fy] = focusPos(L);
    const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 3.5;
    critters.push({ x: fx + 0.5 + Math.cos(a) * d, y: fy + 0.5 + Math.sin(a) * d, a: Math.random() * Math.PI * 2, life: 5 + Math.random() * 5, hop: Math.random() * 7 });
  }
  for (const c of critters) {
    c.life -= dt; c.hop += dt * 7;
    if (Math.sin(c.hop) > 0.2) { c.x += Math.cos(c.a) * dt * 1.6; c.y += Math.sin(c.a) * dt * 1.6; }
    else if (Math.random() < dt * 2) c.a += (Math.random() - 0.5) * 2;
    // hunters actually hunt: a working hunter nearby looses an arrow
    for (const v of G.villagers) {
      const d = Math.hypot(v.x - c.x, v.y - c.y);
      if (v.state === 'work' && v.job != null && byId(v.job)?.type === 'hunter' && d < 4.5 && d > 1 && !v.carry && Math.random() < dt * 0.8) {
        arrows.push({ x1: v.x, y1: v.y - 0.3, x2: c.x, y2: c.y, t: 0 });
        c.life = Math.min(c.life, 0.18);
        c.shot = true;
        v.carry = { x: c.x, y: c.y, got: false };     // one shot, then carry it home
        sfx('chop');
        break;
      }
      if (!c.shot && d < 2.2) { c.a = Math.atan2(c.y - v.y, c.x - v.x); c.x += Math.cos(c.a) * dt * 5; c.y += Math.sin(c.a) * dt * 5; c.life -= dt * 2; break; }
    }
  }
  for (let i = critters.length - 1; i >= 0; i--) if (critters[i].life <= 0) critters.splice(i, 1);
  for (const a of arrows) a.t += dt * 6;
  for (let i = arrows.length - 1; i >= 0; i--) if (arrows[i].t >= 1.3) arrows.splice(i, 1);
}
const chips = [];
function updateParticles(dt) {
  updateCritters(dt);
  const now = performance.now();
  // stone chips fly where picks are working
  if (G && chips.length < 14 && Math.random() < dt * 3) {
    for (const b of G.builds) {
      if (b.type !== 'quarry' || !b.built || b.tx == null) continue;
      if (!G.villagers.some(v => v.job === b.id && v.state === 'work')) continue;
      chips.push({ x: b.tx % W + 0.5, y: Math.floor(b.tx / W) + 0.4, vx: (Math.random() - 0.5) * 2.4, vy: -(1 + Math.random()), life: 0.6 });
      break;
    }
  }
  for (const c of chips) { c.x += c.vx * dt; c.y += c.vy * dt; c.vy += dt * 5; c.life -= dt; }
  for (let i = chips.length - 1; i >= 0; i--) if (chips[i].life <= 0) chips.splice(i, 1);
  if (G && G.fire.lit && sparks.length < 26 && Math.random() < 0.5) {
    sparks.push({ x: HX + 0.5 + (Math.random() - 0.5) * 0.6, y: HY + 0.4, vy: -(0.8 + Math.random()), vx: (Math.random() - 0.5) * 0.4, life: 1 });
  }
  for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * (0.8 + Math.random() * 0.4); }
  for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
  if (G && smokes.length < 18 && Math.random() < 0.25) {
    const cabins = G.builds.filter(b => b.type === 'cabin' && b.built);
    if (cabins.length) {
      const c = choice(cabins);
      smokes.push({ x: c.x + 0.7, y: c.y + 0.1, life: 1 });
    }
  }
  for (const s of smokes) { s.y -= dt * 0.5; s.x += Math.sin(now / 600 + s.y * 4) * dt * 0.2; s.life -= dt * 0.35; }
  for (let i = smokes.length - 1; i >= 0; i--) if (smokes[i].life <= 0) smokes.splice(i, 1);
  const snowA = snowAmount();
  if (G && snowA > 0.05) {
    const target = Math.round(50 * snowA);
    while (flakes.length < target) flakes.push({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, s: 0.5 + Math.random() });
    while (flakes.length > target) flakes.pop();
    for (const fl of flakes) {
      fl.y += fl.s * 28 * dt; fl.x += Math.sin(now / 900 + fl.y / 30) * 12 * dt;
      if (fl.y > window.innerHeight) { fl.y = -4; fl.x = Math.random() * window.innerWidth; }
    }
  } else flakes.length = 0;
}

/* ---------- rendering ---------- */
const BIOME_STYLE = {
  heartwood:  { grass: ['#27331f', '#2b361d', '#33321c', '#4d555f'], water: '#17354c' },
  lakeland:   { grass: ['#26351f', '#2a381e', '#32331d', '#4b545e'], water: '#15425e' },
  riverlands: { grass: ['#293620', '#2d391e', '#35341d', '#4d555f'], water: '#1a4258' },
  alpine:     { grass: ['#2c332b', '#2e3530', '#34352c', '#5a646e'], water: '#1a3a50' },
  coast:      { grass: ['#2b3520', '#30381f', '#37361e', '#505a64'], water: '#14506a' },
  meadow:     { grass: ['#2d3b1e', '#33401d', '#3b3c1c', '#4f5760'], water: '#17354c' },
};
const bstyle = () => BIOME_STYLE[G.biome] || BIOME_STYLE.heartwood;
const TILE_BG = { tree: '#222f1c', berry: '#27331f', stone: '#33363c', ruin: '#2b2a33', ancient: '#1c332c', road: '#3c3c42', pylon: '#2b3326', derrick: '#332f2a', hulk: '#2f3328' };
const tHash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

function hexLerp(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  return `rgb(${Math.round(lerp(pa[0], pb[0], t))},${Math.round(lerp(pa[1], pb[1], t))},${Math.round(lerp(pa[2], pb[2], t))})`;
}
/* seasons slide into one another instead of snapping */
function grassNow() {
  const b = seasonBlend();
  const g = bstyle().grass;
  return b.t > 0 ? hexLerp(g[b.s], g[b.next], b.t) : g[b.s];
}
function snowAmount() {
  if (!G) return 0;
  const b = seasonBlend();
  if (b.s === 3) return b.t > 0 ? 1 - b.t * 0.8 : Math.min(1, ((G.day % DAYS_PER_YEAR) % DAYS_PER_SEASON) / 2 + 0.2);
  if (b.s === 2 && b.t > 0) return b.t * 0.5;       // first flurries of late autumn
  if (b.s === 0) return Math.max(0, 0.5 - ((G.day % DAYS_PER_YEAR) % DAYS_PER_SEASON) / 4);  // thaw
  return 0;
}
function nightAlpha() {
  const f = G.day % 1;
  return clamp((Math.cos((f - 0.5) * Math.PI * 2) + 1) / 2 * 1.4 - 0.2, 0, 1);
}

/* each building type has its own silhouette; the hash varies the shade */
function drawBuildingArt(b, now) {
  const px = b.x * TILE, py = b.y * TILE;
  const h = tHash(b.x, b.y);
  const night = nightAlpha() > 0.45;
  const shade = (h % 3) * 0.045;
  switch (b.type) {
    case 'cabin': {
      ctx.fillStyle = ['#7a5a3a', '#71543a', '#80603e'][h % 3];
      ctx.fillRect(px + 2, py + 6, 12, 9);
      ctx.fillStyle = ['#5d4630', '#574230', '#634a32'][(h >> 2) % 3];
      ctx.beginPath(); ctx.moveTo(px + 1, py + 7); ctx.lineTo(px + 8, py + 1); ctx.lineTo(px + 15, py + 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(px + 7, py + 10, 2.6, 5);
      ctx.fillStyle = night ? 'rgba(255,205,110,0.95)' : '#2c2418';
      ctx.fillRect(px + (h % 2 ? 3.5 : 10.5), py + 8.5, 2.2, 2.2);
      break;
    }
    case 'woodcutter': {
      ctx.fillStyle = '#54401f';
      for (let i = 0; i < 3; i++) ctx.fillRect(px + 2, py + 10 - i * 2.4, 9 - i * 2, 2);
      ctx.fillStyle = '#6b4f33';
      ctx.beginPath(); ctx.arc(px + 12.5, py + 11, 2.6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 12.5, py + 10.5); ctx.lineTo(px + 14.5, py + 5.5); ctx.stroke();
      ctx.fillStyle = '#9aa3ad'; ctx.fillRect(px + 13.6, py + 4.6, 2.4, 1.8);
      break;
    }
    case 'forager': {
      ctx.fillStyle = ['#5a7a3a', '#547438', '#60803e'][h % 3];
      ctx.beginPath(); ctx.arc(px + 7, py + 8, 5.4, Math.PI, 0); ctx.fill();
      ctx.fillRect(px + 1.6, py + 8, 10.8, 5.5);
      ctx.fillStyle = '#3a2c1c'; ctx.fillRect(px + 6, py + 9.5, 2.4, 4);
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(px + 12.6, py + 10.5, 2.8, 3);
      ctx.strokeStyle = '#5d4626'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(px + 14, py + 10.5, 1.3, Math.PI, 0); ctx.stroke();
      break;
    }
    case 'fisher': {
      ctx.fillStyle = '#6e5638';
      ctx.fillRect(px + 1, py + 7, 14, 3.4);
      ctx.fillStyle = '#5a4630';
      for (let i = 0; i < 4; i++) ctx.fillRect(px + 2.2 + i * 3.6, py + 10, 1.2, 4);
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(px + 3, py + 7); ctx.lineTo(px + 7.5, py + 1.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(220,230,240,0.6)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(px + 7.5, py + 1.5); ctx.lineTo(px + 7.5, py + 5); ctx.stroke();
      ctx.fillStyle = '#3a6a8a'; ctx.fillRect(px + 10.5, py + 3.5, 4, 3.4);
      break;
    }
    case 'hunter': {
      ctx.fillStyle = ['#7a6a4a', '#73644a', '#80704e'][h % 3];
      ctx.beginPath(); ctx.moveTo(px + 2, py + 13); ctx.lineTo(px + 8, py + 3); ctx.lineTo(px + 14, py + 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2c1c';
      ctx.beginPath(); ctx.moveTo(px + 6, py + 13); ctx.lineTo(px + 8, py + 8.5); ctx.lineTo(px + 10, py + 13); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d8cdb4'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(px + 6.6, py + 5.6); ctx.lineTo(px + 5.4, py + 3.6);
      ctx.moveTo(px + 9.4, py + 5.6); ctx.lineTo(px + 10.6, py + 3.6);
      ctx.stroke();
      break;
    }
    case 'farm': {
      ctx.fillStyle = b.phase === 'till' ? '#3d3220' : '#4a3d28';
      ctx.fillRect(px + 1, py + 4, 14, 11);
      const ph = b.phase || 'fallow';
      if (ph === 'till') {
        ctx.strokeStyle = '#5d4c32'; ctx.lineWidth = 1.6;
        for (let i = 0; i < 2 + (Math.floor(b.prog || 0) % 3); i++) { ctx.beginPath(); ctx.moveTo(px + 2, py + 5.6 + i * 2.6); ctx.lineTo(px + 14, py + 5.6 + i * 2.6); ctx.stroke(); }
      } else if (ph === 'sow') {
        ctx.fillStyle = '#8a7a50';
        for (let i = 0; i < 10; i++) ctx.fillRect(px + 2.5 + (i % 5) * 2.6, py + 6 + Math.floor(i / 5) * 4, 1, 1);
      } else if (ph === 'grow' || ph === 'harvest') {
        const g = ph === 'harvest' ? 1 : Math.min(1, b.growth || 0);
        ctx.strokeStyle = ph === 'harvest' ? '#d8b545' : `rgba(110,160,60,${0.4 + g * 0.6})`;
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(px + 2, py + 5.6 + i * 2.6); ctx.lineTo(px + 14, py + 5.6 + i * 2.6); ctx.stroke(); }
      }
      ctx.fillStyle = '#6b5436'; ctx.fillRect(px + 11.5, py + 1.5, 4, 3.4);
      break;
    }
    case 'storehouse': {
      ctx.fillStyle = ['#5d5d6e', '#575766', '#636374'][h % 3];
      ctx.fillRect(px + 1, py + 5, 14, 10);
      ctx.fillStyle = '#46465a';
      ctx.beginPath(); ctx.moveTo(px, py + 6); ctx.lineTo(px + 8, py + 1); ctx.lineTo(px + 16, py + 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a3a4c'; ctx.lineWidth = 1;
      ctx.strokeRect(px + 5.5, py + 8, 5, 6.5);
      ctx.beginPath(); ctx.moveTo(px + 5.5, py + 8); ctx.lineTo(px + 10.5, py + 14.5); ctx.moveTo(px + 10.5, py + 8); ctx.lineTo(px + 5.5, py + 14.5); ctx.stroke();
      break;
    }
    case 'delver': {
      ctx.fillStyle = '#7a5a85';
      ctx.beginPath(); ctx.moveTo(px + 3, py + 13); ctx.lineTo(px + 8, py + 5); ctx.lineTo(px + 13, py + 13); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(px + 13.5, py + 13); ctx.lineTo(px + 13.5, py + 3.5); ctx.stroke();
      ctx.fillStyle = `rgba(255,190,90,${0.7 + Math.sin(now / 280 + h) * 0.25})`;
      ctx.beginPath(); ctx.arc(px + 13.5, py + 3.4, 1.7, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a3140'; ctx.fillRect(px + 5.5, py + 13, 5, 2);
      break;
    }
    case 'quarry': {
      ctx.fillStyle = '#565d66';
      ctx.fillRect(px + 2, py + 9, 5, 5); ctx.fillRect(px + 8, py + 11, 4, 3); ctx.fillRect(px + 5, py + 5, 4, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(px + 2, py + 9, 5, 1.2); ctx.fillRect(px + 5, py + 5, 4, 1.2);
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px + 11, py + 10.5); ctx.lineTo(px + 14, py + 4.5); ctx.stroke();
      ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(px + 14.2, py + 4.8, 2, Math.PI * 0.8, Math.PI * 1.7); ctx.stroke();
      break;
    }
    case 'watch': {
      ctx.fillStyle = ['#8a4040', '#823c3e', '#914444'][h % 3];
      ctx.fillRect(px + 5, py + 4, 6, 11);
      ctx.fillStyle = '#6e3434';
      ctx.fillRect(px + 3.5, py + 2, 9, 3.4);
      ctx.fillStyle = '#2c2418'; ctx.fillRect(px + 7, py + 11, 2.2, 4);
      ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(px + 12.6, py + 14); ctx.lineTo(px + 14.6, py + 5); ctx.stroke();
      break;
    }
    case 'kiln': {
      ctx.fillStyle = '#9a4a30';
      ctx.beginPath(); ctx.arc(px + 8, py + 10, 6, Math.PI, 0); ctx.fill();
      ctx.fillRect(px + 2, py + 10, 12, 4.5);
      ctx.fillStyle = `rgba(255,150,60,${0.6 + Math.sin(now / 200 + h) * 0.3})`;
      ctx.beginPath(); ctx.arc(px + 8, py + 12.5, 2.2, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#6e3424'; ctx.fillRect(px + 7, py + 2, 2, 4);
      break;
    }
    case 'shrine': {
      ctx.fillStyle = '#5d5d6e';
      ctx.fillRect(px + 3, py + 7, 2.6, 8); ctx.fillRect(px + 10.4, py + 7, 2.6, 8); ctx.fillRect(px + 6.6, py + 5, 2.8, 10);
      for (const cx2 of [4.3, 8, 11.7]) {
        ctx.fillStyle = `rgba(255,210,110,${0.7 + Math.sin(now / 240 + cx2) * 0.25})`;
        ctx.beginPath(); ctx.arc(px + cx2, py + (cx2 === 8 ? 4 : 6), 1.1, 0, 7); ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = BUILDS[b.type].color;
      ctx.beginPath(); ctx.roundRect(px + 1, py + 3, TILE - 2, TILE - 4, 2); ctx.fill();
      ctx.font = '8px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(BUILDS[b.type].emoji, px + 8, py + 8);
    }
  }
  ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
  if (b.lvl > 1) { ctx.fillStyle = '#ffd87a'; ctx.font = '6px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★', px + 13.5, py + 3.5); }
}

/* a villager you can read at a glance */
function drawVillager(v, now) {
  const px = v.x * TILE, py = v.y * TILE;
  const child = v.age < ADULT_AGE;
  const elder = v.age >= ELDER_AGE;
  const female = (v.sex || (v.id % 2 ? 'm' : 'f')) === 'f';
  const r = child ? 1.4 : 2.0;
  const jobT = v.job != null && byId(v.job) ? byId(v.job).type : null;
  const working = v.state === 'work' && jobT;
  const skin = '#e8cfa8';
  const hairC = elder ? '#cfcabd' : ['#4a3520', '#6b4a26', '#2e2418', '#8a6a3a'][v.id % 4];

  let pose = 'stand';
  if (v.state === 'sleep' && v.home == null) pose = 'lie';
  else if (v.state === 'idle' || v.state === 'resting') pose = ['sit', 'lie', 'stand'][(v.id + Math.floor(G.day * 2)) % 3];

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(px, py + r + 0.6, r + 0.4, r * 0.5, 0, 0, 7); ctx.fill();

  const bodyC = isMilitia(v) ? '#c98a8a'
    : v.injured > G.day ? '#9a8d80'
    : jobT ? { woodcutter: '#caa468', forager: '#9db877', fisher: '#8aaec4', hunter: '#b0a06e', farm: '#d8c47a', quarry: '#aab2bc', delver: '#b394c4', kiln: '#d09a72', watch: '#c98a8a' }[jobT] || '#e3d2a8'
    : child ? '#e8d9a8' : '#b9b39f';

  if (pose === 'lie') {
    ctx.fillStyle = bodyC;
    ctx.beginPath(); ctx.ellipse(px, py + 0.6, r * 1.5, r * 0.65, 0, 0, 7); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(px - r * 1.7, py + 0.3, r * 0.5, 0, 7); ctx.fill();
    if (v.state === 'sleep' && (now / 900 + v.id) % 3 < 1) {
      ctx.fillStyle = 'rgba(220,225,235,0.7)'; ctx.font = '5px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('z', px + 2, py - 3 - ((now / 300) % 4));
    }
    return;
  }

  const bob = working ? Math.sin(now / 140 + v.id) * 1.1 : 0;
  const stride = v.state === 'walk' ? Math.sin(now / 90 + v.id) * 0.5 : 0;
  const sitDrop = pose === 'sit' ? 1 : 0;
  const bx = px + stride * 0.3, by = py + bob * 0.25 + sitDrop;

  ctx.fillStyle = bodyC;
  ctx.beginPath(); ctx.ellipse(bx, by, r * (pose === 'sit' ? 1.05 : 0.85), r * (pose === 'sit' ? 0.8 : 1), 0, 0, 7); ctx.fill();
  if (v.pregnant > 0) { ctx.beginPath(); ctx.arc(bx + r * 0.5, by + 0.2, r * 0.5, 0, 7); ctx.fill(); }
  const hy = by - r * (pose === 'sit' ? 0.9 : 1) - r * 0.3;
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(bx, hy, r * 0.55, 0, 7); ctx.fill();
  ctx.fillStyle = hairC;
  if (female) {
    ctx.beginPath(); ctx.arc(bx, hy - r * 0.15, r * 0.55, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    ctx.beginPath(); ctx.arc(bx - r * 0.55, hy + r * 0.15, r * 0.28, 0, 7); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(bx, hy - r * 0.2, r * 0.5, Math.PI, Math.PI * 2); ctx.fill();
  }

  if (!child && jobT && (working || v.state === 'walk')) {
    ctx.lineCap = 'round';
    const swing = working ? Math.sin(now / 160 + v.id * 2) : 0.3;
    if (jobT === 'woodcutter' || jobT === 'quarry') {
      ctx.save();
      ctx.translate(bx + r * 0.8, by - r * 0.4);
      ctx.rotate(-0.7 + swing * 0.8);
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -4); ctx.stroke();
      ctx.fillStyle = '#9aa3ad';
      if (jobT === 'woodcutter') ctx.fillRect(-0.4, -4.6, 2.2, 1.6);
      else ctx.fillRect(-1.6, -4.6, 3.6, 1.1);
      ctx.restore();
      if (working && swing > 0.92) { ctx.fillStyle = 'rgba(255,255,230,0.8)'; ctx.fillRect(bx + 3, by - 4, 1.4, 1.4); }
    } else if (jobT === 'fisher') {
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(bx + r * 0.6, by); ctx.lineTo(bx + r * 0.6 + 4.5, by - 3.5); ctx.stroke();
      if (working) {
        const dip = Math.sin(now / 500 + v.id) * 0.8;
        ctx.strokeStyle = 'rgba(220,230,240,0.55)'; ctx.lineWidth = 0.4;
        ctx.beginPath(); ctx.moveTo(bx + r * 0.6 + 4.5, by - 3.5); ctx.lineTo(bx + r * 0.6 + 4.5, by + 1.5 + dip); ctx.stroke();
        ctx.fillStyle = '#d05a4a';
        ctx.beginPath(); ctx.arc(bx + r * 0.6 + 4.5, by + 1.7 + dip, 0.6, 0, 7); ctx.fill();
      }
    } else if (jobT === 'forager') {
      ctx.fillStyle = '#8a6a3a';
      ctx.fillRect(bx - r * 1.5, by - 0.4, 2, 1.8);
      ctx.strokeStyle = '#5d4626'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(bx - r * 1.5 + 1, by - 0.4, 0.9, Math.PI, 0); ctx.stroke();
    } else if (jobT === 'hunter') {
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.8;
      const draw2 = working ? Math.abs(Math.sin(now / 700 + v.id)) * 0.4 : 0;
      ctx.beginPath(); ctx.arc(bx + r * 0.9, by - r * 0.3, 2.6, -1.2 - draw2, 1.2 + draw2); ctx.stroke();
      if (working && draw2 > 0.36) {
        ctx.strokeStyle = 'rgba(220,210,180,0.8)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(bx + r * 0.9, by - r * 0.3 - 2.4); ctx.lineTo(bx + r * 0.9, by - r * 0.3 + 2.4); ctx.stroke();
      }
    } else if (jobT === 'farm') {
      ctx.save();
      ctx.translate(bx + r * 0.7, by - r * 0.3);
      ctx.rotate(0.5 + (working ? Math.sin(now / 220 + v.id) * 0.4 : 0));
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -4.4); ctx.stroke();
      ctx.fillStyle = '#9aa3ad'; ctx.fillRect(-1.4, -4.9, 1.6, 0.9);
      ctx.restore();
    } else if (jobT === 'delver') {
      ctx.strokeStyle = '#cabb9d'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(bx + r * 0.7, by - r * 0.6); ctx.lineTo(bx + r * 0.7 + 2, by - r * 0.6 + 1.5); ctx.stroke();
      ctx.fillStyle = `rgba(255,190,90,${0.7 + Math.sin(now / 240 + v.id) * 0.25})`;
      ctx.beginPath(); ctx.arc(bx + r * 0.7 + 2.2, by - r * 0.6 + 2.3, 1, 0, 7); ctx.fill();
    }
  }
  if (isMilitia(v)) {
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(bx + 1.5, by + 2); ctx.lineTo(bx + 3.5, by - 4.5); ctx.stroke();
  }
  if (v.carry && v.carry.got) {
    // the day's kill over the shoulder
    ctx.fillStyle = '#7a5a40';
    ctx.beginPath(); ctx.ellipse(bx - r * 0.9, by - r * 0.8, 1.4, 0.9, -0.4, 0, 7); ctx.fill();
  }
  if (selected && selected.kind === 'vill' && selected.id === v.id) {
    ctx.strokeStyle = '#f0a843'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, r + 2.4, 0, 7); ctx.stroke();
  }
}

/* the village animal — every one its own colors */
function drawPet(p, now) {
  const px = p.x * TILE, py = p.y * TILE;
  const moving = p.dx != null && Math.hypot(p.dx - p.x, p.dy - p.y) > 0.25;
  const trot = moving ? Math.sin(now / 80) * 0.5 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(px, py + 1.6, 2.6, 0.9, 0, 0, 7); ctx.fill();
  // body
  ctx.fillStyle = p.c1;
  ctx.beginPath(); ctx.ellipse(px, py + trot * 0.3, 2.6, 1.5, 0, 0, 7); ctx.fill();
  // patch
  ctx.fillStyle = p.c2;
  ctx.beginPath(); ctx.ellipse(px - 0.8, py - 0.2, 1.2, 0.9, 0, 0, 7); ctx.fill();
  // head
  ctx.fillStyle = p.c1;
  ctx.beginPath(); ctx.arc(px + 2.2, py - 0.8, 1.3, 0, 7); ctx.fill();
  // ears: floppy for the dog, sharp for the cat
  if (p.kind === 'dog') {
    ctx.fillStyle = p.c2;
    ctx.beginPath(); ctx.ellipse(px + 1.6, py - 1.7, 0.5, 0.9, -0.5, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = p.c1;
    ctx.beginPath();
    ctx.moveTo(px + 1.5, py - 1.6); ctx.lineTo(px + 1.8, py - 2.7); ctx.lineTo(px + 2.3, py - 1.8);
    ctx.moveTo(px + 2.5, py - 1.8); ctx.lineTo(px + 3, py - 2.6); ctx.lineTo(px + 3.2, py - 1.5);
    ctx.fill();
  }
  // the tail never lies
  ctx.strokeStyle = p.c1; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
  const wag = Math.sin(now / (p.kind === 'dog' ? 120 : 400)) * (p.kind === 'dog' ? 0.9 : 0.4);
  ctx.beginPath(); ctx.moveTo(px - 2.4, py - 0.2);
  ctx.quadraticCurveTo(px - 3.6, py - 1.2 + wag, px - 3.4 + wag * 0.4, py - 2.2 + wag);
  ctx.stroke();
  if (selected && selected.kind === 'pet') {
    ctx.strokeStyle = '#f0a843'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, 4.4, 0, 7); ctx.stroke();
  }
}

function drawHearthStructure(px, py, now) {
  const lvl = G.hearth.level;
  if (lvl >= 2) {
    ctx.fillStyle = '#4a4a52';
    for (let i = 0; i < Math.min(10, 4 + lvl); i++) {
      const a = i / Math.min(10, 4 + lvl) * Math.PI * 2;
      ctx.fillRect(px + Math.cos(a) * 9 - 1.5, py + Math.sin(a) * 9 - 1.5, 3, 3);
    }
  }
  if (G.form) {
    const id = G.form.id, t2 = G.form.tier > 1;
    if (id === 'hall') {
      ctx.fillStyle = '#5d4630';
      ctx.fillRect(px - 12, py - 14, 24, 6);
      ctx.beginPath(); ctx.moveTo(px - 14, py - 14); ctx.lineTo(px, py - (t2 ? 24 : 20)); ctx.lineTo(px + 14, py - 14); ctx.closePath();
      ctx.fillStyle = '#7a5a3a'; ctx.fill();
    } else if (id === 'keep') {
      ctx.fillStyle = '#5a5d66';
      ctx.fillRect(px - 13, py - 15, 5, t2 ? 14 : 9);
      ctx.fillRect(px + 8, py - 15, 5, t2 ? 14 : 9);
      ctx.fillRect(px - 13, py - 17, 4, 3); ctx.fillRect(px + 9, py - 17, 4, 3);
    } else if (id === 'temple') {
      ctx.strokeStyle = t2 ? '#e8c060' : '#b89a50'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py - 6, 12, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(px - 13, py - 7, 3, 9); ctx.fillRect(px + 10, py - 7, 3, 9);
    }
  }
}

function draw() {
  const cw = canvas.width / dpr, ch = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, cw, ch);
  if (!G) return;

  const R = lightAnim;
  const sB = seasonBlend();
  const now = performance.now();
  const snowA = snowAmount();
  const winter = season() === 3;
  const grassC = grassNow();

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.z, cam.z);

  const x0 = clamp(Math.floor(-cam.x / cam.z / TILE), 0, W - 1);
  const y0 = clamp(Math.floor(-cam.y / cam.z / TILE), 0, H - 1);
  const x1 = clamp(Math.ceil((cw - cam.x) / cam.z / TILE), 0, W);
  const y1 = clamp(Math.ceil((ch - cam.y) / cam.z / TILE), 0, H);

  const litDraw = (x, y) => {
    const dx = x - HX, dy = y - HY;
    if (dx * dx + dy * dy <= R * R) return true;
    for (const t of TORCHES) {
      const a = x - t.x, b = y - t.y;
      if (a * a + b * b <= TORCH_R * TORCH_R) return true;
    }
    return false;
  };

  // who is touching what right now — the world reacts to hands on it
  const activeTiles = new Set(), busyCrews = new Set();
  for (const v of G.villagers) {
    if (v.state !== 'work' || v.job == null) continue;
    const b = byId(v.job);
    if (!b) continue;
    busyCrews.add(b.id);
    if (b.tx != null && GATHER_KINDS[b.type]) activeTiles.add(b.tx);
  }

  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!litDraw(x, y)) continue;
    const t = tile(x, y);
    const px = x * TILE, py = y * TILE;
    const h = tHash(x, y);
    let bg = t.t === 'grass' || t.t === 'berry' ? grassC : t.t === 'water' ? bstyle().water : TILE_BG[t.t];
    if (winter && t.t === 'water') bg = '#7d96aa';
    ctx.fillStyle = bg;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = `rgba(255,255,255,${(h % 5) * 0.007})`;
    ctx.fillRect(px, py, TILE, TILE);
    if ((t.t === 'grass') && (h % 7) === 0 && snowA < 0.3) {
      ctx.fillStyle = 'rgba(150,180,90,0.25)';
      ctx.fillRect(px + (h % 11), py + (h % 9), 1.5, 2.5);
    }
    if (snowA > 0.05 && (t.t === 'grass' || t.t === 'berry')) {
      ctx.fillStyle = `rgba(235,240,245,${snowA * (0.1 + (h % 4) * 0.03)})`;
      ctx.fillRect(px, py, TILE, TILE);
    }

    const jx = ((h >> 3) % 3) - 1, jy = ((h >> 5) % 3) - 1;
    const shake = activeTiles.has(idx(x, y)) ? Math.sin(now / 55 + x * 3) * 0.7 : 0;
    if (t.t === 'tree' && t.amt > 0) {
      const r = (2 + (t.amt / 10) * 3.5) * (0.85 + ((h >> 7) % 4) * 0.08);
      const cx2 = px + 8 + jx + shake, cy2 = py + 7 + jy;
      ctx.fillStyle = '#54401f'; ctx.fillRect(cx2 - 0.8, cy2 + 1, 1.6, 5);
      ctx.fillStyle = winter ? ['#36503c', '#324a38', '#3a5440'][h % 3] : ['#3a5c2e', '#42662f', '#37552c', '#456b33'][h % 4];
      ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, 7); ctx.fill();
      if ((h >> 9) % 3 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.beginPath(); ctx.arc(cx2 - r * 0.3, cy2 - r * 0.3, r * 0.45, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.arc(cx2, cy2 + 1.5, r * 0.7, 0, Math.PI); ctx.fill();
      if (snowA > 0.2) { ctx.fillStyle = `rgba(235,240,245,${snowA * 0.55})`; ctx.beginPath(); ctx.arc(cx2, cy2 - 1, r * 0.7, Math.PI, 0); ctx.fill(); }
    } else if (t.t === 'ancient') {
      ctx.fillStyle = `rgba(110,240,200,${0.12 + 0.08 * Math.sin(now / 400 + x)})`;
      ctx.beginPath(); ctx.arc(px + 8, py + 8, 7.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#4d8f72';
      ctx.beginPath(); ctx.arc(px + 8, py + 7, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#7fe0c8';
      ctx.beginPath(); ctx.arc(px + 8, py + 7, 2, 0, 7); ctx.fill();
    } else if (t.t === 'berry') {
      ctx.fillStyle = ['#3a5c2e', '#34532a', '#406432'][h % 3];
      ctx.beginPath(); ctx.arc(px + 8 + jx + shake, py + 9 + jy, 3.4 + (h % 3) * 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = t.amt > 1 ? '#c2455a' : '#5b4248';
      ctx.beginPath();
      ctx.arc(px + 6 + jx, py + 8 + jy, 1.2, 0, 7); ctx.arc(px + 10 + jx, py + 7 + jy, 1.2, 0, 7); ctx.arc(px + 8 + jx, py + 11 + jy, 1.2, 0, 7);
      ctx.fill();
    } else if (t.t === 'stone') {
      const v = h % 3;
      ctx.fillStyle = ['#5d646e', '#565d66', '#646b75'][v];
      ctx.beginPath();
      if (v === 0) { ctx.moveTo(px + 3, py + 12); ctx.lineTo(px + 6, py + 5); ctx.lineTo(px + 10, py + 8); ctx.lineTo(px + 13, py + 4); ctx.lineTo(px + 14, py + 12); }
      else if (v === 1) { ctx.moveTo(px + 2, py + 13); ctx.lineTo(px + 5, py + 6); ctx.lineTo(px + 9, py + 9); ctx.lineTo(px + 14, py + 7); ctx.lineTo(px + 13, py + 13); }
      else { ctx.moveTo(px + 4, py + 12); ctx.lineTo(px + 5, py + 7); ctx.lineTo(px + 8, py + 3); ctx.lineTo(px + 12, py + 7); ctx.lineTo(px + 12, py + 12); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(px + 5 + jx, py + 8 + jy, 3, 2.5);
    } else if (t.t === 'ruin') {
      ctx.fillStyle = '#8c8798';
      ctx.fillRect(px + 4, py + 5, 2.5, 8); ctx.fillRect(px + 10, py + 5, 2.5, 8); ctx.fillRect(px + 3, py + 4, 10.5, 2);
      ctx.fillStyle = `rgba(240,168,67,${0.25 + 0.15 * Math.sin(now / 500 + x * 3)})`;
      ctx.fillRect(px + 7.3, py + 8, 2, 2);
    } else if (t.t === 'water') {
      if (winter) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(px + 3, py + 4 + (h % 4)); ctx.lineTo(px + 12, py + 10 - (h % 4)); ctx.stroke();
      } else {
        // the water breathes, barely
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(px + 3 + Math.sin(now / 1600 + x * 0.7 + y) * 1.2, py + 5 + (h % 5), 5, 1);
        if (t.fish && t.amt > 3) {
          // a quiet ring now and then; nothing showy
          const ph2 = ((now / 2800) + (h % 9) / 9) % 1;
          if (ph2 < 0.3) {
            ctx.strokeStyle = `rgba(220,240,255,${0.16 * (1 - ph2 / 0.3)})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.arc(px + 8 + jx, py + 8 + jy, 1.5 + ph2 * 8, 0, 7); ctx.stroke();
          }
          if (ph2 > 0.74 && ph2 < 0.78) {
            ctx.strokeStyle = 'rgba(200,220,235,0.45)'; ctx.lineWidth = 0.9;
            ctx.beginPath(); ctx.arc(px + 8 + jx, py + 6 + jy, 2.2, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
          }
        }
        // a line being worked stirs the surface
        if (activeTiles.has(idx(x, y))) {
          const ph3 = (now / 900) % 1;
          ctx.strokeStyle = `rgba(220,240,255,${0.3 * (1 - ph3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(px + 8, py + 8, 1 + ph3 * 6, 0, 7); ctx.stroke();
        }
      }
    } else if (t.t === 'road') {
      // cracked black stone, too straight for nature
      ctx.strokeStyle = 'rgba(20,20,24,0.5)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(px + 2 + (h % 4), py + 3); ctx.lineTo(px + 8 + (h % 5), py + 13); ctx.stroke();
      ctx.fillStyle = 'rgba(150,180,90,0.18)';
      ctx.fillRect(px + (h % 12), py + ((h >> 4) % 12), 2, 2);          // moss reclaiming it
      ctx.strokeStyle = 'rgba(200,190,120,0.12)';
      ctx.beginPath(); ctx.moveTo(px, py + 8); ctx.lineTo(px + 4, py + 8); ctx.stroke();   // a ghost of lane paint
    } else if (t.t === 'pylon') {
      ctx.strokeStyle = '#6e4a38'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 14); ctx.lineTo(px + 8, py - 6); ctx.lineTo(px + 12, py + 14);
      ctx.moveTo(px + 5.2, py + 8); ctx.lineTo(px + 10.8, py + 8);
      ctx.moveTo(px + 6, py + 2); ctx.lineTo(px + 10, py + 2);
      ctx.moveTo(px + 5, py - 3); ctx.lineTo(px + 11, py - 3);
      ctx.stroke();
      ctx.fillStyle = 'rgba(110,74,56,0.6)';
      ctx.fillRect(px + 3, py - 4, 2, 1.4); ctx.fillRect(px + 11, py - 4, 2, 1.4);
    } else if (t.t === 'derrick') {
      ctx.fillStyle = 'rgba(15,12,10,0.5)';
      ctx.beginPath(); ctx.ellipse(px + 8, py + 12, 6, 2.5, 0, 0, 7); ctx.fill();   // the old stain
      ctx.strokeStyle = '#7a5240'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 13); ctx.lineTo(px + 8, py - 2); ctx.lineTo(px + 12, py + 13);
      ctx.moveTo(px + 5.5, py + 7); ctx.lineTo(px + 10.5, py + 7);
      ctx.stroke();
      if (t.amt > 0) {
        ctx.fillStyle = `rgba(255,140,60,${0.25 + 0.15 * Math.sin(now / 700 + h)})`;
        ctx.fillRect(px + 6.8, py + 10, 2.4, 2.4);                       // still warm underneath
      }
    } else if (t.t === 'hulk') {
      ctx.fillStyle = '#6e4a38';
      ctx.beginPath(); ctx.roundRect(px + 2, py + 6, 12, 7, 2); ctx.fill();
      ctx.fillStyle = '#5a3c2e';
      ctx.beginPath(); ctx.roundRect(px + 4, py + 3, 8, 5, 2); ctx.fill();
      ctx.fillStyle = '#1c1c22';
      ctx.fillRect(px + 5, py + 4.5, 2.4, 2.4); ctx.fillRect(px + 8.6, py + 4.5, 2.4, 2.4);   // dark windows
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.arc(px + 4.5, py + 13, 1.6, 0, 7); ctx.arc(px + 11.5, py + 13, 1.6, 0, 7); ctx.fill();
    }
  }

  // worn paths: lean single roads — and where life truly converges, a full trodden plaza
  ctx.lineCap = 'round';
  const plazas = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const wr = G.wear[idx(x, y)];
    if (wr < 4 || !litDraw(x, y)) continue;
    let nWorn = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && G.wear[idx(nx, ny)] >= 4) nWorn++;
    }
    const cxp = x * TILE + 8, cyp = y * TILE + 8;
    const strong = wr >= 12;
    ctx.strokeStyle = strong ? 'rgba(146,116,80,0.85)' : 'rgba(122,100,74,0.5)';
    ctx.lineWidth = strong ? 3.4 : 2;
    let linked = false;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny >= H) continue;
      if (G.wear[idx(nx, ny)] >= 4) {
        ctx.beginPath(); ctx.moveTo(cxp, cyp); ctx.lineTo(nx * TILE + 8, ny * TILE + 8); ctx.stroke();
        linked = true;
      }
    }
    if (!linked && nWorn === 0) { ctx.beginPath(); ctx.arc(cxp, cyp, ctx.lineWidth * 0.7, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
    // a true plaza is rare: deeply worn AND a real crossroads
    if (wr >= 14 && nWorn >= 3) plazas.push([x, y]);
  }
  // plazas swallow their whole tile — packed earth, edge to edge, no grass seams
  for (const [x, y] of plazas) {
    const px = x * TILE, py = y * TILE;
    const h = tHash(x, y);
    ctx.fillStyle = '#8a7050';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(px + (h % 7), py + ((h >> 3) % 7), 3, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(px + ((h >> 5) % 10), py + ((h >> 7) % 10), 2, 2);
  }

  // light edge rings
  ctx.strokeStyle = 'rgba(240,170,80,0.12)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc((HX + 0.5) * TILE, (HY + 0.5) * TILE, (R + 0.45) * TILE, 0, 7);
  ctx.stroke();
  for (const t of TORCHES) {
    ctx.strokeStyle = 'rgba(240,170,80,0.09)';
    ctx.beginPath(); ctx.arc((t.x + 0.5) * TILE, (t.y + 0.5) * TILE, TORCH_R * TILE, 0, 7); ctx.stroke();
  }

  // buildings
  for (const b of G.builds) {
    if (!litDraw(b.x, b.y)) continue;
    const def = BUILDS[b.type];
    const px = b.x * TILE, py = b.y * TILE;
    const age = G.day - (b.bornAt || 0);
    const popScale = b.built && age < 0.15 ? 0.7 + (age / 0.15) * 0.3 : 1;
    ctx.save();
    if (popScale < 1) { ctx.translate(px + 8, py + 8); ctx.scale(popScale, popScale); ctx.translate(-px - 8, -py - 8); }
    if (!b.built && busyCrews.has(b.id)) {
      // hammers shake the scaffold
      ctx.translate(Math.sin(now / 45 + b.id) * 0.5, Math.cos(now / 60 + b.id) * 0.3);
    }
    if (!b.built) {
      ctx.strokeStyle = 'rgba(200,180,140,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
      ctx.beginPath(); ctx.moveTo(px + 2, py + 2); ctx.lineTo(px + 14, py + 14);
      ctx.moveTo(px + 14, py + 2); ctx.lineTo(px + 2, py + 14); ctx.stroke();
      const pr = clamp((b.progress || 0) / def.work, 0, 1);
      ctx.fillStyle = '#2a2317'; ctx.fillRect(px + 2, py + 13, 12, 2);
      ctx.fillStyle = '#f0a843'; ctx.fillRect(px + 2, py + 13, 12 * pr, 2);
      if (b.rush) { ctx.fillStyle = '#ffd87a'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', px + 13, py + 5); }
    } else if (b.type === 'palisade') {
      ctx.fillStyle = '#5a4628';
      for (let i = 0; i < 3; i++) ctx.fillRect(px + 2.5 + i * 4.5, py + 3, 3, 11);
      ctx.fillStyle = '#7a6038';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(px + 2.5 + i * 4.5, py + 3); ctx.lineTo(px + 4 + i * 4.5, py); ctx.lineTo(px + 5.5 + i * 4.5, py + 3); ctx.fill(); }
    } else if (b.type === 'torch') {
      ctx.fillStyle = '#54401f'; ctx.fillRect(px + 7, py + 5, 2.5, 9);
      const fl = 1 + Math.sin(now / 110 + b.x) * 0.25;
      ctx.fillStyle = 'rgba(255,180,80,0.9)';
      ctx.beginPath(); ctx.arc(px + 8.2, py + 4, 2.6 * fl, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,150,0.9)';
      ctx.beginPath(); ctx.arc(px + 8.2, py + 4, 1.2 * fl, 0, 7); ctx.fill();
    } else {
      drawBuildingArt(b, now);
    }
    if (b.halt) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2); }
    ctx.restore();
    if (cam.z > 0.85) {
      let icon = null;
      if (!b.built) icon = '🔨';
      else if (b.halt) icon = '🚫';
      else if (b.type === 'farm' && b.phase === 'harvest') icon = '🌾';
      else if (slotsOf(b) && workplaceViable(b) && !G.villagers.some(v => v.job === b.id) && (b.maxCrew == null || b.maxCrew > 0)) icon = '❗';
      else if (GATHER_KINDS[b.type] && !workplaceViable(b)) icon = '💤';
      if (icon) {
        ctx.font = '7px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(10,12,18,0.7)';
        ctx.beginPath(); ctx.arc(px + 8, py - 4, 4.4, 0, 7); ctx.fill();
        ctx.fillText(icon, px + 8, py - 3.6);
      }
    }
    if (selected && selected.kind === 'build' && selected.id === b.id) {
      ctx.strokeStyle = '#f0a843'; ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      if (GATHER_KINDS[b.type] || b.type === 'hunter') {
        const [fx, fy] = focusPos(b);
        ctx.strokeStyle = 'rgba(240,168,67,0.4)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc((fx + 0.5) * TILE, (fy + 0.5) * TILE, WORK_RADIUS * TILE, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.type === 'torch') {
        ctx.strokeStyle = 'rgba(240,168,67,0.4)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(px + 8, py + 8, TORCH_R * TILE, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // trader wagon
  if (G.trader.state !== 'away') {
    const px = G.trader.x * TILE - 8, py = G.trader.y * TILE - 7;
    ctx.fillStyle = '#6e4f30';
    ctx.fillRect(px, py + 4, 16, 8);
    ctx.fillStyle = '#c9b48a';
    ctx.beginPath(); ctx.arc(px + 8, py + 4, 8, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#2c2017';
    const wob = G.trader.state === 'here' ? 0 : Math.sin(now / 120) * 0.6;
    ctx.beginPath(); ctx.arc(px + 4, py + 13 + wob, 2.6, 0, 7); ctx.arc(px + 12, py + 13 - wob, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,200,100,${0.7 + Math.sin(now / 300) * 0.2})`;
    ctx.beginPath(); ctx.arc(px + 16.5, py + 5, 1.6, 0, 7); ctx.fill();
  }

  for (const v of G.villagers) {
    if (v.state === 'sleep' && v.home != null) continue;
    drawVillager(v, now);
  }

  for (const m of G.monsters) {
    const px = m.x * TILE, py = m.y * TILE;
    const wob = Math.sin(now / 250 + m.x * 5) * 0.8;
    ctx.fillStyle = m.bold ? 'rgba(35,15,30,0.85)' : 'rgba(20,12,28,0.8)';
    ctx.beginPath(); ctx.ellipse(px + wob * 0.3, py, 4.5 + wob * 0.4, 3.2, 0, 0, 7); ctx.fill();
    if (Math.sin(now / 300 + m.x * 7) > -0.7) {
      ctx.fillStyle = m.bold ? '#ff5a30' : '#e04040';
      ctx.fillRect(px - 2.2, py - 1.5, 1.4, 1.4);
      ctx.fillRect(px + 0.8, py - 1.5, 1.4, 1.4);
    }
  }

  // small game and arrows
  for (const c of critters) {
    if (!litDraw(Math.floor(c.x), Math.floor(c.y))) continue;
    const hopUp = Math.max(0, Math.sin(c.hop)) * 1.4;
    const cx2 = c.x * TILE, cy2 = c.y * TILE - hopUp;
    ctx.fillStyle = '#8a7456';
    ctx.beginPath(); ctx.ellipse(cx2, cy2, 1.5, 1.1, 0, 0, 7); ctx.fill();
    ctx.fillRect(cx2 - Math.cos(c.a) * 1.4 - 0.3, cy2 - 1.8, 0.7, 1.3);
  }
  for (const a of arrows) {
    const t = Math.min(1, a.t);
    ctx.strokeStyle = `rgba(220,210,180,${1 - Math.max(0, a.t - 1) * 3})`;
    ctx.lineWidth = 0.6;
    const ax = lerp(a.x1, a.x2, t) * TILE, ay = lerp(a.y1, a.y2, t) * TILE;
    ctx.beginPath(); ctx.moveTo(ax - (a.x2 - a.x1) * 2, ay - (a.y2 - a.y1) * 2); ctx.lineTo(ax, ay); ctx.stroke();
  }

  for (const sm of smokes) {
    ctx.fillStyle = `rgba(180,180,180,${sm.life * 0.25})`;
    ctx.beginPath(); ctx.arc(sm.x * TILE, sm.y * TILE, (1 - sm.life) * 3 + 1, 0, 7); ctx.fill();
  }
  for (const sp of sparks) {
    ctx.fillStyle = `rgba(255,${160 + Math.floor(sp.life * 60)},60,${sp.life * 0.8})`;
    ctx.fillRect(sp.x * TILE, sp.y * TILE, 1.2, 1.2);
  }
  for (const c of chips) {
    ctx.fillStyle = `rgba(170,178,188,${c.life * 1.4})`;
    ctx.fillRect(c.x * TILE, c.y * TILE, 1.3, 1.3);
  }
  if (G.pet) drawPet(G.pet, now);

  // the Hearth — its blaze IS the gauge
  {
    const px = (HX + 0.5) * TILE, py = (HY + 0.5) * TILE;
    drawHearthStructure(px, py, now);
    const fl = 1 + Math.sin(now / 130) * 0.08 + Math.sin(now / 47) * 0.04;
    const power = G.fire.lit ? (0.25 + 0.75 * G.fire.fuel / FUEL_MAX) : 0.1;
    const rad = (8 + G.hearth.level * 1.2) * fl * power + 4;
    const g = ctx.createRadialGradient(px, py, 1, px, py, rad);
    const gold = G.won ? '255,240,180' : '255,210,120';
    g.addColorStop(0, `rgba(${gold},${0.9 * Math.max(power, 0.2)})`);
    g.addColorStop(0.4, `rgba(240,140,50,${0.45 * Math.max(power, 0.2)})`);
    g.addColorStop(1, 'rgba(240,140,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
    ctx.font = `${G.fire.lit ? Math.round(8 + G.hearth.level + 8 * (G.fire.fuel / FUEL_MAX)) : 8}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(G.fire.lit ? '🔥' : '🕳️', px, py - 2);
  }

  if (pulse && now < pulse.until) {
    const t = 1 - (pulse.until - now) / 1600;
    ctx.strokeStyle = `rgba(240,168,67,${0.8 * (1 - t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc((pulse.x + 0.5) * TILE, (pulse.y + 0.5) * TILE, 6 + t * 18, 0, 7);
    ctx.stroke();
  }

  // build ghost with placement advice
  if ((buildMode || uiMode === 'focus') && !modalOpen) {
    const [wx, wy] = toWorld(mouse.x, mouse.y);
    const x = Math.floor(wx), y = Math.floor(wy);
    if (x >= 0 && y >= 0 && x < W && y < H) {
      if (buildMode) {
        const info = placeInfo(buildMode, x, y);
        const advice = info.ok ? ghostAdvice(buildMode, x, y) : null;
        const warn = advice && advice.startsWith('⚠');
        ctx.fillStyle = !info.ok ? 'rgba(224,122,106,0.35)' : warn ? 'rgba(240,200,90,0.35)' : 'rgba(127,201,127,0.35)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        if (BUILDS[buildMode].slots || buildMode === 'torch') {
          ctx.strokeStyle = !info.ok ? 'rgba(224,122,106,0.4)' : warn ? 'rgba(240,200,90,0.45)' : 'rgba(240,168,67,0.3)';
          ctx.lineWidth = 1;
          const rr2 = buildMode === 'torch' ? TORCH_R : WORK_RADIUS;
          ctx.beginPath(); ctx.arc((x + 0.5) * TILE, (y + 0.5) * TILE, rr2 * TILE, 0, 7); ctx.stroke();
        }
        if (warn) {
          ctx.font = '8px serif'; ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(240,200,90,0.95)';
          ctx.fillText('⚠', x * TILE + 8, y * TILE - 5);
        }
      } else {
        ctx.strokeStyle = 'rgba(240,168,67,0.5)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc((x + 0.5) * TILE, (y + 0.5) * TILE, WORK_RADIUS * TILE, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  ctx.restore();

  // darkness + warmth in screen space
  const hx = (HX + 0.5) * TILE * cam.z + cam.x;
  const hy = (HY + 0.5) * TILE * cam.z + cam.y;
  const rr = (R + 0.5) * TILE * cam.z;
  const na = nightAlpha();
  const flick = 1 + Math.sin(now / 300) * 0.008 + Math.sin(now / 97) * 0.005;
  let g = ctx.createRadialGradient(hx, hy, rr * 0.45, hx, hy, rr * flick);
  g.addColorStop(0, `rgba(7,9,13,${0.06 + na * 0.18})`);
  g.addColorStop(0.82, `rgba(7,9,13,${0.2 + na * 0.25})`);
  g.addColorStop(1, 'rgba(7,9,13,0.96)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rr * 0.55);
  g.addColorStop(0, `rgba(255,170,70,${0.08 + (G.fire.lit ? 0.06 * G.fire.fuel / FUEL_MAX : 0)})`);
  g.addColorStop(1, 'rgba(255,170,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  if (flakes.length) {
    ctx.fillStyle = 'rgba(235,240,248,0.6)';
    for (const fl of flakes) ctx.fillRect(fl.x, fl.y, fl.s + 0.4, fl.s + 0.4);
  }
}

/* ---------- trader menu (lives in the bubble area when the wagon is here) ---------- */
function traderRows() {
  if (G.trader.state !== 'here') return '';
  let html = `<h3>🛞 The Trader</h3><div class="sdesc">Leaves in ${Math.max(1, Math.ceil(G.trader.leaves - G.day))} day(s). Prices follow his appetites.</div>`;
  for (const r of Object.keys(TRADE_GOODS)) {
    if (r !== 'food' && r !== 'wood' && !G.seen[r]) continue;
    const g2 = TRADE_GOODS[r];
    html += `<div class="srow"><span>${RES_ICON[r]} ×${g2.unit}</span><span>` +
      `<button class="btn" data-trade="${r}" data-dir="sell" ${G.res[r] < g2.unit ? 'disabled' : ''}>Sell ${sellPrice(r)}🪙</button> ` +
      `<button class="btn" data-trade="${r}" data-dir="buy" ${G.res.coin < buyPrice(r) ? 'disabled' : ''}>Buy ${buyPrice(r)}🪙</button></span></div>`;
  }
  html += `<div class="srow"><span>🎁 A stranger's charm</span><button class="btn" data-trade="charm" data-dir="buy" ${G.res.coin < Math.round(40 / tradeFair()) ? 'disabled' : ''}>Buy ${Math.round(40 / tradeFair())}🪙</button></div>`;
  return html;
}

/* ---------- frame loop & boot ---------- */
let lastT = performance.now();
let uiTimer = 0, saveTimer = 0;
let lastToastSeq = 0;
function pushToasts() {
  if (!G) return;
  if (lastToastSeq === 0) { lastToastSeq = G.logSeq || 0; return; }   // don't replay history on load
  if ((G.logSeq || 0) <= lastToastSeq) return;
  const fresh = Math.min(2, (G.logSeq || 0) - lastToastSeq);
  lastToastSeq = G.logSeq || 0;
  if (!$('chronpanel').classList.contains('hidden')) return;          // the open book shows them itself
  const wrap = $('toasts');
  for (let i = fresh - 1; i >= 0; i--) {
    const e = G.log[i];
    if (!e) continue;
    const el = document.createElement('div');
    el.className = 'toast ' + (e.cls === 'death' ? 'death' : e.cls === 'ember' ? 'ember' : '');
    el.innerHTML = `<span class="tdate">${vagueDate(e.d)}</span><br>${e.msg.length > 110 ? e.msg.slice(0, 108) + '…' : e.msg}`;
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 650); }, 3600);
  }
}
function frame(t) {
  try {
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    if (G && !modalOpen && G.speed > 0) tick(dt / SEC_PER_DAY * G.speed);
    if (G) {
      lightAnim = lerp(lightAnim, effLight(), Math.min(1, dt * 1.6));
      zoomTarget = clamp(zoomTarget, minZoom(), 4);
      if (Math.abs(cam.z - zoomTarget) > 0.0005) {
        const nz = lerp(cam.z, zoomTarget, Math.min(1, dt * 9));
        const ax = zoomAnchor ? zoomAnchor[0] : window.innerWidth / 2;
        const ay = zoomAnchor ? zoomAnchor[1] : window.innerHeight / 2;
        const real = nz / cam.z;
        cam.x = ax - (ax - cam.x) * real;
        cam.y = ay - (ay - cam.y) * real;
        cam.z = nz;
      }
      updateParticles(dt);
      ambientUpdate(dt, t);
      pushToasts();
      if (statusTimer > 0) { statusTimer -= dt; if (statusTimer <= 0) $('statusbar').textContent = ''; }
    }
    draw();
    uiTimer += dt; saveTimer += dt;
    if (uiDirty || uiTimer > 0.25) { refreshUI(); uiDirty = false; uiTimer = 0; }
    else if (selected) refreshBubble();
    if (saveTimer > 15) { saveTo('auto'); saveTimer = 0; }
  } catch (err) {
    // one bad frame must never freeze the world
    console.error('frame error:', err);
  }
  requestAnimationFrame(frame);
}
function randomSeed() {
  const a = ['ash', 'elm', 'fen', 'mist', 'oak', 'thorn', 'wolf', 'ember', 'frost', 'moss'];
  return choice(a) + '-' + choice(a) + '-' + Math.floor(Math.random() * 999);
}

/* wiring */
for (const [id, val] of Object.entries(SPEEDS))
  $(id).onclick = () => { if (G) { G.speed = val; uiDirty = true; } };
$('stokebtn').onclick = stoke;
$('feedbtn').onclick = feedHearth;
$('settingsbtn').onclick = () => { refreshSlots(); showModal('settingsmodal'); };
$('closesettingsbtn').onclick = () => hideModal('settingsmodal');
$('soundtoggle').onclick = () => { settings.sound = !settings.sound; saveSettings(); refreshSlots(); };
$('buildbtn').onclick = () => { $('buildpop').classList.toggle('hidden'); sfx('click'); };
$('chronbtn').onclick = () => {
  const p = $('chronpanel');
  p.classList.toggle('hidden');
  if (!p.classList.contains('hidden') && G) {
    G.logRead = G.logSeq || 0;
    $('chronbtn').classList.remove('unread');
    refreshChron(); uiDirty = true;
  }
};
for (const t of document.querySelectorAll('#chrontabs .tab'))
  t.onclick = () => { chronTab = t.dataset.tab; refreshChron(); };
$('chronbody').addEventListener('click', e => {
  const el = e.target.closest('.entry.loc');
  if (el && G) { focusCam(+el.dataset.x, +el.dataset.y); if (window.innerWidth < 700) $('chronpanel').classList.add('hidden'); }
});
$('bubble').addEventListener('click', e => {
  const tr = e.target.dataset && e.target.dataset.trade;
  if (tr && G) doTrade(tr, e.target.dataset.dir);
});
$('newgamebtn').onclick = () => { hideModal('settingsmodal'); showIntro(true); };
$('continuebtn').onclick = () => {
  if (loadFrom('auto')) {
    hideModal('intromodal');
    buildBuildMenu(); centerCam(false); lightAnim = effLight(); zoomTarget = cam.z;
    chronTab = 'chron';
    lastToastSeq = 0;
    uiDirty = true;
  }
};
$('newvillagebtn').onclick = () => {
  $('seedrow').classList.remove('hidden');
  $('introbtns').classList.add('hidden');
  $('seedinput').value = randomSeed();
  $('seedinput').focus();
};
$('randseedbtn').onclick = () => { $('seedinput').value = randomSeed(); };
$('beginbtn').onclick = () => {
  const s = $('seedinput').value.trim() || randomSeed();
  hideModal('intromodal');
  newGame(s);
  zoomTarget = cam.z;
  chronTab = 'chron';
  lastToastSeq = 0;
  $('chronpanel').classList.add('hidden');
  saveTo('auto');
};
$('slotrows').addEventListener('click', e => {
  const sv = e.target.dataset && e.target.dataset.save;
  const ld = e.target.dataset && e.target.dataset.load;
  if (sv) { saveTo(sv); refreshSlots(); sfx('click'); }
  if (ld && loadFrom(ld)) {
    hideModal('settingsmodal');
    buildBuildMenu(); centerCam(false); lightAnim = effLight(); zoomTarget = cam.z;
    uiDirty = true; sfx('click');
  }
});
$('exportbtn').onclick = async () => {
  if (!G) return;
  try { await navigator.clipboard.writeText(serialize()); setStatus('Save copied to clipboard.'); } catch (e) { setStatus('Clipboard blocked by the browser.'); }
};
$('importbtn').onclick = async () => {
  try {
    const raw = await navigator.clipboard.readText();
    if (deserialize(raw)) {
      hideModal('settingsmodal');
      buildBuildMenu(); centerCam(false); lightAnim = effLight(); zoomTarget = cam.z;
      uiDirty = true;
      setStatus('Save loaded from clipboard.');
    } else setStatus('That did not look like a Hearthlight save.');
  } catch (e) { setStatus('Clipboard blocked by the browser.'); }
};
window.addEventListener('beforeunload', () => saveTo('auto'));
window.addEventListener('resize', () => { resize(); uiDirty = true; });

/* tapping the wagon or the village animal opens their own bubbles */
const _origTap = handleTap;
handleTap = function (mx, my, shiftHeld) {
  if (G && !buildMode && !uiMode) {
    const [wx, wy] = toWorld(mx, my);
    if (G.trader.state === 'here' && Math.hypot(wx - G.trader.x, wy - G.trader.y) < 1.4) {
      selected = { kind: 'trader' };
      uiDirty = true;
      return;
    }
    if (G.pet && Math.hypot(wx - G.pet.x, wy - G.pet.y) < 0.9) {
      selected = { kind: 'pet' };
      uiDirty = true;
      return;
    }
  }
  _origTap(mx, my, shiftHeld);
};
function petThought(p) {
  const lines = p.kind === 'dog'
    ? ['Woof. (The treeline is handled.)', 'Someone dropped a fish once. A dog remembers.', 'The small humans are mine now. I have decided.', 'The dark smells like wire. I do not like wire.']
    : ['The woodpile is mine. The fire is mine. You may stay.', 'I have inspected the dark. It blinked first.', 'Mrr. (Translation withheld.)', 'The things out there have no heartbeat. Unacceptable.'];
  return lines[(Math.floor(G.day) + p.name.length) % lines.length];
}
const _origBubbleTarget = bubbleTarget;
bubbleTarget = function () {
  if (selected && selected.kind === 'trader') {
    if (G.trader.state !== 'here') { selected = null; return null; }
    return [G.trader.x, G.trader.y - 0.6, null];
  }
  if (selected && selected.kind === 'pet') {
    if (!G.pet) { selected = null; return null; }
    return [G.pet.x, G.pet.y - 0.4, null];
  }
  return _origBubbleTarget();
};
const _origRefreshBubble = refreshBubble;
refreshBubble = function () {
  if (selected && (selected.kind === 'trader' || selected.kind === 'pet')) {
    const bub = $('bubble');
    const t = bubbleTarget();
    if (!t) { bub.classList.add('hidden'); return; }
    bub.classList.remove('hidden');
    let inner;
    if (selected.kind === 'trader') inner = traderRows();
    else {
      const p = G.pet;
      inner = `<h3>${p.kind === 'dog' ? '🐕' : '🐈'} ${p.name}</h3>` +
        `<div class="sdesc">the village ${p.kind} · ${(p.hungry || 0) > 1 ? 'hungry, and patient about it' : 'fed and on duty'}</div>` +
        `<div class="thought">“${petThought(p)}”</div>` +
        `<div class="sdesc">Eats a little. Smells the watchers coming. Worth it.</div>`;
    }
    if (bub.dataset.cache !== inner) { bub.dataset.cache = inner; bub.innerHTML = inner; }
    const sx = t[0] * TILE * cam.z + cam.x;
    const sy = t[1] * TILE * cam.z + cam.y;
    const bw = bub.offsetWidth, bh = bub.offsetHeight;
    let left = clamp(sx - bw / 2, 8, window.innerWidth - bw - 8);
    let top = sy - bh - 16;
    const below = top < 56;
    if (below) top = sy + 24;
    bub.classList.toggle('below', below);
    bub.style.left = left + 'px';
    bub.style.top = clamp(top, 8, window.innerHeight - bh - 8) + 'px';
    return;
  }
  _origRefreshBubble();
};

function showIntro(newOnly) {
  const hasSave = !!localStorage.getItem(SAVE_PREFIX + 'auto');
  $('continuebtn').classList.toggle('hidden', !hasSave || newOnly);
  $('seedrow').classList.add('hidden');
  $('introbtns').classList.remove('hidden');
  showModal('intromodal');
  if (newOnly) {
    $('seedrow').classList.remove('hidden');
    $('introbtns').classList.add('hidden');
    $('seedinput').value = randomSeed();
  }
}

resize();
if (loadFrom('auto')) {
  buildBuildMenu();
  centerCam(false);
  lightAnim = effLight();
  zoomTarget = clamp(cam.z, minZoom(), 4);
  showIntro(false);          // even returning keepers get the door — Continue is one tap
} else {
  buildBuildMenu();
  showIntro(false);
}
requestAnimationFrame(frame);
