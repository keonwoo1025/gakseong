// 배경음과 효과음: 파일 없이 소리를 직접 합성한다 (8비트 게임기 느낌).
// 곡 악보는 data/music.json. 브라우저 정책상 첫 터치 이후에 소리가 난다.

const KEY = 'gakseong_audio';
const NOTE = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
function freq(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE[m[1]] + (Number(m[2]) - 4) * 12) / 12);
}

export class Sound {
  constructor() {
    this.ctx = null; this.tracks = {}; this.want = null; this.cur = null; this.nodes = [];
    let st = 'on'; try { st = localStorage.getItem(KEY) || 'on'; } catch (e) {}
    this.enabled = st !== 'off';
    setInterval(() => this.tick(), 200);
  }

  setTracks(t) { this.tracks = t; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 0.7; this.sfxBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.want && this.cur !== this.want) { const w = this.want; this.cur = null; this.play(w); }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? 'on' : 'off'); } catch (e) {}
    if (!this.enabled) this.stopMusic();
    else { const w = this.want; this.cur = null; this.play(w); }
    return this.enabled;
  }

  play(name) {
    this.want = name;
    if (!this.ctx || !this.enabled || !name || this.cur === name) return;
    this.stopMusic();
    const tr = this.tracks[name]; if (!tr) return;
    this.cur = name;
    this.trackGain = this.ctx.createGain(); this.trackGain.gain.value = 0; this.trackGain.connect(this.master);
    this.trackGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.8);
    this.loopStart = this.ctx.currentTime + 0.1;
    this.loopDur = tr.beats * 60 / tr.bpm;
    this.scheduleLoop(tr, this.loopStart);
  }

  stopMusic() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.trackGain) { const g = this.trackGain; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.4); setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 600); }
    for (const n of this.nodes) { try { n.stop(t + 0.45); } catch (e) {} }
    this.nodes = []; this.trackGain = null; this.cur = null;
  }

  tick() {
    if (!this.ctx || !this.cur || !this.trackGain) return;
    const tr = this.tracks[this.cur];
    if (this.ctx.currentTime > this.loopStart + this.loopDur - 1.5) {
      this.loopStart += this.loopDur;
      this.nodes = this.nodes.filter((n) => n._end > this.ctx.currentTime);
      this.scheduleLoop(tr, this.loopStart);
    }
  }

  scheduleLoop(tr, t0) {
    const spb = 60 / tr.bpm;
    for (const p of tr.parts) {
      let t = t0;
      for (const tok of p.notes.trim().split(/\s+/)) {
        const [n, d] = tok.split(':'); const dur = Number(d) * spb;
        if (n !== '-') this.tone(freq(n), t, dur * 0.92, p.wave, p.vol);
        t += dur;
      }
    }
    if (tr.drums) {
      const step = tr.drums.step * spb, pat = tr.drums.pattern;
      const steps = Math.round(tr.beats / tr.drums.step);
      for (let i = 0; i < steps; i++) {
        const c = pat[i % pat.length];
        if (c !== '-') this.drum(c, t0 + i * step, tr.drums.vol || 1);
      }
    }
  }

  tone(f, t, dur, wave, vol) {
    if (!f) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = wave; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + Math.min(0.12, dur * 0.5));
    g.gain.setValueAtTime(vol * 0.7, t + Math.max(0.02, dur - 0.04));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.trackGain || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02); o._end = t + dur + 0.02;
    if (this.trackGain) this.nodes.push(o);
  }

  noiseHit(t, dur, hp, vol, bus) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t); s.stop(t + dur + 0.02); s._end = t + dur + 0.02;
    return s;
  }

  drum(kind, t, vol) {
    const c = this.ctx, bus = this.trackGain;
    if (!bus) return;
    if (kind === 'k') {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.14);
      g.gain.setValueAtTime(0.35 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.18); o._end = t + 0.18; this.nodes.push(o);
    } else if (kind === 's') this.nodes.push(this.noiseHit(t, 0.12, 1500, 0.18 * vol, bus));
    else if (kind === 'h') this.nodes.push(this.noiseHit(t, 0.04, 7000, 0.07 * vol, bus));
  }

  sfx(name) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, bus = this.sfxBus, c = this.ctx;
    if (name === 'slash') this.noiseHit(t, 0.09, 3000, 0.12, bus);
    else if (name === 'hit') {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.12);
      this.noiseHit(t, 0.06, 800, 0.1, bus);
    } else if (name === 'heavy') {
      this.noiseHit(t, 0.35, 200, 0.25, bus);
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.36);
    } else if (name === 'levelup') {
      ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => this.blip(freq(n), t + i * 0.08, 0.12, 'square', 0.05));
    } else if (name === 'hurt') {
      this.blip(220, t, 0.12, 'sawtooth', 0.06); this.blip(150, t + 0.06, 0.12, 'sawtooth', 0.05);
    } else if (name === 'death') {
      ['E4', 'C4', 'A3', 'E3'].forEach((n, i) => this.blip(freq(n), t + i * 0.25, 0.3, 'triangle', 0.08));
    } else if (name === 'select') this.blip(freq('A5'), t, 0.05, 'square', 0.03);
  }

  blip(f, t, dur, wave, vol) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = wave; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
}
