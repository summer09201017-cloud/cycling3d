function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.enabled = true;
    this.lastAnnouncementAt = 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = enabled ? 0.18 : 0;
    }
  }

  ensureContext() {
    if (this.context) {
      return this.context;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    this.context = new AudioContextCtor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = this.enabled ? 0.18 : 0;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  unlock() {
    const context = this.ensureContext();
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
  }

  vibrate(pattern) {
    if ("vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }

  tone({
    frequency = 440,
    frequencyEnd = null,
    duration = 0.12,
    type = "sine",
    gain = 0.12,
    when = 0,
  }) {
    const context = this.ensureContext();
    if (!context || !this.enabled) {
      return;
    }

    const startTime = context.currentTime + when;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    if (frequencyEnd !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(40, frequencyEnd),
        startTime + duration,
      );
    }

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(
      clamp(gain, 0.0001, 0.4),
      startTime + 0.02,
    );
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.masterGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  uiTap() {
    this.tone({
      frequency: 520,
      frequencyEnd: 760,
      duration: 0.08,
      type: "triangle",
      gain: 0.06,
    });
  }

  whistle() {
    this.tone({
      frequency: 1280,
      frequencyEnd: 980,
      duration: 0.2,
      type: "square",
      gain: 0.11,
    });
    this.tone({
      frequency: 980,
      frequencyEnd: 1180,
      duration: 0.16,
      type: "square",
      gain: 0.06,
      when: 0.04,
    });
  }

  swish() {
    this.tone({
      frequency: 620,
      frequencyEnd: 340,
      duration: 0.12,
      type: "triangle",
      gain: 0.08,
    });
  }

  scoreSting() {
    this.tone({
      frequency: 480,
      frequencyEnd: 720,
      duration: 0.12,
      type: "triangle",
      gain: 0.08,
    });
    this.tone({
      frequency: 720,
      frequencyEnd: 980,
      duration: 0.14,
      type: "triangle",
      gain: 0.08,
      when: 0.08,
    });
  }

  thud(strength = 0.5) {
    this.tone({
      frequency: 120,
      frequencyEnd: 65,
      duration: 0.08,
      type: "sawtooth",
      gain: clamp(0.04 + strength * 0.06, 0.04, 0.12),
    });
  }

  steal() {
    this.tone({
      frequency: 300,
      frequencyEnd: 520,
      duration: 0.09,
      type: "square",
      gain: 0.07,
    });
    this.tone({
      frequency: 680,
      frequencyEnd: 520,
      duration: 0.08,
      type: "square",
      gain: 0.05,
      when: 0.05,
    });
  }

  rebound() {
    this.tone({
      frequency: 240,
      frequencyEnd: 180,
      duration: 0.08,
      type: "triangle",
      gain: 0.05,
    });
  }

  buzzer() {
    this.tone({
      frequency: 230,
      frequencyEnd: 180,
      duration: 0.26,
      type: "square",
      gain: 0.1,
    });
    this.tone({
      frequency: 180,
      frequencyEnd: 210,
      duration: 0.2,
      type: "square",
      gain: 0.08,
      when: 0.12,
    });
  }

  horn() {
    this.tone({
      frequency: 190,
      frequencyEnd: 150,
      duration: 0.42,
      type: "sawtooth",
      gain: 0.12,
    });
    this.tone({
      frequency: 290,
      frequencyEnd: 240,
      duration: 0.42,
      type: "square",
      gain: 0.08,
      when: 0.02,
    });
  }

  // ── 觀眾:環境人聲+喝采浪(07-11 鐵則,搬自 boxing3d/racket3d 範式) ──
  makeNoiseBuffer() {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    if (this._noiseBuf) return this._noiseBuf;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.random());
    this._noiseBuf = buf;
    return buf;
  }

  startCrowd() {
    const ctx = this.ensureContext();
    if (!ctx || this._crowd) return;
    const buf = this.makeNoiseBuffer();
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    // 07-12 實測(AnalyserNode):boxing3d 原值 0.07×master0.18 只剩 -58dB 根本聽不到;
    // 低通會再吃掉大半能量,基準增益要開到 0.65 才是「聽得見的環境人聲浪」(RMS≈-40dB)
    g.gain.value = 0.65;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    src.start();
    this._crowd = { src, gain: g };
  }

  stopCrowd() {
    if (!this._crowd) return;
    try { this._crowd.src.stop(); } catch { /* ignore */ }
    this._crowd = null;
  }

  crowdCheer(strength = 1) {
    const ctx = this.ensureContext();
    if (!ctx || !this.enabled) return;
    this.startCrowd();
    if (this._crowd) {
      const g = this._crowd.gain.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.65, g.value), now);
      g.linearRampToValueAtTime(0.65 + 2.2 * strength, now + 0.1);
      g.exponentialRampToValueAtTime(0.65, now + 2.6);
    }
    // 零星高頻拍手/口哨疊在浪上
    const buf = this.makeNoiseBuffer();
    for (let i = 0; i < 10; i += 1) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1600;
      const g2 = ctx.createGain();
      const t0 = ctx.currentTime + Math.random() * 0.6;
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.exponentialRampToValueAtTime(0.5 * strength, t0 + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      src.connect(hp);
      hp.connect(g2);
      g2.connect(this.masterGain);
      src.start(t0);
      src.stop(t0 + 0.1);
    }
  }

}
