'use strict';
/* ============================================================
   HEARTHLIGHT — simulation core
   (rendering, input, sound and boot live in ui.js)
   ============================================================ */

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------- world constants ---------- */
const W = 96, H = 96, TILE = 16;
const HX = 48, HY = 48;
const SEC_PER_DAY = 37.5;                 // a year (48 days) ≈ 30 real minutes at 1x
const DAYS_PER_SEASON = 12, DAYS_PER_YEAR = 48;
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const BASE_LIGHT = 8;
const EAT = 0.75;
const HEARTH_HOUSING = 6;
const WORK_RADIUS = 5;
const TORCH_R = 4.5;
const BABY_AGE = 2, ADULT_AGE = 4, ELDER_AGE = 16;  // babies 0–2, helper children 2–4, grown at 4
const WORK_WINDOW = 0.50;
const JOB_RANGE = 30;
const FUEL_MAX = 100;
const SPEEDS = { spd0: 0, spd1: 1, spd2: 3, spd4: 8 };

/* a 24-hour day: ~8h sleep, an easy morning hour or two, a long working day,
   and the evening fire before bed */
function phase(f) {
  if (f < 0.25 || f >= 0.89) return 'night';   // sleep (~8.6h)
  if (f < 0.31) return 'morning';              // ease into the day (~1.5h)
  if (f < 0.81) return 'day';                  // work (~12h)
  return 'evening';                            // the fire circle (~2h)
}

/* ---------- data ---------- */
const BUILDS = {
  cabin:      { name: 'Cabin',             emoji: '🏠', cost: { wood: 14 },            slots: 0, unlock: 1, color: '#7a5a3a', work: 2,   desc: 'A roof for one family.' },
  forager:    { name: "Forager's Hut",     emoji: '🧺', cost: { wood: 8 },             slots: 2, unlock: 1, color: '#5a7a3a', work: 1.5, desc: 'Berries, roots, mushrooms — whatever the season leaves out.' },
  woodcutter: { name: "Woodcutter's Camp", emoji: '🪓', cost: { wood: 8 },             slots: 2, unlock: 1, color: '#6b4f33', work: 1.5, desc: 'The forest gives, if someone swings the axe.' },
  fisher:     { name: 'Fishing Dock',      emoji: '🎣', cost: { wood: 10 },            slots: 2, unlock: 1, color: '#3a6a8a', work: 2,   near: 'water', desc: 'Patience, by deep water.' },
  hunter:     { name: "Hunter's Lodge",    emoji: '🏹', cost: { wood: 12 },            slots: 2, unlock: 2, color: '#7a6a4a', work: 2,   desc: 'Game runs where the trees grow thick.' },
  farm:       { name: 'Farm',              emoji: '🌾', cost: { wood: 12 },            slots: 4, unlock: 2, color: '#8a7a30', work: 2.5, desc: 'Break ground, sow, wait, reap. The field sets the schedule.' },
  storehouse: { name: 'Storehouse',        emoji: '📦', cost: { wood: 22 },            slots: 0, unlock: 2, color: '#5d5d6e', work: 3,   desc: 'Room to keep more than you need — for a while.' },
  delver:     { name: "Delvers' Camp",     emoji: '🏮', cost: { wood: 25 },            slots: 2, unlock: 2, color: '#7a5a85', work: 2.5, near: 'ruin', desc: 'Old places hold old fire. And older things.' },
<<<<<<< HEAD
  lookout:    { name: 'Lookout Tower',     emoji: '🔭', cost: { wood: 12 },            slots: 1, unlock: 2, color: '#6a6048', work: 2,   desc: 'No flame — just a long ladder and younger eyes. Sees far into the dark; protects nothing.' },
  muster:     { name: 'Muster Green',      emoji: '🪤', cost: { wood: 10 },            slots: 2, unlock: 2, color: '#7a6048', work: 1.5, desc: 'Clubs and courage. Militia guard what is being hurt — they do not go looking.' },
  quarry:     { name: 'Quarry',            emoji: '⛏️', cost: { wood: 16 },            slots: 2, unlock: 3, color: '#707a85', work: 2.5, near: 'stone', desc: 'Stone, for those willing to break it loose.' },
  watch:      { name: 'Watch Post',        emoji: '🛡️', cost: { wood: 15, stone: 5 },  slots: 2, unlock: 3, color: '#8a4040', work: 2.5, desc: 'Soldiers. They hunt the things in the dark, and they do not stop at the light\'s edge.' },
  garrison:   { name: 'Garrison',          emoji: '🏹', cost: { wood: 30, stone: 15 }, slots: 3, unlock: 5, color: '#8a5050', work: 3.5, desc: 'Bows for keeping the dark at arm\'s length — or scouts, with a captive spark, for walking into it.' },
=======
  quarry:     { name: 'Quarry',            emoji: '⛏️', cost: { wood: 16 },            slots: 2, unlock: 3, color: '#707a85', work: 2.5, near: 'stone', desc: 'Stone, for those willing to break it loose.' },
  watch:      { name: 'Watch Post',        emoji: '🛡️', cost: { wood: 15, stone: 5 },  slots: 2, unlock: 3, color: '#8a4040', work: 2.5, desc: 'Spears, for whatever watches back.' },
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  torch:      { name: 'Brazier',           emoji: '🔆', cost: { wood: 8, ember: 1 },   slots: 0, unlock: 3, color: '#a06a2a', work: 1,   desc: 'A captive spark — light, planted where you need it.' },
  palisade:   { name: 'Palisade',          emoji: '🛑', cost: { wood: 4 },             slots: 0, unlock: 3, color: '#5a4628', work: 0.8, desc: 'Sharpened logs. The dark must walk around.' },
  kiln:       { name: 'Ember Kiln',        emoji: '🔥', cost: { wood: 20, stone: 12 }, slots: 1, unlock: 4, color: '#9a4a30', work: 3,   desc: 'Wood in. Something brighter out. Slowly.' },
  shrine:     { name: 'Shrine of Sparks',  emoji: '🕯️', cost: { wood: 10, stone: 25 }, slots: 0, unlock: 4, color: '#a08a40', work: 3,   desc: 'A small comfort against the dark.' },
};
<<<<<<< HEAD
const JOB_TYPES = ['forager', 'woodcutter', 'fisher', 'hunter', 'farm', 'quarry', 'delver', 'watch', 'kiln', 'lookout', 'muster', 'garrison'];
const B_HP = 6;                       // every building can take six blows
/* three things hunt in the dark, in rising order of nightmare */
const MONSTER_TYPES = {
  skitter: { hp: 3, speed: 105, lightDmg: 24, tolerance: 0.12, aggressive: false, name: 'a skittering thing' },
  breaker: { hp: 4, speed: 130, lightDmg: 8,  tolerance: 0.3,  aggressive: true,  lightFloor: 1, name: 'a breaker' },
  hulk:    { hp: 6, speed: 55,  lightDmg: 3,  tolerance: 0.85, aggressive: true,  name: 'a hulking shadow' },
};
=======
const JOB_TYPES = ['forager', 'woodcutter', 'fisher', 'hunter', 'farm', 'quarry', 'delver', 'watch', 'kiln'];
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
const GATHER_KINDS = { woodcutter: ['ancient', 'tree'], forager: ['berry'], quarry: ['stone'], delver: ['derrick', 'ruin'], fisher: ['fish', 'water'] };

const PERKS = [
  { id: 'greenthumb',  name: 'Green Thumb',        desc: 'Crops come in a third heavier.' },
  { id: 'keenaxes',    name: 'Keen Axes',          desc: 'Woodcutters fell a third more.' },
  { id: 'pantry',      name: 'Forest Pantry',      desc: 'Foragers find a third more.' },
  { id: 'nets',        name: 'Knotted Nets',       desc: 'Fishers haul a third more.' },
  { id: 'fletcher',    name: "Fletcher's Eye",     desc: 'Hunters bring home a third more.' },
  { id: 'heartyfolk',  name: 'Hearty Folk',        desc: 'Your people eat a quarter less.' },
  { id: 'slowcoals',   name: 'Slow Coals',         desc: 'The fire burns its wood 15% slower.' },
  { id: 'beacon',      name: "Wanderer's Beacon",  desc: 'One more wanderer finds you every spring.' },
  { id: 'delvers',     name: 'Deep Delvers',       desc: 'Delvers pry embers half again as fast.' },
  { id: 'stonebones',  name: 'Stone Bones',        desc: 'All buildings cost a quarter less.' },
  { id: 'ashgardens',  name: 'Ash Gardens',        desc: 'Foragers keep working through winter, slowly.' },
  { id: 'frostgrain',  name: 'Frostgrain',         desc: 'The first frost no longer kills a standing crop.' },
  { id: 'tithe',       name: 'Ember Tithe',        desc: 'Each new year the village gathers embers for the fire.' },
  { id: 'oldroads',    name: 'Old Roads',          desc: 'The light reaches 3 tiles further, at once.' },
  { id: 'festival',    name: 'Festival of Sparks', desc: 'Spirits stay higher, always.' },
  { id: 'quarrysongs', name: 'Quarry Songs',       desc: 'Quarries cut a third more.' },
  { id: 'masons',      name: 'Mason Kilns',        desc: 'Kilns yield twice the embers per log.' },
  { id: 'spears',      name: 'Sharp Spears',       desc: 'Your militia strike from further and never falter.' },
];

const RELICS = [
  { id: 'lantern',  name: 'The Unsleeping Lantern', desc: 'The light reaches a tile further, always.' },
  { id: 'plough',   name: 'The Old Plough',         desc: 'Fields yield a fifth more.' },
  { id: 'wolfbane', name: 'The Wolfbane Charm',     desc: 'The things in the dark keep further back.' },
  { id: 'crock',    name: 'The Bottomless Crock',   desc: 'Food spoils half as fast.' },
  { id: 'axe',      name: "The Founder's Axe",      desc: 'Woodcutters fell a fifth more.' },
  { id: 'whistle',  name: 'The Stone Whistle',      desc: 'Militia strike from a pace further.' },
  { id: 'doll',     name: 'The Cradle Doll',        desc: 'Children come easier to the village.' },
  { id: 'scale',    name: 'The Honest Scale',       desc: 'The trader cannot bring himself to cheat you.' },
  { id: 'compass',  name: "The Builder's Old Compass", desc: 'It always points to a better place. Building goes a third faster.' },
];

const FORMS = {
  hall:   { name: 'The Hearthhall',     emoji: '🏛️', desc: 'A roof over the fire and a long table beneath it. One more wanderer each spring, and the village may elect a leader.' },
  keep:   { name: 'The Emberkeep',      emoji: '🏰', desc: 'Stone raised around the flame. Defences cost half, and your militia hold the line without faltering.' },
  temple: { name: 'The Temple of Sparks', emoji: '⛩️', desc: 'The fire becomes worship. Spirits stay high, and embers come easier to those who dig for them.' },
};

const EVENTS = [
  { id: 'rains',    seasons: [0, 1], dur: true,  msg: 'Gentle rains fall — green things drink deep this season.' },
  { id: 'frost',    seasons: [3],    dur: true,  msg: 'A harsh frost bites — the fire eats wood half again as fast this season.' },
  { id: 'howling',  seasons: [2, 3], dur: true,  msg: 'Howling on the wind. Things in the dark are restless this season.' },
  { id: 'minstrel', seasons: [0, 1, 2], dur: true, msg: 'A wandering minstrel sings by the fire — spirits lift this season.' },
  { id: 'windfall', seasons: [0, 1, 2, 3], dur: false, msg: "A storm felled trees at the wood's edge — +15 wood.", apply() { addRes('wood', 15); } },
  { id: 'glowmoths',seasons: [1, 2], dur: false, msg: 'Glow moths drift into the flame — +2 ✨.', apply() { addRes('ember', 2); } },
  { id: 'blight',   seasons: [1, 2], dur: true,  msg: 'A creeping blight in the fields — crops sicken this season.' },
];

const LORE = {
  'theflight':    { t: 'The Flight',          x: 'Three pairs, six souls, out the service gate before dawn — off the registry, off the grid, off the maps that watch back. You do not say the regime\'s name aloud. Names travel, in the dark. The forest does not report you. The fire keeps it that way.' },
  'fire-hunger':  { t: 'The Fire Hungers',    x: 'The Hearth eats wood day and night, and faster for every mouth it warms. Your people toss a stick when it falls truly low — never more. A bright blaze is the keeper\'s work. Yours. And bright work goes quicker: everything is easier in honest light.' },
  'fire-low':     { t: 'Dwindling',           x: 'As the flames fall, the light itself draws inward. Fields and camps at the edge fall dark and stand idle. And the watchers in the dark write it all down, and edge closer.' },
  'fire-out':     { t: 'The Cold Dark',       x: 'The fire is dead. The room is freezing. The dark belongs to them — the fire is the only ground that is yours. Rekindle it with wood. Quickly.' },
  'embers':       { t: 'Embers',              x: 'Coals that do not cool. Too regular to be wood, too warm to be stone — seeds of the old power, the elders say, from before the sky was rationed. The regime burned every one it could find, which tells you everything. Find them — in the glowing trees, under the ruins — or the village fades.' },
  'whyfire':      { t: 'Why the Fire',        x: 'They do not fear heat. They fear flame — raw, wild, unscheduled light. Their glass eyes were tuned for the ordered dark, and a true fire is noise to them: blinding, unreadable, unreportable. That is why the regime banned open flame. That is why you lit one.' },
  'first-gift':   { t: 'Gifts of the Fire',   x: 'Each time the Hearth grows, it offers a choice of three gifts. A gift is forever. Choose like it matters.' },
  'winter':       { t: 'Winter',              x: 'Nothing grows. Forage fails. Fish hide deep beneath the ice. The fire eats faster. Survive on the hunt and what autumn left you.' },
  'harvest':      { t: 'The Harvest',         x: 'Crops sown in spring swell through summer and come in heavy in autumn. An unharvested field is killed by the first frost.' },
  'hunting':      { t: 'The Hunt',            x: 'Game runs where the trees grow thick, in every season — leaner in spring, fat in autumn. The one food the snow cannot stop.' },
  'fishing':      { t: 'Deep Water',          x: 'The water gives all year, but grudgingly under ice. A dock wants deep water close by.' },
  'paths':        { t: 'Worn Paths',          x: 'Where feet pass often, a path wears in — and feet move faster on a worn path. Villages grow along their roads.' },
  'commute':      { t: 'The Long Walk',       x: 'Workers walk from bed to workplace to the resource itself, every day. Each step is an hour not worked. Place buildings beside their work, and homes beside the buildings.' },
  'construction': { t: 'Raising Walls',       x: 'Nothing builds itself. Idle hands raise new structures — and if no hands are idle, the scaffold stands empty.' },
  'eyes':         { t: 'Eyes in the Dark',    x: 'Something circles beyond the light, patient as paperwork. Animals blink. These watch in shifts. They are looking for you — six names that walked off a registry — and they creep nearer whenever the flames fall low.' },
  'bolder':       { t: 'Bolder Every Year',   x: 'The dark is learning your village the way a clerk learns a file. Year on year the watchers grow braver — drawn to the noise, the stores, the headcount. Somewhere, someone is still funding the search.' },
  'monster-slain':{ t: 'They Can Die',        x: 'Spears in trained hands can end the things in the dark — and up close, under the mist, there is wire in them, and a glass eye, and parts no animal grew. Made things. Made by the ones you fled. The dead ones drop what they have swallowed.' },
  'monster-loss': { t: 'And So Can We',       x: 'The dark took someone. Taken, or collected — no one says the second word aloud. Keep the fire high, or keep spears between it and your people.' },
  'raid':         { t: 'Ransacked',           x: 'They came into the light and broke what we built — methodically, like an inspection. Walls, watchposts, and bright braziers turn them aside.' },
  'torchlight':   { t: 'Carried Flame',       x: 'A spark of the Hearth, set in a brazier, makes its own small day. Light can be planted — and the village can follow it outward.' },
  'relics':       { t: 'Relics',              x: 'The ones who came before left more than ruins. What the delvers bring up changes everything. Keep them digging.' },
  'trader':       { t: 'The Trader',          x: 'A wagon crosses the dark with a lantern swinging. It pays coin for surplus, sells what the forest will not give, and leaves by a different road than it came.' },
  'coins':        { t: 'Coin',                x: 'Coin does not rot, does not burn, and feeds no one. But the trader honours it.' },
  'stone':        { t: 'Stone',               x: 'Wood burns. Stone does not. The village can now build for the ages.' },
  'spoilage':     { t: 'Rot',                 x: 'Food keeps only so long. Great stores rot from the top — better to trade, eat, or grow people than to hoard.' },
  'family':       { t: 'Hearth and Home',     x: 'Two people by the evening fire became a family. A family wants its own roof — and under one, children follow.' },
  'children':     { t: 'Children',            x: 'Children eat little and work nothing for two years. They grow up better at their parents\' craft than their parents ever were.' },
  'mothers':      { t: 'The Cradle Years',    x: 'A mother heavy with child, or nursing one, works at half her pace — and is all the more likely to fill the cradle again. Villages grow around full cradles.' },
  'housing':      { t: 'A Roof of One\'s Own', x: 'One family to one cabin. Crowded roofs and cold ground breed quiet misery.' },
  'first-death':  { t: 'The Mist Takes Back', x: 'Everyone returns to the dark eventually. The village mourns, and what the lost knew lives on in their children.' },
  'ice':          { t: 'Ice Roads',           x: 'In winter your people walk straight across the frozen lakes. Shortcuts in the cold season — gone by spring.' },
  'leader':       { t: 'The Long Table',      x: 'A leader keeps the tallies now. The Ledger lays the village bare: what comes in, what goes out, who eats and who works.' },
  'upgrade':      { t: 'Better Tools',        x: 'A building, rebuilt wiser, holds one more pair of hands and wastes less of their day.' },
  'forester':     { t: 'The Forester',        x: 'An upgraded camp keeps one set of hands planting instead of felling. The forest, tended, never empties.' },
  'forms':        { t: 'What the Fire Becomes', x: 'Fed enough, the fire stops being a fire. It becomes a place — a hall, a keep, a temple. It can only ever become one thing. Choose like your grandchildren are watching.' },
  'visitors':     { t: 'Strangers on the Road', x: 'Not everyone the light draws in is ordinary. Runaways, like you were. Some carry gifts. Some carry debts. Some carry trouble. The village remembers how you treat them — and so do they.' },
  'pet':          { t: 'The Village Animal',  x: 'It eats a little and asks for nothing, and the whole village stands straighter for it. Better still: it smells the watchers long before any eye sees them, and it is not afraid to say so. Keep it fed. It chose you.' },
  'lm_road':      { t: 'The Old Road',        x: 'Under the moss, cracked black stone in a line too straight for nature. The world had roads once, and they went somewhere worth going, fast. Feet still remember: it is the surest ground there is.' },
  'lm_pylon':     { t: 'The Iron Tree',       x: 'A tower of rusted lattice, taller than any pine, holding up nothing. It carried light once — not firelight, the other kind. The kind that could be measured, metered, and switched off. It was switched off.' },
  'lm_derrick':   { t: 'The Black Derrick',   x: 'It drank from the deep and fed the engines of the old world until the old world stopped. The delvers swear the ground beneath is still warm — embers, of a sort, that never knew a tree. Whatever the regime became, it began with things like this.' },
  'lm_hulk':      { t: 'The Husk',            x: 'A carriage of rusted metal with no horse and seats for six. Someone fled in it once, the same direction you did, with the same number of people. It got this far. You got further.' },
};

const NAMES = ['Abel','Anya','Bram','Cora','Dane','Edda','Finn','Greta','Hale','Ines','Joren','Kara','Liv','Milo','Nessa','Odo','Petra','Quinn','Rolf','Sif','Tova','Ulf','Vera','Wren','Ysolt','Zane','Beck','Hazel','Iver','Sten','Maren','Oskar','Runa','Tilde','Eira','Falk'];
const SURNAMES = ['Ashdown','Brierley','Coldbrook','Dunmore','Elmwright','Fenwick','Greyloft','Hollowell','Irontree','Kindler','Larkspur','Mossvale','Nightfield','Oakhart','Pinewick','Rimeworth','Stonebrace','Thornby','Underbough','Wickfield','Shiningrock'];

const SAVE_PREFIX = 'hl3_';

const OFFS = [];
for (let dy = -WORK_RADIUS; dy <= WORK_RADIUS; dy++)
  for (let dx = -WORK_RADIUS; dx <= WORK_RADIUS; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= WORK_RADIUS * WORK_RADIUS) OFFS.push([dx, dy, d2]);
  }
OFFS.sort((a, b) => a[2] - b[2]);

/* ---------- state ---------- */
let G = null;
let nextId = 1;
let buildMode = null;
let selected = null;       // {kind:'build'|'vill', id}
let uiMode = null;         // 'focus' = next click moves selected building's work area
let modalOpen = false;
let uiDirty = true;
let OCC = new Int32Array(W * H);
let TORCHES = [];

const idx = (x, y) => y * W + x;
const tile = (x, y) => G.tiles[idx(x, y)];
const distH = (x, y) => Math.hypot(x - HX, y - HY);
const has = id => G.perks.includes(id);
const hasRelic = id => G.relics.includes(id);
const season = () => Math.floor((Math.floor(G.day) % DAYS_PER_YEAR) / DAYS_PER_SEASON);
const yearNum = () => Math.floor(Math.floor(G.day) / DAYS_PER_YEAR) + 1;
const lightR = () => BASE_LIGHT + (G.hearth.level - 1) * 3 + (has('oldroads') ? 3 : 0) + (hasRelic('lantern') ? 1 : 0);
const effLight = () => G.fire.lit
  ? Math.max(5, Math.round(lightR() * (0.45 + 0.55 * Math.min(1, G.fire.fuel / 75))))
  : 4;
const hearthCost = () => 4 + (G.hearth.level - 1) * 2 + Math.max(0, G.hearth.level - 4) * 2;
const pop = () => G.villagers.length;
const evActive = id => G.event && G.event.id === id && G.day < G.event.until;
const buildAt = (x, y) => { const o = OCC[idx(x, y)]; return o && o < 999999 ? G.builds.find(b => b.id === o - 1) || null : null; };
const byId = id => G.builds.find(b => b.id === id) || null;
const adults = () => G.villagers.filter(v => v.age >= ADULT_AGE);
const isWinter = () => season() === 3;
const slotsOf = b => (BUILDS[b.type].slots || 0) + (b.lvl > 1 ? 1 : 0);
const lvlMult = b => b.lvl > 1 ? 1.18 : 1;
const cabinCap = c => c.lvl > 1 ? 7 : 5;

function isLit(x, y) {
  const dx = x - HX, dy = y - HY, r = effLight();
  if (dx * dx + dy * dy <= r * r) return true;
  for (const t of TORCHES) {
<<<<<<< HEAD
    if ((t.fuel || 0) <= 0 || t.ruined) continue;        // a cold brazier guards nothing
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    const a = x - t.x, b = y - t.y;
    if (a * a + b * b <= TORCH_R * TORCH_R) return true;
  }
  return false;
}
<<<<<<< HEAD
/* how fiercely the light burns at a spot — the things in the dark feel this on their skin */
function brightnessAt(x, y) {
  let best = 0;
  if (G.fire.lit) {
    const dh = Math.hypot(x - HX - 0.5, y - HY - 0.5);
    if (dh <= effLight()) best = Math.max(best, (G.fire.fuel / FUEL_MAX) * (1.1 - dh / (effLight() + 2)));
  }
  for (const t of TORCHES) {
    if ((t.fuel || 0) <= 0 || t.ruined) continue;
    const d = Math.hypot(x - t.x - 0.5, y - t.y - 0.5);
    if (d <= TORCH_R) best = Math.max(best, (t.fuel / 30) * 0.85);
  }
  for (const v of G.villagers) {
    if (roleOf(v) !== 'scout') continue;
    if (Math.hypot(x - v.x, y - v.y) <= 2.8) best = Math.max(best, 0.45);
  }
  return Math.min(1, best);
}
/* lookouts and scouts see into the dark, though they light nothing */
function visionSources() {
  const out = [];
  for (const b of G.builds) {
    if (b.type !== 'lookout' || !b.built || b.ruined || b.halt) continue;
    if (!G.villagers.some(v => v.job === b.id)) continue;
    out.push([b.x + 0.5, b.y + 0.5, 9]);
  }
  for (const v of G.villagers) if (roleOf(v) === 'scout') out.push([v.x, v.y, 5]);
  return out;
}
function isScouted(x, y, srcs) {
  for (const [sx, sy, r] of srcs) {
    const dx = x - sx, dy = y - sy;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}
function feedBrazier(b) {
  if (b.type !== 'torch' || !b.built || b.ruined) return false;
  if (G.res.wood < 5 || (b.fuel || 0) > 26) return false;
  G.res.wood -= 5;
  G.flow.woodOut = (G.flow.woodOut || 0) + 5;
  b.fuel = Math.min(30, (b.fuel || 0) + 14);
  b.outLogged = false;
  if (!G.flags.fedBrazier) { G.flags.fedBrazier = true; log('✦ A brazier is a small hearth with the same appetite. It guards nothing once it goes dark — someone must keep walking out to feed it. That someone is you.', 'disc', [b.x, b.y]); }
  sfx('whoosh');
  uiDirty = true;
  return true;
}
function ruinBuilding(b) {
  b.ruined = true; b.ruinedAt = G.day; b.hp = 0;
  for (const v of G.villagers) if (v.job === b.id) { v.job = null; v.equipped = false; }
  G.homesDirty = true;
  log(`💥 The ${BUILDS[b.type].name} comes down — a smoulder of beams and sparks. It can be raised again on the same ground, quickly, for half the timber.`, 'death', [b.x, b.y]);
  discover('raid', [b.x, b.y]);
  assignJobs();
  sfx('thud');
  uiDirty = true;
}
function rebuildRuin(b) {
  if (!b.ruined) return;
  const half = {};
  for (const [k, v] of Object.entries(costOf(b.type))) half[k] = Math.ceil(v * 0.5);
  if (!canAfford(half)) return;
  for (const [k, v] of Object.entries(half)) { G.res[k] -= v; G.flow[k + 'Out'] = (G.flow[k + 'Out'] || 0) + v; }
  b.ruined = false; b.built = true; b.hp = B_HP; b.progress = BUILDS[b.type].work;
  if (b.type === 'torch') b.fuel = 20;
  log(`The ${BUILDS[b.type].name} stands again, on the bones of the old one.`, '', [b.x, b.y]);
  assignJobs();
  sfx('thud');
  uiDirty = true;
}
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
function rebuildOcc() {
  OCC.fill(0);
  for (const b of G.builds) OCC[idx(b.x, b.y)] = b.id + 1;
  OCC[idx(HX, HY)] = 999999;
  TORCHES = G.builds.filter(b => b.type === 'torch' && b.built);
}
function housingCap() {
<<<<<<< HEAD
  return HEARTH_HOUSING + G.builds.filter(b => b.type === 'cabin' && b.built && !b.ruined).reduce((s, c) => s + cabinCap(c), 0);
}
function caps() {
  const n = G.builds.filter(b => b.type === 'storehouse' && b.built && !b.ruined).reduce((s, b) => s + (b.lvl > 1 ? 2 : 1), 0);
=======
  return HEARTH_HOUSING + G.builds.filter(b => b.type === 'cabin' && b.built).reduce((s, c) => s + cabinCap(c), 0);
}
function caps() {
  const n = G.builds.filter(b => b.type === 'storehouse' && b.built).reduce((s, b) => s + (b.lvl > 1 ? 2 : 1), 0);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  return { food: 150 + 150 * n, wood: 150 + 150 * n, stone: 60 + 75 * n, ember: 999, coin: 99999 };
}
function addRes(kind, amt) {
  const before = G.res[kind];
  G.res[kind] = clamp(G.res[kind] + amt, 0, caps()[kind]);
  if (amt > 0) {
    G.flow[kind + 'In'] = (G.flow[kind + 'In'] || 0) + amt;
    if (G.seen[kind] === false) {
      G.seen[kind] = true;
      if (kind === 'stone') discover('stone');
      if (kind === 'coin') discover('coins');
      uiDirty = true;
    }
    // every whole ember is an event — the village counts them like heartbeats
    if (kind === 'ember' && Math.floor(G.res[kind]) > Math.floor(before)) {
      discover('embers');
      log('✨ An ember for the fire. Work stops; everyone watches it carried home.', 'ember', [HX, HY]);
      sfx('chime');
    }
  } else if (amt < 0) G.flow[kind + 'Out'] = (G.flow[kind + 'Out'] || 0) - amt;
}
function costOf(type) {
  const out = {};
  let mult = has('stonebones') ? 0.75 : 1;
  if (G.form && G.form.id === 'keep' && ['watch', 'torch', 'palisade'].includes(type)) mult *= 0.5;
  for (const [k, v] of Object.entries(BUILDS[type].cost)) out[k] = Math.max(1, Math.ceil(v * mult));
  return out;
}
function canAfford(cost) { return Object.entries(cost).every(([k, v]) => G.res[k] >= v); }

function dateStr(day) {
  const d = Math.floor(day);
  return `Year ${Math.floor(d / DAYS_PER_YEAR) + 1}, ${SEASONS[Math.floor((d % DAYS_PER_YEAR) / DAYS_PER_SEASON)]} ${d % DAYS_PER_SEASON + 1}`;
}
function vagueDate(day) {
  const d = Math.floor(day);
  const ds = d % DAYS_PER_SEASON;
  const part = ds < 4 ? 'Early' : ds < 8 ? 'Mid' : 'Late';
  return `Year ${Math.floor(d / DAYS_PER_YEAR) + 1} · ${part} ${SEASONS[Math.floor((d % DAYS_PER_YEAR) / DAYS_PER_SEASON)]}`;
}
/* how far we are into the season, 0..1 — the world changes gradually, not on a bell */
function seasonBlend() {
  const dy = G.day % DAYS_PER_YEAR;
  const within = (dy % DAYS_PER_SEASON) / DAYS_PER_SEASON;
  return { s: Math.floor(dy / DAYS_PER_SEASON), next: (Math.floor(dy / DAYS_PER_SEASON) + 1) % 4, t: clamp((within - 0.82) / 0.18, 0, 1) };
}
function log(msg, cls, loc) {
  G.log.unshift({ d: Math.floor(G.day), msg, cls: cls || '', loc: loc || null });
  if (G.log.length > 120) G.log.pop();
  G.logSeq = (G.logSeq || 0) + 1;
  uiDirty = true;
}
function discover(id, loc) {
  if (!LORE[id] || G.lore.includes(id)) return;
  G.lore.push(id);
  log(`✦ ${LORE[id].t} — ${LORE[id].x}`, 'disc', loc);
}

/* ---------- map generation ---------- */
function noiseGen(rng, cell) {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rng());
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const v = (ix, iy) => g[iy * gw + ix];
    const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
}
/* every seed grows a different kind of country */
const BIOMES = {
  heartwood: { name: 'the Heartwood',   blurb: 'deep forest in every direction',          water: 0.76, forest: 0.52, stone: 0.84 },
  lakeland:  { name: 'the Lakelands',   blurb: 'still water glinting between the trees',  water: 0.70, forest: 0.54, stone: 0.85 },
  riverlands:{ name: 'the Riverlands',  blurb: 'a great river crossing the dark',         water: 0.78, forest: 0.53, stone: 0.85, river: true },
  alpine:    { name: 'the High Vales',  blurb: 'thin cold air and bare grey bones of stone', water: 0.80, forest: 0.58, stone: 0.78 },
  coast:     { name: 'the Mistcoast',   blurb: 'an endless sea breathing at the world\'s edge', water: 0.78, forest: 0.54, stone: 0.85, ocean: true },
  meadow:    { name: 'the Open Meads',  blurb: 'wide grass, scattered groves, long sight', water: 0.78, forest: 0.60, stone: 0.86, berries: 0.2 },
};
function biomeOf(seedStr) {
  return Object.keys(BIOMES)[hashSeed('biome|' + seedStr) % Object.keys(BIOMES).length];
}
function genMap(seedStr) {
  const rng = mulberry32(hashSeed(seedStr));
  const B = BIOMES[biomeOf(seedStr)];
  const forest = noiseGen(rng, 7), forest2 = noiseGen(rng, 14);
  const waterN = noiseGen(rng, 11), stoneN = noiseGen(rng, 5);
  const fishN = noiseGen(rng, 9), riverN = noiseGen(rng, 16);
  const oceanSide = Math.floor(rng() * 4);
  const tiles = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - HX, y - HY);
    let t = 'grass', amt = 0;
    if (waterN(x, y) > B.water && d > 5) t = 'water';
    else if (forest(x, y) * 0.6 + forest2(x, y) * 0.4 > B.forest) { t = 'tree'; amt = 6 + Math.floor(rng() * 5); }
    if (t !== 'water' && stoneN(x, y) > B.stone && d > 4) { t = 'stone'; amt = 30; }
    // a river wanders the whole breadth of the world
    if (B.river && d > 6) {
      const yC = H / 2 + Math.sin(x / 11) * 11 + (riverN(x, 0) - 0.5) * 16;
      if (Math.abs(y - yC) < 1.6) { t = 'water'; amt = 0; }
    }
    // the sea claims one edge
    if (B.ocean && d > 6) {
      const depth = 10 + (riverN(oceanSide < 2 ? x : y, 3) - 0.5) * 8;
      if ((oceanSide === 0 && y < depth) || (oceanSide === 1 && y > H - depth) ||
          (oceanSide === 2 && x < depth) || (oceanSide === 3 && x > W - depth)) { t = 'water'; amt = 0; }
    }
    tiles[idx(x, y)] = { t, amt };
  }
  // schools of fish: rich, regenerating spots in the deeper water
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tiles[idx(x, y)];
    if (t.t === 'water' && fishN(x, y) > 0.58) { t.fish = true; t.amt = 20; }
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const t = tiles[idx(x, y)];
    if (t.t !== 'grass') continue;
    let trees = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (tiles[idx(x + dx, y + dy)].t === 'tree') trees++;
    if (trees >= 1 && rng() < (B.berries || 0.14)) { t.t = 'berry'; t.amt = 10; }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = tiles[idx(x, y)], d = Math.hypot(x - HX, y - HY);
    if (t.t === 'tree' && d > 6 && rng() < 0.006 + d * 0.0003) { t.t = 'ancient'; t.amt = 10; }
    if (t.t === 'grass' && d > 9 && rng() < 0.0022 + (d / 48) * 0.004) { t.t = 'ruin'; t.amt = 4 + Math.floor(rng() * 5); }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - HX, y - HY), t = tiles[idx(x, y)];
    if (d <= 2) { t.t = 'grass'; t.amt = 0; }
    else if (d <= 5 && t.t === 'water') { t.t = 'grass'; t.amt = 0; }
  }
  { // breathable clearings near the fire
    const treesNear = [];
    let grassNear = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - HX, y - HY);
      if (d > 2 && d <= 7) {
        const t = tiles[idx(x, y)];
        if (t.t === 'grass') grassNear++;
        else if (t.t === 'tree') treesNear.push(t);
      }
    }
    for (let i = treesNear.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); [treesNear[i], treesNear[j]] = [treesNear[j], treesNear[i]];
    }
    while (grassNear < 30 && treesNear.length) {
      const t = treesNear.pop(); t.t = 'grass'; t.amt = 0; grassNear++;
    }
  }
  function ensure(kind, count, maxDist, amt) {
    let have = 0;
    const cands = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const d = Math.hypot(x - HX, y - HY);
      if (d > maxDist) continue;
      const t = tiles[idx(x, y)];
      if (t.t === kind) have++;
      else if (d > 2.5 && (t.t === 'grass' || t.t === 'tree')) cands.push(t);
    }
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    while (have < count && cands.length) {
      const t = cands.pop(); t.t = kind; t.amt = amt; have++;
    }
  }
  ensure('tree', 10, 7, 10);
  ensure('berry', 8, 7, 10);
  {
    const a = rng() * Math.PI * 2;
    for (const [d, ang] of [[6, a], [7.5, a + 0.45]]) {
      const x = clamp(Math.round(HX + Math.cos(ang) * d), 1, W - 2);
      const y = clamp(Math.round(HY + Math.sin(ang) * d), 1, H - 2);
      const t = tiles[idx(x, y)];
      t.t = 'ancient'; t.amt = 10;
    }
  }
  ensure('ancient', 3, 12, 10);
  ensure('ruin', 1, 9, 6);
  ensure('ruin', 2, 16, 7);
  ensure('stone', 4, 11, 30);
  ensure('stone', 7, 15, 30);
  // the old world, half-swallowed — rare, far out, and not on every map
  const landAt = (x, y) => x > 1 && y > 1 && x < W - 2 && y < H - 2 && tiles[idx(x, y)].t !== 'water';
  const farSpot = () => {
    for (let tr = 0; tr < 60; tr++) {
      const a = rng() * Math.PI * 2, d = 26 + rng() * 16;
      const x = Math.round(HX + Math.cos(a) * d), y = Math.round(HY + Math.sin(a) * d);
      if (landAt(x, y)) return [x, y];
    }
    return null;
  };
  if (rng() < 0.4) {       // a stretch of the old road, too straight for nature
    const s = farSpot();
    if (s) {
      const ang = rng() * Math.PI * 2, len = 10 + Math.floor(rng() * 12);
      for (let i = 0; i < len; i++) {
        const x = Math.round(s[0] + Math.cos(ang) * i), y = Math.round(s[1] + Math.sin(ang) * i);
        if (landAt(x, y)) { tiles[idx(x, y)].t = 'road'; tiles[idx(x, y)].amt = 0; }
      }
    }
  }
  if (rng() < 0.35) {      // an iron tree that once carried the other kind of light
    const s = farSpot();
    if (s) { tiles[idx(s[0], s[1])].t = 'pylon'; tiles[idx(s[0], s[1])].amt = 0; }
  }
  if (rng() < 0.3) {       // a black derrick, still warm underneath
    const s = farSpot();
    if (s) { tiles[idx(s[0], s[1])].t = 'derrick'; tiles[idx(s[0], s[1])].amt = 12 + Math.floor(rng() * 7); }
  }
  if (rng() < 0.35) {      // a dead carriage with seats for six
    const s = farSpot();
    if (s) { tiles[idx(s[0], s[1])].t = 'hulk'; tiles[idx(s[0], s[1])].amt = 0; }
  }
  return tiles;
}

/* ---------- pathfinding & worn paths ---------- */
function walkableTile(x, y, opt) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const t = G.tiles[idx(x, y)];
  if (t.t === 'water' && !isWinter()) return false;
  if (t.t === 'stone' || t.t === 'ruin' || t.t === 'pylon' || t.t === 'derrick' || t.t === 'hulk') return false;
  if (OCC[idx(x, y)]) return false;
  if (!opt.dark && !isLit(x, y)) return false;
  return true;
}
function moveCost(x, y) {
  // established paths are much cheaper than breaking trail — so everyone
  // funnels onto the same few roads, and the roads deepen
  const t = G.tiles[idx(x, y)].t;
  if (t === 'road') return 0.35;                          // the old world built to last
  const wr = G.wear[idx(x, y)];
  if (wr >= 12) return 0.35;
  if (wr >= 4) return 0.65;
  if (t === 'tree' || t === 'ancient' || t === 'berry') return 3.2;
  if (t === 'water') return 1.4;                          // ice
  // a stable whisper of preference, so everyone breaks trail in the SAME place
  return 1 + (((x * 7 + y * 13) % 5) * 0.03);
}
function heapPush(h, n) {
  h.push(n);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].f <= h[i].f) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l].f < h[m].f) m = l;
      if (r < h.length && h[r].f < h[m].f) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}
function findPath(sx, sy, tx, ty, opt) {
  opt = opt || {};
  sx = clamp(Math.floor(sx), 0, W - 1); sy = clamp(Math.floor(sy), 0, H - 1);
  tx = clamp(Math.floor(tx), 0, W - 1); ty = clamp(Math.floor(ty), 0, H - 1);
  if (sx === tx && sy === ty) return [];
  const destI = idx(tx, ty);
  const open = [], g = new Map(), came = new Map();
  heapPush(open, { i: idx(sx, sy), g: 0, f: Math.abs(tx - sx) + Math.abs(ty - sy) });
  g.set(idx(sx, sy), 0);
  let exp = 0;
  while (open.length && exp++ < 3200) {
    const cur = heapPop(open);
    if (cur.i === destI) {
      const path = [];
      let i = destI;
      while (i !== idx(sx, sy)) { path.push([i % W, Math.floor(i / W)]); i = came.get(i); }
      path.reverse();
      return path;
    }
    if (cur.g > (g.get(cur.i) ?? Infinity)) continue;
    const cx = cur.i % W, cy = Math.floor(cur.i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, ni = idx(nx, ny);
      const isDest = ni === destI;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!isDest && !walkableTile(nx, ny, opt)) continue;
      const ng = cur.g + (isDest ? 1 : moveCost(nx, ny));
      if (ng < (g.get(ni) ?? Infinity)) {
        g.set(ni, ng); came.set(ni, cur.i);
        heapPush(open, { i: ni, g: ng, f: ng + Math.abs(tx - nx) + Math.abs(ty - ny) });
      }
    }
  }
  return null;
}

/* ---------- villagers ---------- */
function randApt() {
  const a = {};
  for (const j of JOB_TYPES) a[j] = +(0.85 + Math.random() * 0.3).toFixed(2);
  return a;
}
function spawnVillager(o) {
  o = o || {};
  const a = Math.random() * Math.PI * 2, r = effLight() - 1;
  const v = {
    id: nextId++,
    name: o.name || choice(NAMES),
    family: o.family || choice(SURNAMES),
    sex: o.sex || (Math.random() < 0.5 ? 'm' : 'f'),
    age: o.age != null ? o.age : ADULT_AGE + Math.random() * 8,
    apt: o.apt || randApt(),
    x: o.x != null ? o.x : HX + 0.5 + Math.cos(a) * r,
    y: o.y != null ? o.y : HY + 0.5 + Math.sin(a) * r,
    job: null, home: null, spouse: null, bearer: false, mom: o.mom || null,
    pregnant: 0, injured: 0, trait: o.trait || null,
    chrono: (Math.random() - 0.5) * 0.05,          // some rise early, some linger late
    state: 'idle', path: null, pi: 0, dx: null, dy: null,
    equipped: false, workTi: null,
    seat: Math.random() * Math.PI * 2, wait: 0,
  };
  G.villagers.push(v);
  return v;
}
<<<<<<< HEAD
/* martial roles: soldiers hunt, militia shield, archers reach, scouts walk into the dark */
function roleOf(v) {
  const b = v.job != null ? byId(v.job) : null;
  if (!b || !b.built || b.ruined) return null;
  if (b.type === 'watch') return 'soldier';
  if (b.type === 'muster') return 'militia';
  if (b.type === 'garrison') return b.troop === 'scout' ? 'scout' : 'archer';
  return null;
}
const isMilitia = v => !!roleOf(v);          // any martial calling
function unitHp(v) { if (v.hp == null) v.hp = isMilitia(v) ? 3 : 1; return v.hp; }
=======
function isMilitia(v) { const b = v.job != null ? byId(v.job) : null; return !!b && b.type === 'watch'; }
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
function nursing(v) {
  if (!v.bearer || v.home == null) return false;
  return G.villagers.some(c => c.home === v.home && c.family === v.family && c.age < BABY_AGE);
}
/* mothers with little ones step away to tend them — roughly an hour in every three */
function tendingNow(v) {
  return nursing(v) && ((G.day * 8 + v.id) % 3) < 1;
}
function workMult(v) {
  let m = v.apt[byId(v.job)?.type] || 1;
  if (v.pregnant > 0) m *= 0.9;
  if (v.age >= ELDER_AGE) m *= 0.8;
  return m;
}
const isHelper = v => v.age >= BABY_AGE && v.age < ADULT_AGE;
function helperParent(v) {
  if (v.mom != null) {
    const m = G.villagers.find(o => o.id === v.mom);
    if (m && m.job != null) return m;
    if (m && m.spouse != null) {
      const d = G.villagers.find(o => o.id === m.spouse);
      if (d && d.job != null) return d;
    }
  }
  return adults().find(o => o.family === v.family && o.job != null) || null;
}

function kill(v, reason, loreId) {
  if (pop() <= 2) return false;
  G.villagers = G.villagers.filter(x => x !== v);
  for (const o of G.villagers) if (o.spouse === v.id) o.spouse = null;
  log(`⚰️ ${v.name} ${v.family} ${reason}. The village mourns.`, 'death', [Math.floor(v.x), Math.floor(v.y)]);
  discover(loreId || 'first-death');
  G.mourning = G.day + 5;
  if (G.leader && G.leader.id === v.id) { G.leader = null; G.electionDue = G.day + 4; }
  G.homesDirty = true;
  sfx('bell');
  return true;
}
function leaveOne(reason) {
  if (pop() <= 2) {
    if (!G.warnedFloor) { log('The last few huddle close to the Hearth. The fire will not let them go.'); G.warnedFloor = true; }
    return;
  }
  const v = choice(G.villagers);
  G.villagers = G.villagers.filter(x => x !== v);
  for (const o of G.villagers) if (o.spouse === v.id) o.spouse = null;
  log(`${v.name} ${v.family} ${reason}.`);
  if (G.leader && G.leader.id === v.id) { G.leader = null; G.electionDue = G.day + 4; }
  G.homesDirty = true;
}

/* homes: one family to one cabin; doubling up only when there is no other roof */
function assignHomes() {
  G.homesDirty = false;
  const cabins = G.builds.filter(b => b.type === 'cabin' && b.built);
  const space = new Map(cabins.map(c => [c.id, cabinCap(c)]));
  const famOf = new Map(cabins.map(c => [c.id, null]));
  for (const v of G.villagers) v.home = null;
  const fams = {};
  for (const v of G.villagers) (fams[v.family] = fams[v.family] || []).push(v);
  const groups = Object.values(fams).sort((a, b) => b.length - a.length);
  // pass 1: one family per cabin
  for (const grp of groups) {
    let best = null;
    for (const c of cabins) {
      if (famOf.get(c.id) !== null) continue;
      const d = Math.hypot(c.x - HX, c.y - HY);
      if (!best || d < best.d) best = { c, d };
    }
    if (best) {
      famOf.set(best.c.id, grp[0].family);
      for (const v of grp.slice(0, cabinCap(best.c))) { v.home = best.c.id; space.set(best.c.id, space.get(best.c.id) - 1); }
    }
  }
  // pass 2: the roofless double up where there is room
  let crowded = 0;
  for (const v of G.villagers) {
    if (v.home != null) continue;
    let best = null, bestFree = 0;
    for (const c of cabins) {
      const f = space.get(c.id) || 0;
      if (f > bestFree) { bestFree = f; best = c; }
    }
    if (best) { v.home = best.id; space.set(best.id, bestFree - 1); crowded++; }
  }
  G.crowded = crowded;
  G.homeless = G.villagers.filter(v => v.home == null).length;
  if (crowded > 0) discover('housing');
}

function homePos(v) {
  const c = v.home != null ? byId(v.home) : null;
  return c ? [c.x + 0.5, c.y + 0.5] : [HX + 0.5 + Math.cos(v.seat) * 2.2, HY + 0.5 + Math.sin(v.seat) * 2.2];
}
function workplaceViable(b) {
<<<<<<< HEAD
  if (b.ruined) return false;                // rubble employs no one
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  if (!b.built) return true;                 // sites always want hands
  if (b.type === 'farm') return ['till', 'sow', 'harvest'].includes(b.phase);   // a growing field needs no one
  const kinds = GATHER_KINDS[b.type];
  if (!kinds) return true;
  return findGatherTile(b, kinds) != null;
}
function canWork(v) { return v.age >= ADULT_AGE && !(v.injured > G.day); }

/* ============================================================
   THE WORK QUEUE — rebuilt from the ground up.
   Every able villager re-applies for every post, every time.
   Posts are ranked: food and wood first, scaffolds always in the
   queue, every building gets one pair of hands before any gets
   two. The only reason a post stays empty is that the village is
   out of people. Nothing is ever stuck.
   ============================================================ */
function assignJobs() {
  // clear the dead wood: gone, halted or worked-out posts release their crews
  for (const v of G.villagers) {
    if (v.job == null) continue;
    const b = byId(v.job);
    if (!b || b.halt || !canWork(v) || !workplaceViable(b)) { v.job = null; v.equipped = false; v.workTi = null; }
  }
  const foodDays = G.res.food / (Math.max(1, pop()) * EAT);
  const needWood = (G.res.wood < 30 || G.fire.fuel < 40) ? 2.2 : 1;
  const needFood = foodDays < 6 ? 2.2 : 1;
  const needSpears = G.monsters.length > 0 ? 2.4 : 1 + Math.min(1.2, Math.max(0, yearNum() - 2) * 0.08);
  const baseUrg = {
    woodcutter: 1.45 * needWood, forager: 1.4 * needFood, farm: 1.5 * needFood,
    fisher: 1.4 * needFood, hunter: 1.42 * needFood,
    kiln: 0.8, delver: 0.95, quarry: 0.9, watch: needSpears,
  };
  if (G.leader && G.leader.focus === 'warden') baseUrg.watch += 0.4;
  // the queue of posts: one slot per building per tier, so crews spread thin before doubling up
  const units = [];
  for (const b of G.builds) {
<<<<<<< HEAD
    if (b.ruined) continue;
    let slots = b.built ? (b.halt ? 0 : slotsOf(b)) : 2;
    if (b.maxCrew != null) slots = Math.min(slots, b.maxCrew);
    // a hurt building with no crew of its own still calls for a repair hand
    if (b.built && !b.halt && !slots && b.hp != null && b.hp < B_HP) {
      units.push({ b, pr: 1.45 });
      continue;
    }
=======
    let slots = b.built ? (b.halt ? 0 : slotsOf(b)) : 2;
    if (b.maxCrew != null) slots = Math.min(slots, b.maxCrew);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    if (!slots || (b.built && !workplaceViable(b))) continue;
    const urg = b.built ? (baseUrg[b.type] || 1) : (b.rush ? 2.8 : 1.6);   // scaffolds are real jobs
    for (let k = 0; k < slots; k++) units.push({ b, pr: urg / (1 + k * 0.7) });
  }
  units.sort((a, b) => b.pr - a.pr);
  // everyone able re-applies; the best remaining hand wins each post
  const able = G.villagers.filter(v => canWork(v));
  const oldJob = new Map(able.map(v => [v.id, v.job]));
  for (const v of able) v.job = null;
  const taken = new Set();
  for (const u of units) {
    let best = null, bestS = -1, bestD = 0;
    for (const v of able) {
      if (taken.has(v.id)) continue;
      const [hx, hy] = homePos(v);
      const d = (Math.abs(u.b.x + 0.5 - hx) + Math.abs(u.b.y + 0.5 - hy)) * 1.2;
      let s = (v.apt[u.b.type] || 1) / (1 + d / 22);
      if (oldJob.get(v.id) === u.b.id) s *= 1.35;             // no churn without cause
      if (v.parentJobType === u.b.type) s *= 1.25;            // the family trade calls
      if (s > bestS) { bestS = s; best = v; bestD = d; }
    }
    if (!best) break;                                          // out of people — posts stay open
    taken.add(best.id);
    best.job = u.b.id;
    if (oldJob.get(best.id) !== u.b.id) {
      best.equipped = false; best.workTi = null;
      G.jobChangesToday = (G.jobChangesToday || 0) + 1;
      if (bestD > 16) discover('commute');
    }
  }
}

/* movement */
function setDest(v, x, y, opt) {
  if (v.dx === x && v.dy === y && v.path !== undefined) return;
  v.dx = x; v.dy = y;
  v.path = findPath(v.x, v.y, x, y, opt || {});
  v.pi = 0;
}
function follow(v, dtDays, speed, wearOn) {
  if (v.dx == null) return true;
  // feet move faster on a worn path
  const ti = idx(clamp(Math.floor(v.x), 0, W - 1), clamp(Math.floor(v.y), 0, H - 1));
  const wr = G.wear[ti];
  let budget = speed * dtDays * (wr >= 12 ? 1.35 : wr >= 4 ? 1.15 : 1);
  while (budget > 0) {
    let tx, ty;
    if (v.path && v.pi < v.path.length) { tx = v.path[v.pi][0] + 0.5; ty = v.path[v.pi][1] + 0.5; }
    else { tx = v.dx; ty = v.dy; }
    const ddx = tx - v.x, ddy = ty - v.y;
    const dd = Math.hypot(ddx, ddy);
    if (dd < 0.08) {
      if (v.path && v.pi < v.path.length) {
        const wi = idx(v.path[v.pi][0], v.path[v.pi][1]);
        // only purposeful trips wear paths — and never on water or ice
        if (wearOn && G.tiles[wi].t !== 'water') {
          G.wear[wi] = Math.min(50, G.wear[wi] + 1.0);
          if (G.wear[wi] >= 12) discover('paths');
        }
        v.pi++;
        continue;
      }
      return true;
    }
    const step = Math.min(dd, budget);
    v.x += ddx / dd * step; v.y += ddy / dd * step;
    budget -= step;
    if (step >= dd) continue;
    break;
  }
  return Math.hypot(v.dx - v.x, v.dy - v.y) < 0.4;
}

function workTileFor(b) {
  if (!b.built) return null;                       // build at the scaffold itself
  if (b.type === 'fisher') return null;            // fishers cast from the dock
  if (!GATHER_KINDS[b.type]) return null;          // farms, kilns: work at the building
  return b.tx != null ? b.tx : null;
}

function updateVillager(v, dtDays) {
  // everyone keeps their own hours, a little
  const ph = phase(((G.day + v.chrono) % 1 + 1) % 1);
  const adult = v.age >= ADULT_AGE;
  const elder = v.age >= ELDER_AGE;
  const speed = (adult ? (elder ? 95 : 130) : 100) * (isMilitia(v) ? 1.15 : 1) * (v.pregnant > 0 ? 0.85 : 1);

  if (!G.fire.lit) {
    setDest(v, HX + 0.5 + Math.cos(v.seat) * 1.8, HY + 0.5 + Math.sin(v.seat) * 1.8);
    v.state = follow(v, dtDays, speed, false) ? 'huddle' : 'walk';
    return;
  }
<<<<<<< HEAD
  // martial callings answer to the dark before they answer to the clock
  const role = roleOf(v);
  if (role && martialStep(v, role, dtDays, speed)) return;
  // everyone else runs from the dark's creatures — toward the fire, always
  if (G.monsters.length && !(v.state === 'sleep' && v.home != null)) {
    let nd = 5;
    for (const m of G.monsters) {
      const d = Math.hypot(m.x - v.x, m.y - v.y);
      if (d < nd) nd = d;
    }
    if (nd < 5) {
      setDest(v, HX + 0.5 + Math.cos(v.seat) * 2, HY + 0.5 + Math.sin(v.seat) * 2);
      v.state = follow(v, dtDays, speed * 1.25, false) ? 'huddle' : 'flee';
      return;
    }
  }
=======
  if (isMilitia(v) && v.engaged) { v.state = 'fight'; return; }
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b

  // the odd soul is up and about at strange hours
  const nightOwl = (v.id * 13 + Math.floor(G.day * 2)) % 19 === 0;

  if (ph === 'night' && !nightOwl) {
    v.equipped = false;
    const [gx, gy] = homePos(v);
    setDest(v, gx, gy);
    v.state = follow(v, dtDays, speed, true) ? 'sleep' : 'walk';
  } else if (ph === 'morning' || (ph === 'night' && nightOwl)) {
    // an easy hour: linger near home or drift toward the fire
    v.wait -= dtDays;
    if (v.wait <= 0 || v.dx == null) {
      v.wait = 0.04 + Math.random() * 0.06;
      if ((v.id + Math.floor(G.day)) % 2) {
        const [hx, hy] = homePos(v);
        setDest(v, hx + (Math.random() - 0.5) * 4, hy + (Math.random() - 0.5) * 4);
      } else {
        setDest(v, HX + 0.5 + (Math.random() - 0.5) * 6, HY + 0.5 + (Math.random() - 0.5) * 6);
      }
    }
    v.state = follow(v, dtDays, speed, false) ? 'resting' : 'walk';
  } else if (ph === 'evening') {
    const r = 1.8 + (v.id % 3) * 0.5;
    setDest(v, HX + 0.5 + Math.cos(v.seat) * r, HY + 0.5 + Math.sin(v.seat) * r);
    v.state = follow(v, dtDays, speed, true) ? 'gather' : 'walk';
  } else { // day
    if (!adult || v.injured > G.day) {
      // helper children shadow a working parent and lend small hands
      const par = adult ? null : isHelper(v) ? helperParent(v) : null;
      const pb = par && par.job != null ? byId(par.job) : null;
      if (pb && pb.built) {
        v.wait -= dtDays;
        if (v.wait <= 0 || v.dx == null) {                    // settle in one spot; don't vibrate
          v.wait = 0.08 + Math.random() * 0.1;
          setDest(v, pb.x + 0.5 + (Math.random() - 0.5) * 1.6, pb.y + 0.8 + (Math.random() - 0.5));
        }
        v.state = follow(v, dtDays, speed, false) ? 'helping' : 'walk';
        return;
      }
      v.wait -= dtDays;
      if (v.wait <= 0 || v.dx == null) {
        v.wait = 0.05 + Math.random() * 0.1;
        const [hx, hy] = homePos(v);
        setDest(v, hx + (Math.random() - 0.5) * 5, hy + (Math.random() - 0.5) * 5);
      }
      v.state = follow(v, dtDays, speed, false) ? (adult ? 'resting' : 'play') : 'walk';
    } else if (v.job != null && tendingNow(v)) {
      // the little one needs her — home for an hour, then back to it
      const [hx, hy] = homePos(v);
      setDest(v, hx, hy);
      v.state = follow(v, dtDays, speed, true) ? 'tending' : 'walk';
    } else if (v.job != null) {
      const b = byId(v.job);
      if (!b) { v.job = null; return; }
<<<<<<< HEAD
      if (!v.equipped) {
=======
      if (b.built && b.type === 'watch') {
        v.wait -= dtDays;
        if (v.wait <= 0 || v.dx == null) {
          v.wait = 0.08 + Math.random() * 0.1;
          const ang = Math.atan2(b.y - HY, b.x - HX) + (Math.random() - 0.5) * 1.2;
          const r = effLight() - 1.5;
          setDest(v, clamp(HX + 0.5 + Math.cos(ang) * r, 1, W - 2), clamp(HY + 0.5 + Math.sin(ang) * r, 1, H - 2), { dark: true });
        }
        v.state = follow(v, dtDays, speed, false) ? 'patrol' : 'walk';
      } else if (!v.equipped) {
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
        // first stop each morning: the building, to take up tools
        setDest(v, b.x + 0.5, b.y + 0.4);
        if (follow(v, dtDays, speed, true)) { v.equipped = true; v.state = 'work'; }
        else v.state = 'walk';
      } else if (b.built && b.type === 'hunter') {
        // a kill gets carried straight home before the hunt goes on
        if (v.carry) {
          if (!v.carry.got) {
            setDest(v, v.carry.x, v.carry.y);
            if (follow(v, dtDays, speed, false)) v.carry.got = true;
            v.state = 'walk';
          } else {
            setDest(v, b.x + 0.5, b.y + 0.8);
            if (follow(v, dtDays, speed * 0.9, false)) {
              addRes('food', 3);
              v.carry = null;
              v.wait = 0;
            }
            v.state = 'walk';
          }
          return;
        }
        // otherwise: stalk the thickets around the lodge, not a fixed spot
        v.wait -= dtDays;
        if (v.wait <= 0 || v.dx == null) {
          v.wait = 0.05 + Math.random() * 0.08;
          const [fx, fy] = focusPos(b);
          let best = null;
          for (let tr = 0; tr < 14; tr++) {
            const [dx2, dy2] = OFFS[Math.floor(Math.random() * OFFS.length)];
            const x2 = fx + dx2, y2 = fy + dy2;
            if (x2 < 1 || y2 < 1 || x2 >= W - 1 || y2 >= H - 1) continue;
            const tt = G.tiles[idx(x2, y2)].t;
            if ((tt === 'tree' || tt === 'grass') && isLit(x2, y2)) { best = [x2, y2]; break; }
          }
          if (best) setDest(v, best[0] + 0.5, best[1] + 0.5);
        }
        v.state = follow(v, dtDays, speed * 0.8, false) ? 'work' : 'walk';   // hunters tread softly, off the paths
      } else {
        const wt = workTileFor(b);
        if (wt != null) {
          if (v.workTi !== wt) { v.workTi = wt; setDest(v, wt % W + 0.5, Math.floor(wt / W) + 0.5); }
          v.state = follow(v, dtDays, speed, true) ? 'work' : 'walk';
        } else {
          setDest(v, b.x + 0.5, b.y + 0.4);
          v.state = follow(v, dtDays, speed, true) ? 'work' : 'walk';
        }
      }
    } else {
      v.wait -= dtDays;
      if (v.wait <= 0 || v.dx == null) {
        v.wait = 0.1 + Math.random() * 0.15;
        setDest(v, HX + 0.5 + (Math.random() - 0.5) * 8, HY + 0.5 + (Math.random() - 0.5) * 8);
      }
      v.state = follow(v, dtDays, speed, false) ? 'idle' : 'walk';
    }
  }
}

<<<<<<< HEAD
/* the soldier's day: hunt, shield, shoot or scout — each calling has its manner */
function martialStep(v, role, dtDays, speed) {
  const b = byId(v.job);
  if (!b || !b.built || b.ruined) return false;
  unitHp(v);
  v.cd = Math.max(0, (v.cd || 0) - dtDays);
  if (role === 'scout') {
    // walks into the dark with a captive spark; sees, never fights
    v.wait -= dtDays;
    if (v.wait <= 0 || v.dx == null) {
      v.wait = 0.25 + Math.random() * 0.3;
      const a2 = Math.random() * Math.PI * 2, d2 = effLight() + 4 + Math.random() * 14;
      setDest(v, clamp(HX + 0.5 + Math.cos(a2) * d2, 2, W - 3), clamp(HY + 0.5 + Math.sin(a2) * d2, 2, H - 3), { dark: true });
    }
    v.state = follow(v, dtDays, speed * 0.85, false) ? 'scouting' : 'walk';
    return true;
  }
  // find a quarry worth the name
  let target = null, td = 1e9;
  for (const m of G.monsters) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - v.x, m.y - v.y);
    let interested = false;
    if (role === 'soldier') interested = d < 14;
    else if (role === 'archer') interested = d < 11;
    else if (role === 'militia') interested = d < 9 && (m.loot || G.day - (m.lastHarm || -9) < 0.8);
    if (interested && d < td) { td = d; target = m; }
  }
  if (target) {
    v.engaged = true;
    let reach = role === 'archer' ? 3.6 : 1.0;
    if (role !== 'archer') {
      if (has('spears')) reach += 0.6;
      if (hasRelic('whistle')) reach += 0.4;
      if (G.leader && G.leader.focus === 'warden') reach += 0.4;
      if (G.leader && G.leader.focus === 'mason') reach -= 0.3;
    }
    if (td > reach) {
      setDest(v, target.x, target.y, { dark: true });
      v.state = follow(v, dtDays, 150, false) ? 'fight' : 'walk';
    } else {
      v.state = 'fight';
      if (v.cd <= 0) {
        v.cd = role === 'archer' ? 0.12 : 0.08;
        target.hp -= 1;
        target.hitFlash = 0.12;
        target.cd = Math.max(target.cd, 0.35);     // a blow landed breaks its rhythm
        if (role === 'archer') FX.push({ kind: 'arrow', x1: v.x, y1: v.y - 0.3, x2: target.x, y2: target.y, t: 0 });
        sfx('chop');
        if (target.type === 'skitter') target.fleeing = true;     // skittish: it runs the moment it bleeds
        if (target.hp <= 0) killMonster(target, `is brought down by ${v.name} ${v.family}`);
        else if (MONSTER_TYPES[target.type].aggressive && td < 1.3 && role !== 'archer') {
          const safe = (has('spears') || (G.form && G.form.id === 'keep')) && Math.random() < 0.6;
          if (!safe && Math.random() < 0.5) {
            v.hp -= 1;
            if (v.hp <= 0) kill(v, 'fell holding the line', 'monster-loss');
          }
        }
      }
    }
    return true;
  }
  v.engaged = false;
  // no quarry: militia hold the green; soldiers and archers walk the rim
  v.wait -= dtDays;
  if (v.wait <= 0 || v.dx == null) {
    v.wait = 0.08 + Math.random() * 0.1;
    if (role === 'militia') {
      setDest(v, HX + 0.5 + (Math.random() - 0.5) * 7, HY + 0.5 + (Math.random() - 0.5) * 7);
    } else {
      const ang = Math.atan2(b.y - HY, b.x - HX) + (Math.random() - 0.5) * 1.2;
      const r = effLight() - 1.5;
      setDest(v, clamp(HX + 0.5 + Math.cos(ang) * r, 1, W - 2), clamp(HY + 0.5 + Math.sin(ang) * r, 1, H - 2), { dark: true });
    }
  }
  v.state = follow(v, dtDays, speed, false) ? 'patrol' : 'walk';
  return true;
}

=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
/* what's on their mind — a thought sits for a while; minds don't flicker */
function thoughtFor(v) {
  if (v.thought && G.day - (v.thoughtAt || -9) < 1.5 && v.thoughtCtx === (G.fire.lit ? 1 : 0)) return v.thought;
  const out = freshThought(v);
  v.thought = out;
  v.thoughtAt = G.day;
  v.thoughtCtx = G.fire.lit ? 1 : 0;
  return out;
}
function freshThought(v) {
  const opts = [];
  const fd = G.res.food / Math.max(1, pop() * EAT);
  if (v.pregnant > 0) opts.push('There will be one more of us soon.');
  if (nursing(v) && v.pregnant <= 0) opts.push('The little one kept me up. Worth it.');
  if (v.injured > G.day) opts.push('I hate sitting idle. But these wounds...');
  if (G.res.food <= 0.5) opts.push('My stomach has stopped growling. That frightens me more.');
  else if (fd < 4) opts.push('The stores are thin. I count the jars when no one looks.');
  if (!G.fire.lit) opts.push('The fire is dead. The room is freezing.');
  else if (G.fire.fuel < 28) opts.push('Someone should feed the fire. The dark is leaning in.');
  if (G.day < (G.mourning || 0)) opts.push('We buried one of our own. The fire seems smaller tonight.');
  if (isWinter()) opts.push('Cold in the bones. Spring is a rumour.');
  if (v.age < ADULT_AGE) opts.push('I found a beetle! It is my beetle now.');
  else if (v.state === 'work' && v.job != null) {
    const t = byId(v.job)?.type;
    const lines = {
      woodcutter: 'Swing, breathe, swing. The forest gives.',
      forager: 'You learn where the good thickets hide.',
      fisher: 'The water keeps its own time.',
      hunter: 'Walk soft. The wood is listening.',
      farm: 'Soil under the nails. Bread later.',
      quarry: 'The stone fights back. I like that.',
      delver: 'It is old down there. Old and warm.',
      kiln: 'Smoke in my eyes, sparks in my pocket.',
      watch: 'Nothing on the treeline. Good. Keep it that way.',
    };
    if (lines[t]) opts.push(lines[t]);
    const quips = {
      woodcutter: 'I named my axe Brenda. Brenda has opinions about oak.',
      forager: 'Rule one: if the mushroom looks too excited, leave it alone.',
      fisher: 'The fish are mocking me. I can hear them. Glub glub. Very funny.',
      hunter: 'I am one with the forest. The forest disagrees, loudly, every time I step on a twig.',
      farm: 'I talk to the turnips. The turnips are better listeners than my spouse.',
      quarry: 'Today a rock won the argument. Tomorrow, the rematch.',
      delver: 'Found a spoon down there older than the village. I kept the spoon. Tell no one.',
      kiln: 'My eyebrows will grow back. They always do.',
      watch: 'Saw a terrifying shape in the treeline. It was a bush. I will be telling everyone it was a monster.',
    };
    if (quips[t] && (v.id + Math.floor(G.day)) % 3 === 0) opts.push(quips[t]);
    if ((v.apt[t] || 1) > 1.15) opts.push('My hands know this work better than I do.');
  }
  if (v.state === 'idle' && v.age >= ADULT_AGE) {
    opts.push('No work for me today. I walk the paths and feel useless.');
    opts.push('I have inspected every cloud twice. Excellent clouds. No notes.');
  }
  if (v.state === 'resting' || v.state === 'play') opts.push(v.age < ADULT_AGE ? 'I found a beetle! It is my beetle now.' : 'Lying in the grass is also a job, if you squint.');
  if (v.state === 'gather') opts.push('The fire is warm. The dark is far. This is enough.');
  if (v.state === 'sleep') opts.push('...');
  if (v.spouse != null && Math.random() < 0.5) {
    const s = G.villagers.find(o => o.id === v.spouse);
    if (s) opts.push(`${s.name} laughed today. The whole day was worth it.`);
  }
  if ((v.id * 7 + Math.floor(G.day)) % 11 === 0) opts.push(choice([
    'I am almost certain the moon is following me.',
    'Soup again. I dream of a food that is not soup.',
    'The elders say the dark is full of horrors. The dark has clearly never met my mother-in-law.',
    'One day I will see what is beyond the light. Right after lunch. Maybe tomorrow.',
    'I waved at the trader\'s horse. The horse nodded. We understand each other.',
  ]));
  if (!opts.length) opts.push('One day more.');
  return opts[(Math.floor(G.day * 2) + v.id) % opts.length];
}

/* ---------- production ---------- */
function focusPos(b) { return b.focus ? b.focus : [b.x, b.y]; }
function findGatherTile(b, kinds) {
  const [fx, fy] = focusPos(b);
  for (const kind of kinds) {
    for (const [dx, dy] of OFFS) {
      const x = fx + dx, y = fy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (!isLit(x, y)) continue;
      const t = G.tiles[idx(x, y)];
      if (kind === 'fish') { if (t.t === 'water' && t.fish && t.amt > 1) return idx(x, y); continue; }
      if (kind === 'water') { if (t.t === 'water') return idx(x, y); continue; }
      if (t.t === kind && t.amt > 0) return idx(x, y);
    }
  }
  return null;
}
function onDeplete(ti) {
  const t = G.tiles[ti];
  if (t.t === 'tree' || t.t === 'stone') { t.t = 'grass'; t.amt = 0; }
  else if (t.t === 'derrick') {
    t.t = 'hulk'; t.amt = 0;     // drained dry, the husk remains
    log('The derrick gives up its last warmth. The iron stays, cold now, like everything the old world left.', '', [ti % W, Math.floor(ti / W)]);
  } else if (t.t === 'ruin') {
    t.t = 'grass'; t.amt = 0;
<<<<<<< HEAD
=======
    if (Math.random() < 0.18) grantRelic([ti % W, Math.floor(ti / W)]);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  } else if (t.t === 'ancient') {
    t.t = 'grass'; t.amt = 0;
    log('An ancient tree falls — its heartwood holds embers.', '', [ti % W, Math.floor(ti / W)]);
    addRes('ember', 2);
  }
}
function gather(b, want, kinds) {
  if (b.tx != null) {
    const t = G.tiles[b.tx];
    const ok = t && (t.t === 'water'
      ? (kinds.includes('water') || kinds.includes('fish'))
      : kinds.includes(t.t) && t.amt > 0);
    if (!ok) b.tx = null;
  }
  if (b.tx == null) b.tx = findGatherTile(b, kinds);
  if (b.tx == null) {
    if (G.day - (b.starveLogDay || -99) > 6) {
      log(`${BUILDS[b.type].name} has nothing left to gather within reach.`, '', [b.x, b.y]);
      b.starveLogDay = G.day;
    }
    return 0;
  }
  const t = G.tiles[b.tx];
  if (t.t === 'water') {
    if (t.fish && t.amt > 0) {                      // a true fishing spot: rich while it lasts
      const got = Math.min(want, t.amt);
      t.amt -= got;
      if (t.amt <= 0.5) b.tx = null;                // school fished out — find another
      return got;
    }
    return want * 0.45;                             // open water: thinner pickings, but honest
  }
  const got = Math.min(want, t.amt);
  t.amt -= got;
  if (t.amt <= 0.001) { t.amt = 0; onDeplete(b.tx); b.tx = null; }
  return got;
}
function prodMult(t) {
  let m = 1;
  if (t === 'farm') {
    if (has('greenthumb')) m *= 1.35;
    if (hasRelic('plough')) m *= 1.2;
    if (evActive('rains')) m *= 1.3;
    if (evActive('blight')) m *= 0.6;
  }
  if (t === 'forager') {
    if (has('pantry')) m *= 1.35;
    if (evActive('rains')) m *= 1.3;
  }
  if (t === 'woodcutter') { if (has('keenaxes')) m *= 1.35; if (hasRelic('axe')) m *= 1.2; }
  if (t === 'fisher' && has('nets')) m *= 1.35;
  if (t === 'hunter' && has('fletcher')) m *= 1.35;
  if (t === 'quarry' && has('quarrysongs')) m *= 1.35;
  if (G.leader) {
    const f = G.leader.focus;
    const food = ['farm', 'forager', 'fisher', 'hunter'].includes(t);
    if (f === 'provider') { if (food) m *= 1.12; if (t === 'woodcutter') m *= 0.95; }
    if (f === 'keeper') m *= 0.96;
    if (f === 'wildwarden' && t === 'farm') m *= 0.92;
  }
  return m;
}
const seasonForage = () => [1, 1.25, 1.15, has('ashgardens') ? 0.5 : 0][season()];
const seasonFish = () => [1, 1.1, 1, 0.35][season()];
const seasonHunt = () => [0.8, 1, 1.2, 0.9][season()];

function produce(dtDays) {
  const presence = new Map();
  for (const v of G.villagers) {
    if (v.state === 'work' && v.job != null) {
      presence.set(v.job, (presence.get(v.job) || 0) + workMult(v));
    } else if (v.state === 'helping') {
      // a child at a parent's elbow is worth a third of a pair of hands
      const par = helperParent(v);
      if (par && par.job != null) presence.set(par.job, (presence.get(par.job) || 0) + 0.33);
    }
  }
  // good light is good work — a blazing fire puts spring in every step
  const fireK = G.fire.lit ? 1 + 0.15 * clamp((G.fire.fuel - 50) / 50, 0, 1) : 0.8;
  const k = fireK / WORK_WINDOW;
  for (const b of G.builds) {
    const apt = presence.get(b.id) || 0;
    if (!b.built) {
      if (apt > 0) {
        b.progress = (b.progress || 0) + apt * k * dtDays * (hasRelic('compass') ? 1.33 : 1) * (G.leader && G.leader.focus === 'mason' ? 1.33 : 1);
        if (b.progress >= BUILDS[b.type].work) {
          b.built = true;
<<<<<<< HEAD
          b.hp = B_HP;
          if (b.type === 'torch') b.fuel = 24;
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
          rebuildOcc();
          log(`${BUILDS[b.type].name} raised.`, '', [b.x, b.y]);
          if (!G.flags['built_' + b.type]) {
            G.flags['built_' + b.type] = true;
            log(`✦ The village's first ${BUILDS[b.type].name}.`, 'disc', [b.x, b.y]);
            if (b.type === 'torch') discover('torchlight', [b.x, b.y]);
            if (b.type === 'fisher') discover('fishing', [b.x, b.y]);
            if (b.type === 'hunter') discover('hunting', [b.x, b.y]);
          }
          sfx('thud');
          G.homesDirty = true;
          assignJobs();
        }
      }
      continue;
    }
<<<<<<< HEAD
    if (b.ruined) continue;
    // hands on a hurt building patch it as they work
    if (apt > 0 && b.hp != null && b.hp < B_HP) b.hp = Math.min(B_HP, b.hp + 1.6 * apt * k * dtDays);
    const lm = lvlMult(b);
    if (b.type === 'kiln') {
      // the slow coal: an ember is a year of patient smoke, not a product
      if (apt > 0) {
        const need = 2 * k * dtDays;
        if (G.res.wood >= need) {
          G.res.wood -= need;
          G.flow.woodOut = (G.flow.woodOut || 0) + need;
          addRes('ember', (1 / DAYS_PER_YEAR) * (has('masons') ? 2 : 1) * lvlMult(b) * k * dtDays * Math.min(apt, 1.2));
=======
    const lm = lvlMult(b);
    if (b.type === 'kiln') {
      if (apt > 0) {
        const need = 8 * k * dtDays;
        if (G.res.wood >= need) {
          G.res.wood -= need;
          G.flow.woodOut = (G.flow.woodOut || 0) + need;
          addRes('ember', 0.5 * (has('masons') ? 2 : 1) * lm * k * dtDays * Math.min(apt, 1.2));
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
        }
      }
      continue;
    }
    if (apt <= 0) continue;
    if (b.type === 'forager') {
      const sm = seasonForage();
      if (sm > 0) addRes('food', gather(b, 2.6 * apt * sm * lm * prodMult('forager') * k * dtDays, ['berry']));
      if (isWinter()) {
        // when nothing grows, they come home with armfuls of deadfall instead
        addRes('wood', 1.0 * apt * lm * k * dtDays);
        if (!G.flags.sticks) { G.flags.sticks = true; log('✦ The foragers return with sticks and windfall branches. The fire does not care what it eats.', 'disc', [b.x, b.y]); }
      }
    } else if (b.type === 'woodcutter') {
      addRes('wood', gather(b, 2.4 * apt * lm * prodMult('woodcutter') * k * dtDays, ['ancient', 'tree']));
    } else if (b.type === 'fisher') {
      addRes('food', gather(b, 3.0 * apt * seasonFish() * lm * prodMult('fisher') * k * dtDays, ['fish', 'water']));
    } else if (b.type === 'hunter') {
      // game runs in thick forest near the lodge — never depleted, never plenty
      let trees = 0;
      const [fx, fy] = focusPos(b);
      for (const [dx, dy] of OFFS) {
        const x = fx + dx, y = fy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && (G.tiles[idx(x, y)].t === 'tree' || G.tiles[idx(x, y)].t === 'ancient')) trees++;
      }
      addRes('food', 3.2 * apt * seasonHunt() * lm * Math.min(1.2, trees / 18) * prodMult('hunter') * k * dtDays);
    } else if (b.type === 'quarry') {
      addRes('stone', gather(b, 1.25 * apt * lm * prodMult('quarry') * k * dtDays, ['stone']));
    } else if (b.type === 'delver') {
      let m = (has('delvers') ? 1.5 : 1) * (G.form && G.form.id === 'temple' ? (G.form.tier > 1 ? 1.6 : 1.3) : 1);
<<<<<<< HEAD
      addRes('ember', gather(b, 0.4 * apt * m * lm * k * dtDays, ['derrick', 'ruin']));
=======
      const got = gather(b, 0.4 * apt * m * lm * k * dtDays, ['ruin']);
      if (got > 0 && !G.flags.firstDelve) {
        G.flags.firstDelve = true;
        grantRelic([b.x, b.y]);    // the first dig always turns something up
      }
      addRes('ember', got);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    } else if (b.type === 'farm') {
      // tilling and sowing take hands; growing takes only patience
      if (b.phase === 'till') {
        b.prog = (b.prog || 0) + apt * k * dtDays;
        if (b.prog >= 2) { b.phase = 'sow'; b.prog = 0; }
      } else if (b.phase === 'sow') {
        b.prog = (b.prog || 0) + apt * k * dtDays;
        if (b.prog >= 1) {
          b.phase = 'grow'; b.prog = 0; b.growth = 0;
          log('A field stands sown. Now the waiting.', '', [b.x, b.y]);
          assignJobs();          // the field crew is free for other work while it grows
        }
      } else if (b.phase === 'harvest' && b.crop > 0) {
        const take = Math.min(b.crop, 7 * apt * lm * k * dtDays);
        b.crop -= take;
        addRes('food', take);
        if (b.crop <= 0.01) { b.crop = 0; b.phase = 'fallow'; assignJobs(); }
      }
    }
  }
}

function farmDaily() {
  const s = season();
  for (const b of G.builds) {
    if (b.type !== 'farm' || !b.built) continue;
    if (!b.phase) { b.phase = 'fallow'; b.growth = 0; b.crop = 0; b.prog = 0; }
    // spring: the year's work begins with breaking ground
    if (s === 0 && b.phase === 'fallow') { b.phase = 'till'; b.prog = 0; b.crop = 0; b.growth = 0; }
    if (b.phase === 'grow' && s !== 3) {
      b.growth += [0.028, 0.055, 0.035, 0][s] * (evActive('rains') ? 1.3 : 1) * (evActive('blight') ? 0.5 : 1);
      if (b.growth >= 1 || (s === 2 && b.growth >= 0.5 && b.readyLogged !== yearNum())) {
        b.crop = 150 * Math.min(b.growth, 1) * prodMult('farm');
        b.growth = Math.min(b.growth, 1);
        b.phase = 'harvest';
        b.readyLogged = yearNum();
        discover('harvest', [b.x, b.y]);
        log('A field stands golden, ready for harvest.', '', [b.x, b.y]);
        assignJobs();
      }
    }
  }
  // foresters: an upgraded woodcutter camp keeps one pair of hands planting
  for (const b of G.builds) {
    if (b.type !== 'woodcutter' || !b.built || b.lvl <= 1) continue;
    if (!G.villagers.some(v => v.job === b.id)) continue;
    discover('forester', [b.x, b.y]);
    const [fx, fy] = focusPos(b);
    for (let tr = 0; tr < 12; tr++) {
      const [dx, dy] = choice(OFFS);
      const x = fx + dx, y = fy + dy;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const t = G.tiles[idx(x, y)];
      if (t.t === 'grass' && !OCC[idx(x, y)] && G.wear[idx(x, y)] < 4) { t.t = 'tree'; t.amt = 1; break; }
    }
  }
  // trees grow, berries ripen, fish return to the deep spots
  for (const t of G.tiles) {
    if (t.t === 'tree' && t.amt < 10) t.amt = Math.min(10, t.amt + 0.35);
    else if (t.t === 'berry') t.amt = Math.min(14, t.amt + 2.5);
    else if (t.t === 'water' && t.fish) t.amt = Math.min(20, t.amt + 0.8);
  }
}

/* ---------- the fire ---------- */
function fireBurnRate() {
  let r = 2.0 + 0.18 * pop() + 0.25 * (G.hearth.level - 1);
  if (isWinter()) r *= 1.35;
  if (evActive('frost')) r *= 1.5;
  if (has('slowcoals')) r *= 0.85;
  return r;
}
function updateFire(dtDays) {
  const F = G.fire;
  if (F.lit) {
    F.fuel -= fireBurnRate() * dtDays;
    if (F.fuel < 28 && G.res.wood > 0) {
      const near = G.villagers.some(v => Math.hypot(v.x - HX - 0.5, v.y - HY - 0.5) < 4);
      if (near) {
        const amt = Math.min(G.res.wood, 28 - F.fuel, 30 * dtDays);
        G.res.wood -= amt; F.fuel += amt;
        G.flow.woodOut = (G.flow.woodOut || 0) + amt;
      }
    }
    if (F.fuel < 30) discover('fire-low');
    if (F.fuel <= 0) {
      F.fuel = 0; F.lit = false; F.outSince = G.day;
      log('🕯️ The fire is dead. The room is freezing.', 'death', [HX, HY]);
      discover('fire-out');
      sfx('bell');
      uiDirty = true;
    }
  } else {
    if (G.res.wood < 15) addRes('wood', adults().length * 1.3 * dtDays);
    if (G.day - (F.lastToll || F.outSince) > 1) {
      F.lastToll = G.day;
      if (Math.random() < 0.6) kill(choice(G.villagers), 'died in the cold dark', 'fire-out');
    }
    if (phase(G.day % 1) === 'day' && G.res.wood >= 15) rekindle();
  }
}
function rekindle() {
  if (G.fire.lit || G.res.wood < 15) return;
  G.res.wood -= 15;
  G.fire.fuel = 40; G.fire.lit = true;
  log('🔥 The fire is rekindled. The light returns, and everyone breathes again.', '', [HX, HY]);
  sfx('whoosh');
  uiDirty = true;
}
function stoke() {
  if (!G.fire.lit) { rekindle(); return; }
  const cost = 10;
  if (G.res.wood < cost || G.fire.fuel > FUEL_MAX - 3) return;
  G.res.wood -= cost;
  G.flow.woodOut = (G.flow.woodOut || 0) + cost;
  G.fire.fuel = Math.min(FUEL_MAX, G.fire.fuel + 25);
  if (!G.flags.stoked) { G.flags.stoked = true; log('✦ You feed the fire with your own hands. It remembers that.', 'disc', [HX, HY]); }
  sfx('whoosh');
  uiDirty = true;
}

<<<<<<< HEAD
/* ---------- monsters: three kinds of nightmare, with hit points ---------- */
let FX = [];          // transient battle effects (arrows, flashes) — drawn by the ui, never saved
/* the schedule of nightmares: skitters alone for three years, breakers until seven, then the hulks */
function monsterTypeForYear() {
  const y = yearNum(), r = Math.random();
  if (y < 3) return 'skitter';
  if (y < 7) return r < 0.65 ? 'skitter' : 'breaker';
  return r < 0.4 ? 'skitter' : r < 0.75 ? 'breaker' : 'hulk';
}
function monsterPressure() {
  let p = 0.2 * (1 - G.fire.fuel / FUEL_MAX) + Math.min(0.55, yearNum() * 0.045);
  if (!G.fire.lit) p += 1.5;
  if (evActive('howling')) p += 0.5;
  if (yearNum() >= 20) p += 2.5;          // the search is funded forever
  return p;
}
function spawnMonster(forceType) {
  const type = forceType || monsterTypeForYear();
  const def = MONSTER_TYPES[type];
  const a = Math.random() * Math.PI * 2;
  const r = effLight() + 3 + Math.random() * 5;
  const m = {
    type, hp: def.hp + (yearNum() >= 20 ? 2 : 0),
    x: clamp(HX + 0.5 + Math.cos(a) * r, 1, W - 2),
    y: clamp(HY + 0.5 + Math.sin(a) * r, 1, H - 2),
    fleeing: false, loot: null, cd: 0, hitFlash: 0, lastHarm: -9,
  };
  G.monsters.push(m);
  discover('eyes', [Math.floor(m.x), Math.floor(m.y)]);
  if (type === 'breaker') discover('bolder');
  if (type === 'hulk') log('Something very large is standing at the edge of the light. It is not hurrying. It does not need to.', 'death', [Math.floor(m.x), Math.floor(m.y)]);
  sfx('growl');
}
function dropLoot(m) {
  if (!m.loot) return;
  addRes(m.loot.kind, m.loot.amt);
  log('What it stole spills back into the stores.', '', [Math.floor(m.x), Math.floor(m.y)]);
  m.loot = null;
}
function killMonster(m, how) {
  if (m.dead) return;
  m.dead = true;
  dropLoot(m);
  addRes('coin', 1 + Math.floor(Math.random() * 2));
  addRes('food', 2 + Math.floor(Math.random() * 3));
  if (Math.random() < 0.05) addRes('ember', 1);
  const nm = MONSTER_TYPES[m.type].name;
  log(`${nm[0].toUpperCase() + nm.slice(1)} ${how}. Wire and a glass eye, under the mist.`, '', [Math.floor(m.x), Math.floor(m.y)]);
  discover('monster-slain');
  if (G.siege && !G.siege.done) G.siege.kills = (G.siege.kills || 0) + 1;
=======
/* ---------- monsters & militia ---------- */
function monsterPressure() {
  let p = 0.25 * (1 - G.fire.fuel / FUEL_MAX) + Math.min(0.4, (yearNum() - 1) * 0.035);
  if (!G.fire.lit) p += 1.5;
  if (evActive('howling')) p += 0.5;
  return p;
}
function fearRadius() {
  // year on year the dark grows braver; relics and form push back
  let boldness = clamp(1 - (yearNum() - 1) * 0.04, 0.55, 1);
  if (hasRelic('wolfbane')) boldness = Math.min(1, boldness + 0.2);
  return effLight() * (0.35 + 0.55 * (G.fire.fuel / FUEL_MAX)) * boldness;
}
function nearTorch(x, y, r) {
  for (const t of TORCHES) {
    if (Math.hypot(x - t.x - 0.5, y - t.y - 0.5) < r) return true;
  }
  return false;
}
function spawnMonster(bold) {
  const a = Math.random() * Math.PI * 2;
  const r = effLight() + 3 + Math.random() * 4;
  const m = {
    x: clamp(HX + 0.5 + Math.cos(a) * r, 1, W - 2),
    y: clamp(HY + 0.5 + Math.sin(a) * r, 1, H - 2),
    fleeing: false, bold: !!bold,
  };
  G.monsters.push(m);
  discover('eyes', [Math.floor(m.x), Math.floor(m.y)]);
  if (bold) discover('bolder');
  sfx('growl');
}
function monsterLoot(x, y) {
  addRes('coin', 1 + Math.floor(Math.random() * 2));
  addRes('food', 3 + Math.floor(Math.random() * 4));
  if (Math.random() < 0.05) addRes('ember', 1);
  if (Math.random() < 0.04) grantRelic([Math.floor(x), Math.floor(y)]);
  log('The thing dissolves into mist, leaving what it had swallowed.', '', [Math.floor(x), Math.floor(y)]);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
}
function updateMonsters(dtDays) {
  const ph = phase(G.day % 1);
  const siege = G.siege && !G.siege.done;
<<<<<<< HEAD
  const relentless = yearNum() >= 20;
  if (ph === 'night' || !G.fire.lit || siege || relentless) {
    let expected = monsterPressure() * dtDays / 0.4;
    if (siege && ph === 'night') expected += dtDays * (10 + pop() / 2) / 0.4;
    // year one: one or two at most; more each year after
    const cap2 = siege ? 30 : relentless ? 12 : Math.min(10, 1 + Math.ceil(yearNum() / 2));
    if (Math.random() < expected && G.monsters.length < cap2) spawnMonster();
  }
  for (const m of G.monsters) {
    if (m.dead) continue;
    const def = MONSTER_TYPES[m.type] || MONSTER_TYPES.skitter;
    m.cd = Math.max(0, m.cd - dtDays);
    m.hitFlash = Math.max(0, (m.hitFlash || 0) - dtDays);
    // the light itself burns them — stoke the fire under a lured skitter and watch
    const br = brightnessAt(m.x, m.y);
    m.burning = br > 0.1;
    if (br > 0.05) {
      let dmg = def.lightDmg * br * dtDays;
      if (def.lightFloor && m.hp - dmg < def.lightFloor) dmg = Math.max(0, m.hp - def.lightFloor);
      m.hp -= dmg;
      if (m.hp <= 0) { killMonster(m, 'comes apart in the light, mid-stride'); continue; }
      if (br > def.tolerance && m.type !== 'hulk') m.fleeing = true;
    } else if (m.hp < def.hp + (yearNum() >= 20 ? 2 : 0)) {
      m.hp = Math.min(def.hp + (yearNum() >= 20 ? 2 : 0), m.hp + 0.5 * dtDays);   // the dark knits them back together
    }
    if (ph !== 'night' && G.fire.lit && !siege && !relentless && m.type !== 'hulk') m.fleeing = true;
    // skitters cannot stand being smelled by the dog
    if (G.pet && m.type === 'skitter' && !m.fleeing && Math.hypot(m.x - G.pet.x, m.y - G.pet.y) < 5) {
      m.fleeing = true;
      sfx('growl');
    }
    // pick a destination
=======
  if (ph === 'night' || !G.fire.lit || siege) {
    let expected = monsterPressure() * dtDays / 0.4;
    if (siege && ph === 'night') expected += dtDays * (10 + pop() / 2) / 0.4;
    if (Math.random() < expected && G.monsters.length < (siege ? 30 : 3 + Math.floor(yearNum() / 2))) {
      spawnMonster(yearNum() >= 4 && Math.random() < Math.min(0.25, (yearNum() - 3) * 0.04));
    }
  }
  const fear = G.fire.lit ? fearRadius() : 0;
  for (const m of G.monsters) {
    if (ph !== 'night' && G.fire.lit && !siege) m.fleeing = true;
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    let tx, ty;
    if (m.fleeing) {
      const a = Math.atan2(m.y - HY, m.x - HX);
      tx = m.x + Math.cos(a) * 6; ty = m.y + Math.sin(a) * 6;
<<<<<<< HEAD
    } else if (m.type === 'hulk') {
      // it hunts people, and only people
=======
    } else if (m.bold && (evActive('howling') || G.fire.fuel < 50)) {
      // bold ones come for the buildings — when the night howls or the fire sinks
      let tb = null, td = 1e9;
      for (const b of G.builds) {
        if (b.type === 'palisade' || !b.built) continue;
        const d = Math.hypot(b.x + 0.5 - m.x, b.y + 0.5 - m.y);
        if (d < td) { td = d; tb = b; }
      }
      if (tb) { tx = tb.x + 0.5; ty = tb.y + 0.5; m.targetB = tb.id; }
      else { tx = HX + 0.5; ty = HY + 0.5; }
    } else {
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
      let prey = null, pd = 1e9;
      for (const v of G.villagers) {
        const d = Math.hypot(v.x - m.x, v.y - m.y);
        if (d < pd) { pd = d; prey = v; }
      }
      tx = prey ? prey.x : HX + 0.5; ty = prey ? prey.y : HY + 0.5;
<<<<<<< HEAD
    } else if (m.type === 'breaker') {
      // it breaks what you built
      if (m.targetB == null || !byId(m.targetB) || byId(m.targetB).ruined || !byId(m.targetB).built) {
        let tb = null, td = 1e9;
        for (const b of G.builds) {
          if (!b.built || b.ruined || b.type === 'palisade') continue;
          const d = Math.hypot(b.x + 0.5 - m.x, b.y + 0.5 - m.y);
          if (d < td) { td = d; tb = b; }
        }
        m.targetB = tb ? tb.id : null;
      }
      const b = m.targetB != null ? byId(m.targetB) : null;
      tx = b ? b.x + 0.5 : HX + 0.5; ty = b ? b.y + 0.5 : HY + 0.5;
    } else {
      // skitter: stragglers in the dark, otherwise the stores
      if (m.loot) { m.fleeing = true; tx = m.x; ty = m.y; }
      else {
        let prey = null, pd = 12;
        for (const v of G.villagers) {
          if (isLit(Math.floor(v.x), Math.floor(v.y))) continue;
          const d = Math.hypot(v.x - m.x, v.y - m.y);
          if (d < pd) { pd = d; prey = v; }
        }
        if (prey) { tx = prey.x; ty = prey.y; }
        else {
          let sb = null, sd = 1e9;
          for (const b of G.builds) {
            if (b.type !== 'storehouse' || !b.built || b.ruined) continue;
            const d = Math.hypot(b.x - m.x, b.y - m.y);
            if (d < sd) { sd = d; sb = b; }
          }
          tx = sb ? sb.x + 0.5 : HX + 0.5; ty = sb ? sb.y + 0.5 : HY + 0.5;
        }
      }
    }
    // move — shying from any brightness it cannot bear
    let vx = tx - m.x, vy = ty - m.y;
    const vd = Math.hypot(vx, vy) || 1;
    const step = def.speed * dtDays;
    let nx = m.x + vx / vd * step, ny = m.y + vy / vd * step;
    if (!m.fleeing && brightnessAt(nx, ny) > def.tolerance && brightnessAt(m.x, m.y) <= def.tolerance) {
      const side = Math.random() < 0.5 ? 1 : -1;
      nx = m.x + (-vy / vd) * step * side; ny = m.y + (vx / vd) * step * side;
      if (brightnessAt(nx, ny) > def.tolerance) { nx = m.x; ny = m.y; }
    }
=======
    }
    const dh = Math.hypot(m.x - HX - 0.5, m.y - HY - 0.5);
    let vx = tx - m.x, vy = ty - m.y;
    const vd = Math.hypot(vx, vy) || 1;
    let step = 100 * dtDays;
    const myFear = m.bold ? fear * 0.5 : fear;
    if (!m.fleeing && dh - step < myFear) step = Math.max(0, dh - myFear);
    let nx = m.x + vx / vd * step, ny = m.y + vy / vd * step;
    // palisades and walls: the dark must walk around
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    if (OCC[idx(clamp(Math.floor(nx), 0, W - 1), clamp(Math.floor(ny), 0, H - 1))]) {
      const side = Math.random() < 0.5 ? 1 : -1;
      nx = m.x + (-vy / vd) * step * side; ny = m.y + (vx / vd) * step * side;
      if (OCC[idx(clamp(Math.floor(nx), 0, W - 1), clamp(Math.floor(ny), 0, H - 1))]) { nx = m.x; ny = m.y; }
    }
<<<<<<< HEAD
    m.x = clamp(nx, 1, W - 2); m.y = clamp(ny, 1, H - 2);
    if (m.fleeing) {
      discover('whyfire');
      if (Math.hypot(m.x - HX, m.y - HY) > effLight() + 10) { m.dead = true; dropLoot(m); }
      continue;
    }
    // do harm
    if (m.cd > 0) continue;
    let acted = false;
    for (const v of G.villagers) {
      if (Math.hypot(v.x - m.x, v.y - m.y) > 0.9) continue;
      // four walls keep the dark out — until the walls come down
      if (v.state === 'sleep' && v.home != null) {
        const hb = byId(v.home);
        if (hb && hb.built && !hb.ruined) continue;
      }
      const role = roleOf(v);
      if (role && role !== 'scout') {
        // it claws back at whoever holds the line
        if (MONSTER_TYPES[m.type].aggressive || m.type === 'skitter') {
          unitHp(v);
          v.hp -= 1;
          m.lastHarm = G.day;
          if (v.hp <= 0) kill(v, 'fell to the dark, weapon in hand', 'monster-loss');
          if (m.type === 'skitter') m.fleeing = true;
          acted = true;
        }
        break;
      } else if (!isLit(Math.floor(v.x), Math.floor(v.y))) {
        kill(v, 'was eaten by the dark, beyond the light', 'monster-loss');
        m.lastHarm = G.day;
        if (m.type !== 'hulk') m.fleeing = true;
        acted = true;
        break;
      } else if (m.type === 'hulk') {
        kill(v, 'was struck down by a hulking shadow', 'monster-loss');
        m.lastHarm = G.day;
        acted = true;
        break;
      }
    }
    if (!acted) {
      // claws on timber — or quick hands in the stores
      let adjB = null, ad = 1.25;
      for (const b of G.builds) {
        if (!b.built || b.ruined) continue;
        const d = Math.hypot(b.x + 0.5 - m.x, b.y + 0.5 - m.y);
        if (d < ad) { ad = d; adjB = b; }
      }
      const nearHearth = Math.hypot(m.x - HX - 0.5, m.y - HY - 0.5) < 2.2;
      if (m.type === 'skitter' && !m.loot && ((adjB && adjB.type === 'storehouse') || nearHearth)) {
        const kind = G.res.food > G.res.wood ? 'food' : 'wood';
        const amt = Math.min(Math.floor(G.res[kind]), 6 + Math.floor(Math.random() * 5));
        if (amt > 0) {
          G.res[kind] -= amt;
          m.loot = { kind, amt };
          m.lastHarm = G.day;
          log(`Something darts off with an armful of ${kind}. Bring it down before it reaches the deep dark, and it drops everything.`, '', [Math.floor(m.x), Math.floor(m.y)]);
          m.fleeing = true;
          acted = true;
        }
      } else if (adjB && m.type !== 'skitter') {
        adjB.hp = (adjB.hp == null ? B_HP : adjB.hp) - 1;
        m.lastHarm = G.day;
        sfx('thud');
        FX.push({ kind: 'hit', x: adjB.x + 0.5, y: adjB.y + 0.5, t: 0 });
        if (adjB.hp <= 0) {
          ruinBuilding(adjB);
          m.targetB = null;
          if (m.type !== 'hulk') m.fleeing = true;
        }
        acted = true;
        m.cd = 0.3;                        // tearing timber is slow work — and easily interrupted
        continue;
      }
    }
    if (acted) m.cd = 0.15;
  }
  for (const v of G.villagers) if (v.engaged && !G.monsters.some(m => !m.dead && Math.hypot(v.x - m.x, v.y - m.y) < 14)) v.engaged = false;
  for (const m of G.monsters) if (m.dead) dropLoot(m);
  G.monsters = G.monsters.filter(m => !m.dead);
  for (const f of FX) f.t += dtDays * 8;
  FX = FX.filter(f => f.t < 1.4);
=======
    // braziers hold them off
    if (!m.fleeing && !m.bold && nearTorch(nx, ny, TORCH_R * 0.7)) { nx = m.x; ny = m.y; }
    m.x = clamp(nx, 1, W - 2); m.y = clamp(ny, 1, H - 2);
    // the dog smells them long before anyone sees them — and they hate being smelled
    if (G.pet && !m.fleeing && Math.hypot(m.x - G.pet.x, m.y - G.pet.y) < 5) {
      m.fleeing = true;
      if (Math.random() < 0.3) log(`${G.pet.name} stands stiff-legged at the dark, making a sound you have never heard ${G.pet.kind === 'dog' ? 'a dog' : 'a cat'} make. Something retreats.`, '', [Math.floor(G.pet.x), Math.floor(G.pet.y)]);
      sfx('growl');
    }

    if (m.fleeing) {
      discover('whyfire');                    // watching one recoil from flame teaches you something
      if (dh > effLight() + 9) m.dead = true;
      continue;
    }

    // militia intercept
    let guard = null, gd = 1e9;
    for (const v of G.villagers) {
      if (!isMilitia(v)) continue;
      const d = Math.hypot(v.x - m.x, v.y - m.y);
      if (d < gd) { gd = d; guard = v; }
    }
    let reach = has('spears') ? 1.6 : 0.9;
    if (hasRelic('whistle')) reach += 0.5;
    if (G.leader && G.leader.focus === 'warden') reach += 0.5;
    if (G.leader && G.leader.focus === 'mason') reach -= 0.3;
    if (guard && gd < 9) {
      guard.engaged = true;
      setDest(guard, m.x, m.y, { dark: true });
      follow(guard, dtDays, 150, false);
      if (Math.hypot(guard.x - m.x, guard.y - m.y) < reach) {
        m.dead = true;
        guard.engaged = false;
        log(`${guard.name} ${guard.family} drove a thing back into the mist.`, '', [Math.floor(m.x), Math.floor(m.y)]);
        discover('monster-slain');
        monsterLoot(m.x, m.y);
        if (G.siege && !G.siege.done) G.siege.kills = (G.siege.kills || 0) + 1;
        const safe = has('spears') || (G.form && G.form.id === 'keep');
        const packed = G.monsters.filter(o => !o.dead && Math.hypot(o.x - m.x, o.y - m.y) < 4).length;
        if (!safe && packed >= 2 && Math.random() < 0.3) kill(guard, 'fell holding the line', 'monster-loss');
        continue;
      }
    }
    // it reaches its target
    if (m.bold && m.targetB != null) {
      const b = byId(m.targetB);
      if (b && Math.hypot(b.x + 0.5 - m.x, b.y + 0.5 - m.y) < 1.1) {
        b.built = false; b.progress = BUILDS[b.type].work * 0.4;
        rebuildOcc();
        log(`💥 Something tore through the ${BUILDS[b.type].name} in the night.`, 'death', [b.x, b.y]);
        discover('raid', [b.x, b.y]);
        G.homesDirty = true;
        m.fleeing = true;
        continue;
      }
    }
    for (const v of G.villagers) {
      if (isMilitia(v)) continue;
      if (Math.hypot(v.x - m.x, v.y - m.y) < 0.8) {
        if (Math.random() < 0.3) kill(v, 'was taken by something in the dark', 'monster-loss');
        else {
          G.res.food = Math.max(0, G.res.food - 8);
          log('Something snatched at the stores and fled into the dark.', '', [Math.floor(m.x), Math.floor(m.y)]);
        }
        m.fleeing = true;
        break;
      }
    }
  }
  for (const v of G.villagers) if (v.engaged && !G.monsters.some(m => !m.dead && Math.hypot(v.x - m.x, v.y - m.y) < 10)) v.engaged = false;
  G.monsters = G.monsters.filter(m => !m.dead);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b

  // the Longest Night: survive until dawn with the fire lit
  if (siege && ph === 'day' && G.day > G.siege.starts + 0.5) {
    if (G.fire.lit) {
      G.siege.done = true;
      G.won = true;
      log('🌅 DAWN. The fire stands. The dark recedes — further than it has ever gone — and does not return the next night, or the next. They will tell of this village in lands you will never see.', 'ember', [HX, HY]);
      sfx('win');
      showVictory();
    } else {
      log('The longest night is not over. It will come again at dusk — keep the fire alive this time.', 'death', [HX, HY]);
      G.siege.starts = Math.floor(G.day) + 0.84;
    }
  }
}

/* ---------- relics ---------- */
function grantRelic(loc) {
  const pool = RELICS.filter(r => !G.relics.includes(r.id));
  if (!pool.length) return;
  const r = choice(pool);
  G.relics.push(r.id);
  discover('relics', loc);
  log(`🏺 A RELIC — ${r.name}. ${r.desc} The whole village comes to touch it.`, 'ember', loc);
  sfx('chime');
  uiDirty = true;
}

/* ---------- trader (comes from the dark, leaves by another road) ---------- */
function traderSpot() { return [HX + 3, HY]; }
function edgePoint() {
  const side = Math.floor(Math.random() * 4);
  const t = 8 + Math.floor(Math.random() * (W - 16));
  return side === 0 ? [t, 1] : side === 1 ? [t, H - 2] : side === 2 ? [1, t] : [W - 2, t];
}
function updateTrader(dtDays) {
  const T = G.trader;
  const speed = 110 * dtDays;
  if (T.state === 'away') {
    if (G.day >= T.next) {
      const [ex, ey] = edgePoint();
      T.from = [ex, ey];
      T.x = ex + 0.5; T.y = ey + 0.5;
      const [sx, sy] = traderSpot();
      T.path = findPath(ex, ey, sx, sy, { dark: true });
      T.pi = 0;
      T.state = 'coming';
      log('A lantern sways in the dark beyond the light. Something is coming up the old road.', '', [ex, ey]);
    }
    return;
  }
  const walk = (destX, destY) => {
    let budget = speed;
    while (budget > 0) {
      let tx, ty;
      if (T.path && T.pi < T.path.length) { tx = T.path[T.pi][0] + 0.5; ty = T.path[T.pi][1] + 0.5; }
      else { tx = destX; ty = destY; }
      const dx = tx - T.x, dy = ty - T.y;
      const dd = Math.hypot(dx, dy);
      if (dd < 0.1) {
        if (T.path && T.pi < T.path.length) { T.pi++; continue; }
        return true;
      }
      const st = Math.min(dd, budget);
      T.x += dx / dd * st; T.y += dy / dd * st;
      budget -= st;
      if (st >= dd) continue;
      break;
    }
    return false;
  };
  if (T.state === 'coming') {
    const [sx, sy] = traderSpot();
    if (walk(sx + 0.5, sy + 0.5)) {
      T.state = 'here';
      T.leaves = G.day + 4;
      T.deals = rollDeals();
      log('🛞 The trader\'s wagon creaks to a stop by the fire. The horse steams. Deals are spread on a blanket.', '', [sx, sy]);
      discover('trader');
      uiDirty = true;
    }
  } else if (T.state === 'here') {
    if (G.day >= T.leaves) {
      let [ex, ey] = edgePoint();
      let guard = 0;
      while (T.from && Math.hypot(ex - T.from[0], ey - T.from[1]) < 30 && guard++ < 10) [ex, ey] = edgePoint();
      T.path = findPath(Math.floor(T.x), Math.floor(T.y), ex, ey, { dark: true });
      T.pi = 0; T.dest = [ex, ey];
      T.state = 'leaving';
      log('The trader packs up and leaves — by a different road than the one that brought him.', '', [Math.floor(T.x), Math.floor(T.y)]);
      uiDirty = true;
    }
  } else if (T.state === 'leaving') {
    if (walk(T.dest[0] + 0.5, T.dest[1] + 0.5)) {
      T.state = 'away';
      // the wagon comes round once a season, snow or no snow
      T.next = G.day + DAYS_PER_SEASON * (0.7 + Math.random() * 0.5);
    }
  }
}
/* the trader's appetites ebb and flow: flood him with wood and wood is worth less;
   starve him of food and he pays dearly for it */
const TRADE_GOODS = {
  food:  { unit: 20, base: 5 },
  wood:  { unit: 20, base: 5 },
  stone: { unit: 10, base: 6 },
  ember: { unit: 1,  base: 11 },
};
function tradeFair() {
  let f = hasRelic('scale') ? 1.2 : 1;
  if (G.leader && G.leader.focus === 'broker') f *= 1.15;
  return f;
}
function market(res) {
  if (!G.trader.market) G.trader.market = {};
  if (G.trader.market[res] == null) G.trader.market[res] = 1;
  return G.trader.market[res];
}
<<<<<<< HEAD
/* the trader reads your purse: the deeper it looks, the dearer his goods */
function wealthTax() { return 1 + Math.max(0, G.res.coin - 70) / 80; }
function sellPrice(res) { return Math.max(1, Math.round(TRADE_GOODS[res].base * market(res) * tradeFair() * (G.trader.jit && G.trader.jit[res] || 1))); }
function buyPrice(res) {
  if (res === 'ember') {
    // one per visit, and each one ever bought makes the next dearer
    return Math.max(8, Math.round((14 + (G.embersBought || 0) * 6) * market('ember') / tradeFair() * wealthTax() * (G.trader.jit && G.trader.jit.ember || 1)));
  }
  return Math.max(2, Math.round(TRADE_GOODS[res].base * 1.5 * market(res) / tradeFair() * wealthTax() * (G.trader.jit && G.trader.jit[res] || 1)));
}
function rollDeals() {
  G.trader.jit = {};
  for (const r of Object.keys(TRADE_GOODS)) G.trader.jit[r] = 0.85 + Math.random() * 0.3;
  G.trader.emberSold = false;
  // sometimes the wagon carries something older than coin
  const unowned = RELICS.filter(r => !G.relics.includes(r.id));
  G.trader.relic = unowned.length && Math.random() < 0.4 ? choice(unowned).id : null;
  G.trader.relicPrice = Math.round((55 + G.relics.length * 30) / tradeFair());
  return true;
=======
function sellPrice(res) { return Math.max(1, Math.round(TRADE_GOODS[res].base * market(res) * tradeFair() * (G.trader.jit && G.trader.jit[res] || 1))); }
function buyPrice(res) { return Math.max(2, Math.round(TRADE_GOODS[res].base * 1.5 * market(res) / tradeFair() * (G.trader.jit && G.trader.jit[res] || 1))); }
function rollDeals() {
  G.trader.jit = {};
  for (const r of Object.keys(TRADE_GOODS)) G.trader.jit[r] = 0.85 + Math.random() * 0.3;
  return true;   // the menu is built live from prices now
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
}
function doTrade(res, dir) {
  const g = TRADE_GOODS[res];
  if (!g) {
    if (res === 'charm' && dir === 'buy') {
      const cost = Math.round(40 / tradeFair());
      if (G.res.coin < cost) return;
      G.res.coin -= cost;
      showGiftModal();
      sfx('click'); uiDirty = true;
<<<<<<< HEAD
    } else if (res === 'relic' && dir === 'buy' && G.trader.relic) {
      if (G.res.coin < G.trader.relicPrice) return;
      G.res.coin -= G.trader.relicPrice;
      const r = RELICS.find(x => x.id === G.trader.relic);
      G.relics.push(r.id);
      G.trader.relic = null;
      discover('relics');
      log(`🏺 ${r.name} changes hands, wrapped in oilcloth. ${r.desc} The trader will not say where he got it.`, 'ember', [Math.floor(G.trader.x), Math.floor(G.trader.y)]);
      sfx('chime');
      uiDirty = true;
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    }
    return;
  }
  if (dir === 'sell') {
    if (G.res[res] < g.unit) return;
    G.res[res] -= g.unit;
    G.flow[res + 'Out'] = (G.flow[res + 'Out'] || 0) + g.unit;
    addRes('coin', sellPrice(res));
<<<<<<< HEAD
    G.trader.market[res] = Math.max(0.35, market(res) * 0.88);   // you've glutted him
  } else {
    if (res === 'ember' && G.trader.emberSold) return;           // he carries only the one
=======
    G.trader.market[res] = Math.max(0.4, market(res) * 0.91);    // you've glutted him
  } else {
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    const cost = buyPrice(res);
    if (G.res.coin < cost) return;
    G.res.coin -= cost;
    addRes(res, g.unit);
<<<<<<< HEAD
    if (res === 'ember') { G.trader.emberSold = true; G.embersBought = (G.embersBought || 0) + 1; }
    G.trader.market[res] = Math.min(3, market(res) * 1.12);      // scarce things grow dear, fast
=======
    G.trader.market[res] = Math.min(2.2, market(res) * 1.07);    // scarce things grow dear
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  }
  discover('coins');
  sfx('click');
  uiDirty = true;
}

/* ---------- families ---------- */
function familyStep() {
  if (phase(G.day % 1) !== 'evening') return;
  if (Math.random() > 0.012) return;
  const single = adults().filter(v => v.spouse == null && v.age < ELDER_AGE && v.state === 'gather');
  if (single.length < 2) return;
  const a = choice(single);
  const b = choice(single.filter(v => v !== a && v.family !== a.family && v.sex !== a.sex));
  if (!b) return;
  a.spouse = b.id; b.spouse = a.id;
  b.family = a.family;
  (a.sex === 'f' ? a : b).bearer = true;
  log(`💞 ${a.name} and ${b.name} now share the name ${a.family}.`, '', [HX, HY]);
  discover('family');
  G.homesDirty = true;
}
function conceptions(dtDays) {
  // happiness and full stores fill cradles; nursing mothers fill them again
  const fd = G.res.food / Math.max(1, pop() * EAT);
  let base = G.happy >= 65 && fd > 10 ? 0.034 : G.happy >= 50 && fd > 5 ? 0.018 : G.happy >= 35 ? 0.006 : 0.001;
  if (hasRelic('doll')) base *= 1.4;
  for (const v of G.villagers) {
    if (!v.bearer || v.pregnant > 0 || v.spouse == null || v.home == null) continue;
    const s = G.villagers.find(o => o.id === v.spouse);
    if (!s || s.home !== v.home) continue;
    const housed = G.villagers.filter(o => o.home === v.home).length;
    const cap = cabinCap(byId(v.home) || { lvl: 1 });
    if (housed >= cap) continue;
    let p = base * (nursing(v) ? 1.5 : 1);
    if (Math.random() < p * dtDays) {
      v.pregnant = 18;
      discover('mothers');
      log(`${v.name} ${v.family} is with child.`, '', v.home != null && byId(v.home) ? [byId(v.home).x, byId(v.home).y] : null);
    }
  }
}
function gestate(dtDays) {
  for (const v of G.villagers) {
    if (v.pregnant <= 0) continue;
    v.pregnant -= dtDays;
    if (v.pregnant <= 0) {
      v.pregnant = 0;
      const s = G.villagers.find(o => o.id === v.spouse);
      const apt = {};
      for (const j of JOB_TYPES) apt[j] = +Math.min(1.5, Math.max(v.apt[j], s ? s.apt[j] : 0)).toFixed(2);
      for (const p of [v, s]) {
        if (!p) continue;
        const pb = p.job != null ? byId(p.job) : null;
        if (pb && apt[pb.type]) apt[pb.type] = +Math.min(1.5, apt[pb.type] * 1.08).toFixed(2);
      }
      const c = spawnVillager({ name: choice(NAMES), family: v.family, age: 0, apt, mom: v.id });
      const home = v.home != null ? byId(v.home) : null;
      if (home) { c.x = home.x + 0.5; c.y = home.y + 0.5; c.home = v.home; }
      log(`👶 A child, ${c.name} ${c.family}, was born under the ${v.family} roof.`, '', home ? [home.x, home.y] : null);
      discover('children');
      sfx('chime');
    }
  }
}

/* ---------- visitors & debts ---------- */
function visitorEvent() {
  const roll = Math.random();
  if (roll < 0.30) { // someone joins outright
    const kind = choice(['warrior', 'gardener', 'banished']);
    if (kind === 'warrior') {
      const v = spawnVillager({ age: 6 + Math.random() * 6 });
      v.apt.watch = 1.5;
      log(`⚔️ A scarred traveller with a wolf-fang necklace asks to stay. ${v.name} ${v.family} fights like ten.`, 'disc', [Math.floor(v.x), Math.floor(v.y)]);
    } else if (kind === 'gardener') {
      const v = spawnVillager({ age: 6 + Math.random() * 6, trait: 'gardener' });
      log(`🌱 A quiet woman who coaxes food from bare dirt settles in. ${v.name} ${v.family} feeds herself and more, wherever she stands.`, 'disc', [Math.floor(v.x), Math.floor(v.y)]);
    } else {
      const v = spawnVillager();
      log(`${v.name} ${v.family}, banished from a distant city for reasons unsaid, was drawn in by the light.`, '', [Math.floor(v.x), Math.floor(v.y)]);
    }
    discover('visitors');
    return;
  }
  if (roll < 0.55) { // the witch
    discover('visitors');
    showChoice('🌙 A Witch at the Edge of the Light',
      'She does not come closer. "A grand offer," she calls. "Your stores for my sparks. Fair — mostly."',
      [
        { n: 'Trade 30 food + 10 wood', d: 'For 4 embers. Probably.', fn() {
          if (G.res.food < 30 || G.res.wood < 10) { log('The witch sees your thin stores and laughs herself back into the dark.'); return; }
          G.res.food -= 30; G.res.wood -= 10;
          if (Math.random() < 0.2) log('🃏 The pouch she threw holds ash and a beetle. The dark laughs all night.', 'death');
          else { addRes('ember', 4); log('The witch keeps her word, this time. Four embers, still warm.', 'ember'); }
        } },
        { n: 'Turn her away', d: 'The dark keeps its own.', fn() { log('The witch shrugs and folds into the mist. You feel watched all night.'); } },
      ]);
    return;
  }
  if (roll < 0.80) { // the beggar
    discover('visitors');
    showChoice('🥣 A Beggar at the Fire',
      'Thin as winter, hands out. "Anything. Anything at all."',
      [
        { n: 'Feed them (8 food)', d: 'Kindness is a seed.', fn() {
          if (G.res.food < 8) { log('You have nothing to spare. The beggar nods like they expected that, and goes.'); return; }
          G.res.food -= 8;
          G.debts.push({ kind: 'beggar', due: G.day + 96 + Math.random() * 96 });
          log('The beggar eats like it is the first meal of a new life. "I will remember this," they say. And they will.');
        } },
        { n: 'Turn them away', d: 'The stores are for the village.', fn() { log('The beggar leaves without a word. The fire pops, disapproving.'); } },
      ]);
    return;
  }
  // the injured
  discover('visitors');
  showChoice('🩸 Wounded on the Road',
    'Carried by the last of their strength, torn by something with claws. They cannot work — perhaps for a year. They will still eat.',
    [
      { n: 'Take them in', d: 'A bed, a bowl, and time.', fn() {
        const v = spawnVillager({ age: 5 + Math.random() * 8 });
        v.injured = G.day + 48;
        log(`${v.name} ${v.family} is carried to a bed by the fire. They will heal — slowly — and they will not forget.`);
        G.debts.push({ kind: 'healed', due: v.injured + 1, who: v.id });
      } },
      { n: 'Turn them away', d: 'Hard times make hard people.', fn() {
        log('You point back down the road. The village sleeps badly that night.', 'death');
        G.gloom = (G.gloom || 0) + 2;
      } },
    ]);
}
function processDebts() {
  for (const d of [...G.debts]) {
    if (G.day < d.due) continue;
    G.debts = G.debts.filter(x => x !== d);
    if (d.kind === 'beggar') {
<<<<<<< HEAD
      addRes('coin', 30);
      log('💰 A rider in fine clothes dismounts and bows. "Years ago, you fed a beggar. The beggar remembers." A purse of 30 coins — and friends in far places.', 'ember', [HX, HY]);
=======
      addRes('coin', 25);
      log('💰 A rider in fine clothes dismounts and bows. "Years ago, you fed a beggar. The beggar remembers." A purse of 25 coins — and friends in far places.', 'ember', [HX, HY]);
      if (Math.random() < 0.3) grantRelic([HX, HY]);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
    } else if (d.kind === 'healed') {
      const v = G.villagers.find(x => x.id === d.who);
      if (v) {
        for (const j of JOB_TYPES) v.apt[j] = +Math.min(1.5, v.apt[j] + 0.1).toFixed(2);
        log(`${v.name} ${v.family} stands straight for the first time in a year — and works like someone repaying a debt.`, 'disc');
      }
    }
  }
}

/* ---------- the village animal ---------- */
const PET_NAMES = { dog: ['Ash', 'Biscuit', 'Rook', 'Patch', 'Cinder', 'Bramble'], cat: ['Soot', 'Mouser', 'Wick', 'Smoke', 'Tansy', 'Moth'] };
const PET_COATS = ['#7a5a38', '#4a4038', '#8a8278', '#2e2a26', '#a08a60', '#665a50', '#8a6a4a'];
function offerPet() {
  const kind = Math.random() < 0.6 ? 'dog' : 'cat';
  const name = choice(PET_NAMES[kind]);
  showChoice(kind === 'dog' ? '🐕 Something at the Edge of the Light' : '🐈 Something at the Edge of the Light',
    kind === 'dog'
      ? 'A thin dog circles the fire at a respectful distance, ribs like fence rails, eyes like it remembers people being kind once. It growls — not at you. At the dark.'
      : 'A cat appears on the woodpile as if it had always owned it, thin as a whisper. It stares into the dark and the dark, oddly, stares away first.',
    [
      { n: `Feed it (8 food)`, d: 'It eats little. It hates the things in the dark more than you do.', fn() {
        if (G.res.food < 8) { log('You have nothing to spare. It watches you a while, then is gone.'); G.flags.petOffered = false; return; }
        G.res.food -= 8;
        G.pet = {
          kind, name,
          c1: choice(PET_COATS), c2: choice(PET_COATS),
          x: HX + 1.5, y: HY + 1.5, dx: null, dy: null, wait: 0, hungry: 0,
        };
        log(`${kind === 'dog' ? '🐕' : '🐈'} ${name} stays. The village has a ${kind} now — and the dark has one more thing to think about.`, 'disc', [HX, HY]);
        discover('pet');
        sfx('chime');
      } },
      { n: 'Shoo it off', d: 'Another mouth is another mouth.', fn() { log('It melts back into the treeline. Some nights you still see its eyes — the warm kind.'); } },
    ]);
}
function updatePet(dtDays) {
  const p = G.pet;
  if (!p) return;
  // it eats a little, quietly, from the stores
  if (G.res.food > 0.5) { G.res.food -= 0.3 * dtDays; p.hungry = 0; }
  else p.hungry = (p.hungry || 0) + dtDays;
  // it trails the children, the fire, whoever is interesting
  p.wait -= dtDays;
  if (p.wait <= 0 || p.dx == null) {
    p.wait = 0.05 + Math.random() * 0.12;
    const kids2 = G.villagers.filter(v => v.age < ADULT_AGE);
    const target = kids2.length && Math.random() < 0.5 ? choice(kids2)
      : Math.random() < 0.5 && pop() ? choice(G.villagers) : null;
    const tx = target ? target.x : HX + 0.5, ty = target ? target.y : HY + 0.5;
    p.dx = clamp(tx + (Math.random() - 0.5) * 3, 2, W - 2);
    p.dy = clamp(ty + (Math.random() - 0.5) * 3, 2, H - 2);
  }
  const dx = p.dx - p.x, dy = p.dy - p.y;
  const dd = Math.hypot(dx, dy);
  if (dd > 0.15) {
    const step = Math.min(dd, 160 * dtDays);
    const nx = p.x + dx / dd * step, ny = p.y + dy / dd * step;
    if (G.tiles[idx(clamp(Math.floor(nx), 0, W - 1), clamp(Math.floor(ny), 0, H - 1))].t !== 'water' || isWinter()) { p.x = nx; p.y = ny; }
    else { p.dx = null; }
  }
}
function updatePetDaily() {
  const p = G.pet;
  if (!p) return;
  if ((p.hungry || 0) > 3) {
    log(`${p.kind === 'dog' ? '🐕' : '🐈'} ${p.name} waited at the empty stores for three days, then walked into the dark without looking back.`, 'death', [Math.floor(p.x), Math.floor(p.y)]);
    G.pet = null;
  }
}

/* ---------- the old world, half-swallowed: landmark discovery ---------- */
function checkLandmarks() {
  const want = [['road', 'lm_road'], ['pylon', 'lm_pylon'], ['derrick', 'lm_derrick'], ['hulk', 'lm_hulk']];
  if (want.every(([, l]) => G.lore.includes(l) || G.flags['no_' + l])) return;
  for (const [tt, loreId] of want) {
    if (G.lore.includes(loreId) || G.flags['no_' + loreId]) continue;
    let found = null;
    for (let y = 0; y < H && !found; y++) for (let x = 0; x < W; x++) {
      if (G.tiles[idx(x, y)].t === tt) { found = [x, y]; break; }
    }
    if (!found) { G.flags['no_' + loreId] = true; continue; }    // not on this map at all
<<<<<<< HEAD
    if (isLit(found[0], found[1]) || isScouted(found[0], found[1], visionSources())) discover(loreId, found);
=======
    if (isLit(found[0], found[1])) discover(loreId, found);
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  }
}

/* ---------- happiness, seasons, years, days ---------- */
function updateHappiness() {
  if (pop() === 0) { G.happy = 50; return; }
  let h = 50;
  const eatAvg = EAT * (has('heartyfolk') ? 0.75 : 1);
  const foodDays = G.res.food / (pop() * eatAvg);
  h += Math.min(12, foodDays * 1.2);
  if (G.res.food <= 0.01) h -= 25;
  h -= Math.min(15, (G.crowded || 0) * 3);          // families without their own roof
  h -= Math.min(16, (G.homeless || 0) * 4);         // sleeping on cold ground
  if (!G.fire.lit) h -= 30;
  else if (G.fire.fuel < 25) h -= 10;
  h += Math.min(20, (G.hearth.level - 1) * 2);
  h += G.builds.filter(b => b.type === 'shrine' && b.built).length * 8;
  if (has('festival')) h += 10;
  if (G.form && G.form.id === 'temple') h += G.form.tier > 1 ? 10 : 6;
  if (G.leader && G.leader.focus === 'keeper') h += 6;
  if (G.leader && G.leader.focus === 'broker') h -= 4;
  if (G.pet) h += 4;                                   // someone warm who asks for nothing
  if (evActive('minstrel')) h += 10;
  if (evActive('howling')) h -= 6;
  if (G.monsters.length) h -= 4;
  if (G.day < (G.mourning || 0)) h -= 8;
  G.happy = clamp(Math.round(h), 0, 100);
}

function onNewSeason(s, dayIndex) {
  log(`— ${SEASONS[s]}, Year ${Math.floor(dayIndex / DAYS_PER_YEAR) + 1} —`);
  if (s === 3) {
    discover('winter');
    discover('ice');
    for (const b of G.builds) {
      if (b.type !== 'farm') continue;
      if ((b.phase === 'grow' || (b.phase === 'harvest' && b.crop > 4)) && !has('frostgrain')) {
        log('Frost took the field overnight.', '', [b.x, b.y]);
        b.crop = 0;
      }
      if (!(has('frostgrain') && b.phase === 'harvest' && b.crop > 0)) { b.phase = 'fallow'; b.growth = 0; b.prog = 0; }
    }
  }
  // mercy of the flame: if no ember source is left within reach and the stores are dry,
  // the fire itself spits out a living coal once in a while. Slow, but never stuck.
  if (G.res.ember < hearthCost() && G.hearth.level < 8 && !G.builds.some(b => b.type === 'kiln' && b.built)) {
    let sources = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = tile(x, y);
      if ((t.t === 'ancient' || t.t === 'ruin' || t.t === 'derrick') && t.amt > 0 && isLit(x, y)) sources++;
    }
    if (sources === 0) {
      addRes('ember', 1);
      log('✨ The fire spits out a living coal that does not cool. The old folk say it does this when it knows you have nowhere else to look.', 'ember', [HX, HY]);
    }
  }
  // the village dog (or cat) finds you, once, when the village is young
  if (!G.pet && !G.flags.petOffered && yearNum() >= 2) {
    G.flags.petOffered = true;
    offerPet();
  } else if (yearNum() >= 2 && Math.random() < 0.25) visitorEvent();
  else if (Math.random() < 0.30) {
    const pool = EVENTS.filter(e => e.seasons.includes(s));
    if (pool.length) {
      const ev = choice(pool);
      if (ev.apply) ev.apply();
      if (ev.dur) G.event = { id: ev.id, until: dayIndex + DAYS_PER_SEASON };
      log(ev.msg);
    }
  }
}
function onNewYear() {
  if (has('tithe')) {
    const t = Math.floor(pop() / 6);
    if (t > 0) { addRes('ember', t); log(`Ember Tithe: the village gathers for the fire.`); }
  }
  let arrivals = 0;
  if (G.happy >= 40) arrivals = 1 + Math.floor((G.hearth.level - 1) / 2) + (G.happy >= 65 ? 1 : 0);
  else if (pop() < 6 && G.happy >= 20) arrivals = 1;
  if (has('beacon')) arrivals += 1;
  if (G.form && G.form.id === 'hall') arrivals += 1;
  const free = housingCap() - pop();
  arrivals = Math.min(arrivals, Math.max(0, free));
  if (pop() < 3) arrivals = Math.max(arrivals, 2);
  for (let i = 0; i < arrivals; i++) {
    const v = spawnVillager();
    // sometimes the road brings two together
    if (i + 1 < arrivals && Math.random() < 0.4) {
      i++;
      const s = spawnVillager({ family: v.family, sex: v.sex === 'm' ? 'f' : 'm' });
      v.spouse = s.id; s.spouse = v.id;
      (v.sex === 'f' ? v : s).bearer = true;
      log(`${v.name} and ${s.name} ${v.family}, wed on the road, were drawn in by the light.`, '', [Math.floor(v.x), Math.floor(v.y)]);
    } else {
      log(`${v.name} ${v.family} was drawn in by the light.`, '', [Math.floor(v.x), Math.floor(v.y)]);
    }
  }
  G.warnedFloor = false;
  for (const v of [...G.villagers]) {
    v.age += 1;
    if (Math.abs(v.age - ADULT_AGE) < 0.01) {
      // children take up their parents' trade, given any choice in the matter
      const par = helperParent(v) || (v.mom != null ? G.villagers.find(o => o.id === v.mom) : null);
      const pb = par && par.job != null ? byId(par.job) : null;
      if (pb) v.parentJobType = pb.type;
      log(`${v.name} ${v.family} has come of age, and takes up work${pb ? ` — drawn to the ${BUILDS[pb.type].name.toLowerCase()}, like family before` : ''}.`);
    }
    if (v.age > 18 && Math.random() < (v.age - 18) * 0.06) kill(v, 'died, old and warm, beside the fire');
  }
  G.homesDirty = true;
}
function onNewDay(n) {
  const sprouts = G.leader && G.leader.focus === 'wildwarden' ? 240 : 150;
  for (let i = 0; i < sprouts; i++) {
    const x = 1 + Math.floor(Math.random() * (W - 2));
    const y = 1 + Math.floor(Math.random() * (H - 2));
    const t = tile(x, y);
    if (t.t !== 'grass' || OCC[idx(x, y)] || G.wear[idx(x, y)] >= 4) continue;
    let trees = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (tile(x + dx, y + dy).t === 'tree' || tile(x + dx, y + dy).t === 'ancient') trees++;
    if (trees >= 1 && Math.random() < 0.2) { t.t = 'tree'; t.amt = 2; }
  }
  // faint trails fade fast; true roads endure — the network consolidates
  for (let i = 0; i < G.wear.length; i++) {
    const w = G.wear[i];
    if (w <= 0) continue;
    G.wear[i] = w < 6 ? Math.max(0, w * 0.95 - 0.04) : Math.max(0, w * 0.995 - 0.005);
  }
  const excess = G.res.food - 60;
  if (excess > 0) {
    const rot = excess * (season() === 1 ? 0.022 : 0.015) * (hasRelic('crock') ? 0.5 : 1);
    G.res.food -= rot;
    G.flow.foodOut = (G.flow.foodOut || 0) + rot;
    if (rot >= 1.5) discover('spoilage');
  }
  farmDaily();
  processDebts();
  updatePetDaily();
  checkLandmarks();
<<<<<<< HEAD
  // rubble cools; soldiers mend
  for (const b of [...G.builds]) {
    if (b.ruined && G.day - b.ruinedAt > 4) {
      G.builds = G.builds.filter(x => x.id !== b.id);
      rebuildOcc();
      log(`The rubble of the ${BUILDS[b.type].name} has cooled. The forest will take the rest.`, '', [b.x, b.y]);
    }
  }
  for (const v of G.villagers) {
    if (isMilitia(v) && v.hp != null && v.hp < 3 && G.res.food > 1 && v.home != null) v.hp = Math.min(3, v.hp + 1);
  }
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  if (G.homesDirty) assignHomes();
  assignJobs();
  G.jobChangesPrev = G.jobChangesToday || 0;
  G.jobChangesToday = 0;
<<<<<<< HEAD
  // the trader's appetites drift back toward even — but he remembers for a year and a half
  if (G.trader.market) for (const r of Object.keys(G.trader.market))
    G.trader.market[r] += (1 - G.trader.market[r]) * 0.012;
=======
  // the trader's appetites drift back toward even
  if (G.trader.market) for (const r of Object.keys(G.trader.market))
    G.trader.market[r] += (1 - G.trader.market[r]) * 0.04;
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  // the village's temper, written between the lines
  const tier = G.happy >= 55 ? 2 : G.happy >= 30 ? 1 : 0;
  if (G.moodTier == null) G.moodTier = tier;
  else if (tier !== G.moodTier) {
    const up = tier > G.moodTier;
    const lines = {
      2: 'The bread rises. The dogs sleep in doorways. There are songs again.',
      1: up ? 'People walk a little straighter. Not singing yet — but not counting jars either.'
            : 'Fewer songs by the fire lately. People count things, quietly.',
      0: 'Doors shut early now. The fire pops, and everyone flinches.',
    };
    log(lines[tier], tier === 0 ? 'death' : tier === 2 ? 'ember' : '');
    G.moodTier = tier;
  }
  // election: a grown village wants a leader
  const need = G.form && G.form.id === 'hall' ? 8 : 10;
  if (!G.leader && pop() >= need && (!G.electionDue || G.day >= G.electionDue) && !G.flags.electionOpen) holdElection();
  // yesterday's ledger
  G.flowPrev = G.flow;
  G.flow = {};

  if (n % DAYS_PER_SEASON === 0) {
    const s = (n / DAYS_PER_SEASON) % 4;
    if (s === 0) onNewYear();
    onNewSeason(s, n);
  }
}

/* every would-be leader brings a gift and a flaw — pick your trouble */
const LEADER_FOCUSES = [
  { id: 'provider',   n: 'the Provider',        d: 'food comes in an eighth richer — but the axes lag for it' },
  { id: 'warden',     n: 'the Warden',          d: 'spears strike further and the watch stays staffed — but drilled bellies eat more' },
  { id: 'keeper',     n: 'the Keeper of Songs', d: 'spirits stay high — but work slows a touch for the singing' },
  { id: 'mason',      n: 'the Mason',           d: 'scaffolds rise a third faster — but the militia drills are neglected' },
  { id: 'broker',     n: 'the Broker',          d: 'the trader deals fairer — but the tolls and tallies grate on everyone' },
  { id: 'wildwarden', n: 'the Wildwarden',      d: 'the forest returns quicker — but the fields are an afterthought' },
];
function holdElection() {
  const cands = adults().filter(v => v.age < ELDER_AGE + 4);
  if (cands.length < 3) { G.electionDue = G.day + 12; return; }
  G.flags.electionOpen = true;
  const picks = [];
  const pool = [...cands];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const fpool = [...LEADER_FOCUSES];
  const focuses = picks.map(() => fpool.splice(Math.floor(Math.random() * fpool.length), 1)[0]);
  showChoice('🗳️ The Village Gathers', 'The village is large enough to want a leader — someone to keep the tallies and the long view. Three stand up by the fire.',
    picks.map((v, i) => ({
      n: `${v.name} ${v.family}, ${focuses[i].n}`,
      d: `${v.age >= ELDER_AGE ? 'Elder. ' : ''}Under them, ${focuses[i].d}. (And the Ledger is opened.)`,
      fn() {
        G.leader = { id: v.id, name: `${v.name} ${v.family}`, focus: focuses[i].id, title: focuses[i].n };
        G.flags.electionOpen = false;
        log(`🗳️ ${v.name} ${v.family} is raised on shoulders by the fire — ${focuses[i].n}. The Ledger is opened.`, 'disc', [HX, HY]);
        discover('leader');
        uiDirty = true;
      },
    })));
}

/* ---------- hearth feeding, forms, endgame ---------- */
function dirName(dx, dy) {
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  return ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'][Math.round(((a + 360) % 360) / 45) % 8];
}
function revealNotables(oldR, newR) {
  let ruins = 0, ancients = 0, stones = 0, firstRuin = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - HX, y - HY);
    if (d <= oldR || d > newR) continue;
    const t = tile(x, y);
    if (t.t === 'ruin') { ruins++; if (!firstRuin) firstRuin = [x, y]; }
    if (t.t === 'ancient') ancients++;
    if (t.t === 'stone') stones++;
  }
  if (ruins) log(`The light falls on old ruins to the ${dirName(firstRuin[0] - HX, firstRuin[1] - HY)}.`, '', firstRuin);
  if (ancients) log(`${ancients} ancient tree${ancients > 1 ? 's' : ''} now stand${ancients > 1 ? '' : 's'} in the light, glowing faintly.`);
  if (stones) log('Stone outcrops glint at the edge of the light.');
  if (!ruins && !ancients && !stones) log('The light grows. The forest beyond looks deep.');
}
function formExtra(level) {
  if (level === 4) return { wood: 40, stone: 12 };
  if (level === 8) return { wood: 80, stone: 40 };
  if (level === 12) return { wood: 120, stone: 80 };
  return null;
}
function feedHearth() {
  if (!G.fire.lit) { rekindle(); return; }
  const c = hearthCost();
  const extra = formExtra(G.hearth.level + 1);
  if (G.res.ember < c || modalOpen) return;
  if (extra && !canAfford(extra)) return;
  if (extra) for (const [k, v] of Object.entries(extra)) { G.res[k] -= v; G.flow[k + 'Out'] = (G.flow[k + 'Out'] || 0) + v; }
  const oldR = lightR();
  G.res.ember -= c;
  G.hearth.level++;
  log(`🔥 The Hearth swells to level ${G.hearth.level}. The light pushes outward.`, '', [HX, HY]);
  revealNotables(oldR, lightR());
  const unlocked = Object.values(BUILDS).filter(b => b.unlock === G.hearth.level).map(b => b.name);
  if (unlocked.length) log(`New craft remembered: ${unlocked.join(', ')}.`);
  sfx('whoosh');
  buildBuildMenu();
  if (G.hearth.level === 4) { discover('forms'); chooseForm(); return; }
  if (G.hearth.level === 8 && G.form) {
    G.form.tier = 2;
    log(`${FORMS[G.form.id].emoji} ${FORMS[G.form.id].name} rises higher — its blessing deepens.`, 'ember', [HX, HY]);
  }
  if (G.hearth.level === 12) {
    G.siege = { starts: Math.floor(G.day) + 0.84, done: false, kills: 0 };
    log('🔥 THE FIRE IS READY TO BECOME ETERNAL. But the dark knows. Tonight it sends everything it has — survive until dawn with the fire still lit.', 'death', [HX, HY]);
    return;
  }
  showGiftModal();
}
function chooseForm() {
  showChoice('🔥 What the Fire Becomes', 'Fed this far, the fire stops being a fire. It will become a place — one place, forever. Choose.',
    Object.entries(FORMS).map(([id, f]) => ({
      n: `${f.emoji} ${f.name}`, d: f.desc,
      fn() {
        G.form = { id, tier: 1 };
        log(`${f.emoji} The fire is housed. It is ${f.name} now — and it always will be.`, 'ember', [HX, HY]);
        sfx('win');
        uiDirty = true;
      },
    })));
}

/* ---------- building actions ---------- */
function placeInfo(type, x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return { ok: false, why: 'out of bounds' };
  if (!isLit(x, y)) return { ok: false, why: 'outside the light' };
  const t = tile(x, y);
  if (t.t !== 'grass') return { ok: false, why: 'needs clear grass' };
  if (OCC[idx(x, y)]) return { ok: false, why: 'occupied' };
  const def = BUILDS[type];
  if (def.near) {
    let found = false;
    for (const [dx, dy] of OFFS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nt = G.tiles[idx(nx, ny)];
      if (nt.t === def.near && (def.near === 'water' || nt.amt > 0)) { found = true; break; }
    }
    if (!found) return { ok: false, why: `needs ${def.near === 'stone' ? 'a stone outcrop' : def.near === 'water' ? 'deep water' : 'ruins'} within reach` };
  }
  if (!canAfford(costOf(type))) return { ok: false, why: 'cannot afford' };
  return { ok: true, why: '' };
}
function tryPlace(type, x, y) {
  const info = placeInfo(type, x, y);
  if (!info.ok) { setStatus(`Cannot build: ${info.why}.`); return; }
  for (const [k, v] of Object.entries(costOf(type))) { G.res[k] -= v; G.flow[k + 'Out'] = (G.flow[k + 'Out'] || 0) + v; }
  G.builds.push({ id: nextId++, type, x, y, tx: null, halt: false, growth: 0, crop: 0, lvl: 1, built: false, progress: 0, bornAt: G.day, maxCrew: null, rush: false, phase: null });
  rebuildOcc();
  log(`Scaffolding rises for a ${BUILDS[type].name}.`, '', [x, y]);
  discover('construction', [x, y]);
  assignJobs();
  sfx('click');
  uiDirty = true;
}
function upgradeCost(b) {
  const base = BUILDS[b.type].cost;
  const out = { wood: Math.ceil((base.wood || 0) * 1.3) + 6, stone: 8 };
  if (has('stonebones')) for (const k of Object.keys(out)) out[k] = Math.ceil(out[k] * 0.75);
  return out;
}
function upgradeBuilding(b) {
  if (b.lvl > 1 || !b.built) return;
  const cost = upgradeCost(b);
  if (!canAfford(cost)) return;
  for (const [k, v] of Object.entries(cost)) { G.res[k] -= v; G.flow[k + 'Out'] = (G.flow[k + 'Out'] || 0) + v; }
  b.lvl = 2;
  log(`The ${BUILDS[b.type].name} is rebuilt, wiser. ★`, '', [b.x, b.y]);
  discover('upgrade', [b.x, b.y]);
  G.homesDirty = true;
  assignJobs();
  sfx('thud');
  uiDirty = true;
}
function demolish(b) {
  for (const v of G.villagers) if (v.job === b.id) { v.job = null; v.equipped = false; }
  // a half-raised scaffold gives nearly everything back
  const refund = b.built ? 0.5 : 0.9;
  for (const [k, v] of Object.entries(costOf(b.type))) addRes(k, Math.floor(v * refund));
  G.builds = G.builds.filter(x => x.id !== b.id);
  rebuildOcc();
  selected = null;
  G.homesDirty = true;
  log(`${BUILDS[b.type].name} ${b.built ? 'dismantled' : 'scaffold struck'}.`);
  assignHomes();
  assignJobs();
  uiDirty = true;
}

/* ---------- main tick ---------- */
function tick(dtDays) {
  G.day += dtDays;
  produce(dtDays);
  updateFire(dtDays);
<<<<<<< HEAD
  // braziers burn their own small bellies of wood — and no one feeds them but you
  for (const b of G.builds) {
    if (b.type !== 'torch' || !b.built || b.ruined || (b.fuel || 0) <= 0) continue;
    b.fuel -= 1.2 * dtDays;
    if (b.fuel <= 0) {
      b.fuel = 0;
      if (!b.outLogged) {
        b.outLogged = true;
        log('🕯️ A brazier gutters out. Its circle belongs to the dark again until someone walks out and feeds it.', 'death', [b.x, b.y]);
        uiDirty = true;
      }
    }
  }
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  updateMonsters(dtDays);
  updateTrader(dtDays);
  updatePet(dtDays);
  familyStep();
  conceptions(dtDays);
  gestate(dtDays);

  let eat = 0;
  for (const v of G.villagers) {
    eat += (v.age < ADULT_AGE ? 0.45 : isMilitia(v) ? 0.9 : EAT);
    if (v.trait === 'gardener') addRes('food', 2.2 * dtDays);
  }
  eat *= (has('heartyfolk') ? 0.75 : 1);
  if (G.leader && G.leader.focus === 'warden') eat *= 1.06;
  G.res.food = Math.max(0, G.res.food - eat * dtDays);
  G.flow.foodOut = (G.flow.foodOut || 0) + eat * dtDays;
  const idleCount = adults().filter(v => v.job == null && canWork(v)).length;
  if (idleCount > 0) addRes('food', idleCount * 0.35 * dtDays);

  if (pop() > 0) {
    if (G.res.food <= 0.01) G.starve += dtDays; else G.starve = 0;
    if (G.happy < 25) G.gloom += dtDays; else G.gloom = Math.max(0, G.gloom - dtDays * 2);
    if (G.starve > 3) { leaveOne('went searching for food and did not return'); G.starve = 1.2; }
    if (G.gloom > 5) { leaveOne('slipped quietly into the mist'); G.gloom = 2; }
  }

  // every half day the whole queue is re-checked, no matter what
  G.jobTimer = (G.jobTimer || 0) + dtDays;
  if (G.jobTimer > 0.5) {
    G.jobTimer = 0;
    assignJobs();
  }

  const d = Math.floor(G.day);
  if (d !== G.lastDay) {
    for (let i = G.lastDay + 1; i <= d; i++) onNewDay(i);
    G.lastDay = d;
  }
  updateHappiness();
  for (const v of G.villagers) updateVillager(v, dtDays);
}

/* ---------- new game / saves ---------- */
function newGame(seedStr) {
  nextId = 1;
  G = {
    seedStr, day: 0.27, lastDay: 0, speed: 1,
    res: { food: 90, wood: 80, stone: 0, ember: 0, coin: 0 },
    seen: { stone: false, ember: false, coin: false },
    hearth: { level: 1 },
    fire: { fuel: 80, lit: true },
    form: null, leader: null, electionDue: 0,
    perks: [], relics: [], lore: [], flags: {}, event: null, debts: [],
    happy: 60, starve: 0, gloom: 0, warnedFloor: false, homesDirty: true,
    crowded: 0, homeless: 0, mourning: 0,
    villagers: [], builds: [], monsters: [],
    trader: { state: 'away', next: 9 + Math.random() * 6, x: 0, y: 0 },
    siege: null, won: false, moodTier: 2, logRead: 0,
    flow: {}, flowPrev: {},
    log: [],
    tiles: genMap(seedStr),
    wear: new Array(W * H).fill(0),
  };
  rebuildOcc();
  // three pairs — six of you — out the service gate before dawn, off the registry
  const fams = [];
  while (fams.length < 3) { const s = choice(SURNAMES); if (!fams.includes(s)) fams.push(s); }
  for (const fam of fams) {
    const a = spawnVillager({ family: fam, sex: 'f' }), b = spawnVillager({ family: fam, sex: 'm' });
    a.spouse = b.id; b.spouse = a.id; a.bearer = true;
  }
  G.biome = biomeOf(seedStr);
  log('Three pairs — six souls who trusted each other enough to run — light a fire in the unmapped wood. The Hearth is born, and the registry will never find it.');
  log(`This is ${BIOMES[G.biome].name} — ${BIOMES[G.biome].blurb}.`);
  discover('theflight');
  discover('fire-hunger');
  assignHomes(); assignJobs();
  buildMode = null; selected = null; uiMode = null;
  centerCam(true);
  buildBuildMenu();
  uiDirty = true;
}
function serialize() {
  return JSON.stringify({ v: 3, nextId, G: { ...G, wear: G.wear.map(w => Math.round(w * 10) / 10) } });
}
function deserialize(raw) {
  const data = JSON.parse(raw);
  if (!data.G || !data.G.tiles || data.G.tiles.length !== W * H) return false;
  G = data.G; nextId = data.nextId || 9000;
  G.monsters = G.monsters || [];
  G.relics = G.relics || [];
  G.debts = G.debts || [];
  G.flags = G.flags || {};
  G.flow = G.flow || {}; G.flowPrev = G.flowPrev || {};
  G.seen = G.seen || { stone: G.res.stone > 0, ember: G.res.ember > 0 || G.hearth.level > 1, coin: G.res.coin > 0 };
  if (G.flags.electionOpen) G.flags.electionOpen = false;
<<<<<<< HEAD
  // older saves predate fuel, hit points and monster breeds
  for (const b of G.builds) {
    if (b.built && b.hp == null) b.hp = B_HP;
    if (b.type === 'torch' && b.built && b.fuel == null) b.fuel = 20;
  }
  for (const m of G.monsters) {
    if (!m.type || !MONSTER_TYPES[m.type]) m.type = 'skitter';
    if (m.hp == null) m.hp = MONSTER_TYPES[m.type].hp;
    if (m.cd == null) m.cd = 0;
  }
=======
>>>>>>> 0caa1cec09c8b2d6f87baa8493a1102faf592c3b
  rebuildOcc();
  return true;
}
function saveTo(slot) {
  if (!G) return;
  try { localStorage.setItem(SAVE_PREFIX + slot, serialize()); } catch (e) {}
}
function loadFrom(slot) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return false;
    if (!deserialize(raw)) return false;
    buildMode = null; selected = null; uiMode = null;
    return true;
  } catch (e) { return false; }
}
function slotInfo(slot) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { date: dateStr(d.G.day), pop: d.G.villagers.length, seed: d.G.seedStr };
  } catch (e) { return null; }
}
