import { CFG, DIFF, MK, TEAMS } from './config.js';
import { W, H, TAU, clamp, rand, inRect } from './util.js';
import { BORDER, BASES } from './field.js';
import { segCircle, raycast, resolveCircle } from './geometry.js';
import { G, hitMark, placeAtSpawns, humanPlayer } from './state.js';
import { updateBot } from './bots.js';
import { splat, burst, muzzlePuff, dust, washDrop } from './drawing.js';
import { Sound } from './sound.js';
import { updateHuman, aimHuman, banner, feed } from './ui.js';

/* ---------- 6. RULES ---------- */
export const isHittable = p => p.state === 'active' && p.protect <= 0;
export function speedFor(p) {
  const base = p.isHuman ? CFG.playerSpeed : CFG.botSpeed * DIFF[G.diff].speed;
  return base * (p.carrying ? CFG.carrierSlow : 1) * (p.sprinting ? CFG.sprintMul : 1);
}
// Stamina: sprinting drains it; after a short rest it refills. Run it to empty and you're winded for a moment.
function updateStamina(p, dt) {
  if (p.sprinting && (p.vx || p.vy)) {
    p.stamina -= CFG.staminaDrain * dt; p.stamWait = CFG.staminaDelay;
    if (p.stamina <= 0) { p.stamina = 0; p.sprinting = false; p.winded = true; }
    if (Math.random() < dt * 16) dust(p);
  } else if (p.stamWait > 0) p.stamWait -= dt;
  else {
    p.stamina = Math.min(1, p.stamina + CFG.staminaRegen * dt);
    if (p.winded && p.stamina >= 0.35) p.winded = false;
  }
}
function volAt(x, y) {
  if (!G.human) return 0;
  const hp = humanPlayer();
  return hp ? clamp(1.15 - Math.hypot(hp.x - x, hp.y - y) / 1300, 0.25, 1) : 0.5;
}

function fire(p, angle, spread) {
  const m = MK(p), a = angle + (Math.random() * 2 - 1) * spread;
  G.balls.push({ x: p.x, y: p.y, vx: Math.cos(a) * m.speed, vy: Math.sin(a) * m.speed, team: p.team, owner: p, traveled: 0, range: m.range });
}
// Hopper: every ball fired uses one paintball (the Scatter fires 3 per shot). Run dry and the reload starts on its
// own. No shooting while sprinting.
export const canShoot = p => p.state === 'active' && p.cool <= 0 && p.reloadT <= 0 && p.ammo > 0 && !p.sprinting;
export function shoot(p, angle, spread) {
  const m = MK(p), k = m.pellets || 1;
  for (let i = 0; i < k; i++) fire(p, angle + (i - (k - 1) / 2) * (m.fan || 0), spread);
  muzzlePuff(p, angle);
  Sound.shot(volAt(p.x, p.y) * (p.isHuman ? 1 : 0.7), p.marker);
  p.ammo = Math.max(0, p.ammo - k);
  if (p.ammo <= 0) startReload(p);
}
export function startReload(p) {
  if (p.reloadT > 0 || p.ammo >= MK(p).hopper || p.state !== 'active') return;
  p.reloadT = MK(p).reload;
  if (p.isHuman) Sound.reload();
}
// Paint landing near a bot (or hitting its teammate) tells it where the shot came from, even from long range.
function alertNear(x, y, shooter, radius) {
  for (const q of G.players) {
    if (q.isHuman || q.team === shooter.team || q.state !== 'active') continue;
    if (Math.hypot(q.x - x, q.y - y) < radius) q.ai.alert = { who: shooter, t: 2.5 };
  }
}

// Move every paintball. Each one either flies on, hits a player, splats on a bunker, or runs out of range.
export function updateBalls(dt) {
  const keep = [];
  for (const b of G.balls) {
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    const step = Math.hypot(nx - b.x, ny - b.y);
    if (step === 0) { keep.push(b); continue; }
    let t = 1, kind = null, who = null;
    const rc = raycast(b.x, b.y, nx, ny, CFG.ballRadius * 0.6);
    if (rc) { t = rc.t; kind = 'wall'; }
    for (const p of G.players) {
      if (G.phase !== 'play' || p.team === b.team || !isHittable(p)) continue; // no hits once a round is over
      const pt = segCircle(b.x, b.y, nx, ny, p.x, p.y, p.r + CFG.ballRadius);
      if (pt !== null && pt < t) { t = pt; kind = 'player'; who = p; }
    }
    const rangeT = (b.range - b.traveled) / step;
    if (rangeT < t) { t = Math.max(0, rangeT); kind = 'ground'; who = null; }
    const ix = b.x + (nx - b.x) * t, iy = b.y + (ny - b.y) * t, ang = Math.atan2(b.vy, b.vx);
    if (kind) alertNear(ix, iy, b.owner, kind === 'player' ? 220 : 80);
    if (kind === 'player') { registerHit(who, b.owner, ix, iy, ang); continue; }
    if (kind === 'wall') { splat(ix, iy, b.team, rand(10, 14), ang); burst(ix, iy, b.team, 6); Sound.splat(volAt(ix, iy) * 0.8); continue; }
    if (kind === 'ground') { splat(ix, iy, b.team, rand(7, 10), ang); burst(ix, iy, b.team, 3); continue; }
    if (nx < BORDER || nx > W - BORDER || ny < BORDER || ny > H - BORDER) {
      splat(clamp(nx, BORDER, W - BORDER), clamp(ny, BORDER, H - BORDER), b.team, rand(8, 11), ang); continue;
    }
    b.x = nx; b.y = ny; b.traveled += step; keep.push(b);
  }
  G.balls = keep;
}

// Somebody got painted: the shooter's team scores a hit point.
function registerHit(v, shooter, x, y, ang) {
  G.hits[shooter.team]++; shooter.stats.hits++; v.stats.painted++;
  bodySplat(v, shooter.team, x, y);
  splat(v.x + Math.cos(ang) * (v.r + 7), v.y + Math.sin(ang) * (v.r + 7), shooter.team, rand(9, 12), ang);
  burst(x, y, shooter.team, 10);
  if (v.carrying) dropFlag(v);
  if (G.mode === 'lts') { v.state = 'out'; v.outT = 0; }
  else { v.state = 'painted'; v.washT = 0; }
  v.reloadT = 0;
  v.ai.target = null; v.ai.goal = null; v.ai.path = []; v.ai.routeKey = '';
  Sound.hit(Math.max(volAt(x, y), v.isHuman || shooter.isHuman ? 0.9 : 0));
  if (shooter.isHuman) { hitMark.t = 0.28; G.fx.shake = Math.max(G.fx.shake, 2.5); }
  if (v.isHuman) Object.assign(G.fx, { hitT: 1.8, hitTeam: shooter.team, shooter, shake: CFG.shakeHit, vignette: 1,
                                       hitAngle: Math.atan2(shooter.y - v.y, shooter.x - v.x) });
  feed(`${shooter.name} painted ${v.name}`, shooter.team);
  if (v.isHuman) banner(G.mode === 'lts' ? "You're out" : 'Painted!', `by ${shooter.name}`, 1.3, 't' + shooter.team);
}
function bodySplat(v, team, x, y) {
  let ox = x - v.x, oy = y - v.y;
  const L = Math.hypot(ox, oy) || 1, k = Math.min(L, v.r * 0.5) / L;
  ox *= k; oy *= k;
  const lobes = [[ox, oy, rand(5, 6.5)]];
  for (let i = 0; i < 5; i++) { const a = rand(0, TAU), d = rand(2, 7); lobes.push([ox + Math.cos(a) * d, oy + Math.sin(a) * d, rand(1.8, 4.2)]); }
  v.splats.push({ team, lobes });
}
function cleanUp(p) {
  p.state = 'active'; p.washT = 0; p.splats = []; p.protect = CFG.spawnProtect;
  p.ammo = MK(p).hopper; p.reloadT = 0; p.stamina = 1; p.winded = false; // the wash pad refills paint and legs
  Sound.wash(p.isHuman);
  if (p.isHuman) banner('Clean', 'Hopper refilled', 1.0);
}

// Three passes so neither team sees fresher information than the other. (With one pass, Blue updated after
// Orange and aimed at where Orange was *this* frame, which made Blue win ~57% of bot-only CTF matches.)
//   1. timers for everyone   2. everyone decides from the same start-of-frame picture   3. everyone moves
export function updatePlayers(dt) {
  const frozen = G.phase !== 'play';
  const live = [];
  for (const p of G.players) {
    if (p.state === 'out') { p.outT += dt; continue; }
    live.push(p);
    p.cool -= dt;
    if (p.protect > 0) p.protect -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { p.reloadT = 0; p.ammo = MK(p).hopper; if (p.isHuman) Sound.reloaded(); }
    }
  }
  if (frozen) for (const p of live) { p.vx = p.vy = 0; p.sprinting = false; if (p.isHuman) aimHuman(p); }
  else {
    // Decide: aim, shoot, pick a direction. Bots lead their shots with the target's velocity, so each player's
    // new velocity is held back until everyone has decided.
    const next = live.map(p => {
      const vx = p.vx, vy = p.vy;
      if (p.isHuman) updateHuman(p, dt); else updateBot(p, dt);
      const v = [p.vx, p.vy];
      p.vx = vx; p.vy = vy;
      return v;
    });
    // Move.
    live.forEach((p, i) => {
      [p.vx, p.vy] = next[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      resolveCircle(p, p.r);
      updateStamina(p, dt);
      if (p.state === 'painted' && inRect(p, BASES[p.team].wash)) {
        p.washT += dt;
        if (Math.random() < dt * 22) washDrop(p);
        if (p.washT >= CFG.washTime) cleanUp(p);
      }
    });
  }
  // keep players from standing inside each other
  const ps = G.players.filter(p => p.state !== 'out');
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
    if (d < min && d > 0.01) {
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
      resolveCircle(a, a.r); resolveCircle(b, b.r);
    }
  }
}

// Flags: grab the other team's, return your own if it's dropped, score by carrying it into your base.
export function updateFlags(dt) {
  for (const f of G.flags) {
    if (f.state === 'carried') {
      const c = f.carrier;
      f.x = c.x; f.y = c.y;
      if (inRect(c, BASES[c.team].zone)) capture(c, f);
      continue;
    }
    if (f.state === 'dropped') {
      f.dropT += dt;
      if (f.dropT >= CFG.flagReturnTime) { returnFlag(f, null); continue; }
    }
    for (const p of G.players) {
      if (p.state !== 'active' || Math.hypot(p.x - f.x, p.y - f.y) > p.r + 12) continue;
      if (p.team !== f.team && !p.carrying) {
        f.state = 'carried'; f.carrier = p; p.carrying = f;
        feed(`${p.name} grabbed the ${TEAMS[f.team].name} flag`, p.team);
        Sound.grab(); if (p.isHuman) banner('Flag grabbed', 'Run it home', 1.1, 't' + p.team);
        else if (G.human && f.team === 0) banner('Flag taken', `${p.name} has your flag`, 1.3, 't1');
        break;
      }
      if (p.team === f.team && f.state === 'dropped') { returnFlag(f, p); break; }
    }
  }
}
function dropFlag(p) {
  const f = p.carrying;
  Object.assign(f, { state: 'dropped', carrier: null, dropT: 0, x: p.x, y: p.y });
  p.carrying = null;
  feed(`${TEAMS[f.team].name} flag dropped`, 1 - f.team);
}
function returnFlag(f, by) {
  Object.assign(f, { state: 'home', carrier: null, dropT: 0, x: BASES[f.team].flag.x, y: BASES[f.team].flag.y });
  feed(by ? `${by.name} returned the ${TEAMS[f.team].name} flag` : `${TEAMS[f.team].name} flag went home`, f.team);
}
function capture(c, f) {
  G.caps[c.team]++; c.stats.caps++; c.carrying = null;
  Object.assign(f, { state: 'home', carrier: null, dropT: 0, x: BASES[f.team].flag.x, y: BASES[f.team].flag.y });
  feed(`${c.name} captured the ${TEAMS[f.team].name} flag`, c.team);
  banner(`${TEAMS[c.team].name} scores`, `${c.name} captured the flag`, 2, 't' + c.team);
  Sound.cheer();
  if (G.caps[c.team] >= CFG.ctfCapsToWin) endMatch(c.team);
}

export function checkLTS() {
  const alive = [0, 1].map(t => G.players.filter(p => p.team === t && p.state !== 'out').length);
  if (alive[0] === 0 || alive[1] === 0) endRound(alive[0] === alive[1] ? -1 : alive[0] > 0 ? 0 : 1);
  else if (G.time <= 0) endRound(alive[0] === alive[1] ? -1 : alive[0] > alive[1] ? 0 : 1);
}
function endRound(w) {
  G.phase = 'roundEnd'; G.phaseT = 2.8;
  Sound.whistle(true);
  if (w >= 0) { G.roundWins[w]++; banner(`${TEAMS[w].name} takes it`, `Round ${G.round}`, 2.4, 't' + w); Sound.cheer(); }
  else banner('Draw', `Round ${G.round}`, 2.4);
  G.pendingWinner = w >= 0 && G.roundWins[w] >= CFG.ltsRoundsToWin ? w : null;
}
export function nextRound() {
  G.round++;
  placeAtSpawns();
  G.balls = [];
  G.fast = false;
  G.time = CFG.ltsRoundTime;
  if (G.human) { G.phase = 'countdown'; G.count = 3; G.countSub = `Round ${G.round}`; banner('3', G.countSub, 1.1); Sound.beep(false); }
  else G.phase = 'play';
}
export function ctfTimeout() {
  const [c0, c1] = G.caps, [h0, h1] = G.hits;
  endMatch(c0 !== c1 ? (c0 > c1 ? 0 : 1) : h0 !== h1 ? (h0 > h1 ? 0 : 1) : -1);
}
export function endMatch(w) {
  G.phase = 'over'; G.winner = w; G.phaseT = G.human ? 1.6 : 5; G.endHandled = false;
  Sound.whistle(true);
  if (G.human) banner(w < 0 ? 'Draw' : `${TEAMS[w].name} wins`, 'Match over', 1.6, w < 0 ? '' : 't' + w);
}
