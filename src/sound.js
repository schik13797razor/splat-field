import { G } from './state.js';

/* ---------- 9. SOUND ---------- */
export const Sound = (() => {
  let ac = null, master = null, noise = null, muted = false, budget = 0, budgetT = 0;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC(); master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 0.6);
      noise = ac.createBuffer(1, len, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function ok(v) {
    if (!ac || muted || !G.human || !(v > 0)) return false;
    const t = ac.currentTime;
    if (t - budgetT > 0.08) { budgetT = t; budget = 0; }
    if (budget >= 7) return false;
    budget++; return true;
  }
  function nz(t, { type = 'bandpass', f = 1500, f2 = null, q = 1, dur = 0.06, vol = 0.2 }) {
    const s = ac.createBufferSource(); s.buffer = noise;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    fl.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
  }
  function tn(t, { f = 440, f2 = null, dur = 0.12, vol = 0.12, type = 'sine' }) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  const now = () => ac.currentTime;
  // Field ambience: soft wind (filtered brown noise) that swells slowly. Plays only during your matches.
  let amb = null;
  function ambience(on) {
    if (!ac) return;
    if (on && !amb) {
      const len = ac.sampleRate * 3, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 420;
      const lfo = ac.createOscillator(), depth = ac.createGain(); lfo.frequency.value = 0.12; depth.gain.value = 180;
      lfo.connect(depth); depth.connect(fl.frequency);
      const g = ac.createGain(); g.gain.setValueAtTime(0, ac.currentTime); g.gain.linearRampToValueAtTime(0.09, ac.currentTime + 1.5);
      src.connect(fl); fl.connect(g); g.connect(master); src.start(); lfo.start();
      amb = { src, lfo, g };
    } else if (!on && amb) {
      const a = amb, t = ac.currentTime; amb = null;
      a.g.gain.cancelScheduledValues(t); a.g.gain.setValueAtTime(a.g.gain.value, t); a.g.gain.linearRampToValueAtTime(0, t + 0.6);
      a.src.stop(t + 0.7); a.lfo.stop(t + 0.7);
    }
  }
  return {
    init, ambience,
    get muted() { return muted; },
    setMuted(v) { muted = v; },
    shot(v = 1, kind = 'electro') {
      if (!ok(v)) return;
      const t = now();
      if (kind === 'pump') { // deeper crack, then the "chk-chk" of the pump racking the next ball
        nz(t, { f: 1500, q: 0.8, dur: 0.07, vol: 0.13 * v }); tn(t, { f: 150, f2: 65, dur: 0.09, vol: 0.09 * v, type: 'triangle' });
        nz(t + 0.17, { f: 950, q: 6, dur: 0.035, vol: 0.07 * v }); nz(t + 0.27, { f: 780, q: 6, dur: 0.035, vol: 0.06 * v });
      } else { nz(t, { f: 2400, q: 0.9, dur: 0.045, vol: 0.09 * v }); tn(t, { f: 210, f2: 90, dur: 0.05, vol: 0.06 * v, type: 'triangle' }); }
    },
    whistle(long) { // referee whistle: two close pitches with a fast flutter
      if (!ok(1)) return;
      const t = now(), dur = long ? 0.7 : 0.35;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.setValueAtTime(0.05, t + dur - 0.06); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      const trem = ac.createGain(); trem.gain.value = 0.6; const lfo = ac.createOscillator(), lg = ac.createGain();
      lfo.frequency.value = 32; lg.gain.value = 0.4; lfo.connect(lg); lg.connect(trem.gain);
      for (const f of [2850, 3010]) { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(trem); o.start(t); o.stop(t + dur + 0.02); }
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2900; bp.Q.value = 3;
      trem.connect(bp); bp.connect(g); g.connect(master); lfo.start(t); lfo.stop(t + dur + 0.02);
    },
    splat(v = 1) { if (!ok(v)) return; nz(now(), { type: 'lowpass', f: 900, f2: 300, q: 0.7, dur: 0.09, vol: 0.11 * v }); },
    hit(v = 1) { if (!ok(v)) return; const t = now(); nz(t, { f: 1600, f2: 280, q: 3, dur: 0.17, vol: 0.22 * v }); tn(t, { f: 340, f2: 110, dur: 0.16, vol: 0.07 * v, type: 'square' }); },
    wash(loud) { if (!ok(loud ? 1 : 0.3)) return; const t = now(), v = loud ? 1 : 0.3; nz(t, { type: 'highpass', f: 3000, q: 0.5, dur: 0.25, vol: 0.06 * v }); tn(t + 0.02, { f: 660, dur: 0.14, vol: 0.1 * v }); tn(t + 0.12, { f: 990, dur: 0.2, vol: 0.1 * v }); },
    grab() { if (!ok(1)) return; const t = now(); tn(t, { f: 440, f2: 660, dur: 0.16, vol: 0.1, type: 'triangle' }); },
    cheer() { if (!ok(1)) return; const t = now(); [523, 659, 784, 1046].forEach((f, i) => tn(t + i * 0.09, { f, dur: 0.22, vol: 0.09, type: 'triangle' })); },
    beep(hi) { if (!ok(1)) return; tn(now(), { f: hi ? 880 : 520, dur: hi ? 0.28 : 0.12, vol: 0.1, type: 'square' }); },
    reload() { if (!ok(1)) return; const t = now(); nz(t, { f: 1300, q: 5, dur: 0.05, vol: 0.13 }); nz(t + 0.16, { f: 950, q: 5, dur: 0.05, vol: 0.11 }); },
    reloaded() { if (!ok(1)) return; const t = now(); nz(t, { f: 2300, q: 6, dur: 0.04, vol: 0.15 }); tn(t, { f: 520, dur: 0.06, vol: 0.05, type: 'square' }); },
    order() { if (!ok(1)) return; const t = now(); tn(t, { f: 700, dur: 0.07, vol: 0.07, type: 'triangle' }); tn(t + 0.07, { f: 940, dur: 0.09, vol: 0.07, type: 'triangle' }); },
  };
})();
