/* ---------- CAREER STATS ----------
   Your record across matches, saved in this browser (localStorage 'splatfield.stats'). Only your own finished
   matches count: bot-only demos, quitting, and restarting don't. Nothing here touches G or Math.random, so stats
   can't change how a match plays. Leaf module: imports nothing, so any file can use it at load time. */
const KEY = 'splatfield.stats';
export const MODES = ['ctf', 'lts', 'koth'], SKILLS = ['easy', 'normal', 'hard'];

function fresh() {
  const record = {};
  for (const m of MODES) { record[m] = {}; for (const s of SKILLS) record[m][s] = { played: 0, won: 0 }; }
  return {
    v: 1, record,
    totals: { hits: 0, painted: 0, caps: 0, hillPoints: 0 },
    winStreak: 0,
    best: { winStreak: 0, hitsInMatch: 0, hitStreak: 0, fastestCtfWin: 0 },   // 0 = no best yet
  };
}
export let career = load();
function load() {
  const base = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.v === 1) {
      for (const m of MODES) for (const s of SKILLS) Object.assign(base.record[m][s], saved.record?.[m]?.[s]);
      Object.assign(base.totals, saved.totals); Object.assign(base.best, saved.best);
      base.winStreak = saved.winStreak || 0;
    }
  } catch (e) {}
  return base;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(career)); } catch (e) {} }
export function resetCareer() { career = fresh(); save(); }

// Hit streak in one life: hits you land before you get painted. Reset at the start of every match.
const life = { streak: 0, bestThisMatch: 0 };
export function startMatchStats() { life.streak = 0; life.bestThisMatch = 0; }
export function noteHumanHit() { life.streak++; life.bestThisMatch = Math.max(life.bestThisMatch, life.streak); }
export function noteHumanPainted() { life.streak = 0; }

// Called once when your match ends. Returns what to show on the end screen: new bests and your record.
//   r = { mode, diff, won, draw, hits, painted, caps, hillPoints, seconds }
export function recordMatch(r) {
  const rec = career.record[r.mode]?.[r.diff];
  if (!rec) return { bests: [], rec: null, winStreak: 0 };
  rec.played++; if (r.won) rec.won++;
  const t = career.totals;
  t.hits += r.hits; t.painted += r.painted; t.caps += r.caps; t.hillPoints += r.hillPoints;
  career.winStreak = r.won ? career.winStreak + 1 : 0;
  const bests = [], B = career.best;
  const beat = (key, value, label, better = (a, b) => a > b) => {
    if (value > 0 && (B[key] === 0 || better(value, B[key]))) { bests.push({ label, value, was: B[key], key }); B[key] = value; }
  };
  beat('hitsInMatch', r.hits, 'Most hits in a match');
  beat('hitStreak', life.bestThisMatch, 'Best hit streak in one life');
  beat('winStreak', career.winStreak, 'Longest win streak');
  if (r.mode === 'ctf' && r.won) beat('fastestCtfWin', Math.round(r.seconds), 'Fastest Capture the Flag win', (a, b) => a < b);
  save();
  return { bests, rec: { ...rec }, winStreak: career.winStreak };
}
export const matchesPlayed = () => MODES.reduce((n, m) => n + SKILLS.reduce((k, s) => k + career.record[m][s].played, 0), 0);
export const matchesWon = () => MODES.reduce((n, m) => n + SKILLS.reduce((k, s) => k + career.record[m][s].won, 0), 0);
export const clockText = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
