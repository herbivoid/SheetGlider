// Tiny synth for hearing the score: live preview, and rendered to a WAV file
// for export (lined up with the video, lead-in included).

function scheduleNotes(ctx, destination, score, fromSec, startAt) {
  const voices = [];
  const sounds = [];
  for (const n of score.notes) {
    if (n.tieFromPrev) continue; // tied notes sound as one long note
    const len = (score.timeOf(n.start + n.soundingDur) - score.timeOf(n.start)) * 0.95;
    sounds.push({ midi: n.midi, on: score.timeOf(n.start), len });
  }
  for (const g of score.graces) {
    sounds.push({ midi: g.midi, on: score.timeOf(g.start) - 0.07 * (g.groupSize - g.order), len: 0.06 });
  }
  for (const n of sounds) {
    const on = n.on - fromSec;
    if (on < 0) continue;
    const len = Math.max(0.06, n.len);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
    const env = ctx.createGain();
    const t = startAt + on;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    env.gain.setValueAtTime(0.5, t + len);
    env.gain.linearRampToValueAtTime(0, t + len + 0.08);
    osc.connect(env).connect(destination);
    osc.start(t);
    osc.stop(t + len + 0.1);
    voices.push(osc);
  }
  return voices;
}

export class PreviewSynth {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.volume = 0.2;
  }

  // Plays every note that starts at or after `fromSec` (score time).
  play(score, fromSec) {
    this.stop();
    this.ctx ??= new AudioContext();
    this.ctx.resume();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.voices = scheduleNotes(this.ctx, this.master, score, fromSec, this.ctx.currentTime + 0.03);
  }

  stop() {
    for (const osc of this.voices) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.voices = [];
    this.master?.disconnect();
    this.master = null;
  }

  // Renders score time t0..t1 to a 16-bit stereo WAV (ArrayBuffer).
  async renderWav(score, t0, t1, sampleRate = 48000) {
    const length = Math.ceil((t1 - t0) * sampleRate);
    const ctx = new OfflineAudioContext(2, length, sampleRate);
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    // Notes before t0 are skipped; a negative t0 (lead-in) just delays everything.
    scheduleNotes(ctx, master, score, Math.max(0, t0), Math.max(0, -t0));
    const buffer = await ctx.startRendering();
    return encodeWav(buffer);
  }
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const out = new DataView(new ArrayBuffer(bytes));
  const text = (offset, s) => [...s].forEach((ch, i) => out.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, bytes - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // PCM
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * channels * 2, true);
  out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return out.buffer;
}
