// npm run sim: bot-only balance batches through the window.__splat hook.
//   npm run sim                         8 matches per mode, field and skill
//   npm run sim -- --matches=20 --fields=snake --skills=normal --modes=ctf
//   npm run sim -- --seed=42            repeatable results (same seed, same numbers)
//   npm run sim -- --workers=4          browsers running in parallel (default: half the CPU cores, max 6)
import os from 'node:os';
import { startServer, launchBrowser, waitForHook, SEEDED_RANDOM, NO_FRAMES } from './harness.js';

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const FIELD_NAMES = { snake: 'Snake Line', barrel: 'Barrel Yard', midline: 'Midline', random: 'Random' };
const matches = +arg('matches', 8);
const fields = arg('fields', 'snake,barrel,midline,random').split(',');
const skills = arg('skills', 'easy,normal,hard').split(',');
const modes = arg('modes', 'ctf,lts').split(',');
const seed = arg('seed', null);
const workers = +arg('workers', Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2))));
// Simulated-time cap per match. CTF ends by 6:00; LTS can run up to 5 rounds of 150 s.
const CAP = { ctf: 420, lts: 900 };

for (const f of fields) if (!FIELD_NAMES[f]) throw new Error(`unknown field "${f}" (use ${Object.keys(FIELD_NAMES)})`);

const jobs = [];
for (const field of fields) for (const skill of skills) for (const mode of modes)
  for (let i = 0; i < matches; i++) jobs.push({ field, skill, mode, seed: seed === null ? null : +seed * 100000 + jobs.length });

// One bot-only match, entirely inside the page (no frames run, so step() is the only thing moving the game).
function playMatch({ field, mode, skill, seed, cap }) {
  const S = window.__splat, G = S.G, dt = 1 / 60;
  if (seed !== null) window.__seed(seed);
  S.loadMap(field);
  S.newMatch(mode, skill, false);
  const rounds = [];
  let steps = 0, phase = G.phase;
  while (G.phase !== 'over' && steps < cap * 60) {
    S.step(dt); steps++;
    if (mode === 'lts' && phase === 'play' && G.phase !== 'play') rounds.push(S.CFG.ltsRoundTime - G.time);
    phase = G.phase;
  }
  return {
    finished: G.phase === 'over', winner: G.winner, caps: G.caps[0] + G.caps[1],
    timeout: mode === 'ctf' && Math.max(...G.caps) < S.CFG.ctfCapsToWin,
    length: mode === 'ctf' ? S.CFG.ctfTimeLimit - G.time : null, rounds,
  };
}

const server = await startServer();
const results = [];
let done = 0;
const t0 = Date.now();
const progress = () => { if (process.stderr.isTTY) process.stderr.write(`\r  ${done}/${jobs.length} matches`); }; // live counter only in a terminal
const browsers = Math.min(workers, jobs.length);
console.error(`Running ${jobs.length} bot-only match(es) on ${browsers} browser(s)${seed !== null ? ` (seed ${seed})` : ''}...`);

// Browsers open the page one at a time (several cold page loads at once can stall the dev server), then play in parallel.
let loading = Promise.resolve();
async function worker(queue, withLayoutCheck) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', e => { console.error(`\npage error: ${e.message}`); process.exitCode = 1; });
  await page.addInitScript(NO_FRAMES);
  if (seed !== null) await page.addInitScript(SEEDED_RANDOM);
  const loaded = loading.then(async () => { await page.goto(server.url, { waitUntil: 'load' }); await waitForHook(page); });
  loading = loaded.catch(() => {});
  await loaded;
  let layouts = null;
  if (withLayoutCheck) layouts = await page.evaluate(n => {
    const S = window.__splat, t = performance.now();
    let fallbacks = 0;
    for (let s = 1; s <= n; s++) if (S.randomLayout(s) === S.MAPS.snake) fallbacks++;
    return { n, fallbacks, ms: (performance.now() - t) / n };
  }, 300);
  while (queue.length) {
    const job = queue.shift();
    results.push({ ...job, ...(await page.evaluate(playMatch, { ...job, cap: CAP[job.mode] })) });
    done++; progress();
  }
  await browser.close();
  return layouts;
}

const queue = jobs.slice();
let layouts;
try {
  const out = await Promise.all(Array.from({ length: browsers }, (_, i) => worker(queue, i === 0)));
  layouts = out[0];
} finally {
  await server.close();
}
process.stderr.write(`\r  ${done}/${jobs.length} matches in ${((Date.now() - t0) / 1000).toFixed(0)} s\n\n`);

// ---- report ----
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const fmt = (v, d = 0) => Number.isNaN(v) ? '-' : v.toFixed(d);
const frac = (xs, pred) => xs.length ? `${xs.filter(pred).length}/${xs.length}` : '-';

const rows = [];
for (const field of fields) for (const skill of skills) {
  const ctf = results.filter(r => r.field === field && r.skill === skill && r.mode === 'ctf');
  const lts = results.filter(r => r.field === field && r.skill === skill && r.mode === 'lts');
  rows.push([
    FIELD_NAMES[field], skill,
    ctf.length ? `${fmt(avg(ctf.map(r => r.length)))} s` : '-',
    ctf.length ? fmt(avg(ctf.map(r => r.caps)), 1) : '-',
    frac(ctf, r => r.timeout),
    frac(ctf, r => r.winner === 1),
    lts.length ? `${fmt(avg(lts.flatMap(r => r.rounds)), 1)} s` : '-',
    frac(lts, r => r.winner === 1),
  ]);
}
const head = ['Field', 'Skill', 'CTF length', 'Captures', 'Timeouts', 'CTF Blue wins', 'LTS round', 'LTS Blue wins'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
const line = r => r.map((c, i) => (i < 2 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
console.log(line(head));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));

const ctfAll = results.filter(r => r.mode === 'ctf'), ltsAll = results.filter(r => r.mode === 'lts');
console.log('');
if (ctfAll.length) console.log(`CTF overall: Blue won ${frac(ctfAll, r => r.winner === 1)}, Orange ${frac(ctfAll, r => r.winner === 0)}, draws ${frac(ctfAll, r => r.winner === -1)}`);
if (ltsAll.length) console.log(`LTS overall: Blue won ${frac(ltsAll, r => r.winner === 1)}, Orange ${frac(ltsAll, r => r.winner === 0)}, draws ${frac(ltsAll, r => r.winner === -1)}`);
const unfinished = results.filter(r => !r.finished);
if (unfinished.length) console.log(`Warning: ${unfinished.length} match(es) hit the simulated-time cap without finishing.`);
if (layouts) console.log(`Random field generator: ${layouts.n - layouts.fallbacks}/${layouts.n} valid (fell back to Snake Line ${layouts.fallbacks} times), ${layouts.ms.toFixed(1)} ms each`);
