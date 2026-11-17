/* ---------- MEDALS ----------
   One-time awards for things you do in your own matches, saved in this browser (localStorage 'splatfield.medals').
   This file only watches: it reads the match (passed in as arguments) and never changes it, and it never uses
   Math.random, so medals can't change how a match plays. Leaf module: imports nothing. */
const KEY = 'splatfield.medals';
export const FIELDS = ['snake', 'barrel', 'midline', 'hilltop', 'random'];

export const MEDALS = [
  { id: 'first',    name: 'First Splat',       how: 'Land your first hit.' },
  { id: 'hattrick', name: 'Hat Trick',         how: 'Land 3 hits within 5 seconds.' },
  { id: 'onfire',   name: 'On Fire',           how: 'Land 5 hits in one life (without getting painted).' },
  { id: 'clean',    name: 'Clean Sheet',       how: 'Win a match without getting painted.' },
  { id: 'runner',   name: 'Flag Runner',       how: 'Capture a flag yourself.' },
  { id: 'slam',     name: 'Grand Slam',        how: 'Capture all 3 flags yourself in one match.' },
  { id: 'king',     name: "King's Seat",       how: 'Earn 30 hill points while you stand on the hill.' },
  { id: 'lastman',  name: 'Last One Standing', how: "Win a Last Team Standing round as your team's last player left." },
  { id: 'sweep',    name: 'Clean Sweep',       how: 'Win Last Team Standing 3 rounds to 0.' },
  { id: 'comeback', name: 'Comeback',          how: 'Win after falling 2 flags, 2 rounds or 30 points behind.' },
  { id: 'hard',     name: 'Hard Hitter',       how: 'Win a match on Hard.' },
  { id: 'tour',     name: 'Field Tour',        how: 'Win on all five fields: Snake Line, Barrel Yard, Midline, Hilltop and Random.' },
  { id: 'allmodes', name: 'Triple Threat',     how: 'Win in all three modes.' },
  { id: 'roll',     name: 'On a Roll',         how: 'Win 5 matches in a row.' },
  { id: 'century',  name: 'Century',           how: 'Land 100 hits across all your matches.' },
  { id: 'daily',    name: 'Daily Player',      how: 'Finish a daily challenge.' },
];
const BY_ID = Object.fromEntries(MEDALS.map(m => [m.id, m]));

function fresh() { return { v: 1, earned: {}, fieldWins: {} }; }   // earned: id -> date string (YYYY-MM-DD)
export let medals = load();
function load() {
  const base = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.v === 1) { Object.assign(base.earned, saved.earned); Object.assign(base.fieldWins, saved.fieldWins); }
  } catch (e) {}
  return base;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(medals)); } catch (e) {} }
export function resetMedals() { medals = fresh(); save(); }
export const earnedCount = () => MEDALS.filter(m => medals.earned[m.id]).length;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Award a medal once. Returns its definition if it's new, otherwise null.
export function award(id) {
  if (!BY_ID[id] || medals.earned[id]) return null;
  medals.earned[id] = today(); save();
  return BY_ID[id];
}

// What we remember during one match.
const m = { hits: 0, painted: 0, lifeHits: 0, hitTimes: [], round: 1, roundWins0: 0, hillPts: 0, seat: 0, fellBehind: false };
export function startMatchMedals() {
  Object.assign(m, { hits: 0, painted: 0, lifeHits: 0, hitTimes: [], round: 1, roundWins0: 0, hillPts: 0, seat: 0, fellBehind: false });
}

// Called every frame of your match. G is the game state, hp your player, onHill(p) the hill test.
// Returns the medals earned this frame (usually none).
export function medalsFrame(G, hp, onHill) {
  if (!G.human || !hp) return [];
  const out = [], give = id => { const d = award(id); if (d) out.push(d); }, s = hp.stats;
  if (G.round !== m.round) { m.round = G.round; m.hitTimes = []; }            // Last Team Standing: new round, new clock
  if (s.painted > m.painted) { m.painted = s.painted; m.lifeHits = 0; }
  while (m.hits < s.hits) { m.hits++; m.lifeHits++; m.hitTimes.push(G.time); }  // G.time counts down
  if (m.hitTimes.length > 3) m.hitTimes = m.hitTimes.slice(-3);
  if (s.hits >= 1) give('first');
  if (m.hitTimes.length === 3 && m.hitTimes[0] - m.hitTimes[2] <= 5) give('hattrick');
  if (m.lifeHits >= 5) give('onfire');
  if (s.caps >= 1) give('runner');
  if (s.caps >= 3) give('slam');
  if (G.mode === 'koth') {
    const gained = G.points[0] - m.hillPts; m.hillPts = G.points[0];
    if (gained > 0 && hp.state === 'active' && onHill(hp)) m.seat += gained;
    if (m.seat >= 30) give('king');
  }
  const behind = G.mode === 'ctf' ? G.caps[1] - G.caps[0] >= 2 : G.mode === 'lts' ? G.roundWins[1] - G.roundWins[0] >= 2
    : G.points[1] - G.points[0] >= 30;
  if (behind) m.fellBehind = true;
  if (G.mode === 'lts' && G.roundWins[0] > m.roundWins0) {                      // your team just won a round
    m.roundWins0 = G.roundWins[0];
    const mates = G.players.filter(p => p.team === hp.team && p !== hp);
    if (hp.state !== 'out' && mates.every(p => p.state === 'out')) give('lastman');
  }
  return out;
}

// Called once when your match ends, after the career stats are saved. Returns the medals earned.
//   r = { won, mode, diff, mapKey, painted, roundWins, careerHits, winStreak, modesWon }
export function medalsEnd(r) {
  const out = [], give = id => { const d = award(id); if (d) out.push(d); };
  if (r.won) {
    if (r.painted === 0) give('clean');
    if (r.mode === 'lts' && r.roundWins[1] === 0) give('sweep');
    if (m.fellBehind) give('comeback');
    if (r.diff === 'hard') give('hard');
    if (FIELDS.includes(r.mapKey)) { medals.fieldWins[r.mapKey] = true; save(); }
    if (FIELDS.every(f => medals.fieldWins[f])) give('tour');
    if (r.modesWon >= 3) give('allmodes');
    if (r.winStreak >= 5) give('roll');
  }
  if (r.careerHits >= 100) give('century');
  return out;
}
