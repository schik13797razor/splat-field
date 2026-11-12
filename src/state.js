import { CFG, MARKERS, MK, NAMES, DEMO_NAME, ROLES, LANES, SPAWN_ORDER } from './config.js';
import { BASES } from './field.js';
import { clearPaint } from './drawing.js';
import { Sound } from './sound.js';
import { bannerEl, feedEl, banner } from './ui.js';

/* ---------- 5. GAME STATE ---------- */
export const G = {
  phase: 'play',          // countdown | play | roundEnd | over
  mode: 'ctf', diff: 'normal',
  human: false,           // false = the menu demo, where all six players are bots
  paused: false,
  time: 0, round: 1, roundWins: [0, 0], caps: [0, 0], hits: [0, 0],
  players: [], balls: [], parts: [], flags: [],
  count: 0, countSub: '', phaseT: 0, winner: null, pendingWinner: null, endHandled: false,
  attractNext: 'ctf',
  squad: { cmd: 'free', x: 0, y: 0 },   // your current order to your two bots
  fast: false,                          // fast-forward while you're out
  fx: null,                             // hit direction, screen shake, edge flash
  marker: 'electro',                    // the marker you chose
  mapKey: 'snake', mapName: 'Snake Line',
};
const freshFx = () => ({ shake: 0, hitT: 0, hitAngle: 0, hitTeam: 1, shooter: null, vignette: 0 });
G.fx = freshFx();
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const hitMark = { t: 0 }; // crosshair flash after you land a hit (an object so other files can change it)

function freshAI(lane) {
  return { goal: null, path: [], repath: 0, think: Math.random() * 0.4, target: null, react: 0, strafe: 0, strafeT: 0,
           hold: 0, atGoal: false, noSee: 0, lastPos: null, stuckT: 0, nudgeT: 0, nudge: 0, laneY: lane,
           route: [], routeKey: '', routed: false, burstLeft: 3 };
}
function makePlayer(team, idx, isHuman) {
  const name = isHuman ? 'YOU' : (team === 0 && idx === 0 ? DEMO_NAME : NAMES[team][idx]);
  const role = ROLES[team][idx], marker = isHuman ? G.marker : role === 'defender' ? 'pump' : 'electro';
  return {
    id: team * 3 + idx, team, idx, isHuman, name, r: CFG.playerRadius, marker,
    x: 0, y: 0, vx: 0, vy: 0, aim: team === 0 ? 0 : Math.PI,
    state: 'active',      // active | painted (CTF: walk to wash) | out (Last Team Standing)
    washT: 0, protect: 0, cool: 0, carrying: null, splats: [], outT: 0,
    ammo: MARKERS[marker].hopper, reloadT: 0,
    stamina: 1, sprinting: false, winded: false, stamWait: 0,
    stats: { hits: 0, painted: 0, caps: 0 },
    role, ai: freshAI(LANES[team][idx]),
  };
}
export function placeAtSpawns() {
  for (const p of G.players) {
    const s = BASES[p.team].spawns[SPAWN_ORDER[p.idx]];
    Object.assign(p, { x: s.x, y: s.y, vx: 0, vy: 0, aim: p.team === 0 ? 0 : Math.PI, state: 'active', washT: 0, protect: 0, cool: 0, carrying: null, splats: [], outT: 0,
                       ammo: MK(p).hopper, reloadT: 0, stamina: 1, sprinting: false, winded: false, stamWait: 0 });
    p.ai = freshAI(LANES[p.team][p.idx]);
  }
}
function resetFlags() {
  G.flags = G.mode === 'ctf' ? [0, 1].map(t => ({ team: t, x: BASES[t].flag.x, y: BASES[t].flag.y, state: 'home', carrier: null, dropT: 0 })) : [];
}
export const humanPlayer = () => G.players.find(p => p.isHuman) || null;

export function newMatch(mode, diff, human, marker = 'electro') {
  Object.assign(G, { mode, diff, human, marker, paused: false, round: 1, roundWins: [0, 0], caps: [0, 0], hits: [0, 0],
    balls: [], parts: [], winner: null, pendingWinner: null, endHandled: false,
    squad: { cmd: 'free', x: 0, y: 0 }, fast: false, fx: freshFx() });
  G.players = [];
  for (let t = 0; t < 2; t++) for (let i = 0; i < 3; i++) G.players.push(makePlayer(t, i, human && t === 0 && i === 0));
  placeAtSpawns();
  resetFlags();
  G.time = mode === 'ctf' ? CFG.ctfTimeLimit : CFG.ltsRoundTime;
  clearPaint();
  feedEl.innerHTML = '';
  bannerEl.hidden = true;
  if (human) { G.phase = 'countdown'; G.count = 3; G.countSub = `${mode === 'ctf' ? 'Capture the Flag' : 'Round 1'} · ${G.mapName}`; banner('3', G.countSub, 1.1); Sound.beep(false); }
  else G.phase = 'play';
}
