import { W, H, clamp } from './util.js';
import { BORDER, OBST } from './field.js';

/* ---------- 3. GEOMETRY ---------- */
// Where along a line segment (0..1) does it first touch a rectangle grown by `pad`? null = never.
function segRect(x1, y1, x2, y2, o, pad) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - (o.x - pad), (o.x + o.w + pad) - x1, y1 - (o.y - pad), (o.y + o.h + pad) - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
      else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
  }
  return t0;
}
// Same idea for a circle.
export function segCircle(x1, y1, x2, y2, cx, cy, R) {
  const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy, c = fx * fx + fy * fy - R * R;
  if (c < 0) return 0;               // starts inside
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy), disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
// First bunker a line hits, or null if the line is clear.
export function raycast(x1, y1, x2, y2, pad = 0) {
  let best = 1, hit = null;
  for (const o of OBST) {
    const t = o.t === 'rect' ? segRect(x1, y1, x2, y2, o, pad) : segCircle(x1, y1, x2, y2, o.x, o.y, o.r + pad);
    if (t !== null && t < best) { best = t; hit = o; }
  }
  return hit ? { t: best, o: hit } : null;
}
export function pointBlocked(x, y, pad) {
  for (const o of OBST) {
    if (o.t === 'rect') { if (x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad) return true; }
    else if (Math.hypot(x - o.x, y - o.y) < o.r + pad) return true;
  }
  return x < BORDER + pad || x > W - BORDER - pad || y < BORDER + pad || y > H - BORDER - pad;
}
// Push a round player out of any bunker it overlaps, and keep it inside the netting.
export function resolveCircle(p, r) {
  for (let iter = 0; iter < 2; iter++) {
    for (const o of OBST) {
      if (o.t === 'rect') {
        const cx = clamp(p.x, o.x, o.x + o.w), cy = clamp(p.y, o.y, o.y + o.h);
        const dx = p.x - cx, dy = p.y - cy, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.y = cy + dy / d * r; }
        else {
          const l = p.x - o.x, rr = o.x + o.w - p.x, t = p.y - o.y, b = o.y + o.h - p.y, m = Math.min(l, rr, t, b);
          if (m === l) p.x = o.x - r; else if (m === rr) p.x = o.x + o.w + r; else if (m === t) p.y = o.y - r; else p.y = o.y + o.h + r;
        }
      } else {
        const dx = p.x - o.x, dy = p.y - o.y, rr = o.r + r, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001; p.x = o.x + dx / d * rr; p.y = o.y + dy / d * rr; }
      }
    }
    p.x = clamp(p.x, BORDER + r, W - BORDER - r);
    p.y = clamp(p.y, BORDER + r, H - BORDER - r);
  }
}
