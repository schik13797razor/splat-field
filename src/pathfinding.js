import { CFG, LANE_Y, LANE_X } from './config.js';
import { W, H, clamp, mulberry32 } from './util.js';
import { MAPS, OBST, buildObstacles, BASES } from './field.js';
import { pointBlocked } from './geometry.js';

/* ---------- 4. PATHFINDING ----------
   The field is cut into a grid of 20-unit cells. Cells a player can't fit in are "blocked".
   A* finds the shortest chain of open cells from a bot to its goal. */
const CELL = 20, GW = W / CELL, GH = H / CELL;
const blocked = new Uint8Array(GW * GH);
function rebuildGrid() {
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    blocked[gy * GW + gx] = pointBlocked(gx * CELL + CELL / 2, gy * CELL + CELL / 2, CFG.playerRadius + 3) ? 1 : 0;
  }
}
const cellIndex = (x, y) => clamp(Math.floor(y / CELL), 0, GH - 1) * GW + clamp(Math.floor(x / CELL), 0, GW - 1);
const cellCenter = i => ({ x: (i % GW) * CELL + CELL / 2, y: Math.floor(i / GW) * CELL + CELL / 2 });
function nearestFree(i) {
  if (!blocked[i]) return i;
  const cx = i % GW, cy = Math.floor(i / GW);
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      if (!blocked[ny * GW + nx]) return ny * GW + nx;
    }
  }
  return -1;
}
export function freePoint(pt) {
  if (!pointBlocked(pt.x, pt.y, CFG.playerRadius + 2)) return { x: pt.x, y: pt.y };
  const i = nearestFree(cellIndex(pt.x, pt.y));
  return i < 0 ? { x: pt.x, y: pt.y } : cellCenter(i);
}
class MinHeap {
  constructor() { this.a = []; this.p = []; }
  get size() { return this.a.length; }
  push(v, pr) {
    const a = this.a, p = this.p; let i = a.length; a.push(v); p.push(pr);
    while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= pr) break; a[i] = a[j]; p[i] = p[j]; i = j; }
    a[i] = v; p[i] = pr;
  }
  pop() {
    const a = this.a, p = this.p, top = a[0], lv = a.pop(), lp = p.pop(), n = a.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; if (l >= n) break;
        const r = l + 1, m = r < n && p[r] < p[l] ? r : l;
        if (p[m] >= lp) break;
        a[i] = a[m]; p[i] = p[m]; i = m;
      }
      a[i] = lv; p[i] = lp;
    }
    return top;
  }
}
const gScore = new Float32Array(GW * GH), came = new Int32Array(GW * GH);
const seen = new Uint32Array(GW * GH), closed = new Uint32Array(GW * GH);
let searchId = 0;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
export function astar(sx, sy, tx, ty) {
  const s = nearestFree(cellIndex(sx, sy)), t = nearestFree(cellIndex(tx, ty));
  if (s < 0 || t < 0) return null;
  searchId++;
  const tgx = t % GW, tgy = Math.floor(t / GW);
  const h = i => { const dx = Math.abs(i % GW - tgx), dy = Math.abs(Math.floor(i / GW) - tgy); return dx + dy - 0.5858 * Math.min(dx, dy); };
  const heap = new MinHeap();
  seen[s] = searchId; gScore[s] = 0; came[s] = -1; heap.push(s, h(s));
  while (heap.size) {
    const cur = heap.pop();
    if (cur === t) break;
    if (closed[cur] === searchId) continue;
    closed[cur] = searchId;
    const cx = cur % GW, cy = Math.floor(cur / GW);
    for (let k = 0; k < 8; k++) {
      const dx = DX[k], dy = DY[k], nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (blocked[ni]) continue;
      if (dx && dy && (blocked[cy * GW + nx] || blocked[ny * GW + cx])) continue; // no corner cutting
      const ng = gScore[cur] + (dx && dy ? 1.4142 : 1);
      if (seen[ni] !== searchId || ng < gScore[ni]) { seen[ni] = searchId; gScore[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
    }
  }
  if (seen[t] !== searchId) return null;
  const path = [];
  for (let i = t; i !== -1; i = came[i]) path.push(cellCenter(i));
  path.reverse();
  if (!pointBlocked(tx, ty, CFG.playerRadius + 2)) path[path.length - 1] = { x: tx, y: ty };
  return path;
}

// Cover spots: just behind each bunker. Side 0 is the west face (cover for Orange), side 1 the east face (Blue).
export const COVER = [[], []];
function buildCover() {
  COVER[0].length = COVER[1].length = 0;
  const R = CFG.playerRadius + 6;
  for (const o of OBST) {
    const pts = [];
    if (o.t === 'circle') pts.push({ x: o.x - o.r - R, y: o.y, side: 0 }, { x: o.x + o.r + R, y: o.y, side: 1 });
    else {
      const cy = o.y + o.h / 2;
      pts.push({ x: o.x - R, y: cy, side: 0 }, { x: o.x + o.w + R, y: cy, side: 1 });
      if (o.h >= 90) pts.push({ x: o.x - R, y: o.y + 22, side: 0 }, { x: o.x - R, y: o.y + o.h - 22, side: 0 }, { x: o.x + o.w + R, y: o.y + 22, side: 1 }, { x: o.x + o.w + R, y: o.y + o.h - 22, side: 1 });
    }
    for (const p of pts) if (!pointBlocked(p.x, p.y, CFG.playerRadius + 2)) COVER[p.side].push({ x: p.x, y: p.y });
  }
}
// Switch the field: bunkers, the walking grid, and cover spots. (Drawing happens in loadMap, section 10.)
export function applyLayout(def) { buildObstacles(def); rebuildGrid(); buildCover(); }

// Random field: drop bunkers on the left half (often mirrored top-to-bottom too), copy them to the right,
// and keep only a layout where every route the bots use is walkable and there's enough cover.
export function randomLayout(seed) {
  const rnd = mulberry32(seed), rr = (a, b) => a + rnd() * (b - a);
  const box = o => o.t === 'circle' ? { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 } : o;
  const clear = (a, b, gap) => a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;
  const PIECES = [
    [3, () => ({ t: 'circle', r: rr(20, 30) })],
    [3, () => { const s = rr(40, 60); return { t: 'rect', kind: 'cake', w: s, h: s }; }],
    [2, () => ({ t: 'rect', kind: 'wall', w: rr(32, 38), h: rr(90, 130) })],
    [1, () => ({ t: 'rect', kind: 'snake', w: rr(150, 230), h: rr(30, 34) })],
    [1, () => ({ t: 'rect', kind: 'temple', w: rr(44, 52), h: rr(66, 80) })],
  ];
  const pick = () => { let n = rnd() * 10; for (const [w, f] of PIECES) { if ((n -= w) < 0) return f(); } return PIECES[0][1](); };
  for (let attempt = 0; attempt < 120; attempt++) {
    const def = { name: 'Random field', rects: [], crects: [], circles: [], ccircles: [] }, placed = [];
    const fits = list => list.every(o => { const b = box(o); return list.every(p => p === o || clear(box(p), b, 42)) && placed.every(p => clear(p, b, 42)); });
    const add = list => { for (const o of list) { placed.push(box(o)); placed.push(box(o.t === 'circle' ? { ...o, x: W - o.x } : { ...o, x: W - o.x - o.w })); } };
    // center pieces on the halfway line
    if (rnd() < 0.6) { const c = { t: 'circle', x: 800, y: 450, r: rr(30, 46) }; def.ccircles.push(c); placed.push(box(c)); }
    else { const h = rr(80, 120), c = { t: 'rect', kind: 'wall', x: 785, y: 450 - h - 40, w: 30, h }; const c2 = { ...c, y: 490 }; def.crects.push(c, c2); placed.push(box(c), box(c2)); }
    if (rnd() < 0.7) { const y = rr(110, 280), c = { t: 'rect', kind: 'cake', x: 770, y, w: 60, h: 40 }, c2 = { ...c, y: 900 - y - 40 }; def.crects.push(c, c2); placed.push(box(c), box(c2)); }
    // left-half pieces
    const mirrorY = rnd() < 0.7, want = mirrorY ? 4 + Math.floor(rnd() * 3) : 7 + Math.floor(rnd() * 3);
    for (let tries = 0, n = 0; n < want && tries < 200; tries++) {
      const o = pick();
      const bw = o.t === 'circle' ? o.r * 2 : o.w, bh = o.t === 'circle' ? o.r * 2 : o.h;
      const x0 = rr(232, 760 - bw), y0 = rr(40, (mirrorY ? 450 : 860) - bh);
      if (o.t === 'circle') { o.x = x0 + o.r; o.y = y0 + o.r; } else { o.x = x0; o.y = y0; }
      const group = [o];
      if (mirrorY) group.push(o.t === 'circle' ? { ...o, y: 900 - o.y } : { ...o, y: 900 - o.y - o.h });
      if (!fits(group)) continue;
      add(group); n++;
      for (const g of group) (g.t === 'circle' ? def.circles : def.rects).push(g);
    }
    applyLayout(def);
    const s = BASES[0].spawns[1];
    const ok = COVER[0].length >= 8 && COVER[1].length >= 8
      && astar(s.x, s.y, BASES[1].flag.x, BASES[1].flag.y)
      && astar(BASES[1].spawns[1].x, BASES[1].spawns[1].y, BASES[0].flag.x, BASES[0].flag.y)
      && LANE_Y.every(y => LANE_X.every(x => { const f = freePoint({ x, y }); return Math.hypot(f.x - x, f.y - y) < 70 && astar(s.x, s.y, f.x, f.y); }));
    if (ok) return def;
  }
  applyLayout(MAPS.snake);
  return MAPS.snake;
}
applyLayout(MAPS.snake);
