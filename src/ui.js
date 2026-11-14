import { CFG, MARKERS, MK, TEAMS, TEAM_COLORS, setTeamColors } from './config.js';
import { W, H, clamp, inRect, angleDiff } from './util.js';
import { raycast } from './geometry.js';
import { MAPS, BASES } from './field.js';
import { freePoint, applyLayout, randomLayout } from './pathfinding.js';
import { G, humanPlayer, newMatch, custom } from './state.js';
import { speedFor, canShoot, shoot, startReload, onHill } from './rules.js';
import { career, MODES, SKILLS, resetCareer, startMatchStats, recordMatch, matchesPlayed, matchesWon, clockText } from './stats.js';
const MODE_NAMES = { ctf: 'Capture the Flag', lts: 'Last Team Standing', koth: 'King of the Hill' };
import { canvas, view, drawField, clearPaint, drawPreview } from './drawing.js';
import { Sound } from './sound.js';

/* ---------- 10. INPUT + UI ---------- */
export const $ = id => document.getElementById(id);
export const stage = $('stage'), bannerEl = $('banner'), feedEl = $('feed'), statusEl = $('status');
const menuEl = $('menu'), pauseEl = $('pauseMenu'), endEl = $('endMenu');
const hopperEl = $('hopper'), squadEl = $('squad'), squadBtns = [...document.querySelectorAll('.sq')];
const keys = Object.create(null);
export const mouse = { sx: 0, sy: 0, wx: W / 2, wy: H / 2, down: false, inside: false };
// Touch: twin sticks. The left thumb's stick moves (mx, my); the right thumb's stick aims (adx, ady) and fires once
// pushed past halfway. Both sticks appear wherever the thumb lands. ax/ay is the crosshair point in front of you.
export const touch = { stickId: null, bx: 0, by: 0, mx: 0, my: 0, aimId: null, abx: 0, aby: 0, adx: 0, ady: 0,
                       aimAng: 0, fire: false, sprint: false, ax: W / 2, ay: H / 2 };
export const STICK = 52;                       // stick radius in screen pixels
export const input = { source: 'mouse' };
// Which controls are in use. The page gets a "touch" class so the CSS can show phone buttons and help.
function setSource(s) {
  if (input.source === s) return;
  input.source = s;
  document.documentElement.classList.toggle('touch', s === 'touch');
}

export function updateHuman(p, dt) {
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  mx += touch.mx; my += touch.my;
  const L = Math.hypot(mx, my);
  if (L > 1) { mx /= L; my /= L; }
  if (p.winded) touch.sprint = false;            // the Sprint button switches itself off when you run out
  p.sprinting = !!((keys.ShiftLeft || keys.ShiftRight || touch.sprint) && L > 0.1 && !p.winded && p.stamina > 0);
  const sp = speedFor(p);
  p.vx = mx * sp; p.vy = my * sp;
  aimHuman(p);
  const wantsFire = mouse.down || keys.Space || touch.fire;
  if (wantsFire && canShoot(p)) { const m = MK(p); shoot(p, p.aim, m.spread); p.cool = m.fireDelay; }
}
const ORDER_TEXT = { follow: 'Squad: follow me', hold: 'Squad: hold that spot', free: 'Squad: free play' };
export function issueOrder(cmd, atSelf) {
  const hp = humanPlayer();
  if (!hp || !ORDER_TEXT[cmd] && cmd !== 'attack') return;
  const sq = G.squad;
  sq.cmd = cmd;
  if (cmd === 'hold') {
    const src = atSelf ? hp : input.source === 'touch' ? { x: touch.ax, y: touch.ay } : { x: mouse.wx, y: mouse.wy };
    const f = freePoint({ x: clamp(src.x, 40, W - 40), y: clamp(src.y, 40, H - 40) });
    sq.x = f.x; sq.y = f.y;
  }
  for (const p of G.players) if (p.team === 0 && !p.isHuman) Object.assign(p.ai, { think: 0, hold: 0, goal: null, path: [], routeKey: '' });
  feed(cmd === 'attack' ? (G.mode === 'ctf' ? 'Squad: go get their flag' : G.mode === 'koth' ? 'Squad: take the hill' : 'Squad: push and hunt') : ORDER_TEXT[cmd], 0);
  Sound.order();
}
export function aimHuman(p) {
  if (input.source === 'touch') {
    p.aim = assistAim(p, touch.aimAng);
    touch.ax = p.x + Math.cos(p.aim) * 170; touch.ay = p.y + Math.sin(p.aim) * 170;
    return;
  }
  p.aim = Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
}
// Light aim assist for thumbs (touch only, while the aim stick is held): if an enemy you could hit is in range and
// within 8 degrees of where you're aiming, the aim snaps onto them. It never picks a target behind a bunker.
const ASSIST = 8 * Math.PI / 180;
function assistAim(p, ang) {
  if (touch.aimId === null || p.state !== 'active') return ang;
  const range = MK(p).range;
  let best = ang, bd = ASSIST;
  for (const e of G.players) {
    if (e.team === p.team || e.state !== 'active' || Math.hypot(e.x - p.x, e.y - p.y) > range) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x), d = Math.abs(angleDiff(ang, a));
    if (d < bd && !raycast(p.x, p.y, e.x, e.y, CFG.ballRadius)) { bd = d; best = a; }
  }
  return best;
}
const toWorld = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
function localPos(e) { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, w: r.width, h: r.height }; }

// Pointer (mouse + touch) listeners. Attached from boot() because the canvas comes from drawing.js,
// which may not have loaded yet when this file runs.
export function bindPointerInput() {
  canvas.addEventListener('pointerdown', e => {
    const { sx, sy, w } = localPos(e);
    if (e.pointerType === 'touch') {
      e.preventDefault();
      setSource('touch');
      if (sx < w * 0.45 && touch.stickId === null) { touch.stickId = e.pointerId; touch.bx = sx; touch.by = sy; touch.mx = touch.my = 0; }
      else if (sx >= w * 0.45 && touch.aimId === null) {
        Object.assign(touch, { aimId: e.pointerId, abx: sx, aby: sy, adx: 0, ady: 0, fire: false });
      }
    } else {
      setSource('mouse');
      if (e.button === 0) { mouse.down = true; e.preventDefault(); }
    }
  });
  window.addEventListener('pointermove', e => {
    const { sx, sy, w, h } = localPos(e);
    if (e.pointerType === 'touch') {
      if (e.pointerId === touch.stickId) {
        let dx = (sx - touch.bx) / STICK, dy = (sy - touch.by) / STICK; const L = Math.hypot(dx, dy);
        if (L > 1) { dx /= L; dy /= L; }
        touch.mx = dx; touch.my = dy;
      } else if (e.pointerId === touch.aimId) {
        let dx = (sx - touch.abx) / STICK, dy = (sy - touch.aby) / STICK; const L = Math.hypot(dx, dy);
        if (L > 1) { dx /= L; dy /= L; touch.abx = sx - dx * STICK; touch.aby = sy - dy * STICK; } // the stick follows a long drag
        touch.adx = dx; touch.ady = dy;
        if (L > 0.25) touch.aimAng = Math.atan2(dy, dx);
        touch.fire = L >= 0.5;
      }
      return;
    }
    setSource('mouse');
    mouse.sx = sx; mouse.sy = sy; mouse.inside = sx >= 0 && sy >= 0 && sx <= w && sy <= h;
    const p = toWorld(sx, sy); mouse.wx = p.x; mouse.wy = p.y;
  });
  function endPointer(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === touch.stickId) { touch.stickId = null; touch.mx = touch.my = 0; touch.sprint = false; }
      if (e.pointerId === touch.aimId) { touch.aimId = null; touch.adx = touch.ady = 0; touch.fire = false; }
    } else if (e.button === 0 || e.type === 'pointercancel') mouse.down = false;
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') mouse.inside = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // Any touch anywhere (menu buttons included) switches to phone controls; a phone starts in them.
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') setSource('touch'); }, { capture: true });
  if (matchMedia('(pointer: coarse)').matches) setSource('touch');
  // Phone buttons. pointerdown (not click) so they respond the instant a thumb lands.
  const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (playing()) fn(); });
  tap('tPause', () => togglePause(true));
  tap('tSprint', () => { touch.sprint = !touch.sprint; });
  tap('tReload', () => { const hp = humanPlayer(); if (hp && hp.state === 'active') startReload(hp); });
  tap('tFast', () => { G.fast = !G.fast; });
}

const playing = () => G.human && !G.paused && G.phase !== 'over';
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return; // typing a name, not playing
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.human) { togglePause(); e.preventDefault(); } return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (playing() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (!playing() || e.repeat) return;
  const hp = humanPlayer();
  if (e.code === 'KeyR' && hp) startReload(hp);
  if (e.code === 'KeyF' && hp && hp.state === 'out') G.fast = !G.fast;
  const cmd = { Digit1: 'follow', Digit2: 'hold', Digit3: 'attack', Digit4: 'free',
                Numpad1: 'follow', Numpad2: 'hold', Numpad3: 'attack', Numpad4: 'free' }[e.code];
  if (cmd) { issueOrder(cmd, false); e.preventDefault(); }
});
document.querySelectorAll('.sq').forEach(b => {
  b.addEventListener('pointerdown', e => e.preventDefault()); // keep keyboard focus on the game
  b.addEventListener('click', () => { if (playing()) issueOrder(b.dataset.cmd, true); });
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
function releaseInputs() {
  for (const k in keys) keys[k] = false;
  mouse.down = false;
  Object.assign(touch, { stickId: null, aimId: null, mx: 0, my: 0, adx: 0, ady: 0, fire: false, sprint: false });
}
window.addEventListener('blur', () => { releaseInputs(); if (playing()) togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing()) togglePause(true); });

// banner + feed
let bannerTimer = 0;
export function banner(main, sub = '', dur = 1.5, cls = '') {
  if (!G.human) return;
  $('bannerMain').textContent = main; $('bannerSub').textContent = sub;
  bannerEl.className = 'banner ' + cls;
  bannerEl.hidden = false;
  bannerEl.style.animation = 'none'; void bannerEl.offsetWidth; bannerEl.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, dur * 1000);
}
export function feed(text, team) {
  if (!G.human) return;
  const li = document.createElement('li');
  li.className = 't' + team; li.textContent = text;
  feedEl.prepend(li);
  while (feedEl.children.length > 5) feedEl.lastChild.remove();
  setTimeout(() => li.classList.add('fade'), 4200);
  setTimeout(() => li.remove(), 5100);
}

// settings (remembered in this browser when storage is available)
export const settings = { mode: 'ctf', diff: 'normal', marker: 'electro', map: 'snake', muted: false, team0: 'orange', team1: 'blue',
                          playerName: '', mate1: '', mate2: '', jersey: 'stripe', mask: 'black', volMaster: 80, volSfx: 100, volMusic: 70 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('splatfield.settings') || '{}')); } catch (e) {}
if (!MARKERS[settings.marker]) settings.marker = 'electro';
if (!MAPS[settings.map] && settings.map !== 'random') settings.map = 'snake';
if (!TEAM_COLORS[settings.team0] || !TEAM_COLORS[settings.team1] || settings.team0 === settings.team1) Object.assign(settings, { team0: 'orange', team1: 'blue' });
if (!['stripe', 'solid', 'split', 'hoops'].includes(settings.jersey)) settings.jersey = 'stripe';
if (!['black', 'white', 'gray', 'camo'].includes(settings.mask)) settings.mask = 'black';
// Volume sliders (0-100). Both copies (menu and pause menu) show the same three settings.
const VOLS = { master: 'volMaster', sfx: 'volSfx', music: 'volMusic' };
for (const [k, key] of Object.entries(VOLS)) {
  const v = Number(settings[key]);
  settings[key] = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : { master: 80, sfx: 100, music: 70 }[k];
}
function applyVolumes() {
  Sound.setVolumes({ master: settings.volMaster, sfx: settings.volSfx, music: settings.volMusic });
  for (const el of document.querySelectorAll('input[data-vol]')) {
    const v = settings[VOLS[el.dataset.vol]];
    if (document.activeElement !== el) el.value = v;
    el.nextElementSibling.textContent = String(v);
  }
}
for (const el of document.querySelectorAll('input[data-vol]')) {
  el.addEventListener('input', () => {
    Sound.init();
    settings[VOLS[el.dataset.vol]] = Number(el.value);
    if (settings.muted) settings.muted = false;   // moving a slider turns sound back on
    saveSettings(); syncSettingsUI();
  });
  el.addEventListener('change', () => { if (el.dataset.vol !== 'music') Sound.preview(); }); // let go: hear the level
}
// Names: up to 10 letters, digits, spaces, dots or dashes, shown in capitals like the bots' names.
const cleanName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10);
const NAME_INPUTS = { nameInput: 'playerName', mate1Input: 'mate1', mate2Input: 'mate2' };
for (const key of Object.values(NAME_INPUTS)) settings[key] = cleanName(settings[key]);
function applyCustom() {
  Object.assign(custom, { name: settings.playerName, mates: [settings.mate1, settings.mate2], jersey: settings.jersey, mask: settings.mask });
  drawPreview($('preview'), settings.playerName || 'YOU', settings.marker);
}
for (const [id, key] of Object.entries(NAME_INPUTS)) {
  $(id).addEventListener('input', () => { settings[key] = cleanName($(id).value); saveSettings(); applyCustom(); });
  $(id).addEventListener('change', () => { $(id).value = settings[key]; });   // show the cleaned-up name
}
function saveSettings() { try { localStorage.setItem('splatfield.settings', JSON.stringify(settings)); } catch (e) {} }
// First visit: open "How to play" so new players see the controls. It stays folded once they've played a match.
if (!settings.seenHelp) $('howto').open = true;

// Team color swatches in the Customize section (built from the palette in config.js).
for (const t of [0, 1]) for (const [key, c] of Object.entries(TEAM_COLORS)) {
  const label = document.createElement('label'), input = document.createElement('input'), dot = document.createElement('span');
  input.type = 'radio'; input.name = 'team' + t; input.value = key;
  dot.className = 'sw'; dot.style.background = c.color;
  label.append(input, dot, c.name);
  $('swatches' + t).append(label);
}
const SETTING_RADIOS = ['mode', 'diff', 'marker', 'map', 'team0', 'team1', 'jersey', 'mask'];
// Recolor both teams everywhere: the drawing palette, the page's CSS colors, and team names in the text.
function applyTeamColors() {
  setTeamColors(settings.team0, settings.team1);
  for (const t of [0, 1]) {
    document.documentElement.style.setProperty('--team' + t, TEAMS[t].color);
    document.querySelectorAll('.tn' + t).forEach(el => { el.textContent = TEAMS[t].name; });
  }
}
export function syncSettingsUI() {
  for (const name of SETTING_RADIOS) for (const el of document.querySelectorAll(`input[name="${name}"]`)) el.checked = el.value === settings[name];
  $('markerHint').textContent = MARKERS[settings.marker].hint;
  Sound.setMuted(!!settings.muted);
  $('soundBtn').textContent = settings.muted ? 'Sound: off' : 'Sound: on';
  applyVolumes();
  for (const [id, key] of Object.entries(NAME_INPUTS)) if (document.activeElement !== $(id)) $(id).value = settings[key];
  applyTeamColors();
  applyCustom();
}
for (const name of SETTING_RADIOS) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(el => el.addEventListener('change', () => {
    if (name === 'team0' || name === 'team1') {
      const other = name === 'team0' ? 'team1' : 'team0';
      if (settings[other] === el.value) settings[other] = settings[name];  // picked the other team's color: swap
    }
    settings[name] = el.value; saveSettings(); syncSettingsUI();
    if (name === 'map') { loadMap(el.value); G.attractNext = G.mode; startDemo(); } // preview the field behind the menu
    if (name === 'team0' || name === 'team1') { drawField(); G.attractNext = G.mode; startDemo(); } // repaint bases, fresh paint
  }));
}
function toggleMute() { settings.muted = !settings.muted; saveSettings(); syncSettingsUI(); }

// Switch fields: rebuild bunkers, paths, and cover, redraw the turf, and wipe old paint.
export function loadMap(key) {
  const def = key === 'random' ? randomLayout((Math.random() * 1e9) | 0) : (applyLayout(MAPS[key]), MAPS[key]);
  G.mapKey = key; G.mapName = def.name;
  drawField(); clearPaint();
}
export function startHumanMatch() {
  Sound.init();
  // Phones: go full screen and sideways where the browser allows it (Android does; iPhone Safari doesn't).
  const root = document.documentElement;
  if (input.source === 'touch' && document.fullscreenEnabled && !document.fullscreenElement && root.requestFullscreen) {
    root.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => {});
  }
  releaseInputs();
  menuEl.hidden = pauseEl.hidden = endEl.hidden = true;
  if (!settings.seenHelp) { settings.seenHelp = true; saveSettings(); }
  startMatchStats();
  if (settings.map === 'random' || G.mapKey !== settings.map) loadMap(settings.map); // a fresh random field every match
  newMatch(settings.mode, settings.diff, true, settings.marker);
  stage.classList.add('playing');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
export function startDemo() {
  if (G.mapKey !== settings.map) loadMap(settings.map);
  const m = G.attractNext; G.attractNext = { ctf: 'lts', lts: 'koth', koth: 'ctf' }[m] || 'ctf'; // the demo cycles modes
  newMatch(m, 'normal', false);
}
function toMenu() {
  releaseInputs();
  pauseEl.hidden = endEl.hidden = true; statusEl.hidden = true; bannerEl.hidden = true;
  stage.classList.remove('playing');
  G.attractNext = 'ctf';
  startDemo();
  menuEl.hidden = false;
  $('playBtn').focus({ preventScroll: true });
}
function togglePause(force) {
  if (!G.human || G.phase === 'over') return;
  const v = force === undefined ? !G.paused : force;
  G.paused = v;
  pauseEl.hidden = !v;
  stage.classList.toggle('playing', !v);
  if (v) { releaseInputs(); $('resumeBtn').focus({ preventScroll: true }); }
  else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}
export function showEnd() {
  const w = G.winner, ctf = G.mode === 'ctf', koth = G.mode === 'koth';
  $('endTitle').textContent = w < 0 ? 'Draw' : `${TEAMS[w].name} wins`;
  $('endTitle').className = 'title' + (w < 0 ? '' : ' t' + w);
  $('endLede').textContent = w < 0 ? 'Dead even. Run it back?' : w === 0 ? 'Your team took the match.' : `${TEAMS[1].name} took this one. Run it back?`;
  const [p0, p1] = G.points.map(Math.floor);
  $('endScore').textContent = (ctf ? `Flags ${G.caps[0]} to ${G.caps[1]}` : koth ? `Points ${p0} to ${p1}`
    : `Rounds ${G.roundWins[0]} to ${G.roundWins[1]}`) + ` · Hits ${G.hits[0]} to ${G.hits[1]}`;
  $('capsHead').hidden = !ctf;
  // career stats: record this match, then show any new personal bests and your record for this mode and skill
  const hp = humanPlayer();
  if (hp) {
    const seconds = ctf ? CFG.ctfTimeLimit - G.time : koth ? CFG.kothTimeLimit - G.time : 0;
    const res = recordMatch({ mode: G.mode, diff: G.diff, won: w === 0, hits: hp.stats.hits, painted: hp.stats.painted,
                              caps: hp.stats.caps, hillPoints: koth ? p0 : 0, seconds });
    const box = $('endBests'); box.textContent = '';
    for (const b of res.bests) {
      const fmt = v => b.key === 'fastestCtfWin' ? clockText(v) : String(v);
      const line = document.createElement('p'), tag = document.createElement('b');
      tag.className = 'newbest'; tag.textContent = 'New best!';
      line.append(tag, ` ${b.label}: ${fmt(b.value)}` + (b.was ? ` (was ${fmt(b.was)})` : ''));
      box.append(line);
    }
    if (res.rec) {
      const line = document.createElement('p'); line.className = 'fhint';
      line.textContent = `Your record in ${MODE_NAMES[G.mode]} on ${G.diff[0].toUpperCase() + G.diff.slice(1)}: ` +
        `${res.rec.won} won of ${res.rec.played}` + (res.winStreak > 1 ? ` · ${res.winStreak} wins in a row` : '');
      box.append(line);
    }
    box.hidden = !box.childElementCount;
    renderStats();
  }
  const body = $('statsBody'); body.textContent = '';
  const top = Math.max(...G.players.map(p => p.stats.hits));
  for (const p of G.players) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td'), who = document.createElement('span'), dot = document.createElement('span');
    who.className = 'who'; dot.className = 'dot'; dot.style.background = TEAMS[p.team].color;
    who.append(dot, p.name === 'YOU' ? 'You' : p.name);
    if (top > 0 && p.stats.hits === top) { const m = document.createElement('span'); m.className = 'mvp'; m.textContent = 'MVP'; who.append(m); }
    td0.append(who); tr.append(td0);
    const cells = [p.stats.hits, p.stats.painted].concat(ctf ? [p.stats.caps] : []);
    for (const v of cells) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    body.append(tr);
  }
  endEl.hidden = false;
  stage.classList.remove('playing');
  $('againBtn').focus({ preventScroll: true });
}

// "Your stats" in the menu (stats.js keeps the numbers; this only shows them)
function renderStats() {
  const played = matchesPlayed(), won = matchesWon(), t = career.totals, B = career.best;
  $('statsHint').textContent = played ? `${played} played · ${won} won` : 'No matches yet';
  const cards = [
    ['Matches', played], ['Wins', played ? `${won} (${Math.round(won / played * 100)}%)` : 0],
    ['Hits', t.hits], ['Times painted', t.painted], ['Flags captured', t.caps], ['Hill points', t.hillPoints],
  ];
  const cardsEl = $('statCards'); cardsEl.textContent = '';
  for (const [label, v] of cards) {
    const d = document.createElement('div'), n = document.createElement('b'), l = document.createElement('span');
    n.textContent = String(v); l.textContent = label; d.append(n, l); cardsEl.append(d);
  }
  const bests = [
    ['Most hits in a match', B.hitsInMatch || '–'], ['Best hit streak in one life', B.hitStreak || '–'],
    ['Longest win streak', B.winStreak || '–'], ['Fastest Capture the Flag win', B.fastestCtfWin ? clockText(B.fastestCtfWin) : '–'],
  ];
  const bl = $('bestList'); bl.textContent = '';
  for (const [label, v] of bests) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = String(v); bl.append(dt, dd); }
  const body = $('recordBody'); body.textContent = '';
  for (const m of MODES) {
    const tr = document.createElement('tr'), th = document.createElement('td'); th.textContent = MODE_NAMES[m]; tr.append(th);
    for (const s of SKILLS) { const r = career.record[m][s], td = document.createElement('td'); td.textContent = r.played ? `${r.won} / ${r.played}` : '–'; tr.append(td); }
    body.append(tr);
  }
}
renderStats();
$('resetStats').addEventListener('click', () => {
  if (confirm('Reset all your stats and personal bests? This can’t be undone.')) { resetCareer(); renderStats(); }
});

$('playBtn').addEventListener('click', startHumanMatch);
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('restartBtn').addEventListener('click', startHumanMatch);
$('quitBtn').addEventListener('click', toMenu);
$('againBtn').addEventListener('click', startHumanMatch);
$('menuBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', () => { if (G.human) togglePause(); });
$('soundBtn').addEventListener('click', () => { Sound.init(); toggleMute(); });

// Music mood: calm behind the menu, full beat in your match, tense in the last 30 seconds or when either team is
// one flag or round from winning (within 10 points on the hill).
function musicMood() {
  if (!G.human || G.phase === 'over') return 'menu';
  const near = G.mode === 'ctf' ? Math.max(...G.caps) >= CFG.ctfCapsToWin - 1
    : G.mode === 'koth' ? Math.max(...G.points) >= CFG.kothPointsToWin - 10
    : Math.max(...G.roundWins) >= CFG.ltsRoundsToWin - 1;
  return G.phase === 'play' && (G.time <= 30 || near) ? 'tense' : 'match';
}
// Browsers only allow sound after you click or press a key, so the menu music starts on your first one.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => Sound.init(), { once: true, capture: true });

// scoreboard
const hud = Object.create(null);
const portrait = matchMedia('(orientation: portrait)');
function setText(id, v) { if (hud[id] !== v) { hud[id] = v; $(id).textContent = v; } }
export function updateHUD() {
  const ctf = G.mode === 'ctf', koth = G.mode === 'koth', t = Math.max(0, Math.ceil(G.time));
  setText('modeName', MODE_NAMES[G.mode]);
  setText('clock', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  setText('subLine', `${G.mapName} · ` + (ctf ? `first to ${CFG.ctfCapsToWin} flags` : koth ? `first to ${CFG.kothPointsToWin} points`
    : `round ${G.round}, first to ${CFG.ltsRoundsToWin}`));
  const obj = ctf ? G.caps : koth ? G.points.map(Math.floor) : G.roundWins, lbl = ctf ? 'Flags' : koth ? 'Points' : 'Rounds';
  setText('objO', String(obj[0])); setText('objB', String(obj[1]));
  setText('lblO', lbl); setText('lblB', lbl);
  setText('hitsO', String(G.hits[0])); setText('hitsB', String(G.hits[1]));
  for (const [t2, id] of [[0, 'rosterO'], [1, 'rosterB']]) {
    const ps = G.players.filter(p => p.team === t2);
    const sig = ps.map(p => p.name + p.state + (p.carrying ? 'f' : '')).join('|');
    if (hud[id] !== sig) {
      hud[id] = sig;
      const el = $(id); el.textContent = '';
      for (const p of ps) {
        const i = document.createElement('i');
        i.className = p.state === 'active' ? (p.carrying ? 'flag' : '') : p.state;
        i.title = `${p.isHuman ? 'You' : p.name}: ${p.state === 'active' ? (p.carrying ? 'has the flag' : 'in play') : p.state}`;
        el.append(i);
      }
    }
  }
  const hp = humanPlayer();
  // hopper
  const showHop = !!(hp && G.human && hp.state === 'active' && G.phase !== 'over' && !G.paused);
  hopperEl.hidden = !showHop;
  if (showHop) {
    const m = MK(hp), reloading = hp.reloadT > 0, low = !reloading && hp.ammo <= m.hopper * 0.25;
    const frac = reloading ? 1 - hp.reloadT / m.reload : hp.ammo / m.hopper;
    setText('ammoNum', reloading ? '··' : String(hp.ammo));
    setText('ammoMax', String(m.hopper));
    setText('hopLabel', m.name);
    const w = `${(clamp(frac, 0, 1) * 100).toFixed(1)}%`;
    if (hud.ammoW !== w) { hud.ammoW = w; $('ammoFill').style.width = w; }
    hopperEl.classList.toggle('reloading', reloading);
    hopperEl.classList.toggle('low', low);
    const tp = input.source === 'touch';
    setText('ammoHint', reloading ? 'Reloading…' : low ? (tp ? 'Low paint. Tap Reload' : 'Low paint. Press R') : (tp ? 'Tap Reload to refill' : 'Press R to reload'));
    const sw = `${(hp.stamina * 100).toFixed(1)}%`;
    if (hud.stamW !== sw) { hud.stamW = sw; $('stamFill').style.width = sw; }
    $('stamMeter').classList.toggle('winded', hp.winded);
  }
  Sound.ambience(G.human && !G.paused && G.phase !== 'over' && !settings.muted);
  Sound.music(musicMood(), G.human && G.paused);
  Sound.crowdBed(G.human && !G.paused && G.phase !== 'over' ? (musicMood() === 'tense' ? 1.5 : 1) : 0);
  // phones: buttons, a bigger field during your match, and a pause when the phone is held upright
  const tp = input.source === 'touch', inPlay = G.human && G.phase !== 'over';
  if (hud.inPlay !== inPlay) { hud.inPlay = inPlay; document.documentElement.classList.toggle('inplay', inPlay); }
  const showPad = tp && inPlay && !G.paused;
  $('tpad').hidden = !showPad;
  if (showPad) {
    const active = !!(hp && hp.state === 'active'), out = !!(hp && hp.state === 'out');
    $('tSprint').hidden = $('tReload').hidden = !active;
    $('tFast').hidden = !out;
    $('tSprint').classList.toggle('on', touch.sprint);
    $('tFast').classList.toggle('on', !!G.fast);
    if (portrait.matches) togglePause(true);
  }
  // squad orders
  squadEl.hidden = !(G.human && G.phase !== 'over');
  if (hud.squad !== G.squad.cmd) { hud.squad = G.squad.cmd; squadBtns.forEach(b => b.classList.toggle('on', b.dataset.cmd === G.squad.cmd)); }
  let msg = '', wash = -1;
  if (hp && G.human && G.phase !== 'over' && !G.paused) {
    const key = (k, t) => (tp ? t : k);
    if (hp.state === 'out') msg = G.fast ? `Fast-forward on. ${key('Press F', 'Tap ×3')} for normal speed.` : `You're out. ${key('Press F', 'Tap ×3')} to fast-forward.`;
    else if (hp.state === 'painted') { msg = inRect(hp, BASES[hp.team].wash) ? 'Washing… stay on the pad' : "You're painted. Get to your WASH pad."; wash = hp.washT / CFG.washTime; }
    else if (hp.carrying) msg = 'You have their flag. Run it home!';
    else if (G.mode === 'koth' && onHill(hp)) msg = G.hill.contested ? `Contested! Even numbers on the hill. ${key('Press 3', 'Tap Attack')} to bring your squad.`
      : G.hill.owner === 0 ? 'Your team holds the hill. Keep it!' : `Outnumbered on the hill! ${key('Press 3', 'Tap Attack')} to bring your squad.`;
  }
  statusEl.hidden = !msg;
  if (msg) {
    setText('statusText', msg);
    $('washMeter').hidden = wash < 0;
    if (wash >= 0) $('washFill').style.width = `${Math.min(100, wash * 100).toFixed(1)}%`;
  }
}

export function resize() {
  const r = stage.getBoundingClientRect();
  view.cw = r.width; view.ch = r.height; view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * view.dpr));
  canvas.height = Math.max(1, Math.round(r.height * view.dpr));
  const pad = 6;
  view.s = Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H);
  view.ox = (r.width - W * view.s) / 2; view.oy = (r.height - H * view.s) / 2;
}
