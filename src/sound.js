import { G } from './state.js';

/* ---------- 9. SOUND ---------- */
export const Sound = (() => {
  // Three volume channels: effects and music each feed the master, which feeds the speakers.
  // Slider values are 0-100; squaring them makes the slider feel even (50 sounds about half as loud).
  let ac = null, out = null, sfx = null, music = null, noise = null, muted = false, budget = 0, budgetT = 0;
  const vol = { master: 80, sfx: 100, music: 70 };
  const curve = v => (Math.max(0, Math.min(100, v)) / 100) ** 2;
  function applyVolumes() {
    if (!ac) return;
    const t = ac.currentTime, set = (node, v) => { node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(v, t, 0.03); };
    set(out, muted ? 0 : 0.55 * curve(vol.master) / curve(80));   // 80 on the master slider = the old fixed level
    set(sfx, curve(vol.sfx));
    set(music, curve(vol.music));
  }
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ac = new AC();
      out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
      sfx = ac.createGain(); sfx.connect(out);
      music = ac.createGain(); music.connect(out);
      applyVolumes();
      const len = Math.floor(ac.sampleRate * 0.6);
      noise = ac.createBuffer(1, len, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  // Effects go through ok(): nothing while muted, only in your own matches, and at most 7 sounds per 0.08 s.
  let previewing = false;
  function ok(v) {
    if (!ac || muted || !(G.human || previewing) || !(v > 0)) return false;
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
    s.connect(fl); fl.connect(g); g.connect(sfx);
    s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
  }
  function tn(t, { f = 440, f2 = null, dur = 0.12, vol = 0.12, type = 'sine' }) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + 0.03);
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
      src.connect(fl); fl.connect(g); g.connect(sfx); src.start(); lfo.start();
      amb = { src, lfo, g };
    } else if (!on && amb) {
      const a = amb, t = ac.currentTime; amb = null;
      a.g.gain.cancelScheduledValues(t); a.g.gain.setValueAtTime(a.g.gain.value, t); a.g.gain.linearRampToValueAtTime(0, t + 0.6);
      a.src.stop(t + 0.7); a.lfo.stop(t + 0.7);
    }
  }

  /* ----- Music: a made-in-code beat in A minor (Am, F, C, G), 16 steps per bar, 4 bars per loop. -----
     Moods: 'menu' (calm), 'match' (full beat), 'tense' (busier, a little faster), 'off'. A mood change waits for the
     next bar so it lands on the beat. Every note is scheduled a little ahead with the audio clock, which keeps the
     rhythm steady even when a frame is slow. The music never touches Math.random (that belongs to the game). */
  let mus = null;
  const mrand = (() => { let a = 7331; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const hz = m => 440 * 2 ** ((m - 69) / 12);
  const CHORDS = [{ root: 45, tones: [0, 3, 7] }, { root: 41, tones: [0, 4, 7] }, { root: 48, tones: [0, 4, 7] }, { root: 43, tones: [0, 4, 7] }];
  const BPM = { menu: 116, match: 124, tense: 132 };
  const env = (t, peak, attack, dur) => {     // a gain that rises to peak and fades out by t + dur
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(mus.bus); return g;
  };
  const voice = (t, type, f, dur, g, f2) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  };
  const noiseHit = (t, type, f, q, dur, peak) => {
    const s = ac.createBufferSource(); s.buffer = noise;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    s.connect(fl); fl.connect(env(t, peak, 0.002, dur)); s.start(t, mrand() * 0.4); s.stop(t + dur + 0.05);
  };
  const DRUM = {
    kick: (t, v) => voice(t, 'sine', 150, 0.16, env(t, 0.9 * v, 0.003, 0.2), 42),
    snare: (t, v) => { noiseHit(t, 'bandpass', 1900, 0.7, 0.13, 0.42 * v); voice(t, 'triangle', 200, 0.07, env(t, 0.25 * v, 0.002, 0.08), 150); },
    hat: (t, v, open) => noiseHit(t, 'highpass', 7500, 0.8, open ? 0.12 : 0.035, 0.16 * v),
  };
  function bass(t, m, dur, v) {
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 6;
    fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(180, t + dur);
    fl.connect(env(t, 0.32 * v, 0.006, dur));
    voice(t, 'sawtooth', hz(m), dur, fl);
  }
  function pad(t, chord, dur, v) {
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1100;
    fl.connect(env(t, 0.07 * v, 0.35, dur));
    for (const n of chord.tones) for (const det of [-6, 6]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(chord.root + 12 + n); o.detune.value = det;
      o.connect(fl); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  const pluck = (t, m, v) => voice(t, 'square', hz(m), 0.14, env(t, 0.05 * v, 0.004, 0.15));

  // One 16th-note step of the loop.
  function playStep(step, t, mood) {
    const s = step % 16, bar = (step >> 4) % 4, chord = CHORDS[bar], hum = () => 0.85 + mrand() * 0.3;
    const full = mood !== 'menu', tense = mood === 'tense';
    if (s === 0) pad(t, chord, 60 / mus.bpm * 4, full ? 0.8 : 1.2);
    // drums
    if (full ? s % 4 === 0 || (tense && s === 14) : s === 0 || s === 8) DRUM.kick(t, full ? 1 : 0.7);
    if (full && (s === 4 || s === 12)) DRUM.snare(t, 1);
    if (full && bar === 3 && s >= 13) DRUM.snare(t, 0.35 + (s - 13) * 0.2);       // a little fill into the loop
    if (tense ? true : full ? s % 2 === 0 : s % 4 === 2) DRUM.hat(t, (s % 4 === 2 ? 1 : 0.55) * hum() * (full ? 1 : 0.7), s === 14 && full);
    // bass: root on the beat, octave jumps in between
    if (full && [0, 3, 6, 8, 11, 14].includes(s)) bass(t, chord.root - 12 + (s === 6 || s === 14 ? 12 : 0), 0.2, hum());
    if (!full && s === 0) bass(t, chord.root - 12, 1.6, 0.6);
    // arpeggio over the chord: every other step in a match, every step when it's tense
    if (full && (tense || s % 2 === 0)) {
      const seq = [0, 1, 2, 1, 2, 0, 1, 2], k = (tense ? s : s >> 1) % 8, oct = (tense && s >= 8) ? 36 : 24;
      pluck(t, chord.root + oct + chord.tones[seq[k]], hum());
    }
  }
  function musicTick() {
    if (!mus) return;
    const t0 = ac.currentTime;
    if (document.hidden || muted || vol.music <= 0) { mus.next = t0 + 0.05; return; } // silent: don't pile up notes
    if (mus.next < t0) mus.next = t0 + 0.02;                                            // fell behind: skip ahead
    while (mus.next < t0 + 0.12) {
      if (mus.step % 16 === 0) { mus.mood = mus.want; mus.bpm = BPM[mus.mood]; }       // moods change on a new bar
      playStep(mus.step, mus.next, mus.mood);
      mus.next += 60 / mus.bpm / 4;
      mus.step = (mus.step + 1) % 64;
    }
  }
  // Called every frame by the HUD: which mood to play, and whether the game is paused (muffled and quieter).
  function setMusic(mood, duck) {
    if (!ac) return;
    if (mood === 'off') {
      if (!mus) return;
      const m = mus, t = ac.currentTime; mus = null; clearInterval(m.timer);
      m.gain.gain.cancelScheduledValues(t); m.gain.gain.setTargetAtTime(0, t, 0.15);
      setTimeout(() => m.gain.disconnect(), 1200);
      return;
    }
    if (!mus) {
      const gain = ac.createGain(), lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 12000; gain.gain.value = 0;
      lp.connect(gain); gain.connect(music);
      mus = { bus: lp, gain, lp, step: 0, next: ac.currentTime + 0.08, mood, want: mood, bpm: BPM[mood], duck: null, timer: setInterval(musicTick, 25) };
    }
    mus.want = mood;
    if (mus.duck !== duck) {
      mus.duck = duck; const t = ac.currentTime;
      mus.gain.gain.cancelScheduledValues(t); mus.gain.gain.setTargetAtTime(duck ? 0.18 : 0.42, t, 0.12);
      mus.lp.frequency.cancelScheduledValues(t); mus.lp.frequency.setTargetAtTime(duck ? 700 : 12000, t, 0.12);
    }
  }

  /* ----- Crowd: a home crowd that cheers for your team. Only in your own matches, through the Effects slider. -----
     A crowd voice is noise shaped by three filters at the pitches that make a vowel ("ah", "oh", "oo"); a few of them
     slightly out of tune with each other sound like many people. Uses the music's random numbers, not the game's. */
  const VOWEL = { ah: [760, 1180, 2500], oh: [470, 820, 2600], oo: [340, 880, 2300] };
  const crowdOk = () => ac && !muted && G.human;
  let cnoise = null;                              // 4 s of the crowd's own noise, so its loop can't be heard repeating
  const crowdNoise = () => {
    if (cnoise) return cnoise;
    const len = ac.sampleRate * 4; cnoise = ac.createBuffer(1, len, ac.sampleRate);
    const d = cnoise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = mrand() * 2 - 1;
    return cnoise;
  };
  function crowdVoice(t, vowel, dur, peak, attack, slide) {
    const s = ac.createBufferSource(); s.buffer = crowdNoise(); s.loop = true;
    const g = ac.createGain(), det = 0.88 + mrand() * 0.24;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    VOWEL[vowel].forEach((f, i) => {
      const bp = ac.createBiquadFilter(), fg = ac.createGain();
      bp.type = 'bandpass'; bp.Q.value = 4 + i * 2;
      bp.frequency.setValueAtTime(f * det, t); bp.frequency.exponentialRampToValueAtTime(f * det * slide, t + dur);
      fg.gain.value = [1, 0.6, 0.3][i];
      s.connect(bp); bp.connect(fg); fg.connect(g);
    });
    g.connect(sfx); s.start(t, mrand() * 3.5); s.stop(t + dur + 0.05);
  }
  function whoo(t, peak) {                       // a fan's "whooo!": a whistled glide up and back down
    const o = ac.createOscillator(), vib = ac.createOscillator(), vg = ac.createGain(), f = 650 + mrand() * 450;
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.55, t + 0.3); o.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.8);
    vib.frequency.value = 6 + mrand() * 3; vg.gain.value = f * 0.02; vib.connect(vg); vg.connect(o.frequency);
    o.connect(env2(t, peak, 0.08, 0.85)); o.start(t); vib.start(t); o.stop(t + 0.9); vib.stop(t + 0.9);
  }
  function applause(t, dur, perSec, peak) {      // lots of tiny claps, thinning out toward the end
    const n = Math.round(dur * perSec);
    for (let i = 0; i < n; i++) {
      const at = t + dur * mrand() ** 1.6, fade = 1 - (at - t) / dur;
      const s = ac.createBufferSource(); s.buffer = noise;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100 + mrand() * 1800; bp.Q.value = 1.4;
      s.connect(bp); bp.connect(env2(at, peak * (0.5 + mrand() * 0.5) * fade + 0.0002, 0.002, 0.035));
      s.start(at, mrand() * 0.5); s.stop(at + 0.05);
    }
  }
  function env2(t, peak, attack, dur) {          // like the music's env(), but into the effects channel
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur); g.connect(sfx); return g;
  }
  let crowdLast = -9;
  // kind: 'cheer' | 'groan' | 'ooh' | 'applause'; size 0-1; delay in seconds. Small reactions (< 0.6) skip if the
  // crowd just reacted, so a busy firefight doesn't turn into one long roar.
  function crowd(kind, size = 0.5, delay = 0) {
    if (!crowdOk()) return;
    const t = ac.currentTime + 0.05 + delay;
    if (size < 0.6 && t - crowdLast < 1.6) return;
    crowdLast = t;
    const voices = 3 + Math.round(size * 5), v = 0.05 + 0.09 * size;
    if (kind === 'cheer') {
      for (let i = 0; i < voices; i++) crowdVoice(t + mrand() * 0.15, 'ah', 1 + size * 1.6, v, 0.12 + mrand() * 0.1, 1.06);
      for (let i = 0; i < Math.round(size * 4); i++) whoo(t + 0.15 + mrand() * 0.9, 0.012 + 0.012 * mrand());
      if (size >= 0.5) applause(t + 0.2, 1.2 + size * 2.2, 60 * size, 0.09);
    } else if (kind === 'groan') {
      for (let i = 0; i < voices; i++) crowdVoice(t + mrand() * 0.12, 'oh', 1.1 + size * 0.9, v * 0.85, 0.25, 0.78);
    } else if (kind === 'ooh') {
      for (let i = 0; i < voices; i++) crowdVoice(t + mrand() * 0.1, 'oo', 0.8 + size * 0.8, v * 0.8, 0.18, 1.3);
    } else if (kind === 'applause') applause(t, 1.5 + size * 2, 45 * size + 10, 0.08);
  }
  // Background murmur while you play; level 0 = off, 1 = normal, higher = buzzing (tense moments).
  let bed = null;
  function crowdBed(level) {
    if (!ac) return;
    const want = crowdOk() ? level : 0, t = ac.currentTime;
    if (want > 0 && !bed) {
      const g = ac.createGain(), sway = ac.createGain(); g.gain.value = 0; sway.gain.value = 1;
      g.connect(sway); sway.connect(sfx);
      const srcs = ['ah', 'oh'].map((vw, k) => {
        const s = ac.createBufferSource(); s.buffer = crowdNoise(); s.loop = true; s.playbackRate.value = 0.93 + k * 0.11;
        VOWEL[vw].forEach((f, i) => {
          const bp = ac.createBiquadFilter(), fg = ac.createGain();
          bp.type = 'bandpass'; bp.Q.value = 2.5; bp.frequency.value = f * 0.95; fg.gain.value = [1, 0.5, 0.2][i];
          s.connect(bp); bp.connect(fg); fg.connect(g);
        });
        s.start(ac.currentTime, k * 1.9); return s;
      });
      const lfo = ac.createOscillator(), depth = ac.createGain();   // the murmur rises and falls
      lfo.frequency.value = 0.17; depth.gain.value = 0.35;
      lfo.connect(depth); depth.connect(sway.gain); lfo.start();
      bed = { g, srcs, lfo, level: 0 };
    }
    if (!bed || bed.level === want) return;
    bed.level = want;
    bed.g.gain.cancelScheduledValues(t); bed.g.gain.setTargetAtTime(0.035 * want, t, want ? 0.6 : 0.25);
    if (!want) {
      const b = bed; bed = null;
      for (const s of b.srcs) s.stop(t + 1.5); b.lfo.stop(t + 1.5);
    }
  }

  return {
    init, ambience, music: setMusic, crowd, crowdBed,
    get muted() { return muted; },
    setMuted(v) { muted = !!v; applyVolumes(); },
    setVolumes(v) { for (const k of Object.keys(vol)) if (Number.isFinite(v[k])) vol[k] = v[k]; applyVolumes(); },
    // A sample shot so you can hear the effects level from the menu (sounds normally play only in your matches).
    preview() { init(); previewing = true; try { this.shot(1, 'electro'); } finally { previewing = false; } },
    shot(v = 1, kind = 'electro') {
      if (!ok(v)) return;
      const t = now();
      if (kind === 'pump') { // deeper crack, then the "chk-chk" of the pump racking the next ball
        nz(t, { f: 1500, q: 0.8, dur: 0.07, vol: 0.13 * v }); tn(t, { f: 150, f2: 65, dur: 0.09, vol: 0.09 * v, type: 'triangle' });
        nz(t + 0.17, { f: 950, q: 6, dur: 0.035, vol: 0.07 * v }); nz(t + 0.27, { f: 780, q: 6, dur: 0.035, vol: 0.06 * v });
      } else if (kind === 'scatter') { // a fat, chunky thump: three balls leaving at once
        nz(t, { f: 1100, q: 0.6, dur: 0.09, vol: 0.15 * v }); tn(t, { f: 130, f2: 50, dur: 0.11, vol: 0.1 * v, type: 'triangle' });
        nz(t + 0.012, { f: 1900, q: 1.2, dur: 0.04, vol: 0.06 * v });
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
      trem.connect(bp); bp.connect(g); g.connect(sfx); lfo.start(t); lfo.stop(t + dur + 0.02);
    },
    splat(v = 1) { if (!ok(v)) return; nz(now(), { type: 'lowpass', f: 900, f2: 300, q: 0.7, dur: 0.09, vol: 0.11 * v }); },
    hit(v = 1) { if (!ok(v)) return; const t = now(); nz(t, { f: 1600, f2: 280, q: 3, dur: 0.17, vol: 0.22 * v }); tn(t, { f: 340, f2: 110, dur: 0.16, vol: 0.07 * v, type: 'square' }); },
    wash(loud) { if (!ok(loud ? 1 : 0.3)) return; const t = now(), v = loud ? 1 : 0.3; nz(t, { type: 'highpass', f: 3000, q: 0.5, dur: 0.25, vol: 0.06 * v }); tn(t + 0.02, { f: 660, dur: 0.14, vol: 0.1 * v }); tn(t + 0.12, { f: 990, dur: 0.2, vol: 0.1 * v }); },
    grab() { if (!ok(1)) return; const t = now(); tn(t, { f: 440, f2: 660, dur: 0.16, vol: 0.1, type: 'triangle' }); },
    cheer() { if (!ok(1)) return; const t = now(); [523, 659, 784, 1046].forEach((f, i) => tn(t + i * 0.09, { f, dur: 0.22, vol: 0.09, type: 'triangle' })); },
    beep(hi) { if (!ok(1)) return; tn(now(), { f: hi ? 880 : 520, dur: hi ? 0.28 : 0.12, vol: 0.1, type: 'square' }); },
    reload() { if (!ok(1)) return; const t = now(); nz(t, { f: 1300, q: 5, dur: 0.05, vol: 0.13 }); nz(t + 0.16, { f: 950, q: 5, dur: 0.05, vol: 0.11 }); },
    reloaded() { if (!ok(1)) return; const t = now(); nz(t, { f: 2300, q: 6, dur: 0.04, vol: 0.15 }); tn(t, { f: 520, dur: 0.06, vol: 0.05, type: 'square' }); },
    medal() { if (!ok(1)) return; const t = now(); [784, 988, 1175, 1568].forEach((f, i) => tn(t + i * 0.07, { f, dur: 0.3, vol: 0.07, type: 'triangle' })); },
    order() { if (!ok(1)) return; const t = now(); tn(t, { f: 700, dur: 0.07, vol: 0.07, type: 'triangle' }); tn(t + 0.07, { f: 940, dur: 0.09, vol: 0.07, type: 'triangle' }); },
  };
})();
