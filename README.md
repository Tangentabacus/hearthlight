# 🔥 Hearthlight

A village-survival game about keeping one fire alive against the dark. Pure browser game,
zero dependencies, desktop and mobile — `index.html` + `game.js` (simulation) + `ui.js`
(render/input/sound/HUD).

**Run it:** double-click `index.html`, or `powershell -ExecutionPolicy Bypass -File serve.ps1`
→ http://localhost:8123. **Deploy it:** copy the three files (plus this README if you like) to
any static host — GitHub Pages, Netlify, S3, anything that serves files. No build step, no
server logic, no login; every player gets their own world in localStorage.

A year is ~30 min at 1× (`1`/`2`/`3` = 1×/3×/8×). Touch controls: drag pans, pinch zooms,
tap inspects, long-press opens the build menu. The HUD floats over a full-screen world:
stores top-left, village top-right, the fire's controls at bottom-center (the blaze itself is
the gauge — no meters), the chronicle scroll bottom-left (its condition mirrors the village's),
the build hammer bottom-right.

## The game

Six travellers, one fire. The fire eats wood constantly — your people only toss a stick when
it's nearly dead, so keeping it *bright* is your job (stoke button, or click the Hearth). As
fuel falls the light contracts and the village edge goes dark and idle; as the village and
Hearth grow, the fire gets hungrier. Embers (scarce: ancient trees, ruins, kilns, the trader)
grow the Hearth: more light, new crafts, gift drafts — and at milestones the fire *becomes*
something (Hearthhall / Emberkeep / Temple — one identity, forever) until the final feeding
triggers **the Longest Night**: survive the siege until dawn and the flame is Eternal.

Beneath that: real pathfinding villagers with day/night routines who collect tools at their
workplace then walk to the resource; worn footpaths; families with cabins, pregnancies, and
children who inherit their parents' crafts; four food chains (crops, fishing, hunting, forage)
that shift with the seasons; frozen lakes you can walk on; monsters that grow bolder every
year and drop loot; militia, palisades, and braziers (plantable light = forced expansion);
relics from the ruins; a trader who crosses the map and leaves by another road; special
visitors (witches, beggars who remember, the wounded); elections that open a stats Ledger;
building upgrades, work-area control, and construction that needs idle hands. Nothing is
explained up front — every mechanic writes itself into the **Lore** when you first touch it,
and chronicle entries click through to where they happened.

Saves: autosave + 3 manual slots + clipboard export/import (⚙). No login, no server.

## Regression checks

With Node.js 18 or later installed, run `node --test tests/*.test.cjs`.
The checks cover script loading, gatherer commutes, crew limits, save imports and
touch gestures. The game itself still runs without Node.js or any dependencies.

## Daily rhythm (v2026.09.08.1)

Untrodden ground uses 80% of base walking speed, faint trails 110%, and worn paths
and old roads 135%. A worn path saves about 41% of the travel time over the same
distance off-path.

Tending costs 3 wood and restores 25 fuel. A starting village burns about 21 fuel
per day, so one click a day keeps it bright. Winter and larger villages need a
little more. The light recedes sooner, but a full fire has several days of reserve;
nearby villagers still preserve a low flame when wood is available.

Couples need a usable cabin with room for a child. Healthy households conceive
more readily; new pregnancies last 12 game days (existing pregnancies keep their
remaining time). Children help from age one and take regular jobs at three. Ages
still advance at the new year. Expectant children reserve cabin space, and couple
formation follows game time consistently at every speed.

Fueled braziers also clear their own circles in the darkness overlay, matching
their usable light radius. Cold or ruined braziers leave the surrounding ground dark.

## Multiplayer roadmap (designed for, not yet wired)

The state is already built for it: the whole world is one serializable object (`G`), the
simulation is a pure `tick(dt)` over it, and every player intent is a small function call
(`tryPlace`, `stoke`, `feedHearth`, `doDeal`, …). To go multiplayer:

1. **Server-authoritative rooms** — a Node process runs `game.js` headless (it has no DOM
   dependencies in the sim path), one instance per shared map; clients send intents, the
   server validates and broadcasts state diffs (or just re-broadcasts `serialize()` at low Hz —
   it's ~300KB, fine for a handful of players per map).
2. **Shared persistent map, 24h wipe** — a cron regenerates the world from a daily seed;
   multiple villages spawn at spread-out hearth points (`HX,HY` per player). Light circles
   eventually overlap → trade/fight/interact at the borders. The trader becomes a real entity
   walking between villages.
3. **Identity without login** — a random token in localStorage claims your hearth for the day.
4. **Scale** — hundreds of players = dozens of independent room processes behind a websocket
   gateway; each room is a single ~16ms-tick loop, trivially cheap.

## Tuning

Everything lives at the top of `game.js`: `fireBurnRate()`, production rates in `produce()`,
`monsterPressure()`/`fearRadius()` (escalation), `BUILDS`, `PERKS`, `RELICS`, `FORMS`,
`LORE`, conception rates in `conceptions()`, and `genMap()`.
