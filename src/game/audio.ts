export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private guitarIn: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private music = false;
  private paused = false;
  private nextNote = 0;
  private step = 0;
  private musicVol = 0.65;
  private basePitch = 1;
  private maxPitch = 1.18;
  private currentPitch = 1;
  private stopAt = 0;

  unlock() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime);
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(this.musicVol, this.ctx.currentTime);
      this.musicGain.connect(this.master);
      this.guitarIn = this.ctx.createGain();
      this.guitarIn.gain.value = 0.85;
      const shaper = this.ctx.createWaveShaper();
      shaper.curve = this.distCurve();
      shaper.oversample = "2x";
      const grit = this.ctx.createBiquadFilter();
      grit.type = "lowpass";
      grit.frequency.value = 2200;
      grit.Q.value = 0.7;
      this.guitarIn.connect(shaper);
      shaper.connect(grit);
      grit.connect(this.musicGain);
      this.ensureNoise();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
  }

  startMusic() {
    this.unlock();
    this.music = true;
    this.paused = false;
    this.currentPitch = this.basePitch;
    this.stopAt = 0;
    if (this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicVol, now);
      this.nextNote = now + 0.05;
      this.step = 0;
    }
  }

  stopMusic() {
    this.music = false;
  }

  pauseMusic() {
    this.paused = true;
  }

  resumeMusic() {
    this.paused = false;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.02;
  }

  setVolume(newVolume: number) {
    this.musicVol = Math.min(1, Math.max(0, newVolume));
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(this.musicVol, this.ctx.currentTime, 0.03);
  }

  updatePitchBySpeed(currentSpeed: number, maxSpeed: number, dt: number) {
    if (!this.music || this.paused) return;
    const speedRatio = Math.min(1, Math.max(0, currentSpeed / Math.max(0.01, maxSpeed)));
    const target = this.basePitch + (this.maxPitch - this.basePitch) * speedRatio;
    const k = 1 - Math.exp(-0.6 * dt);
    this.currentPitch += (target - this.currentPitch) * k;
  }

  fadeOut(duration = 1.5) {
    this.fadeAudio(0, duration, true);
  }

  fadeIn(duration = 1) {
    this.music = true;
    this.paused = false;
    this.fadeAudio(this.musicVol, duration, false);
  }

  private fadeAudio(target: number, duration: number, stop: boolean) {
    if (!this.ctx || !this.musicGain) {
      if (stop) this.music = false;
      return;
    }
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + duration);
    this.stopAt = stop ? now + duration : 0;
    if (!stop) this.music = true;
  }

  resumeCtx() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  tick() {
    if (!this.ctx || !this.master || !this.musicGain || this.muted || !this.music || this.paused) return;
    const t = this.ctx.currentTime;
    if (this.stopAt > 0 && t >= this.stopAt) {
      this.music = false;
      this.stopAt = 0;
      return;
    }
    if (this.nextNote < t) this.nextNote = t;
    const eighth = 0.174 / this.currentPitch;
    let guard = 0;
    while (this.nextNote < t + 0.2 && guard < 6) {
      const i = this.step % 16;
      this.drums(i, this.nextNote);
      this.chug(i, this.nextNote);
      this.step += 1;
      this.nextNote += eighth;
      guard += 1;
    }
  }

  fail() {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(160, 0.1, "sine", 0.16, 48);
    this.tone(980, 0.46, "sine", 0.055, 220);
    this.wah(t + 0.1, 349, 0.2);
    this.wah(t + 0.32, 294, 0.2);
    this.wah(t + 0.54, 196, 0.42);
  }

  private distCurve() {
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    return curve;
  }

  private ensureNoise() {
    if (!this.ctx || this.noise) return;
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  private drums(i: number, when: number) {
    const slot = i % 8;
    if (slot === 0 || slot === 3 || slot === 4 || slot === 7) this.kick(when);
    if (slot === 2 || slot === 6) this.snare(when);
    this.hat(when, slot % 2 === 1 ? 0.045 : 0.02);
  }

  private chug(i: number, when: number) {
    const roots = [146.83, 174.61, 196, 130.81];
    const root = roots[Math.floor(i / 4) % roots.length] * this.currentPitch;
    const accent = i % 4 === 0;
    this.powerChord(root, when, accent ? 0.12 : 0.07, accent ? 0.05 : 0.032);
    if (accent) this.bass(root / 2, when, 0.28, 0.07);
  }

  private powerChord(root: number, when: number, dur: number, vel: number) {
    this.guitarNote(root, when, dur, vel);
    this.guitarNote(root * 1.4983, when, dur, vel * 0.85);
    this.guitarNote(root * 2, when, dur, vel * 0.55);
  }

  private guitarNote(freq: number, when: number, dur: number, vel: number) {
    if (!this.ctx || !this.guitarIn || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vel, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(this.guitarIn);
    o.start(when);
    o.stop(when + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private bass(freq: number, when: number, dur: number, vel: number) {
    if (!this.ctx || !this.musicGain || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(vel, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(when);
    o.stop(when + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private kick(when: number) {
    if (!this.ctx || !this.musicGain || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150 * this.currentPitch, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.1);
    g.gain.setValueAtTime(0.22, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(when);
    o.stop(when + 0.16);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private snare(when: number) {
    this.noiseHit(when, 0.12, 0.09, 800);
    if (!this.ctx || !this.musicGain || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(190 * this.currentPitch, when);
    g.gain.setValueAtTime(0.06, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(when);
    o.stop(when + 0.1);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private hat(when: number, vel: number) {
    this.noiseHit(when, 0.04, vel, 6000);
  }

  private noiseHit(when: number, dur: number, vel: number, hp: number) {
    if (!this.ctx || !this.musicGain || !this.noise || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vel, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.musicGain);
    src.start(when);
    src.stop(when + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  private wah(when: number, freq: number, dur: number) {
    if (!this.ctx || !this.master || this.muted) return;
    const o = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, when);
    lfo.frequency.value = 6.5;
    lfoGain.gain.value = 14;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.07, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(when);
    lfo.start(when);
    o.stop(when + dur + 0.02);
    lfo.stop(when + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      g.disconnect();
    };
  }

  jump() {
    this.tone(420, 0.12, "square", 0.05, 780);
  }
  slide() {
    this.tone(200, 0.16, "sawtooth", 0.035, 70);
  }
  coin() {
    this.tone(880, 0.07, "square", 0.04);
    this.tone(1320, 0.09, "square", 0.03);
  }
  rich() {
    this.tone(523, 0.08, "square", 0.045);
    this.tone(784, 0.1, "square", 0.04);
    this.tone(1046, 0.14, "square", 0.035);
  }
  power() {
    this.tone(494, 0.1, "square", 0.05, 988);
  }
  smack() {
    this.tone(160, 0.18, "sawtooth", 0.07, 50);
  }
  hit() {
    this.tone(110, 0.32, "sawtooth", 0.1, 36);
    this.tone(70, 0.28, "triangle", 0.08);
  }
  near() {
    this.tone(680, 0.06, "triangle", 0.035, 980);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide?: number) {
    if (!this.ctx) return;
    this.toneAt(freq, this.ctx.currentTime, dur, type, gain, slide, this.master);
  }

  private toneAt(
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slide?: number,
    dest?: AudioNode | null,
  ) {
    if (!this.ctx || !this.master || !dest || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(40, freq), when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), when + dur);
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    g.connect(dest);
    o.start(when);
    o.stop(when + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
}
