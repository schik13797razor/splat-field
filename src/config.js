/* ---------- 1. CONFIG ---------- */
export const CFG = {
  W: 1600, H: 900,          // field size in game units (scaled to fit your screen)
  playerRadius: 14,
  playerSpeed: 215,         // units per second
  botSpeed: 205,
  carrierSlow: 1.0,         // flag carrier speed (1.0 = full speed; lower makes carriers easier to chase down)
  ballRadius: 3.6,
  sprintMul: 1.5,           // hold Shift: this much faster, but you can't shoot
  staminaDrain: 0.42,       // share of the stamina bar used per second of sprinting
  staminaRegen: 0.3,        // share recovered per second
  staminaDelay: 0.7,        // seconds of rest before stamina starts coming back
  washTime: 3,              // seconds standing on the WASH pad to get clean
  spawnProtect: 1.0,        // seconds you can't be hit after washing
  flagReturnTime: 15,       // a dropped flag goes home on its own after this
  ctfCapsToWin: 3,
  ctfTimeLimit: 360,
  ltsRoundsToWin: 3,
  ltsRoundTime: 150,
  shakeHit: 9,              // screen shake in pixels when you get painted
  fastForward: 3,           // game speed while you're out and press F
};

// Bot skill levels. Lower numbers for reaction, aim error, and fire delay make tougher bots.
//   acquire   extra delay when a bot spots someone after not seeing anyone for a while
//   moveError extra aim error when a bot shoots while running
//   burst     shots in a burst, then a short pause
export const DIFF = {
  easy:   { reaction: 0.65, acquire: 0.55, aimError: 0.15, moveError: 0.10, fireDelay: 0.45, burst: [2, 4], pause: [0.7, 1.2],  lead: 0.0, sight: 520, turn: 6,  speed: 0.9,  hold: [2.4, 4.2] },
  normal: { reaction: 0.40, acquire: 0.40, aimError: 0.10, moveError: 0.08, fireDelay: 0.30, burst: [3, 5], pause: [0.5, 0.9],  lead: 0.5, sight: 640, turn: 9,  speed: 0.95, hold: [1.5, 3.0] },
  hard:   { reaction: 0.26, acquire: 0.30, aimError: 0.065, moveError: 0.06, fireDelay: 0.21, burst: [3, 6], pause: [0.35, 0.7], lead: 0.9, sight: 760, turn: 13, speed: 1.0,  hold: [0.8, 1.9] },
};

// Markers (paintball guns). You choose yours in the menu. Bot defenders carry a Pump, everyone else an Electro.
//   fireDelay/spread/speed/range/hopper/reload apply to everyone; bot* numbers scale how bots use it.
export const MARKERS = {
  electro: { name: 'Electro', hint: 'Rapid fire and a big 45-ball hopper, but shorter range and more spray.',
             fireDelay: 0.11, spread: 0.05, speed: 980, range: 640, hopper: 45, reload: 1.6, botDelay: 1.0, botAim: 1.1, botSight: 1.0 },
  pump:    { name: 'Pump', hint: 'One pinpoint shot at a time, long range, 20-ball pod with a quick swap.',
             fireDelay: 0.5, spread: 0.008, speed: 1200, range: 940, hopper: 20, reload: 1.3, botDelay: 2.1, botAim: 0.45, botSight: 1.2 },
};
export const MK = p => MARKERS[p.marker];

export const TEAMS = [
  { name: 'Orange', color: '#ff6a1f', dark: '#a8400c', light: '#ffc6a3', trail: 'rgba(255,106,31,0.38)' },
  { name: 'Blue',   color: '#2e9bff', dark: '#1458a3', light: '#bfe0ff', trail: 'rgba(46,155,255,0.38)' },
];
export const PAL = {
  turf: '#2d6839', net: '#141c17', chalk: '#f5f8f2',
  bunker: '#3d4853', bunkerHi: '#5d6a77', bunkerLo: '#28303a', bunkerEdge: '#1b2127',
  wash: '#7fd6ff', washPad: '#21495a', marker: '#20262b', markerHi: '#56626d', lens: '#a8e0ff',
};
export const FONT_UI = '"Barlow Semi Condensed", "Arial Narrow", "Segoe UI", sans-serif';
export const FONT_DISPLAY = '"Saira Stencil One", "Arial Black", Impact, sans-serif';

export const NAMES = [['YOU', 'KIT', 'DASH'], ['VEX', 'BOLT', 'MOSS']];
export const DEMO_NAME = 'RUSH';                       // fills your slot in the menu demo
// CTF jobs: the attacker goes for the flag, support travels with the attacker, the defender guards home.
export const ROLES = [['support', 'attacker', 'defender'], ['attacker', 'support', 'defender']];
export const LANES = [[450, 190, 710], [190, 450, 710]]; // preferred y line for each player
export const SPAWN_ORDER = [1, 0, 2];
// CTF attack lanes (top flank, middle, bottom flank) and where each team crosses into the far half.
export const LANE_Y = [130, 450, 770];
export const LANE_X = [1180, 420];
