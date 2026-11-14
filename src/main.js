/* =====================================================================
   SPLAT FIELD: a 3v3 top-down paintball game.
   How the code is organized (one file per section, in src/):
    1. CONFIG ........ numbers you can tweak (speeds, sprint, markers, wash time, win rules)
    2. FIELD ......... bases and the field layouts (Snake Line, Barrel Yard, Midline, Hilltop, random)
    3. GEOMETRY ...... collision and line-of-sight math
    4. PATHFINDING ... A* search so bots can walk around bunkers
    5. GAME STATE .... players, paintballs, flags, scores
    6. RULES ......... shooting, hits, washing, flags, the hill, rounds, winning
    7. BOT BRAINS .... how computer players pick targets and where to go
    8. DRAWING ....... the field, paint splats, players, effects
    9. SOUND ......... small synthesized sound effects
   10. INPUT + UI .... keyboard, mouse, touch, menus, scoreboard
   11. MAIN LOOP ..... update, then draw, about 60 times a second
   ===================================================================== */

import './styles.css';
import { CFG, DIFF, MARKERS } from './config.js';
import { MAPS } from './field.js';
import { astar, COVER, randomLayout } from './pathfinding.js';
import { G, hitMark, humanPlayer, newMatch } from './state.js';
import { updateBalls, updatePlayers, updateFlags, checkLTS, nextRound, ctfTimeout, endMatch, updateHill, kothTimeout } from './rules.js';
import { drawField, updateParticles, render } from './drawing.js';
import { Sound } from './sound.js';
import { $, stage, bindPointerInput, issueOrder, banner, settings, syncSettingsUI, loadMap, startHumanMatch, startDemo, showEnd, updateHUD, resize } from './ui.js';

/* ---------- 11. MAIN LOOP ---------- */
function update(dt) {
  if (G.paused) return;
  updateParticles(dt);
  hitMark.t = Math.max(0, hitMark.t - dt);
  const fx = G.fx;
  fx.shake = Math.max(0, fx.shake - dt * 30);
  fx.vignette = Math.max(0, fx.vignette - dt * 1.6);
  if (fx.hitT > 0) { // keep the hit arrow pointed at the shooter as they move
    fx.hitT -= dt;
    const hp = humanPlayer();
    if (hp && fx.shooter) fx.hitAngle = Math.atan2(fx.shooter.y - hp.y, fx.shooter.x - hp.x);
  }
  if (G.phase === 'countdown') {
    const before = Math.ceil(G.count);
    G.count -= dt;
    const after = Math.ceil(G.count);
    if (G.count <= 0) { G.phase = 'play'; banner('GO!', G.countSub, 0.8); Sound.whistle(false); }
    else if (after !== before) { banner(String(after), G.countSub, 1.1); Sound.beep(false); }
  } else if (G.phase === 'play') G.time -= dt;
  else G.phaseT -= dt;

  updatePlayers(dt);
  updateBalls(dt);
  if (G.phase === 'play') {
    if (G.mode === 'ctf') { updateFlags(dt); if (G.phase === 'play' && G.time <= 0) ctfTimeout(); }
    else if (G.mode === 'koth') { updateHill(dt); if (G.phase === 'play' && G.time <= 0) kothTimeout(); }
    else checkLTS();
  }
  if (G.phase === 'roundEnd' && G.phaseT <= 0) { if (G.pendingWinner !== null) endMatch(G.pendingWinner); else nextRound(); }
  else if (G.phase === 'over' && G.phaseT <= 0 && !G.endHandled) { G.endHandled = true; if (G.human) showEnd(); else startDemo(); }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const steps = G.fast && G.human ? CFG.fastForward : 1;
  for (let i = 0; i < steps; i++) update(dt);
  render();
  updateHUD();
  requestAnimationFrame(frame);
}

// expose a tiny hook for automated testing (harmless in normal play)
window.__splat = { G, CFG, DIFF, MARKERS, MAPS, COVER, step: dt => update(dt), newMatch, startHumanMatch, issueOrder, humanPlayer, loadMap, randomLayout, astar, settings };

function boot() {
  bindPointerInput();
  syncSettingsUI();
  drawField();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawField);
  resize();
  new ResizeObserver(resize).observe(stage);
  startDemo();
  requestAnimationFrame(t => { last = t; frame(t); });
}
boot();
