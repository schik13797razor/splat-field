/* ---------- DAILY CHALLENGE ----------
   One match a day that's the same for everyone: the date picks the mode, bot skill, your marker, sometimes a twist,
   and a seed for a brand-new field (built by the Random field generator). Your best score of the day and your streak
   of days played are saved in this browser (localStorage 'splatfield.daily'). The picks use their own generator,
   never Math.random. Leaf module: imports only util.js. */
import { mulberry32 } from './util.js';
const KEY = 'splatfield.daily';
const EPOCH = Date.UTC(2026, 0, 1);

// Day 1 = 1 January 2026, counted in your own time zone (the challenge changes at your midnight).
export function dayNumber(d = new Date()) {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000) + 1;
}

// Twists apply to everyone in that match, bots included. Long Wash never lands on Last Team Standing (no washing there).
export const TWISTS = {
  pump:    { name: 'Pump Day',    how: 'Everyone carries the Pump.' },
  scatter: { name: 'Scatter Day', how: 'Everyone carries the Scatter.' },
  speed:   { name: 'Speed Day',   how: 'Everyone runs 20% faster.' },
  wash:    { name: 'Long Wash',   how: 'Washing off takes 6 seconds instead of 3.' },
};

// The challenge for day n: always the same answer for the same n.
// Modes take turns (Capture the Flag, Last Team Standing, King of the Hill); the rest is picked by a generator seeded
// with a scrambled day number (neighbouring days would otherwise get similar picks).
export function dailyFor(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  const r = mulberry32(h);
  const mode = ['ctf', 'lts', 'koth'][((n % 3) + 3) % 3];
  const x = r(), diff = x < 0.25 ? 'easy' : x < 0.7 ? 'normal' : 'hard';
  let marker = ['electro', 'pump', 'scatter'][Math.floor(r() * 3)];
  let twist = null;
  if (r() < 0.5) {                                            // about every other day
    const options = ['pump', 'scatter', 'speed'].concat(mode === 'lts' ? [] : ['wash']);
    twist = options[Math.floor(r() * options.length)];
  }
  if (twist === 'pump' || twist === 'scatter') marker = twist;
  const fieldSeed = Math.floor(r() * 1e9);
  return { n, mode, diff, marker, twist, fieldSeed };
}

// Score: 10 per hit you land, 100 per flag or round your team wins (2 per hill point), 300 for a win, 100 for a draw.
export function dailyScore({ mode, hits, objective, won, draw }) {
  const obj = mode === 'koth' ? Math.floor(objective) * 2 : objective * 100;
  return hits * 10 + obj + (won ? 300 : draw ? 100 : 0);
}

function fresh() { return { v: 1, day: 0, best: 0, tries: 0, streak: 0, lastDay: 0, bestEver: 0 }; }
let data = load();
function load() {
  const base = fresh();
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) Object.assign(base, s); } catch (e) {}
  return base;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
export function resetDaily() { data = fresh(); save(); }

// Today's best and tries, and the streak (days in a row with at least one finished daily; it survives until a day is missed).
export function dailyStatus(n) {
  const today = data.day === n;
  return { best: today ? data.best : 0, tries: today ? data.tries : 0, streak: data.lastDay >= n - 1 ? data.streak : 0, bestEver: data.bestEver };
}

// A finished daily match. Best of unlimited tries counts.
export function recordDaily(n, score) {
  if (data.day !== n) Object.assign(data, { day: n, best: 0, tries: 0 });
  data.tries++;
  const newBest = score > data.best;
  if (newBest) data.best = score;
  if (data.lastDay !== n) { data.streak = data.lastDay === n - 1 ? data.streak + 1 : 1; data.lastDay = n; }
  data.bestEver = Math.max(data.bestEver, score);
  save();
  return { newBest, ...dailyStatus(n) };
}
