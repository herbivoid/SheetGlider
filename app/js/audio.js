// Tiny preview synth so you can hear what Clawd is hitting. Not part of the export.

export class PreviewSynth {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.volume = 0.2;
  }

  // Schedules every note that starts at or after `fromSec`, relative to now.
  play(score, fromSec) {
    this.stop();
    this.ctx ??= new AudioContext();
    this.ctx.resume();
    const now = this.ctx.currentTime + 0.03;
    const master = this.ctx.createGain();
    master.gain.value = this.volume;
    master.connect(this.ctx.destination);
    this.master = master;
    const spb = score.secondsPerBeat;
    for (const n of score.notes) {
      const on = n.start * spb - fromSec;
      if (on < 0) continue;
      const len = Math.max(0.08, n.dur * spb * 0.95);
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
      const env = this.ctx.createGain();
      const t = now + on;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
      env.gain.setValueAtTime(0.5, t + len);
      env.gain.linearRampToValueAtTime(0, t + len + 0.08);
      osc.connect(env).connect(master);
      osc.start(t);
      osc.stop(t + len + 0.1);
      this.voices.push(osc);
    }
  }

  stop() {
    for (const osc of this.voices) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.voices = [];
    this.master?.disconnect();
    this.master = null;
  }
}
