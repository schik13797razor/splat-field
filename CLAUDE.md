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
  Orange vs Blue is the default; Customize lets you pick both team colors (Orange, Blue, Red, Purple, Yellow, Pink;
  never the same). A team's name follows its color.
- **Customize** (menu, saved in settings): your name and your two teammates' names (10 characters, shown in capitals),
  your jersey (Stripe, Solid, Split, Hoops) and mask (Black, White, Gray, Camo). Only your own player wears the
  jersey and mask; bots keep Stripe and Black.
- **Scoring:** every paint hit is 1 point ("hits") for the shooter's team.
- **Wash:** a painted player stands on their team's WASH pad for 3 s. Stepping off pauses progress (doesn't reset it).
  Washing refills paint and stamina, then gives 1 s of spawn protection.
- **Last Team Standing:** one hit and you're out for the round. First to 3 rounds, 150 s per round (more survivors
  wins, otherwise a draw). F while out = 3× fast-forward.
- **Capture the Flag:** carry the enemy flag into your base zone; your own flag doesn't need to be home. A hit carrier
  drops it. Touching your own dropped flag returns it; otherwise it goes home after 15 s. First to 3 captures, 6:00
  limit, tiebreak on captures then hits.
- **King of the Hill:** a hill (radius 110) in the middle of the field. A team scores 1 point per second while it has
  active players on the hill and the other team has none (contested = nobody scores). Hit players wash as in CTF.
  First to 100 points, 5:00 limit, tiebreak on points then hits.
- **Markers** (menu choice; bot defenders carry a Pump): Electro 0.11 s between shots, spread 0.05 rad, range 640,
  45 balls, 1.6 s reload. Pump 0.5 s, 0.008 rad, range 940, 20 balls, 1.3 s reload. Scatter (player choice only):
  3 balls in a fan (0.12 rad apart) per shot, 0.55 s, 0.035 rad, range 420, 30 balls, 1.7 s reload.
- **Sprint:** Shift = 1.5× speed, no shooting. Stamina drains 0.42/s and regenerates 0.3/s after 0.7 s rest. Emptying
  it leaves you "winded" until 35%.
- **Squad orders (1-4):** follow, hold the spot under the crosshair (the on-screen button holds where you stand),
  attack (CTF: their flag; KOTH: take the hill; LTS: hunt), free play.
- **Fields:** Snake Line, Barrel Yard, Midline, Hilltop (open middle for the hill), Random. Left half mirrored; bases
  are the same on every field.
- **Bot skill:** Easy / Normal / Hard (`DIFF`).
- Skipped by Jeff's choice for now: "enemy paint slows you", local 2-player, online multiplayer.

## Commands

- `npm install`, then `npx playwright install chromium` once: one-time setup (dev dependencies: Vite, Playwright).
- `npm run dev`: dev server at http://localhost:5173. CSS hot-swaps; a JS edit reloads the page.
- `npm run build` / `npm run preview`: static build into `dist/` and serve it.
- **Publishing:** every push to `master` rebuilds and publishes the game to https://schik13797razor.github.io/splat-field/
  (`.github/workflows/deploy.yml`). Pushing `master` is a public release: push only when Jeff asks.
- `npm test` (`tests/smoke.js`, about 15 s): loads the game in headless Chromium, plays a real match through the menu
  and controls, sweeps every field × mode with bots, and fails on any page error or `console.error` (failed Google
  Fonts requests are ignored). Run it after every change.
- `npm run sim` (`tests/sim.js`): bot-only balance batches, printed as one table per field × skill. Defaults to 8
  matches per setting (360 matches, about 40 s). Options: `--matches=N --fields=snake,barrel,midline,hilltop,random
  --skills=easy,normal,hard --modes=ctf,lts,koth --seed=N --workers=N`. With `--seed`, results are exactly repeatable.
  Example single setting: `npm run sim -- --matches=50 --fields=snake --skills=normal --modes=ctf`.

Both scripts start their own Vite server on a free port (`tests/harness.js`), so they work while `npm run dev` runs.
There is no linter. The tests drive the game through the `window.__splat` hook, which `src/main.js` exposes: `G`,
`CFG`, `DIFF`, `MARKERS`, `MAPS`, `COVER`, `step(dt)`, `newMatch(mode, diff, human, marker)`, `startHumanMatch`,
`issueOrder`, `humanPlayer`, `loadMap(key)`, `randomLayout(seed)`, `astar`, `settings`. Keep this hook's keys stable.
A bot-only match by hand:

```js
const S = window.__splat;
S.loadMap('snake');                       // snake | barrel | midline | hilltop | random
S.newMatch('ctf', 'normal', false);       // ctf | lts | koth; easy | normal | hard; human=false → six bots
while (S.G.phase !== 'over') S.step(1 / 60);   // cap at 420 simulated seconds
```

What the balance tests measure: for CTF, average match length, captures, timeouts (neither team reached 3), and Blue
wins; for LTS, average round length and Blue wins; for KOTH, average match length, timeouts (neither team reached
100), and Blue wins. For Random, generate 300 fields with different seeds and count
fallbacks to Snake Line.

Latest results (`npm run sim -- --matches=20`, 2026-11-12, after the fair-update fix; CTF length / captures /
timeouts, LTS round):

| Field | Easy | Normal | Hard |
|---|---|---|---|
| Snake Line | 125 s, 4.3, 0/20; 28.0 s | 113 s, 4.0, 0/20; 21.4 s | 185 s, 4.0, 2/20; 16.6 s |
| Barrel Yard | 144 s, 4.0, 0/20; 31.0 s | 232 s, 3.3, 5/20; 23.8 s | 336 s, 2.0, 18/20; 17.3 s |
| Midline | 95 s, 4.3, 0/20; 28.8 s | 144 s, 4.2, 0/20; 22.9 s | 167 s, 4.2, 0/20; 18.4 s |
| Random | 124 s, 4.3, 0/20; 27.9 s | 205 s, 4.0, 3/20; 22.6 s | 259 s, 3.4, 5/20; 16.6 s |
| Hilltop | 113 s, 4.0, 0/20; 27.9 s | 147 s, 4.2, 0/20; 22.6 s | 184 s, 4.0, 1/20; 17.6 s |

Blue won 123/240 CTF and 113/240 LTS (Hilltop: 28/60 each). Random field generator: 300/300 valid, ~3 ms each.

King of the Hill (`--modes=koth --matches=20`, 2026-11-12; match length / timeouts):

| Field | Easy | Normal | Hard |
|---|---|---|---|
| Snake Line | 294 s, 11/20 | 256 s, 0/20 | 246 s, 0/20 |
| Barrel Yard | 291 s, 12/20 | 254 s, 0/20 | 240 s, 0/20 |
| Midline | 273 s, 7/20 | 255 s, 1/20 | 233 s, 0/20 |
| Hilltop | 223 s, 0/20 | 238 s, 0/20 | 242 s, 0/20 |
| Random | 291 s, 14/20 | 259 s, 1/20 | 258 s, 0/20 |

KOTH fairness: 600 seeded matches gave Blue 49.4%. Winners finish near 100 points, losers around 75.

Open balance items: Barrel Yard CTF runs long (Hard almost always times out). KOTH on Easy often times out (Easy
bots miss, so hill fights drag on). The Pump is the strongest marker in bot hands: with Orange's RUSH on a Pump,
Orange won ~66% of CTF matches (Electro 45%, Scatter 53%, 300 matches each).

**Team fairness.** Bot-only matches should split about 50/50. Blue used to win ~57% because `updatePlayers`
handled each player in team order and let it move immediately, so Blue (second) aimed at Orange's fresh position.
It now runs three passes (timers, everyone decides from the same start-of-frame picture, everyone moves). Fairness
check: 1,200 CTF matches gave Blue 51.1%, and reversing the update order no longer flips the result. Keep this
property: anything a bot reads about other players must be the same for both teams within a frame.

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
- **The menu is a live demo.** When `G.human` is false, six bots play behind the menu, and `startDemo()` cycles
  CTF, LTS, and KOTH. Banners, the feed, and sound only fire when `G.human` is true.
- **Fields:** `loadMap` (in `ui.js`) → `applyLayout` rebuilds obstacles (`OBST`), the 20-unit A* grid, and `COVER`
  spots, then redraws. Layouts define the left half and are mirrored. `randomLayout(seed)` keeps a layout only if
  pathfinding validates bot routes and cover, otherwise it falls back to Snake Line.
- **Drawing:** the turf/bunker layer is drawn once per field and the paint layer accumulates splats (both offscreen at
  1.5×). Each frame composites them, then draws players and effects. `view` maps game units to the scaled canvas.
- **Bots** (`bots.js`): `updateBot` handles target choice, aiming, and cover, then hands movement to a mode brain
  (`ctfBrain`, `ltsBrain`, `kothBrain`) or to `followOrders` for Orange bots under a squad order. Per-difficulty numbers come from
  `DIFF`; per-marker numbers from `MARKERS`.
- **Settings** persist in localStorage under `splatfield.settings`. Customize choices are copied into `custom`
  (`state.js`), which `makePlayer` (names) and `drawPlayer` (jersey, mask) read; team colors recolor the shared
  `TEAMS` objects in place (`setTeamColors`) and the CSS `--team0`/`--team1` variables.
- **Random numbers and drawing:** `splat()` runs during the simulation, so it must take the same `Math.random`
  numbers in the same order; extra visual detail uses its own generator (`vr` in `drawing.js`). Animation state
  (stride, hit pop) lives in a WeakMap in `drawing.js`, never on the player.

## Proving a change doesn't affect gameplay

Everything random goes through `Math.random`, and real-time frames call `update` too. For an exact comparison, use a
Playwright init script that replaces `Math.random` with a seeded generator (re-seed right before each match) and
stubs `requestAnimationFrame` to a no-op. With rAF stubbed, `page.waitForFunction` needs `{ polling: 100 }`. Then
compare final `G` state between the old commit and the new code across every mode × skill × field, plus
`randomLayout(seed)` for many seeds. The file split was verified this way (24/24 matches, 300/300 fields identical). The KOTH-only fields
`G.hill` and `G.points` exist in every match, so leave them out when comparing against code from before KOTH.
