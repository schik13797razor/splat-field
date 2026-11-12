// npm test: load the game in headless Chromium, play it a little, and fail on any console error or page error.
import { startServer, launchBrowser, waitForHook, SEEDED_RANDOM } from './harness.js';

// Google Fonts is the only external resource. If it can't be reached (offline), the game falls back to local fonts,
// so a failed font request isn't a game error.
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

const errors = [];
const checks = [];
const check = (ok, what) => { checks.push({ ok: !!ok, what }); };

const server = await startServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(SEEDED_RANDOM); // repeatable runs: same random numbers every time
  page.on('pageerror', e => errors.push(`page error: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error' || FONT_HOSTS.test(m.location().url || '')) return;
    errors.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', r => { if (!FONT_HOSTS.test(r.url())) errors.push(`request failed: ${r.url()}`); });

  // 1. Page loads and the menu demo runs in real time.
  await page.goto(server.url, { waitUntil: 'load' });
  await waitForHook(page);
  const t0 = await page.evaluate(() => window.__splat.G.time);
  await page.waitForTimeout(1500);
  const demo = await page.evaluate(() => ({ human: window.__splat.G.human, time: window.__splat.G.time }));
  check(!demo.human && demo.time < t0, 'menu demo is running');

  // 2. Start a real match from the menu and use the controls.
  await page.click('#playBtn');
  check(await page.isHidden('#menu'), 'Play hides the menu');
  await page.waitForFunction(() => window.__splat.G.phase === 'play', null, { timeout: 6000 });
  check(await page.evaluate(() => window.__splat.G.human), 'match started with a human player');
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await page.keyboard.down('KeyD'); await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(400); await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyD');
  check(await page.evaluate(() => window.__splat.humanPlayer().ammo < window.__splat.MARKERS[window.__splat.settings.marker].hopper), 'shooting used paint');
  await page.keyboard.press('KeyR');
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) { await page.keyboard.press(k); await page.waitForTimeout(100); }
  check(await page.evaluate(() => window.__splat.G.squad.cmd === 'free'), 'squad orders respond (ended on free play)');
  await page.keyboard.press('KeyM'); await page.keyboard.press('KeyM');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => window.__splat.G.paused) && await page.isVisible('#pauseMenu'), 'Esc pauses');
  await page.click('#resumeBtn');
  check(await page.evaluate(() => !window.__splat.G.paused), 'Resume unpauses');
  await page.waitForTimeout(500);

  // 3. Every field and mode, bots only, 30 simulated seconds each, drawn at the end.
  const sweep = await page.evaluate(() => {
    const S = window.__splat, out = [];
    let seed = 1;
    for (const map of ['snake', 'barrel', 'midline', 'random']) for (const mode of ['ctf', 'lts']) {
      window.__seed(seed++);
      S.loadMap(map);
      S.newMatch(mode, 'normal', false);
      for (let i = 0; i < 30 * 60 && S.G.phase !== 'over'; i++) S.step(1 / 60);
      out.push({ map, mode, hits: S.G.hits[0] + S.G.hits[1] });
    }
    return out;
  });
  await page.waitForTimeout(300); // let a few real frames render the last field
  for (const r of sweep) check(r.hits > 0, `${r.map} ${r.mode}: bots play (${r.hits} hits in 30 s)`);
} finally {
  await browser.close();
  await server.close();
}

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.what}`);
for (const e of errors) console.log(`FAIL  ${e}`);
const failed = checks.filter(c => !c.ok).length + errors.length;
console.log(failed ? `\n${failed} problem(s)` : `\nAll ${checks.length} checks passed, no console errors.`);
process.exit(failed ? 1 : 0);
