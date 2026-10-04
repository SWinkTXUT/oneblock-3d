// WebAudio-synthesised SFX (SPEC §12). No assets. Call sound.resume() from a user gesture.
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.noise = null;
    this.last = {};
    this.defs = this._defs();
  }

  init() {
    if (this.ctx) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  // ---- primitives ----
  tone({ f = 440, f2 = null, dur = 0.15, type = 'sine', vol = 0.3, delay = 0, attack = 0.005, vib = 0, vibRate = 7, lp = 0 }) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (lp) { const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = lp; o.connect(flt); node = flt; }
    node.connect(g); g.connect(this.master);
    if (vib) {
      const l = c.createOscillator(); l.frequency.value = vibRate;
      const lg = c.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency);
      l.start(t0); l.stop(t0 + dur + 0.05);
    }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  hiss({ dur = 0.1, vol = 0.3, type = 'bandpass', f = 1000, f2 = null, q = 1, delay = 0, attack = 0.003 }) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const flt = c.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t0);
    if (f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(flt); flt.connect(g); g.connect(this.master);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
  }

  /** play(name, { pitch, vol, minGap }) */
  play(name, o = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const def = this.defs[name];
    if (!def) return;
    const now = performance.now();
    const gap = o.minGap ?? 25;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    def.call(this, (o.pitch || 1) * (0.92 + Math.random() * 0.16), o.vol ?? 1);
  }

  _defs() {
    const mat = (f, f2, q, dur, vol, extra) => function (p, v) {
      this.hiss({ f: f * p, f2: f2 * p, q, dur, vol: vol * v });
      if (extra) extra.call(this, p, v);
    };
    const defs = {
      dig_stone: mat(1400, 600, 1.2, 0.09, 0.35, function (p, v) { this.tone({ f: 160 * p, f2: 90, dur: 0.07, type: 'triangle', vol: 0.25 * v }); }),
      dig_wood: mat(700, 350, 2, 0.09, 0.3, function (p, v) { this.tone({ f: 220 * p, f2: 140, dur: 0.08, type: 'square', vol: 0.12 * v, lp: 900 }); }),
      dig_dirt: mat(450, 220, 0.8, 0.1, 0.4),
      dig_sand: mat(3000, 1800, 0.7, 0.11, 0.2),
      dig_glass: function (p, v) { this.tone({ f: 2600 * p, dur: 0.12, vol: 0.15 * v }); this.tone({ f: 3900 * p, dur: 0.08, vol: 0.08 * v }); this.hiss({ f: 6000, type: 'highpass', dur: 0.05, vol: 0.12 * v }); },
      dig_wool: mat(320, 180, 0.6, 0.1, 0.3),
      place: function (p, v) { this.tone({ f: 130 * p, f2: 70, dur: 0.08, type: 'triangle', vol: 0.4 * v }); this.hiss({ f: 900, f2: 400, dur: 0.05, vol: 0.2 * v }); },
      land: function (p, v) { this.tone({ f: 90 * p, f2: 45, dur: 0.12, type: 'triangle', vol: 0.4 * v }); this.hiss({ f: 500, f2: 200, dur: 0.1, vol: 0.25 * v, type: 'lowpass' }); },
      hurt: function (p, v) { this.tone({ f: 260 * p, f2: 110, dur: 0.28, type: 'sawtooth', vol: 0.3 * v, vib: 30, lp: 1400 }); this.hiss({ f: 800, dur: 0.1, vol: 0.2 * v }); },
      eat: function (p, v) { for (let i = 0; i < 4; i++) this.hiss({ f: 1800 * p, f2: 700, q: 3, dur: 0.06, vol: 0.35 * v, delay: i * 0.11 }); },
      pop: function (p, v) { this.tone({ f: 420 * p, f2: 1000 * p, dur: 0.09, vol: 0.2 * v }); },
      craft: function (p, v) { this.tone({ f: 880 * p, dur: 0.08, type: 'triangle', vol: 0.22 * v }); this.tone({ f: 1320 * p, dur: 0.14, type: 'triangle', vol: 0.2 * v, delay: 0.07 }); },
      furnace: function (p, v) { for (let i = 0; i < 4; i++) this.hiss({ f: 2500 + Math.random() * 3000, type: 'highpass', dur: 0.025, vol: 0.18 * v, delay: Math.random() * 0.35 }); },
      baa: function (p, v) { this.tone({ f: 330 * p, f2: 260 * p, dur: 0.55, type: 'sawtooth', vol: 0.2 * v, vib: 22, vibRate: 11, lp: 1100, attack: 0.05 }); this.tone({ f: 660 * p, f2: 520 * p, dur: 0.5, type: 'sawtooth', vol: 0.06 * v, vib: 30, vibRate: 11, lp: 1500, attack: 0.05 }); },
      sheep_hurt: function (p, v) { this.tone({ f: 420 * p, f2: 300 * p, dur: 0.25, type: 'sawtooth', vol: 0.22 * v, vib: 25, vibRate: 14, lp: 1300 }); },
      zombie_groan: function (p, v) { this.tone({ f: 95 * p, f2: 62 * p, dur: 0.9, type: 'sawtooth', vol: 0.3 * v, vib: 6, vibRate: 5, lp: 420, attack: 0.12 }); this.tone({ f: 140 * p, f2: 90 * p, dur: 0.8, type: 'square', vol: 0.05 * v, lp: 500, attack: 0.15 }); },
      zombie_hurt: function (p, v) { this.tone({ f: 150 * p, f2: 70 * p, dur: 0.3, type: 'sawtooth', vol: 0.3 * v, vib: 18, lp: 600 }); },
      zombie_death: function (p, v) { this.tone({ f: 120 * p, f2: 35 * p, dur: 0.9, type: 'sawtooth', vol: 0.3 * v, vib: 10, vibRate: 6, lp: 500 }); },
      phase: function (p, v) { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone({ f: f * p, dur: 0.6, type: 'triangle', vol: 0.18 * v, delay: i * 0.11, attack: 0.01 })); },
      achievement: function (p, v) { [784, 988, 1175, 1568].forEach((f, i) => this.tone({ f: f * p, dur: 0.35, type: 'triangle', vol: 0.16 * v, delay: i * 0.08 })); },
      tool_break: function (p, v) { this.hiss({ f: 2000, f2: 500, dur: 0.25, vol: 0.4 * v }); this.tone({ f: 400 * p, f2: 100, dur: 0.25, type: 'square', vol: 0.15 * v, lp: 1200 }); },
      splash: function (p, v) { this.hiss({ f: 1200 * p, f2: 300, dur: 0.4, vol: 0.4 * v, type: 'lowpass', q: 0.5 }); this.hiss({ f: 4000, f2: 1500, dur: 0.2, vol: 0.12 * v, type: 'highpass' }); },
      click: function (p, v) { this.tone({ f: 900 * p, dur: 0.03, type: 'square', vol: 0.07 * v }); },
      sleep: function (p, v) { [392, 330, 262].forEach((f, i) => this.tone({ f, dur: 0.7, type: 'sine', vol: 0.14 * v, delay: i * 0.25 })); },
      whoosh: function (p, v) { this.hiss({ f: 500, f2: 2500, dur: 0.12, vol: 0.1 * v, q: 0.5 }); },
      burn: function (p, v) { this.hiss({ f: 3000, type: 'highpass', dur: 0.08, vol: 0.12 * v }); },
    };
    // step + break variants per family
    for (const m of ['stone', 'wood', 'dirt', 'sand', 'glass', 'wool']) {
      const d = defs['dig_' + m];
      defs['step_' + m] = function (p, v) { d.call(this, p * 0.9, v * 0.35); };
      defs['break_' + m] = function (p, v) { d.call(this, p * 0.8, v * 1.3); if (m !== 'glass') d.call(this, p * 0.6, v * 0.8); };
    }
    return defs;
  }
}
