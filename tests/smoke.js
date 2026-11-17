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

  // Finish the match (run the clock out) and check the end screen and career stats.
  await page.evaluate(() => { window.__splat.G.time = 0.01; });
  await page.waitForSelector('#endMenu:not([hidden])', { timeout: 6000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('splatfield.stats') || 'null'));
  check(saved && saved.record.ctf.normal.played === 1, 'finished match shows the end screen and is saved to stats');
  await page.click('#menuBtn');
  check((await page.textContent('#statsHint')).startsWith('1 played'), 'menu stats show the match');
  check(await page.locator('#medalGrid .medalcard').count() === 16 && /of 16 earned/.test(await page.textContent('#medalsHint')), 'menu shows the 16 medals');

  // Daily challenge: starts today's match on its own field, and leaving puts any twist numbers back.
  const base = await page.evaluate(() => ({ speed: window.__splat.CFG.playerSpeed, wash: window.__splat.CFG.washTime }));
  await page.click('#dailyBtn');
  const daily = await page.evaluate(() => ({ field: window.__splat.G.mapName, human: window.__splat.G.human }));
  check(daily.human && /^Daily field #\d+$/.test(daily.field), `daily challenge starts on today's field (${daily.field})`);
  await page.keyboard.press('Escape'); await page.click('#quitBtn');
  const after = await page.evaluate(() => ({ speed: window.__splat.CFG.playerSpeed, wash: window.__splat.CFG.washTime }));
  check(after.speed === base.speed && after.wash === base.wash, 'leaving the daily puts the normal rules back');

  // 3. A phone held sideways: touch controls (twin sticks and buttons) in a real match.
  const phone = await browser.newPage({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });
  await phone.addInitScript(SEEDED_RANDOM);
  phone.on('pageerror', e => errors.push(`phone page error: ${e.message}`));
  phone.on('console', m => { if (m.type() === 'error' && !FONT_HOSTS.test(m.location().url || '')) errors.push(`phone console.error: ${m.text()}`); });
  await phone.goto(server.url, { waitUntil: 'load' });
  await waitForHook(phone);
  check(await phone.evaluate(() => document.documentElement.classList.contains('touch')), 'phone: touch controls switch on');
  await phone.tap('#playBtn');
  await phone.waitForFunction(() => window.__splat.G.phase === 'play', null, { timeout: 6000 });
  await phone.waitForFunction(() => document.documentElement.classList.contains('inplay'), null, { timeout: 6000 }).catch(() => {});
  const ui = { sprint: await phone.isVisible('#tSprint'), reload: await phone.isVisible('#tReload'), footbarHidden: await phone.isHidden('.footbar') };
  check(ui.sprint && ui.reload && ui.footbarHidden, `phone: buttons show and the bottom bar hides during a match ${JSON.stringify(ui)}`);
  const moved = await phone.evaluate(() => {
    const S = window.__splat, hp = S.humanPlayer(), cv = document.getElementById('game'), r = cv.getBoundingClientRect();
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true }));
    const run = n => { for (let i = 0; i < n; i++) S.step(1 / 60); };   // steps the game itself, so a slow machine can't change the result
    // left thumb pushes down, right thumb aims up at empty field: you move and aim, but don't fire
    const x0 = hp.x, y0 = hp.y, a0 = hp.ammo;
    ev('pointerdown', 1, 90, r.height - 70); ev('pointermove', 1, 90, r.height - 30);
    ev('pointerdown', 2, r.width - 120, r.height - 90); ev('pointermove', 2, r.width - 120, r.height - 130);
    run(40);
    const res = { walked: Math.round(Math.hypot(hp.x - x0, hp.y - y0)), aimUp: Math.abs(hp.aim + Math.PI / 2) < 0.2, shotsAtNothing: a0 - hp.ammo };
    ev('pointerup', 1, 90, r.height - 30);
    // an enemy in the open, a little off to the right: aim right and auto-fire takes over
    const place = (p, x, y) => Object.assign(p, { x, y, vx: 0, vy: 0, state: 'active', protect: 0 });
    S.G.players.filter(p => p.team === 1).forEach((p, i) => place(p, 1450, 250 + i * 200));
    place(hp, 560, 125); place(S.G.players.find(p => p.team === 1), 760, 135);
    const a1 = hp.ammo;
    ev('pointermove', 2, r.width - 80, r.height - 90);
    run(10);
    res.shotsOnTarget = a1 - hp.ammo;
    ev('pointerup', 2, r.width - 80, r.height - 90);
    return res;
  });
  check(moved.walked > 20 && moved.aimUp && moved.shotsAtNothing === 0 && moved.shotsOnTarget > 0,
    `phone: left stick moves, right stick aims, auto-fires only on target ${JSON.stringify(moved)}`);
  await phone.tap('#tReload');
  check(await phone.evaluate(() => window.__splat.humanPlayer().reloadT > 0), 'phone: Reload button reloads');
  await phone.tap('#tPause');
  check(await phone.evaluate(() => window.__splat.G.paused), 'phone: Pause button pauses');
  await phone.close();

  // 4. Every field and mode, bots only, 30 simulated seconds each, drawn at the end.
  const sweep = await page.evaluate(() => {
    const S = window.__splat, out = [];
    let seed = 1;
    for (const map of ['snake', 'barrel', 'midline', 'hilltop', 'random']) for (const mode of ['ctf', 'lts', 'koth']) {
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
} catch (e) {
  errors.push(`test stopped early: ${String(e && e.message || e).split(/\r?\n/).slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
  await server.close();
}

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.what}`);
for (const e of errors) console.log(`FAIL  ${e}`);
// On GitHub, also report each problem as an annotation (shown on the run page, readable without signing in).
if (process.env.GITHUB_ACTIONS) for (const p of [...checks.filter(c => !c.ok).map(c => c.what), ...errors]) console.log(`::error title=npm test::${p.replace(/\r?\n/g, ' ')}`);
const failed = checks.filter(c => !c.ok).length + errors.length;
console.log(failed ? `\n${failed} problem(s)` : `\nAll ${checks.length} checks passed, no console errors.`);
process.exit(failed ? 1 : 0);
