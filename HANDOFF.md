# Splat Field: handoff notes

Notes for Claude Code (and for Jeff) on where this project stands as it moves out of a Claude chat.

## What this is

- A 3v3 top-down paintball game. Jeff's personal hobby and learning project, not for sale.
- The point is to learn how Claude Code plans, builds, and tests a game. Jeff doesn't write code by hand.
  Explain what you're doing and why, work in small testable steps, and flag risks before big changes.
- Built in a chat as one self-contained file (`splat-field.html`, still in git history at commit 9254aa4), then split
  into a Vite project: `index.html`, `src/styles.css`, and one JavaScript file per code section (see the code map).
  Canvas 2D drawing, Web Audio synthesized sound, no game libraries, no image or audio files.
  The only external resource is Google Fonts (Saira Stencil One, Barlow Semi Condensed), with fallbacks.

## Running it

- One-time setup: `npm install` (needs Node.js).
- `npm run dev` starts the game at http://localhost:5173. CSS edits show up instantly; JS edits reload the page.
- `npm run build` makes a static copy in `dist/`; `npm run preview` serves that copy.

## Rules already decided with Jeff

- **Teams:** Orange (Jeff + 2 bots: KIT attacker, DASH defender) vs Blue (3 bots: VEX attacker, BOLT support, MOSS defender).
- **Scoring:** every paint hit is 1 point ("hits") for the shooter's team.
- **Wash pad:** a painted player walks to their team's WASH pad and stands on it for 3 seconds. Stepping off pauses
  progress (doesn't reset it). Washing also refills paint and stamina, then gives 1 second of spawn protection.
- **Last Team Standing:** one hit and you're out for the round. First to 3 rounds. 150-second round limit
  (more survivors wins, otherwise a draw). Press F while out for 3x fast-forward.
- **Capture the Flag:** grab the enemy flag and carry it into your base zone. A hit carrier drops it. Touching your own
  dropped flag returns it; otherwise it goes home after 15 seconds. Your own flag doesn't need to be home to score.
  First to 3 captures, 6:00 limit, tiebreak on captures then hits.
- **Markers** (chosen in the menu; bot defenders carry a Pump):
  - Electro: 0.11 s between shots, spread 0.05 rad, range 640, 45-ball hopper, 1.6 s reload.
  - Pump: 0.5 s between shots, spread 0.008 rad, range 940, 20-ball pod, 1.3 s reload.
- **Sprint:** hold Shift for 1.5x speed. You can't shoot while sprinting. Stamina drains 0.42/s and regenerates
  0.3/s after a 0.7 s rest. Running it empty leaves you "winded" until it's back to 35%.
- **Squad orders (keys 1-4):** follow me, hold the spot under the crosshair (clicking the on-screen button holds
  where you stand), attack, free play.
- **Fields:** Snake Line, Barrel Yard, Midline, and Random. The left half is mirrored onto the right, and bases are
  the same on every field. Random builds a new layout every match and keeps it only if pathfinding confirms every
  bot route is walkable and there's enough cover.
- **Bot skill:** Easy / Normal / Hard (the `DIFF` table).

## Code map (one file per section in `src/`)

1. `config.js` CONFIG: `CFG`, `DIFF`, `MARKERS`. Every tunable number lives here.
   `util.js` holds the small shared helpers (`W`, `H`, `clamp`, `rand`, `dist`, `mulberry32`, ...).
2. `field.js` FIELD: `MAPS`, `BASES`, `buildObstacles`.
3. `geometry.js` GEOMETRY: segment vs rectangle/circle, `raycast`, collision push-out.
4. `pathfinding.js` PATHFINDING: 20-unit grid, A*, cover spots, `applyLayout`, `randomLayout`.
5. `state.js` GAME STATE: `G`, `makePlayer`, `newMatch`, `hitMark` (crosshair flash timer).
6. `rules.js` RULES: shooting, hits, wash, flags, rounds, stamina.
7. `bots.js` BOT BRAINS: `pickTarget`, `updateBot`, attack lanes (`routeTo`), `ctfBrain`, `followOrders`, `ltsBrain`, `findCover`.
8. `drawing.js` DRAWING: the field layer is drawn once, the paint layer keeps every splat, then players and effects.
9. `sound.js` SOUND: Web Audio synth, field ambience.
10. `ui.js` INPUT + UI: keyboard, mouse, touch, menus, settings saved in localStorage, HUD, `loadMap`.
11. `main.js` MAIN LOOP: update, render, HUD, `boot()`, and the `window.__splat` test hook. This is the entry point.

Files share code through `import`/`export`. Several files import each other in a loop (rules ↔ drawing ↔ ui, for
example). That's fine as long as **code that runs when a file loads only uses its own names or the leaf files**
(`config`, `util`, `field`, `geometry`, `pathfinding`). Anything that needs another section at startup goes in
`boot()` (that's why `bindPointerInput()` exists: it needs the canvas from `drawing.js`). Breaking this rule shows up
as "Cannot access 'X' before initialization" in the browser console.

The `window.claude?.hot` artifact-viewer code was removed when the project was split.

**Test hook:** `window.__splat` exposes `G`, `CFG`, `DIFF`, `MARKERS`, `MAPS`, `COVER`, `step(dt)`,
`newMatch(mode, diff, human, marker)`, `loadMap(key)`, `randomLayout(seed)`, `astar`, `issueOrder`,
`humanPlayer`, `settings`. Keep it: the balance tests depend on it.

## How balance was tested

Headless Chromium (Playwright): load the page (now the `npm run dev` URL), call `newMatch(mode, diff, false)` so all six players are bots,
then call `step(1/60)` in a loop until `G.phase === 'over'` (capped at 420 simulated seconds). Measured:

- Capture the Flag: average match length, total captures, timeouts (neither team reached 3), Blue wins.
- Last Team Standing: average round length, Blue wins.
- Random fields: generate 300 with different seeds and count any that fall back to Snake Line.

### Latest results (version 3, at handoff)

| Setting | Result |
|---|---|
| Snake Line, CTF Normal | about 107-120 s per match, about 4 captures, 0 timeouts (10 and 20 match batches) |
| Snake Line, CTF Hard | 162 s, 3.9 captures, 1 timeout in 10 |
| Snake Line, LTS round length (Easy / Normal / Hard) | 24 / 20 / 17 s |
| Barrel Yard, CTF Normal | 264 s, 3 timeouts in 8 |
| Midline, CTF Normal | 115 s, 0 timeouts in 8 |
| Random, CTF Normal | 238 s, 1 timeout in 8 |
| LTS round length on other fields (Normal) | 21-23 s |
| Random field generator | 300 of 300 valid, about 2 ms each |

Refactor check (2026-11-12, splitting into files): with `Math.random` swapped for a seeded generator and
`requestAnimationFrame` stopped, the original file and the split version produced identical results in 24 of 24
bot-only matches (every mode × skill × field) and 300 of 300 random fields.

For history: version 1 had CTF Normal running out the clock in 6 of 8 matches, Hard in 8 of 8, and LTS rounds of 9-14 s.

## Open items and ideas

- **Possible Blue tilt:** Blue won about 60% of bot-only CTF matches on Snake Line in some batches (13 of 20 in the
  largest). It could be noise, or a small asymmetry: A* neighbor order, the scan order in `nearestFree`, or players
  updating in team order. Worth a proper check with bigger batches.
- Easy LTS rounds dropped from 33 s to 24 s once bots learned to sprint between bunkers.
- Barrel Yard Capture the Flag runs long (3 timeouts in 8).
- Replace the drawn art and synthesized sounds with real asset packs (for example CC0 packs). Jeff wants to do this here.
- Skipped for now, by Jeff's choice: an "enemy paint slows you down" mechanic, and local 2-player / online multiplayer.
