import { CFG, MK, MARKERS, TEAMS, PAL, FONT_UI, FONT_DISPLAY } from './config.js';
import { W, H, TAU, clamp, rand, rectCenter, hexA, mulberry32 } from './util.js';
import { BORDER, OBST, BASES } from './field.js';
import { G, reduceMotion, hitMark, humanPlayer, custom } from './state.js';
import { mouse, touch, input, STICK } from './ui.js';

/* ---------- 8. DRAWING ---------- */
export const canvas = document.getElementById('game');
const mctx = canvas.getContext('2d');
const FS = 1.5; // the field and paint layers are drawn once at 1.5x for crispness, then scaled
const fieldLayer = document.createElement('canvas');
const paintLayer = document.createElement('canvas');
fieldLayer.width = paintLayer.width = W * FS;
fieldLayer.height = paintLayer.height = H * FS;
const pctx = paintLayer.getContext('2d');
pctx.setTransform(FS, 0, 0, FS, 0, 0);
export const view = { s: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };

function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function rrPath(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shapePath(c, o) {
  if (o.t === 'circle') { c.beginPath(); c.arc(o.x, o.y, o.r, 0, TAU); return; }
  const rad = o.kind === 'snake' ? 12 : o.kind === 'temple' ? 8 : 11;
  rrPath(c, o.x, o.y, o.w, o.h, rad);
}
function drawBunker(c, o) {
  c.save(); c.translate(5, 7); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 10; c.fillStyle = 'rgba(0,0,0,0.26)'; shapePath(c, o); c.fill(); c.restore(); // soft shadow
  // tie-down straps and stakes holding the inflatable bunker to the turf
  const stakes = o.t === 'circle'
    ? [0.5, 2.6, 4.6].map(a => [o.x + Math.cos(a) * (o.r + 5), o.y + Math.sin(a) * (o.r + 5), o.x + Math.cos(a) * o.r, o.y + Math.sin(a) * o.r])
    : [[o.x - 4, o.y - 4, o.x + 5, o.y + 5], [o.x + o.w + 4, o.y - 4, o.x + o.w - 5, o.y + 5], [o.x - 4, o.y + o.h + 4, o.x + 5, o.y + o.h - 5], [o.x + o.w + 4, o.y + o.h + 4, o.x + o.w - 5, o.y + o.h - 5]];
  c.strokeStyle = 'rgba(20,24,28,0.7)'; c.lineWidth = 1.2;
  for (const [sx, sy, ex, ey] of stakes) { c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke(); }
  c.fillStyle = '#cfc7a8';
  for (const [sx, sy] of stakes) circle(c, sx, sy, 1.7);
  const bx = o.t === 'circle' ? o.x - o.r : o.x, by = o.t === 'circle' ? o.y - o.r : o.y;
  const bw = o.t === 'circle' ? o.r * 2 : o.w, bh = o.t === 'circle' ? o.r * 2 : o.h;
  const g = c.createLinearGradient(bx, by, bx + bw, by + bh);
  g.addColorStop(0, PAL.bunkerHi); g.addColorStop(0.55, PAL.bunker); g.addColorStop(1, PAL.bunkerLo);
  c.fillStyle = g; shapePath(c, o); c.fill();
  c.strokeStyle = PAL.bunkerEdge; c.lineWidth = 2; c.stroke();
  c.save(); shapePath(c, o); c.clip();
  c.strokeStyle = 'rgba(0,0,0,0.24)'; c.lineWidth = 1.5;
  if (o.t === 'circle') { c.beginPath(); c.arc(o.x, o.y, o.r * 0.62, 0, TAU); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.12)'; circle(c, o.x - o.r * 0.3, o.y - o.r * 0.35, o.r * 0.3); }
  else if (o.w > o.h) { for (let x = o.x + 46; x < o.x + o.w - 10; x += 46) { c.beginPath(); c.moveTo(x, o.y); c.lineTo(x, o.y + o.h); c.stroke(); } c.fillStyle = 'rgba(255,255,255,0.11)'; c.fillRect(o.x + 6, o.y + 4, o.w - 12, Math.min(6, o.h * 0.2)); }
  else { for (let y = o.y + 40; y < o.y + o.h - 10; y += 40) { c.beginPath(); c.moveTo(o.x, y); c.lineTo(o.x + o.w, y); c.stroke(); } c.fillStyle = 'rgba(255,255,255,0.11)'; c.fillRect(o.x + 4, o.y + 6, Math.min(6, o.w * 0.2), o.h - 12); }
  c.restore();
}
export function drawField() {
  const c = fieldLayer.getContext('2d');
  c.setTransform(FS, 0, 0, FS, 0, 0);
  c.fillStyle = PAL.turf; c.fillRect(0, 0, W, H);
  for (let i = 0; i < W / 100; i += 2) { c.fillStyle = 'rgba(255,255,255,0.035)'; c.fillRect(i * 100, 0, 100, H); } // mowing stripes
  const rnd = mulberry32(7);
  for (let i = 0; i < 14000; i++) { c.fillStyle = rnd() < 0.55 ? 'rgba(10,30,15,0.16)' : 'rgba(190,230,170,0.07)'; c.fillRect(rnd() * W, rnd() * H, 1.1, 2.6); }
  // worn turf where players run the most: out of each base and along the halfway line
  const wear = (x, y, rx, ry, a) => {
    c.save(); c.translate(x, y); c.scale(rx / ry, 1);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, ry);
    g.addColorStop(0, `rgba(125,110,72,${a})`); g.addColorStop(1, 'rgba(125,110,72,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, ry, 0, TAU); c.fill(); c.restore();
  };
  wear(220, 450, 90, 160, 0.24); wear(W - 220, 450, 90, 160, 0.24); wear(800, 450, 70, 300, 0.12);
  // netting
  c.fillStyle = PAL.net;
  c.fillRect(0, 0, W, BORDER); c.fillRect(0, H - BORDER, W, BORDER); c.fillRect(0, 0, BORDER, H); c.fillRect(W - BORDER, 0, BORDER, H);
  c.save(); c.beginPath(); c.rect(0, 0, W, H); c.rect(BORDER, BORDER, W - 2 * BORDER, H - 2 * BORDER); c.clip('evenodd');
  c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1;
  for (let k = -H; k < W; k += 8) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + H, H); c.moveTo(k + H, 0); c.lineTo(k, H); c.stroke(); }
  c.restore();
  // chalk lines
  c.strokeStyle = 'rgba(245,248,242,0.7)'; c.lineWidth = 2.5;
  c.strokeRect(BORDER + 1, BORDER + 1, W - 2 * BORDER - 2, H - 2 * BORDER - 2);
  c.setLineDash([14, 12]); c.beginPath(); c.moveTo(W / 2, BORDER); c.lineTo(W / 2, H - BORDER); c.stroke(); c.setLineDash([]);
  c.strokeStyle = 'rgba(245,248,242,0.22)'; c.lineWidth = 2;
  for (const x of [400, 1200]) { c.beginPath(); c.moveTo(x, BORDER); c.lineTo(x, H - BORDER); c.stroke(); }
  // bases
  for (let t = 0; t < 2; t++) {
    const b = BASES[t], z = b.zone, T = TEAMS[t];
    c.fillStyle = hexA(T.color, 0.13); c.fillRect(z.x, z.y, z.w, z.h);
    c.strokeStyle = hexA(T.color, 0.75); c.lineWidth = 2.5; c.setLineDash([10, 7]);
    c.strokeRect(z.x + 1.5, z.y + 1.5, z.w - 3, z.h - 3); c.setLineDash([]);
    c.save();
    c.translate(t === 0 ? z.x + 15 : z.x + z.w - 15, z.y + z.h * 0.69);
    c.rotate(t === 0 ? -Math.PI / 2 : Math.PI / 2);
    c.font = `15px ${FONT_DISPLAY}`; c.fillStyle = hexA(T.color, 0.9); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${T.name.toUpperCase()} BASE`, 0, 0);
    c.restore();
    const w = b.wash;
    c.fillStyle = PAL.washPad; rrPath(c, w.x, w.y, w.w, w.h, 6); c.fill();
    c.save(); rrPath(c, w.x, w.y, w.w, w.h, 6); c.clip();
    c.strokeStyle = 'rgba(127,214,255,0.22)'; c.lineWidth = 1;
    for (let x = w.x + 11.5; x < w.x + w.w; x += 11.5) { c.beginPath(); c.moveTo(x, w.y); c.lineTo(x, w.y + w.h); c.stroke(); }
    for (let y = w.y + 11.3; y < w.y + w.h; y += 11.3) { c.beginPath(); c.moveTo(w.x, y); c.lineTo(w.x + w.w, y); c.stroke(); }
    c.restore();
    c.strokeStyle = PAL.wash; c.lineWidth = 2; rrPath(c, w.x, w.y, w.w, w.h, 6); c.stroke();
    c.font = `16px ${FONT_DISPLAY}`; c.fillStyle = PAL.wash; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('WASH', w.x + w.w / 2, w.y + w.h / 2 + 1);
    c.strokeStyle = 'rgba(245,248,242,0.55)'; c.lineWidth = 2;
    c.beginPath(); c.arc(b.flag.x, b.flag.y, 19, 0, TAU); c.stroke();
  }
  for (const o of OBST) drawBunker(c, o);
  // evening light: corners fall off a little
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.26)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}
export function clearPaint() { pctx.clearRect(0, 0, W, H); }

// Visual-only randomness. Splats are drawn during the simulation, so they must take exactly the same numbers from
// Math.random as before (same count, same order) or every later bot decision would shift. Extra detail uses vr().
const vr = mulberry32(20261112), vrand = (a, b) => a + vr() * (b - a);
const onBunker = (x, y) => OBST.some(o => o.t === 'rect'
  ? x > o.x - 2 && x < o.x + o.w + 2 && y > o.y - 2 && y < o.y + o.h + 2
  : Math.hypot(x - o.x, y - o.y) < o.r + 2);
function blob(c, x, y, rx, ry, a) { c.beginPath(); c.ellipse(x, y, rx, ry, a, 0, TAU); c.fill(); }

// A paint splat: a core blob, lobes around it, tapered streaks in the direction the ball was flying, flecks, and a
// fine spray. On grass the paint soaks in (darker, softer edge); on a bunker it stays glossy.
export function splat(x, y, team, size, ang = rand(0, TAU)) {
  const c = pctx, T = TEAMS[team], hard = onBunker(x, y), s = size * (hard ? 1.25 : 1.15);
  // the random numbers, drawn in the original order
  const lobes = [], n = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) { const a = rand(0, TAU), d = s * rand(0.35, 0.8); lobes.push([x + Math.cos(a) * d, y + Math.sin(a) * d, s * rand(0.18, 0.46)]); }
  const streak = [], m = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < m; i++) { const sd = rand(-0.25, 0.25), d = s * (0.6 + i * 0.38 + rand(0, 0.3)); streak.push([x + Math.cos(ang + sd) * d, y + Math.sin(ang + sd) * d, s * 0.16 * (1 - i / (m + 1)) + 0.8]); }
  const flecks = [];
  for (let i = 0; i < 6; i++) { const a = rand(0, TAU), d = s * rand(1, 1.9); flecks.push([x + Math.cos(a) * d, y + Math.sin(a) * d, rand(0.8, 2.2)]); }
  const body = (grow, dx, dy) => {
    circle(c, x + dx, y + dy, s * 0.62 + grow);
    for (const [lx, ly, lr] of lobes) circle(c, lx + dx, ly + dy, lr + grow);
    for (const [sx, sy, sr] of streak) blob(c, sx + dx, sy + dy, sr * 1.9 + grow, sr + grow, ang);
  };
  if (!hard) { c.fillStyle = hexA(T.dark, 0.22); body(2.2, 0, 0); }            // paint soaking into the turf
  c.fillStyle = hexA(T.dark, hard ? 0.7 : 0.55); body(0.6, 0.9, 1.1);            // darker rim gives depth
  c.fillStyle = T.color; body(0, 0, 0);
  for (const [fx, fy, fr] of flecks) circle(c, fx, fy, fr);
  for (let i = 0; i < 7; i++) {                                                   // fine spray fanning forward
    const a = ang + vrand(-0.7, 0.7), d = s * vrand(1.2, 2.6);
    circle(c, x + Math.cos(a) * d, y + Math.sin(a) * d, vrand(0.5, 1.3));
  }
  c.fillStyle = T.light;                                                          // wet shine
  c.globalAlpha = hard ? 0.6 : 0.4; blob(c, x - s * 0.18, y - s * 0.2, s * 0.2, s * 0.12, -0.6);
  if (hard) { c.globalAlpha = 0.35; circle(c, x + s * 0.2, y - s * 0.32, s * 0.07); }
  c.globalAlpha = 1;
}
export function burst(x, y, team, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(60, 240);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.18, 0.42), t: 0, color: TEAMS[team].color, r: rand(1.2, 2.6), stain: team });
  }
  for (let i = 0; i < Math.ceil(n / 4); i++) { // bits of the paintball's shell
    const a = rand(0, TAU), s = rand(80, 200);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.45), t: 0, color: TEAMS[team].dark, r: 2, shard: true, rot: rand(0, TAU), spin: rand(-14, 14), stain: null });
  }
}
// puff of air at the barrel tip
export function muzzlePuff(p, angle) {
  const L = p.r + MK(p).barrel, x = p.x + Math.cos(angle) * L, y = p.y + Math.sin(angle) * L;
  for (let i = 0; i < 2; i++) G.parts.push({ x, y, vx: Math.cos(angle) * rand(40, 90) + rand(-20, 20), vy: Math.sin(angle) * rand(40, 90) + rand(-20, 20),
    life: rand(0.16, 0.26), t: 0, color: '#e8eee6', r: rand(2.5, 4), a: 0.35, grow: 14, stain: null });
}
// dust kicked up behind a sprinting player
export function dust(p) {
  const a = Math.atan2(p.vy, p.vx) + Math.PI + rand(-0.5, 0.5);
  G.parts.push({ x: p.x + Math.cos(a) * 9, y: p.y + Math.sin(a) * 9, vx: Math.cos(a) * rand(20, 50), vy: Math.sin(a) * rand(20, 50),
    life: rand(0.3, 0.45), t: 0, color: '#b9ad86', r: rand(2.5, 4), a: 0.4, grow: 10, stain: null });
}
export function washDrop(p) {
  G.parts.push({ x: p.x + rand(-11, 11), y: p.y + rand(-11, 11), vx: rand(-40, 40), vy: rand(-90, -30), life: 0.5, t: 0, color: PAL.wash, r: rand(1.2, 2.3), stain: null });
}
export function updateParticles(dt) {
  const keep = [];
  for (const q of G.parts) {
    q.t += dt;
    if (q.t >= q.life) { if (q.stain !== null) { pctx.fillStyle = TEAMS[q.stain].color; circle(pctx, q.x, q.y, q.r * 0.8); } continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - 3 * dt; q.vy *= 1 - 3 * dt;
    if (q.grow) q.r += q.grow * dt;
    if (q.shard) q.rot += q.spin * dt;
    keep.push(q);
  }
  G.parts = keep;
}

// King of the Hill: the hill glows in the holding team's color, flashes both colors when contested.
function drawHill(c, now) {
  const h = G.hill, contested = h.contested, own = h.owner;
  const col = contested ? TEAMS[Math.floor(now * 4) % 2].color : own >= 0 ? TEAMS[own].color : PAL.chalk;
  c.save(); c.translate(h.x, h.y);
  const g = c.createRadialGradient(0, 0, h.r * 0.2, 0, 0, h.r);
  g.addColorStop(0, hexA(col, own >= 0 || contested ? 0.05 : 0.02)); g.addColorStop(1, hexA(col, own >= 0 || contested ? 0.2 : 0.07));
  c.fillStyle = g; circle(c, 0, 0, h.r);
  c.strokeStyle = hexA(col, own >= 0 || contested ? 0.9 : 0.5); c.lineWidth = 3;
  c.setLineDash([16, 10]); c.lineDashOffset = own >= 0 ? -now * 30 * (own === 0 ? 1 : -1) : 0;
  c.beginPath(); c.arc(0, 0, h.r, 0, TAU); c.stroke(); c.setLineDash([]);
  c.font = `14px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,10,0.6)';
  const label = contested ? 'CONTESTED' : 'HILL';
  c.strokeText(label, 0, h.r + 16); c.fillStyle = hexA(col, 0.95); c.fillText(label, 0, h.r + 16);
  c.restore();
}
function drawFlag(c, f, x, y, sc, now) {
  const T = TEAMS[f.team], wave = Math.sin(now * 6 + f.team) * 2.5;
  c.save(); c.translate(x, y); c.scale(sc, sc);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(4, 3, 7, 3.5, 0, 0, TAU); c.fill();
  c.strokeStyle = '#e9ece6'; c.lineWidth = 2.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, 2); c.lineTo(0, -28); c.stroke();
  c.fillStyle = T.color; c.strokeStyle = T.dark; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(1, -28); c.quadraticCurveTo(10, -30 + wave, 22, -24 + wave); c.quadraticCurveTo(11, -18 - wave * 0.4, 1, -15); c.closePath(); c.fill(); c.stroke();
  c.restore();
  if (f.state === 'dropped') {
    const k = 1 - f.dropT / CFG.flagReturnTime;
    c.strokeStyle = hexA(T.color, 0.9); c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
  }
}
// Your look from the Customize menu. Bots always wear the stripe jersey and a black mask.
const MASKS = { black: '#1a1f24', white: '#e2e6e8', gray: '#76808a', camo: '#4d5c3a' };
function drawJersey(c, kind, T, r) {   // drawn inside the torso clip, facing +x
  if (kind === 'solid') return;
  if (kind === 'split') { c.fillStyle = hexA(T.dark, 0.6); c.fillRect(-r, 0, r * 2, r * 1.2); return; }
  c.fillStyle = hexA(T.light, kind === 'hoops' ? 0.45 : 0.32);
  if (kind === 'hoops') { c.fillRect(-10, -r * 1.1, 2.2, r * 2.2); c.fillRect(-6.4, -r * 1.1, 2.2, r * 2.2); }
  else c.fillRect(-5, -r * 1.1, 3.5, r * 2.2);                                     // stripe
}
// The player preview in the Customize menu: your player, drawn big, facing right.
export function drawPreview(cv, name, marker) {
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = PAL.turf; c.fillRect(0, 0, cv.width, cv.height);
  const k = cv.height / 52;
  c.setTransform(k, 0, 0, k, cv.width / 2 - 6 * k, cv.height / 2 + 7 * k);
  const p = { team: 0, r: CFG.playerRadius, x: 0, y: 0, aim: -0.35, state: 'active', isHuman: true, marker, name,
              splats: [], carrying: null, protect: 0, reloadT: 0 };
  drawPlayer(c, p, 0);
}

// Animation state for drawing only (stride, lean, hit pop). Kept here, not on the player, so the simulation and G
// are untouched by how players look.
const look = new WeakMap();
function animate(p, now) {
  let L = look.get(p);
  if (!L) { L = { x: p.x, y: p.y, t: now, phase: 0, move: 0, dir: p.aim, state: p.state, pop: 0 }; look.set(p, L); }
  const dt = clamp(now - L.t, 0, 0.1), dx = p.x - L.x, dy = p.y - L.y, moved = Math.hypot(dx, dy);
  if (moved > 40) { L.phase = 0; L.move = 0; }                                    // respawn or new match: no stride
  else if (dt > 0) {
    L.phase += moved / 7;
    L.move += (clamp(moved / dt / 160, 0, 1) - L.move) * clamp(dt * 12, 0, 1);
    if (moved > 0.2) L.dir = Math.atan2(dy, dx);
  }
  if (L.state === 'active' && p.state === 'painted') L.pop = 1;                   // just got hit
  L.pop = Math.max(0, L.pop - dt * 4);
  Object.assign(L, { x: p.x, y: p.y, t: now, state: p.state });
  return L;
}
function drawPlayer(c, p, now) {
  const T = TEAMS[p.team], r = p.r, painted = p.state === 'painted', L = animate(p, now);
  c.save(); c.translate(p.x, p.y);
  // team glow and shadow on the turf, so teams read at a glance
  const glow = c.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.75);
  glow.addColorStop(0, hexA(T.color, painted ? 0.12 : 0.3)); glow.addColorStop(1, hexA(T.color, 0));
  c.fillStyle = glow; circle(c, 0, 0, r * 1.75);
  c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(3, 5, r * 1.05, r * 0.82, 0, 0, TAU); c.fill();
  if (p.isHuman) { c.strokeStyle = 'rgba(245,248,242,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r + 5, 0, TAU); c.stroke(); }
  if (p.carrying) {
    c.strokeStyle = TEAMS[p.carrying.team].color; c.lineWidth = 2.5; c.setLineDash([5, 4]); c.lineDashOffset = -now * 24;
    c.beginPath(); c.arc(0, 0, r + 9, 0, TAU); c.stroke(); c.setLineDash([]);
  }
  c.save();                                              // body only: the rings and name below don't bob or pop
  c.globalAlpha = painted ? 0.72 : 1;
  // boots stepping in the direction of travel (they peek out under the body as it walks)
  c.save(); c.rotate(L.dir);
  const stride = Math.sin(L.phase) * 8.5 * L.move;
  c.fillStyle = '#14181c';
  blob(c, stride, -5, 4.4, 2.9, 0); blob(c, -stride, 5, 4.4, 2.9, 0);
  c.restore();
  // body leans into the run, bobs with each step, and pops when hit
  const lean = 1.6 * L.move, bob = 1 + Math.abs(Math.sin(L.phase)) * 0.035 * L.move, pop = 1 + 0.24 * L.pop;
  c.translate(Math.cos(L.dir) * lean, Math.sin(L.dir) * lean);
  c.scale(bob * pop, bob * pop);
  c.rotate(p.aim);
  // pod pack on the back with spare paint
  c.fillStyle = '#262c32'; rrPath(c, -r * 1.02, -r * 0.5, r * 0.5, r, 3); c.fill();
  c.fillStyle = T.dark; for (const py of [-r * 0.3, 0, r * 0.3]) circle(c, -r * 0.92, py, 2.1);
  // torso from above: shoulders wider than deep, jersey stripe, shoulder pads, crisp outline
  c.fillStyle = T.color; c.strokeStyle = 'rgba(10,14,18,0.8)'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(-1, 0, r * 0.74, r * 1.08, 0, 0, TAU); c.fill(); c.stroke();
  c.save(); c.beginPath(); c.ellipse(-1, 0, r * 0.74, r * 1.08, 0, 0, TAU); c.clip();
  drawJersey(c, p.isHuman ? custom.jersey : 'stripe', T, r);
  c.fillStyle = hexA(T.light, 0.28); blob(c, -1, -r * 0.72, r * 0.42, r * 0.24, 0); blob(c, -1, r * 0.72, r * 0.42, r * 0.24, 0);
  c.fillStyle = hexA(T.dark, 0.35); c.fillRect(-r * 0.74 - 1, -r * 1.1, r * 0.3, r * 2.2);    // shade on the back
  if (p.splats.length) {                                                  // paint on the jersey
    c.rotate(-p.aim);
    for (const s of p.splats) { c.fillStyle = TEAMS[s.team].color; for (const [lx, ly, lr] of s.lobes) circle(c, lx, ly, lr); }
  }
  c.restore();
  // arms reaching forward to the marker
  c.strokeStyle = T.dark; c.lineWidth = 4.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(1, r * 0.78); c.lineTo(r * 0.62, 3); c.moveTo(1, -r * 0.78); c.lineTo(r * 1.05, -1); c.stroke();
  drawMarker(c, p.marker, r, T);
  c.fillStyle = '#15191d'; circle(c, r * 0.62, 3, 2.8); circle(c, r * 1.05, -1, 2.6);        // gloves
  // head: dark helmet and mask, team headwrap at the back, goggle lens facing forward with a glint
  const mask = p.isHuman ? custom.mask : 'black';
  c.fillStyle = MASKS[mask] || MASKS.black; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.2;
  c.beginPath(); c.arc(1, 0, r * 0.5, 0, TAU); c.fill(); c.stroke();
  if (mask === 'camo') {
    c.save(); c.beginPath(); c.arc(1, 0, r * 0.5, 0, TAU); c.clip();
    c.fillStyle = '#2e3a22'; circle(c, -1, -3, 2.6); circle(c, 4, 3, 2.2);
    c.fillStyle = '#7a8a52'; circle(c, 3, -3.5, 1.8); circle(c, -2.5, 3, 1.9);
    c.restore();
  }
  c.fillStyle = T.color; c.beginPath(); c.moveTo(1, 0); c.arc(1, 0, r * 0.5, Math.PI * 0.62, Math.PI * 1.38); c.closePath(); c.fill();
  c.fillStyle = PAL.lens; c.globalAlpha = painted ? 0.35 : 0.85;
  c.beginPath(); c.ellipse(r * 0.34, 0, r * 0.13, r * 0.36, 0, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.globalAlpha = painted ? 0.2 : 0.7; circle(c, r * 0.36, -r * 0.18, 1.1);
  c.globalAlpha = 1;
  if (L.pop > 0) { c.fillStyle = `rgba(255,255,255,${0.55 * L.pop})`; circle(c, 0, 0, r * 1.1); }   // hit flash
  c.restore();
  if (painted) {
    c.strokeStyle = 'rgba(245,248,242,0.75)'; c.lineWidth = 1.5; c.setLineDash([3, 4]);
    c.beginPath(); c.arc(0, 0, r + 4, 0, TAU); c.stroke(); c.setLineDash([]);
    if (p.washT > 0) { c.strokeStyle = PAL.wash; c.lineWidth = 3.5; c.beginPath(); c.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * (p.washT / CFG.washTime)); c.stroke(); }
  }
  if (p.protect > 0) { c.strokeStyle = `rgba(245,248,242,${0.35 + 0.35 * Math.sin(now * 20)})`; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, r + 6, 0, TAU); c.stroke(); }
  c.font = `700 12px ${FONT_UI}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
  c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,10,0.7)';
  const label = painted ? `${p.name} · WASH` : p.reloadT > 0 ? `${p.name} · RELOAD` : p.name;
  c.strokeText(label, 0, -r - 7);
  c.fillStyle = painted ? 'rgba(245,248,242,0.7)' : p.isHuman ? PAL.chalk : T.light;
  c.fillText(label, 0, -r - 7);
  c.restore();
}
// Electro: short barrel with a see-through loader full of paint. Pump: long barrel, wooden pump handle, and a short
// feed tube of paint. Barrel lengths match the muzzle puff in muzzlePuff().
function drawMarker(c, kind, r, T) {
  const x0 = r * 0.3;
  if (kind === 'pump') {
    c.fillStyle = PAL.marker; c.fillRect(x0, -2.2, r + 22, 4.4);
    c.fillStyle = PAL.markerHi; c.fillRect(x0 + r + 19, -2.8, 3, 5.6);                 // muzzle
    c.fillStyle = PAL.markerHi; c.fillRect(x0, -4, 12, 8);
    c.fillStyle = '#8a6a44'; c.fillRect(x0 + 16, -3.4, 9, 6.8);
    c.fillStyle = 'rgba(0,0,0,0.3)'; for (const hx of [x0 + 18.5, x0 + 21.5]) c.fillRect(hx, -3.4, 1, 6.8); // grip ridges
    c.fillStyle = 'rgba(20,24,28,0.9)'; rrPath(c, x0 + 1.5, -2.6, 9, 5.2, 2.4); c.fill(); // feed tube
    c.fillStyle = T.color; for (const bx of [x0 + 4, x0 + 7.5]) circle(c, bx, 0, 1.7);
  } else if (kind === 'scatter') {
    // short, wide barrel that flares at the muzzle, with a small loader
    const end = r + MARKERS.scatter.barrel;                                             // where the muzzle puff appears
    c.fillStyle = PAL.marker; c.fillRect(x0, -3.6, end - x0 - 4, 7.2);
    c.beginPath(); c.moveTo(end - 5, -3.6); c.lineTo(end, -5.2); c.lineTo(end, 5.2); c.lineTo(end - 5, 3.6); c.closePath(); c.fill();
    c.fillStyle = PAL.markerHi; c.fillRect(x0, -4.8, 11, 9.6); c.fillRect(end - 7, -4.2, 2, 8.4);
    c.fillStyle = 'rgba(0,0,0,0.45)'; for (const by of [-2.2, 0, 2.2]) circle(c, end - 0.6, by, 0.9); // three bores
    c.fillStyle = 'rgba(18,22,26,0.92)'; c.beginPath(); c.ellipse(x0 + 7, 0, 5, 4.2, 0, 0, TAU); c.fill();
    c.fillStyle = T.color; circle(c, x0 + 6, -1.2, 1.6); circle(c, x0 + 8.2, 1.3, 1.6);
  } else {
    c.fillStyle = PAL.marker; c.fillRect(x0, -2.8, r + 10, 5.6);
    c.fillStyle = PAL.markerHi; c.fillRect(x0 + r + 7, -3.4, 3, 6.8);                  // muzzle
    c.fillStyle = PAL.markerHi; c.fillRect(x0, -4.5, 13, 9);
    c.save();
    c.fillStyle = 'rgba(18,22,26,0.92)'; c.beginPath(); c.ellipse(x0 + 9, 0, 6.5, 5.2, 0, 0, TAU); c.fill(); c.clip();
    c.fillStyle = T.color; for (const [bx, by] of [[x0 + 6, -1.8], [x0 + 9.5, 1.6], [x0 + 12, -1.4], [x0 + 6.5, 2.3]]) circle(c, bx, by, 1.9);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x0 + 9, 0, 6.5, 5.2, 0, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.3)'; circle(c, x0 + 7.5, -2.4, 1.5);
  }
}
function drawOut(c, p) {
  const a = clamp(1 - p.outT / 4, 0, 1);
  c.save(); c.globalAlpha = a; c.translate(p.x, p.y);
  c.strokeStyle = TEAMS[p.team].dark; c.lineWidth = 4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-8, -8); c.lineTo(8, 8); c.moveTo(8, -8); c.lineTo(-8, 8); c.stroke();
  c.font = `700 12px ${FONT_UI}`; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = PAL.chalk;
  c.fillText(`${p.name} OUT`, 0, -14);
  c.restore();
}
function drawGuide(c, hp, now) {
  let tx, ty, col;
  if (hp.state === 'painted') { const w = rectCenter(BASES[hp.team].wash); tx = w.x; ty = w.y; col = 'rgba(127,214,255,0.6)'; }
  else if (hp.carrying) { tx = BASES[hp.team].flag.x; ty = BASES[hp.team].flag.y; col = hexA(TEAMS[hp.team].color, 0.65); }
  else return;
  c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash([8, 9]); c.lineDashOffset = -now * 40;
  c.beginPath(); c.moveTo(hp.x, hp.y); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]);
}
function drawHoldMarker(c, sq, now) {
  const col = TEAMS[0].color;
  c.save(); c.translate(sq.x, sq.y);
  c.strokeStyle = hexA(col, 0.85); c.lineWidth = 2; c.setLineDash([6, 5]); c.lineDashOffset = -now * 12;
  c.beginPath(); c.arc(0, 0, 40, 0, TAU); c.stroke(); c.setLineDash([]);
  c.font = `13px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 3; c.strokeStyle = 'rgba(8,12,10,0.7)'; c.strokeText('HOLD', 0, 52);
  c.fillStyle = col; c.fillText('HOLD', 0, 52);
  c.restore();
}
// When you get painted: an arc and arrow around you point at the shooter, and the shooter gets a ring.
function drawHitIndicator(c, hp, now) {
  const fx = G.fx;
  if (fx.hitT <= 0) return;
  const a = clamp(fx.hitT / 0.9, 0, 1), col = TEAMS[fx.hitTeam].color;
  c.save(); c.globalAlpha = a; c.translate(hp.x, hp.y);
  c.strokeStyle = 'rgba(8,12,10,0.55)'; c.lineWidth = 10; c.lineCap = 'round';
  c.beginPath(); c.arc(0, 0, 38, fx.hitAngle - 0.5, fx.hitAngle + 0.5); c.stroke();
  c.strokeStyle = col; c.lineWidth = 6;
  c.beginPath(); c.arc(0, 0, 38, fx.hitAngle - 0.5, fx.hitAngle + 0.5); c.stroke();
  c.rotate(fx.hitAngle); c.fillStyle = col;
  c.beginPath(); c.moveTo(60, 0); c.lineTo(46, -10); c.lineTo(46, 10); c.closePath(); c.fill();
  c.restore();
  const s = fx.shooter;
  if (s && s.state !== 'out') {
    c.save(); c.globalAlpha = a; c.strokeStyle = PAL.chalk; c.lineWidth = 2.5;
    c.beginPath(); c.arc(s.x, s.y, 24 + 4 * Math.sin(now * 14), 0, TAU); c.stroke();
    c.restore();
  }
}
// Touch aim line: where your shots go, up to the first bunker or your marker's range. Faint when your aim thumb is
// up, brighter while it's down, your team color when it's on an enemy (you're firing).
function drawAimLine(c, hp) {
  const x1 = hp.x * view.s + view.ox, y1 = hp.y * view.s + view.oy, x2 = touch.ax * view.s + view.ox, y2 = touch.ay * view.s + view.oy;
  const held = touch.aimId !== null, hot = held && touch.onTarget;
  c.save();
  c.lineCap = 'round'; c.setLineDash([2, 7]);
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = hot ? 5 : 4;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.strokeStyle = hot ? TEAMS[0].color : held ? 'rgba(245,248,242,0.85)' : 'rgba(245,248,242,0.3)'; c.lineWidth = hot ? 3 : 2;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.restore();
}
function drawCrosshair(c, x, y, hp) {
  if (hp) { // ammo ring around the crosshair (blue while reloading)
    const reloading = hp.reloadT > 0, m = MK(hp);
    const frac = reloading ? 1 - hp.reloadT / m.reload : hp.ammo / m.hopper;
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.beginPath(); c.arc(x, y, 21, 0, TAU); c.stroke();
    c.strokeStyle = reloading ? PAL.wash : frac <= 0.25 ? TEAMS[0].color : 'rgba(245,248,242,0.85)';
    c.beginPath(); c.arc(x, y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
  }
  const flash = hitMark.t > 0;
  for (const [col, lw] of [['rgba(0,0,0,0.65)', 4], [flash ? TEAMS[0].color : PAL.chalk, 2]]) {
    c.strokeStyle = col; c.lineWidth = lw;
    c.beginPath(); c.arc(x, y, 9, 0, TAU);
    c.moveTo(x - 16, y); c.lineTo(x - 11, y); c.moveTo(x + 11, y); c.lineTo(x + 16, y);
    c.moveTo(x, y - 16); c.lineTo(x, y - 11); c.moveTo(x, y + 11); c.lineTo(x, y + 16);
    if (flash) { c.moveTo(x - 6, y - 6); c.lineTo(x + 6, y + 6); c.moveTo(x + 6, y - 6); c.lineTo(x - 6, y + 6); }
    c.stroke();
  }
}

export function render() {
  const c = mctx, now = performance.now() / 1000, d = view.dpr;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const sh = reduceMotion || G.paused ? 0 : G.fx.shake, jx = sh ? rand(-sh, sh) : 0, jy = sh ? rand(-sh, sh) : 0;
  c.setTransform(view.s * d, 0, 0, view.s * d, (view.ox + jx) * d, (view.oy + jy) * d);
  c.save(); c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 24; c.fillStyle = PAL.net; c.fillRect(0, 0, W, H); c.restore();
  c.drawImage(fieldLayer, 0, 0, W, H);
  c.drawImage(paintLayer, 0, 0, W, H);
  if (G.mode === 'koth') drawHill(c, now);
  for (const f of G.flags) if (f.state !== 'carried') drawFlag(c, f, f.x, f.y, 1, now);
  for (const p of G.players) if (p.state === 'out' && p.outT < 4) drawOut(c, p);
  if (G.human && G.squad.cmd === 'hold' && G.phase !== 'over') drawHoldMarker(c, G.squad, now);
  const hp = humanPlayer();
  if (hp && G.phase === 'play' && hp.state !== 'out') drawGuide(c, hp, now);
  for (const p of G.players) if (p.state === 'painted') drawPlayer(c, p, now);
  for (const p of G.players) if (p.state === 'active') drawPlayer(c, p, now);
  for (const f of G.flags) if (f.state === 'carried') { const k = f.carrier; drawFlag(c, f, k.x - Math.cos(k.aim) * 9, k.y - Math.sin(k.aim) * 9, 0.85, now); }
  c.lineWidth = 2.5;
  for (const b of G.balls) {
    const T = TEAMS[b.team];
    c.strokeStyle = T.trail; c.beginPath(); c.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); c.lineTo(b.x, b.y); c.stroke();
    c.fillStyle = T.color; circle(c, b.x, b.y, CFG.ballRadius);
    c.fillStyle = 'rgba(255,255,255,0.8)'; circle(c, b.x - 1, b.y - 1.2, 1.2);
  }
  for (const q of G.parts) {
    c.globalAlpha = (q.a || 1) * (1 - q.t / q.life); c.fillStyle = q.color;
    if (q.shard) { c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.fillRect(-2.6, -1.1, 5.2, 2.2); c.restore(); }
    else circle(c, q.x, q.y, q.r);
  }
  c.globalAlpha = 1;
  if (hp) drawHitIndicator(c, hp, now);
  // screen-space UI
  c.setTransform(d, 0, 0, d, 0, 0);
  if (G.fx.vignette > 0) { // paint-colored flash around the edges when you get hit
    const col = TEAMS[G.fx.hitTeam].color, cx = view.cw / 2, cy = view.ch / 2;
    const g = c.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.55, cx, cy, Math.hypot(cx, cy));
    g.addColorStop(0, hexA(col, 0)); g.addColorStop(1, hexA(col, 0.42 * G.fx.vignette));
    c.fillStyle = g; c.fillRect(0, 0, view.cw, view.ch);
  }
  if (hp && !G.paused && G.phase !== 'over' && hp.state !== 'out') {
    const ammo = hp.state === 'active' ? hp : null;
    if (input.source === 'touch') {
      if (ammo) drawAimLine(c, hp);
      if (touch.aimId !== null) drawCrosshair(c, touch.ax * view.s + view.ox, touch.ay * view.s + view.oy, ammo);
    }
    else if (mouse.inside) drawCrosshair(c, mouse.sx, mouse.sy, ammo);
  }
  // touch sticks: move (left thumb) and aim (right thumb; its knob turns your team color while it's on target)
  if (touch.stickId !== null) drawStick(c, touch.bx, touch.by, touch.mx, touch.my, 'rgba(245,248,242,0.45)', false);
  if (touch.aimId !== null) drawStick(c, touch.abx, touch.aby, touch.adx, touch.ady, touch.onTarget ? hexA(TEAMS[0].color, 0.75) : 'rgba(245,248,242,0.45)');
}
function drawStick(c, x, y, dx, dy, knob) {
  c.fillStyle = 'rgba(245,248,242,0.10)'; c.strokeStyle = 'rgba(245,248,242,0.35)'; c.lineWidth = 2;
  c.beginPath(); c.arc(x, y, STICK, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = knob; circle(c, x + dx * STICK, y + dy * STICK, 22);
}
