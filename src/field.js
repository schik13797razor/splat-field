import { W } from './util.js';

/* ---------- 2. FIELD ----------
   Each layout lists the left half (mirrored onto the right, so both teams get a fair field) plus
   center pieces that sit on the halfway line. Bases are the same on every field.
   Bunker names come from speedball: snakes are long and low, cans are round, cakes are squat. */
export const BORDER = 12; // netting around the edge

export const MAPS = {
  snake: { name: 'Snake Line',
    rects: [
      { x: 240, y: 215, w: 60, h: 60, kind: 'cake' }, { x: 240, y: 625, w: 60, h: 60, kind: 'cake' },
      { x: 300, y: 412, w: 50, h: 76, kind: 'temple' },
      { x: 520, y: 190, w: 36, h: 120, kind: 'wall' }, { x: 520, y: 590, w: 36, h: 120, kind: 'wall' },
      { x: 460, y: 62, w: 230, h: 32, kind: 'snake' }, { x: 460, y: 806, w: 230, h: 32, kind: 'snake' },
      { x: 676, y: 168, w: 44, h: 44, kind: 'cake' }, { x: 676, y: 688, w: 44, h: 44, kind: 'cake' },
    ],
    crects: [{ x: 770, y: 262, w: 60, h: 40, kind: 'cake' }, { x: 770, y: 598, w: 60, h: 40, kind: 'cake' }],
    circles: [{ x: 432, y: 330, r: 24 }, { x: 432, y: 570, r: 24 }, { x: 622, y: 450, r: 28 }],
    ccircles: [{ x: 800, y: 450, r: 44 }],
  },
  // lots of round cans: angles everywhere, very little hard cover
  barrel: { name: 'Barrel Yard',
    rects: [{ x: 380, y: 60, w: 120, h: 30, kind: 'snake' }, { x: 380, y: 810, w: 120, h: 30, kind: 'snake' }],
    crects: [],
    circles: [
      { x: 300, y: 210, r: 26 }, { x: 300, y: 690, r: 26 }, { x: 390, y: 450, r: 30 },
      { x: 470, y: 310, r: 24 }, { x: 470, y: 590, r: 24 }, { x: 560, y: 150, r: 28 }, { x: 560, y: 750, r: 28 },
      { x: 620, y: 450, r: 26 }, { x: 700, y: 280, r: 30 }, { x: 700, y: 620, r: 30 },
    ],
    ccircles: [{ x: 800, y: 450, r: 40 }, { x: 800, y: 160, r: 24 }, { x: 800, y: 740, r: 24 }],
  },
  // a split wall down the middle pushes the fight out to the flanks
  midline: { name: 'Midline',
    rects: [
      { x: 290, y: 415, w: 46, h: 70, kind: 'temple' },
      { x: 470, y: 170, w: 34, h: 130, kind: 'wall' }, { x: 470, y: 600, w: 34, h: 130, kind: 'wall' },
      { x: 300, y: 62, w: 200, h: 30, kind: 'snake' }, { x: 300, y: 808, w: 200, h: 30, kind: 'snake' },
      { x: 620, y: 250, w: 56, h: 56, kind: 'cake' }, { x: 620, y: 594, w: 56, h: 56, kind: 'cake' },
    ],
    crects: [
      { x: 785, y: 300, w: 30, h: 110, kind: 'wall' }, { x: 785, y: 490, w: 30, h: 110, kind: 'wall' },
      { x: 760, y: 120, w: 80, h: 36, kind: 'cake' }, { x: 760, y: 744, w: 80, h: 36, kind: 'cake' },
    ],
    circles: [{ x: 600, y: 450, r: 30 }, { x: 400, y: 300, r: 22 }, { x: 400, y: 600, r: 22 }, { x: 680, y: 120, r: 22 }, { x: 680, y: 780, r: 22 }],
    ccircles: [],
  },
  // an open middle (the King of the Hill spot) ringed by cans and two cakes, long snakes up the flanks
  hilltop: { name: 'Hilltop',
    rects: [
      { x: 290, y: 412, w: 48, h: 76, kind: 'temple' },
      { x: 250, y: 200, w: 56, h: 56, kind: 'cake' }, { x: 250, y: 644, w: 56, h: 56, kind: 'cake' },
      { x: 420, y: 64, w: 220, h: 30, kind: 'snake' }, { x: 420, y: 806, w: 220, h: 30, kind: 'snake' },
      { x: 470, y: 250, w: 34, h: 120, kind: 'wall' }, { x: 470, y: 530, w: 34, h: 120, kind: 'wall' },
      { x: 600, y: 150, w: 50, h: 50, kind: 'cake' }, { x: 600, y: 700, w: 50, h: 50, kind: 'cake' },
    ],
    crects: [{ x: 775, y: 300, w: 50, h: 50, kind: 'cake' }, { x: 775, y: 550, w: 50, h: 50, kind: 'cake' }],
    circles: [{ x: 420, y: 450, r: 26 }, { x: 640, y: 380, r: 24 }, { x: 640, y: 520, r: 24 }],
    ccircles: [],
  },
};

export const OBST = [];
export function buildObstacles(def) {
  OBST.length = 0;
  for (const r of def.rects) { OBST.push({ t: 'rect', ...r }); OBST.push({ t: 'rect', ...r, x: W - r.x - r.w }); }
  for (const r of def.crects) OBST.push({ t: 'rect', ...r });
  for (const c of def.circles) { OBST.push({ t: 'circle', ...c }); OBST.push({ t: 'circle', ...c, x: W - c.x }); }
  for (const c of def.ccircles) OBST.push({ t: 'circle', ...c });
}

const mirrorRect = r => ({ ...r, x: W - r.x - r.w });
const mirrorPt = p => ({ x: W - p.x, y: p.y });
const LEFT_BASE = {
  zone:   { x: BORDER, y: 300, w: 180, h: 300 },   // carry the enemy flag in here to score
  flag:   { x: 92, y: 470 },
  wash:   { x: 34, y: 318, w: 92, h: 68 },         // stand here 3 seconds to get clean
  spawns: [{ x: 168, y: 384 }, { x: 168, y: 450 }, { x: 168, y: 516 }],
};
export const BASES = [
  LEFT_BASE,
  { zone: mirrorRect(LEFT_BASE.zone), flag: mirrorPt(LEFT_BASE.flag), wash: mirrorRect(LEFT_BASE.wash), spawns: LEFT_BASE.spawns.map(mirrorPt) },
];
