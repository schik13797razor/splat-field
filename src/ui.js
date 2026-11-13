import { CFG, MARKERS, MK, TEAMS, TEAM_COLORS, setTeamColors } from './config.js';
import { W, H, clamp, inRect } from './util.js';
import { MAPS, BASES } from './field.js';
import { freePoint, applyLayout, randomLayout } from './pathfinding.js';
import { G, humanPlayer, newMatch, custom } from './state.js';
import { speedFor, canShoot, shoot, startReload, onHill } from './rules.js';
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
export const touch = { stickId: null, bx: 0, by: 0, mx: 0, my: 0, aimId: null, ax: W / 2, ay: H / 2 };
export const input = { source: 'mouse' };

export function updateHuman(p, dt) {
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  mx += touch.mx; my += touch.my;
  const L = Math.hypot(mx, my);
  if (L > 1) { mx /= L; my /= L; }
  p.sprinting = !!((keys.ShiftLeft || keys.ShiftRight) && L > 0.1 && !p.winded && p.stamina > 0);
  const sp = speedFor(p);
  p.vx = mx * sp; p.vy = my * sp;
  aimHuman(p);
  const wantsFire = mouse.down || keys.Space || touch.aimId !== null;
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
  const tx = input.source === 'touch' ? touch.ax : mouse.wx, ty = input.source === 'touch' ? touch.ay : mouse.wy;
  p.aim = Math.atan2(ty - p.y, tx - p.x);
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
      input.source = 'touch';
      if (sx < w * 0.45 && touch.stickId === null) { touch.stickId = e.pointerId; touch.bx = sx; touch.by = sy; touch.mx = touch.my = 0; }
      else if (touch.aimId === null) { touch.aimId = e.pointerId; const p = toWorld(sx, sy); touch.ax = p.x; touch.ay = p.y; }
    } else {
      input.source = 'mouse';
      if (e.button === 0) { mouse.down = true; e.preventDefault(); }
    }
  });
  window.addEventListener('pointermove', e => {
    const { sx, sy, w, h } = localPos(e);
    if (e.pointerType === 'touch') {
      if (e.pointerId === touch.stickId) {
        let dx = (sx - touch.bx) / 52, dy = (sy - touch.by) / 52; const L = Math.hypot(dx, dy);
        if (L > 1) { dx /= L; dy /= L; }
        touch.mx = dx; touch.my = dy;
      } else if (e.pointerId === touch.aimId) { const p = toWorld(sx, sy); touch.ax = p.x; touch.ay = p.y; }
      return;
    }
    input.source = 'mouse';
    mouse.sx = sx; mouse.sy = sy; mouse.inside = sx >= 0 && sy >= 0 && sx <= w && sy <= h;
    const p = toWorld(sx, sy); mouse.wx = p.x; mouse.wy = p.y;
  });
  function endPointer(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === touch.stickId) { touch.stickId = null; touch.mx = touch.my = 0; }
      if (e.pointerId === touch.aimId) touch.aimId = null;
    } else if (e.button === 0 || e.type === 'pointercancel') mouse.down = false;
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') mouse.inside = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
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
function releaseInputs() { for (const k in keys) keys[k] = false; mouse.down = false; touch.stickId = touch.aimId = null; touch.mx = touch.my = 0; }
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
                          playerName: '', mate1: '', mate2: '', jersey: 'stripe', mask: 'black' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('splatfield.settings') || '{}')); } catch (e) {}
if (!MARKERS[settings.marker]) settings.marker = 'electro';
if (!MAPS[settings.map] && settings.map !== 'random') settings.map = 'snake';
if (!TEAM_COLORS[settings.team0] || !TEAM_COLORS[settings.team1] || settings.team0 === settings.team1) Object.assign(settings, { team0: 'orange', team1: 'blue' });
if (!['stripe', 'solid', 'split', 'hoops'].includes(settings.jersey)) settings.jersey = 'stripe';
if (!['black', 'white', 'gray', 'camo'].includes(settings.mask)) settings.mask = 'black';
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
  releaseInputs();
  menuEl.hidden = pauseEl.hidden = endEl.hidden = true;
  if (!settings.seenHelp) { settings.seenHelp = true; saveSettings(); }
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

$('playBtn').addEventListener('click', startHumanMatch);
$('resumeBtn').addEventListener('click', () => togglePause(false));
$('restartBtn').addEventListener('click', startHumanMatch);
$('quitBtn').addEventListener('click', toMenu);
$('againBtn').addEventListener('click', startHumanMatch);
$('menuBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', () => { if (G.human) togglePause(); });
$('soundBtn').addEventListener('click', () => { Sound.init(); toggleMute(); });

// scoreboard
const hud = Object.create(null);
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
    setText('ammoHint', reloading ? 'Reloading…' : low ? 'Low paint. Press R' : 'Press R to reload');
    const sw = `${(hp.stamina * 100).toFixed(1)}%`;
    if (hud.stamW !== sw) { hud.stamW = sw; $('stamFill').style.width = sw; }
    $('stamMeter').classList.toggle('winded', hp.winded);
  }
  Sound.ambience(G.human && !G.paused && G.phase !== 'over' && !settings.muted);
  // squad orders
  squadEl.hidden = !(G.human && G.phase !== 'over');
  if (hud.squad !== G.squad.cmd) { hud.squad = G.squad.cmd; squadBtns.forEach(b => b.classList.toggle('on', b.dataset.cmd === G.squad.cmd)); }
  let msg = '', wash = -1;
  if (hp && G.human && G.phase !== 'over' && !G.paused) {
    if (hp.state === 'out') msg = G.fast ? 'Fast-forward on. Press F for normal speed.' : "You're out. Press F to fast-forward.";
    else if (hp.state === 'painted') { msg = inRect(hp, BASES[hp.team].wash) ? 'Washing… stay on the pad' : "You're painted. Get to your WASH pad."; wash = hp.washT / CFG.washTime; }
    else if (hp.carrying) msg = 'You have their flag. Run it home!';
    else if (G.mode === 'koth' && onHill(hp)) msg = G.hill.contested ? 'Contested! Clear them off the hill.' : 'On the hill. Hold it!';
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
