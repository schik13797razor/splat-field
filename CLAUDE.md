# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Splat Field is a 3v3 top-down paintball game: plain JavaScript ES modules, Canvas 2D, Web Audio, no runtime libraries,
no image or audio files (only Google Fonts). It's Jeff's hobby and learning project: the point is to learn how Claude
Code plans, builds, and tests a game. `HANDOFF.md` has the full history and open items.

## Working with Jeff

- Jeff doesn't write code by hand. Explain what you're doing and why.
- Work in small, testable steps, and flag risks before any big change.
- Keep gameplay changes separate from refactors. A refactor should leave bot-only matches identical (see "Proving
  a change doesn't affect gameplay" below).
- Commit only when Jeff asks, usually after he has played the change.

## Game rules (decided with Jeff; don't change without asking)

- **Teams:** Orange (Jeff + KIT attacker, DASH defender) vs Blue bots (VEX attacker, BOLT support, MOSS defender).
- **Scoring:** every paint hit is 1 point ("hits") for the shooter's team.
- **Wash:** a painted player stands on their team's WASH pad for 3 s. Stepping off pauses progress (doesn't reset it).
  Washing refills paint and stamina, then gives 1 s of spawn protection.
- **Last Team Standing:** one hit and you're out for the round. First to 3 rounds, 150 s per round (more survivors
  wins, otherwise a draw). F while out = 3× fast-forward.
- **Capture the Flag:** carry the enemy flag into your base zone; your own flag doesn't need to be home. A hit carrier
  drops it. Touching your own dropped flag returns it; otherwise it goes home after 15 s. First to 3 captures, 6:00
  limit, tiebreak on captures then hits.
- **Markers** (menu choice; bot defenders carry a Pump): Electro 0.11 s between shots, spread 0.05 rad, range 640,
  45 balls, 1.6 s reload. Pump 0.5 s, 0.008 rad, range 940, 20 balls, 1.3 s reload.
- **Sprint:** Shift = 1.5× speed, no shooting. Stamina drains 0.42/s and regenerates 0.3/s after 0.7 s rest. Emptying
  it leaves you "winded" until 35%.
- **Squad orders (1-4):** follow, hold the spot under the crosshair (the on-screen button holds where you stand),
  attack, free play.
- **Fields:** Snake Line, Barrel Yard, Midline, Random. Left half mirrored; bases are the same on every field.
- **Bot skill:** Easy / Normal / Hard (`DIFF`).
- Skipped by Jeff's choice for now: "enemy paint slows you", local 2-player, online multiplayer.

## Commands

- `npm install`: one-time setup (Vite is the only dependency).
- `npm run dev`: dev server at http://localhost:5173. CSS hot-swaps; a JS edit reloads the page.
- `npm run build` / `npm run preview`: static build into `dist/` and serve it.

There is no test runner or linter in the repo. Balance tests are done ad hoc with headless Chromium (Playwright) via
the `window.__splat` hook, which `src/main.js` exposes: `G`, `CFG`, `DIFF`, `MARKERS`, `MAPS`, `COVER`, `step(dt)`,
`newMatch(mode, diff, human, marker)`, `startHumanMatch`, `issueOrder`, `humanPlayer`, `loadMap(key)`,
`randomLayout(seed)`, `astar`, `settings`. Keep this hook's keys stable. To run a single bot-only match:

```js
const S = window.__splat;
S.loadMap('snake');                       // snake | barrel | midline | random
S.newMatch('ctf', 'normal', false);       // ctf | lts; easy | normal | hard; human=false → six bots
while (S.G.phase !== 'over') S.step(1 / 60);   // cap at 420 simulated seconds
```

What the balance tests measure: for CTF, average match length, captures, timeouts (neither team reached 3), and Blue
wins; for LTS, average round length and Blue wins. For Random, generate 300 fields with different seeds and count
fallbacks to Snake Line.

Latest results (v3, bot-only):

| Setting | Result |
|---|---|
| Snake Line CTF Normal | ~107-120 s, ~4 captures, 0 timeouts |
| Snake Line CTF Hard | 162 s, 3.9 captures, 1 timeout in 10 |
| Snake Line LTS round (Easy / Normal / Hard) | 24 / 20 / 17 s |
| Barrel Yard CTF Normal | 264 s, 3 timeouts in 8 (runs long; open item) |
| Midline CTF Normal | 115 s, 0 timeouts in 8 |
| Random CTF Normal | 238 s, 1 timeout in 8 |
| LTS round, other fields (Normal) | 21-23 s |
| Random field generator | 300/300 valid, ~2 ms each |

Open question: Blue won ~60% of bot-only Snake Line CTF in some batches (13 of 20). It might be noise, or an asymmetry
(A* neighbor order, `nearestFree` scan order, players updating in team order). Check it with bigger batches.

## Architecture

One file per numbered section in `src/`: `config` (1, every tunable number), `field` (2), `geometry` (3),
`pathfinding` (4), `state` (5), `rules` (6), `bots` (7), `drawing` (8), `sound` (9), `ui` (10), `main` (11, entry
point). `util.js` holds shared math helpers and `W`/`H` (field size in game units, 1600×900).

- **Shared state lives in `G`** (`state.js`). It's one mutable object that every section reads and writes: phase
  (`countdown | play | roundEnd | over`), mode, players, balls, flags, scores, effects. `newMatch` resets it in place.
- **Imported bindings are read-only.** A value that another file must change has to live on an object (`G`,
  `hitMark.t`, `view`, `settings`), not in a top-level `let`.
- **Load-order rule.** `rules`, `bots`, `drawing`, `sound`, `ui`, and `state` import each other in loops. Code that
  runs at load time may only use its own names or the leaf modules (`config`, `util`, `field`, `geometry`,
  `pathfinding`). Anything that needs another section at startup goes in `boot()` in `main.js` (this is why
  `bindPointerInput()` exists). A violation shows up as "Cannot access 'X' before initialization".
- **Loop:** `frame()` calls `update(dt)` (×`CFG.fastForward` when the human is out and pressed F), then `render()`,
  then `updateHUD()`. `update` drives phases, players (human input or `updateBot`), balls, flags, and round/match end.
  Simulation never depends on rendering, which is why `step()` can run headless.
- **The menu is a live demo.** When `G.human` is false, six bots play behind the menu, and `startDemo()` alternates
  CTF and LTS. Banners, the feed, and sound only fire when `G.human` is true.
- **Fields:** `loadMap` (in `ui.js`) → `applyLayout` rebuilds obstacles (`OBST`), the 20-unit A* grid, and `COVER`
  spots, then redraws. Layouts define the left half and are mirrored. `randomLayout(seed)` keeps a layout only if
  pathfinding validates bot routes and cover, otherwise it falls back to Snake Line.
- **Drawing:** the turf/bunker layer is drawn once per field and the paint layer accumulates splats (both offscreen at
  1.5×). Each frame composites them, then draws players and effects. `view` maps game units to the scaled canvas.
- **Bots** (`bots.js`): `updateBot` handles target choice, aiming, and cover, then hands movement to a mode brain
  (`ctfBrain`, `ltsBrain`) or to `followOrders` for Orange bots under a squad order. Per-difficulty numbers come from
  `DIFF`; per-marker numbers from `MARKERS`.
- **Settings** persist in localStorage under `splatfield.settings`.

## Proving a change doesn't affect gameplay

Everything random goes through `Math.random`, and real-time frames call `update` too. For an exact comparison, use a
Playwright init script that replaces `Math.random` with a seeded generator (re-seed right before each match) and
stubs `requestAnimationFrame` to a no-op. With rAF stubbed, `page.waitForFunction` needs `{ polling: 100 }`. Then
compare final `G` state between the old commit and the new code across every mode × skill × field, plus
`randomLayout(seed)` for many seeds. The file split was verified this way (24/24 matches, 300/300 fields identical).
