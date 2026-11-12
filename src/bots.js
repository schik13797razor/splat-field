import { DIFF, MK, LANE_Y, LANE_X } from './config.js';
import { H, TAU, clamp, rand, dist, rectCenter, angleDiff, turnToward } from './util.js';
import { BASES } from './field.js';
import { raycast } from './geometry.js';
import { freePoint, astar, COVER } from './pathfinding.js';
import { G, humanPlayer } from './state.js';
import { isHittable, speedFor, canShoot, shoot, startReload } from './rules.js';

/* ---------- 7. BOT BRAINS ----------
   Every ~0.3 s a bot "thinks": it picks a target it can see and decides where to go.
   Every frame it walks its path, sidesteps while shooting, and fires when its aim is close. */
function setGoal(p, pt) {
  const ai = p.ai;
  if (!ai.goal || Math.hypot(ai.goal.x - pt.x, ai.goal.y - pt.y) > 22) {
    ai.goal = freePoint(pt); ai.repath = 0; ai.atGoal = false;
  }
}
function followPath(p) {
  const ai = p.ai;
  if (!ai.goal) { ai.atGoal = true; return [0, 0]; }
  const gd = Math.hypot(ai.goal.x - p.x, ai.goal.y - p.y);
  if (gd < 18) ai.atGoal = true; else if (gd > 60) ai.atGoal = false; // slack, so leaning out of cover still counts as "at cover"
  if (ai.atGoal) return [0, 0];
  if (ai.repath <= 0) { ai.path = astar(p.x, p.y, ai.goal.x, ai.goal.y) || []; ai.repath = rand(0.8, 1.2); }
  const path = ai.path;
  let guard = 0;
  while (path.length > 1 && guard++ < 6 && !raycast(p.x, p.y, path[1].x, path[1].y, p.r * 0.85)) path.shift(); // shortcut when the way is clear
  if (path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 8) path.shift();
  const tg = path.length ? path[0] : ai.goal;
  const dx = tg.x - p.x, dy = tg.y - p.y, L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}
function pickTarget(p, D) {
  let best = null, bs = Infinity;
  const m = MK(p), sight = Math.min(D.sight * m.botSight, m.range * 0.92);
  const alerted = p.ai.alert ? p.ai.alert.who : null;            // someone just shot at us from range
  for (const e of G.players) {
    if (e.team === p.team || !isHittable(e)) continue;
    const d = dist(p, e);
    if (d > (e === alerted ? 1000 : sight) || raycast(p.x, p.y, e.x, e.y, 1.5)) continue;   // too far or behind a bunker
    const s = d - (e.carrying ? 200 : 0) - (e === p.ai.target ? 60 : 0);
    if (s < bs) { bs = s; best = e; }
  }
  // spotting someone after a quiet stretch takes a beat longer than switching targets mid-fight
  if (best && best !== p.ai.target) p.ai.react = (p.ai.noSee > 1.5 ? D.acquire : 0) + D.reaction * rand(0.8, 1.3);
  p.ai.target = best;
  if (best) { p.ai.noSee = 0; p.ai.threat = { x: best.x, y: best.y }; }
}
function closestBot(team, pt) {
  let best = null, bd = Infinity;
  for (const q of G.players) if (q.team === team && !q.isHuman && q.state === 'active') { const d = dist(q, pt); if (d < bd) { bd = d; best = q; } }
  return best;
}

export function updateBot(p, dt) {
  const D = DIFF[G.diff], ai = p.ai, m = MK(p);
  ai.think -= dt; ai.repath -= dt;
  if (ai.alert && (ai.alert.t -= dt) <= 0) ai.alert = null;
  if (p.state === 'painted') {
    ai.target = null;
    const c = rectCenter(BASES[p.team].wash);
    setGoal(p, { x: c.x + (p.idx - 1) * 26, y: c.y + (p.idx === 1 ? -6 : 8) });
  } else if (ai.think <= 0) {
    ai.think = rand(0.22, 0.36);
    pickTarget(p, D);
    ai.routed = false;
    if (p.carrying) carryHome(p);
    else if (!followOrders(p)) { if (G.mode === 'ctf') ctfBrain(p, D); else ltsBrain(p, D); }
    if (!ai.routed) ai.routeKey = '';
    if (!ai.target && p.ammo < m.hopper * 0.6) startReload(p); // top up during a quiet moment
  }
  if (ai.target && !isHittable(ai.target)) ai.target = null;

  let [mx, my] = followPath(p);
  if (p.state === 'active' && ai.target && !p.carrying) {
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafeT = rand(0.45, 1.2); const r = Math.random(); ai.strafe = r < 0.38 ? -1 : r < 0.76 ? 1 : 0; }
    const dx = ai.target.x - p.x, dy = ai.target.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (ai.atGoal && ai.goal) {
      // at cover: lean a short step out to one side and back, instead of drifting into the open
      const px = ai.goal.x - dy / d * ai.strafe * 22, py = ai.goal.y + dx / d * ai.strafe * 22;
      const ex = px - p.x, ey = py - p.y, el = Math.hypot(ex, ey);
      if (el > 3) { const k = Math.min(1, el / 25) * 0.7; mx = ex / el * k; my = ey / el * k; }
    } else {
      mx = mx * 0.6 + (-dy / d) * ai.strafe * 0.65;
      my = my * 0.6 + (dx / d) * ai.strafe * 0.65;
    }
  } else {
    ai.noSee += dt;
    if (ai.atGoal && ai.goal && !p.carrying) {
      let gx = ai.goal.x, gy = ai.goal.y;
      if (ai.threat && ai.noSee < 4) { // lean out toward where we last saw someone, then duck back
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafeT = rand(0.5, 1.1); ai.strafe = ai.strafe ? 0 : Math.random() < 0.5 ? -1 : 1; }
        const dx = ai.threat.x - gx, dy = ai.threat.y - gy, d = Math.hypot(dx, dy) || 1;
        gx -= dy / d * ai.strafe * 30; gy += dx / d * ai.strafe * 30;
      }
      const ex = gx - p.x, ey = gy - p.y, el = Math.hypot(ex, ey);
      if (el > 6) { const k = Math.min(1, el / 25) * 0.7; mx = ex / el * k; my = ey / el * k; }
    }
  }
  if (ai.atGoal && !ai.target) ai.hold -= dt;

  // unstick: if we meant to move but barely did, re-plan and take a small random step
  ai.stuckT += dt;
  if (ai.stuckT > 0.6) {
    const lp = ai.lastPos;
    if (lp && ai.goal && !ai.atGoal && (mx || my) && Math.hypot(p.x - lp.x, p.y - lp.y) < 10) { ai.repath = 0; ai.nudge = rand(0, TAU); ai.nudgeT = 0.35; }
    ai.lastPos = { x: p.x, y: p.y }; ai.stuckT = 0;
  }
  if (ai.nudgeT > 0) { ai.nudgeT -= dt; mx = Math.cos(ai.nudge); my = Math.sin(ai.nudge); }

  const L = Math.hypot(mx, my);
  if (L > 1) { mx /= L; my /= L; }
  // sprint on long trips when nobody is in sight (and always when heading to the wash pad)
  const far = ai.goal && !ai.atGoal && Math.hypot(ai.goal.x - p.x, ai.goal.y - p.y) > 170;
  p.sprinting = !!(far && L > 0.5 && (p.state === 'painted' || !ai.target) && !p.winded && (p.sprinting || p.stamina > 0.45));
  const sp = speedFor(p);
  p.vx = mx * sp; p.vy = my * sp;

  if (p.state === 'active' && ai.target) {
    const t = ai.target, td = dist(p, t), tf = td / m.speed;
    const want = Math.atan2(t.y + t.vy * tf * D.lead - p.y, t.x + t.vx * tf * D.lead - p.x);
    p.aim = turnToward(p.aim, want, D.turn * dt);
    ai.react -= dt;
    if (ai.react <= 0 && canShoot(p) && td < m.range && Math.abs(angleDiff(p.aim, want)) < 0.2) {
      const running = Math.hypot(p.vx, p.vy) / speedFor(p);
      shoot(p, p.aim, (D.aimError + D.moveError * running) * m.botAim);
      p.cool = D.fireDelay * m.botDelay * rand(0.8, 1.25);
      if (p.marker === 'electro' && --ai.burstLeft <= 0) { ai.burstLeft = Math.round(rand(D.burst[0], D.burst[1])); p.cool += rand(D.pause[0], D.pause[1]); }
    }
  } else if (L > 0.1) p.aim = turnToward(p.aim, Math.atan2(my, mx), D.turn * 0.6 * dt);
}

// Find a nearby spot behind a bunker that `threat` can't see.
function findCover(p, threat, maxD) {
  let best = null, bs = Infinity;
  for (const side of COVER) for (const c of side) {
    const d = dist(p, c);
    if (d > maxD || !raycast(threat.x, threat.y, c.x, c.y, 2)) continue;
    if (d < bs) { bs = d; best = c; }
  }
  return best;
}

// Last Team Standing: hop forward from cover to cover in your lane; hunt once things go quiet.
function ltsBrain(p, D) {
  const ai = p.ai;
  const foes = G.players.filter(e => e.team !== p.team && e.state !== 'out');
  if (!foes.length) return;
  if (ai.target) {
    // caught in the open by someone? get behind the nearest bunker instead of trading shots
    const safe = ai.goal && raycast(ai.target.x, ai.target.y, ai.goal.x, ai.goal.y, 2);
    if (!safe && foes.length > 1) { const c = findCover(p, ai.target, 190); if (c) { setGoal(p, c); ai.hold = rand(D.hold[0], D.hold[1]); } }
    return;
  }
  if (ai.goal && !ai.atGoal) return;
  if (ai.atGoal && (ai.hold > 0 || ai.noSee < 3)) return; // just traded shots: stay in cover a moment
  const fwd = p.team === 0 ? 1 : -1;
  let nf = foes[0], nd = Infinity;
  for (const e of foes) { const d = dist(p, e); if (d < nd) { nd = d; nf = e; } }
  if (ai.noSee > 7 || foes.length === 1) { setGoal(p, nf); ai.hold = 0; return; }
  const myX = p.x * fwd, foeX = nf.x * fwd;
  let best = null, bs = -Infinity;
  for (const c of COVER[p.team]) {
    const cx = c.x * fwd, gain = cx - myX;
    if (gain < 40 || cx > foeX - 60) continue;
    const s = -Math.abs(gain - 170) * 0.6 - Math.abs(c.y - ai.laneY) * 0.9 + rand(0, 80);
    if (s > bs) { bs = s; best = c; }
  }
  if (best) { setGoal(p, best); ai.hold = rand(D.hold[0], D.hold[1]); }
  else { setGoal(p, nf); ai.hold = 0; }
}

// Routes: walk a list of waypoints (an attack lane), then the final spot.
// The route is planned once per `key` so a bot doesn't flip between lanes every time it thinks.
function routeTo(p, final, key, build) {
  const ai = p.ai;
  ai.routed = true;
  if (ai.routeKey !== key) { ai.routeKey = key; ai.route = build(); }
  const r = ai.route;
  while (r.length && (dist(p, r[0]) < 50 || dist(p, final) < dist(r[0], final) + 10)) r.shift(); // reached or already past it
  setGoal(p, r.length ? r[0] : final);
}
// Pick the lane with the fewest enemies near it. A little randomness keeps bots from being predictable.
function pickLane(p) {
  let best = 0, bs = Infinity;
  LANE_Y.forEach((y, i) => {
    let s = rand(0, 160) + (i === 1 ? 70 : 0); // slight preference for the flanks
    for (const e of G.players) if (e.team !== p.team && e.state === 'active') s += Math.max(0, 320 - Math.abs(e.y - y));
    if (s < bs) { bs = s; best = i; }
  });
  return LANE_Y[best];
}
const laneRoute = (p, xs) => { const y = pickLane(p); return xs.map(x => ({ x, y })); };

// Flag carrier: run home down a lane instead of straight through the middle.
function carryHome(p) {
  const z = BASES[p.team].zone;
  const home = { x: z.x + z.w / 2, y: clamp(p.y, z.y + 40, z.y + z.h - 40) };
  routeTo(p, home, 'carry', () => laneRoute(p, [LANE_X[p.team], LANE_X[1 - p.team]]));
}
// Go for the enemy flag, or escort the teammate who already has it.
function attackFlag(p) {
  const theirs = G.flags[1 - p.team];
  if (theirs.state === 'carried') {
    const c = theirs.carrier;
    return setGoal(p, { x: c.x + (p.team === 0 ? 70 : -70), y: c.y + (p.idx % 2 ? 55 : -55) });
  }
  if (theirs.state === 'dropped') return setGoal(p, theirs);
  routeTo(p, theirs, 'attack', () => laneRoute(p, [LANE_X[p.team]]));
}

// Capture the Flag: attacker goes for the flag, support travels with the attacker, defender guards home.
function ctfBrain(p, D) {
  const ai = p.ai, me = p.team, foe = 1 - me;
  const mine = G.flags[me], theirs = G.flags[foe], home = BASES[me];
  if (mine.state === 'dropped' && closestBot(me, mine) === p) return setGoal(p, mine);           // go return our flag
  if (mine.state === 'carried') {                                                              // chase the thief
    const d = dist(p, mine.carrier);
    if (p.role === 'defender' ? d < 420 : p.role === 'attacker' ? d < 300 : true) return setGoal(p, mine.carrier);
  }
  if (theirs.state === 'carried' && p.role !== 'defender') return attackFlag(p);              // escort our carrier
  if (p.role === 'attacker') return attackFlag(p);
  if (p.role === 'support') {
    const att = G.players.find(q => q.team === me && q.role === 'attacker');
    if (!att || att.state !== 'active') return attackFlag(p);                                  // take over the attack
    const back = me === 0 ? -85 : 85;
    return setGoal(p, { x: att.x + back, y: att.y + (att.y < H / 2 ? 60 : -60) });
  }
  // defender
  let intr = null, id = 420;
  for (const e of G.players) { if (e.team === me || e.state !== 'active') continue; const d = dist(e, home.flag); if (d < id) { id = d; intr = e; } }
  if (intr) return setGoal(p, intr);
  if (ai.goal && (!ai.atGoal || ai.hold > 0)) return;
  const spots = COVER[me].filter(c => { const d = dist(c, home.flag); return d > 150 && d < 430; });
  const s = spots[Math.floor(Math.random() * spots.length)];
  if (s) { setGoal(p, s); ai.hold = rand(2.5, 5); }
}

// Squad orders from you (keys 1-4) for your two bots. Returns false to let the bot do its normal job.
function followOrders(p) {
  if (!G.human || p.team !== 0) return false;
  const sq = G.squad, hp = humanPlayer();
  if (sq.cmd === 'follow') {
    if (!hp || hp.state !== 'active') return false;                 // you're painted or out: they play normally
    setGoal(p, { x: hp.x - 55, y: hp.y + (p.idx === 1 ? -48 : 48) });
    return true;
  }
  if (sq.cmd === 'hold') { setGoal(p, { x: sq.x, y: sq.y + (p.idx === 1 ? -26 : 26) }); return true; }
  if (sq.cmd === 'attack') {
    if (G.mode === 'ctf') {
      const mine = G.flags[0];
      if (mine.state === 'dropped' && closestBot(0, mine) === p && dist(p, mine) < 300) setGoal(p, mine);
      else attackFlag(p);
    } else {
      let nf = null;
      for (const e of G.players) if (e.team === 1 && e.state !== 'out' && (!nf || dist(p, e) < dist(p, nf))) nf = e;
      if (nf) setGoal(p, nf);
    }
    return true;
  }
  return false;
}
