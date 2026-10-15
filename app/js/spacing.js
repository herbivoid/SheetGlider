// Maps musical time (beats) to distance along the staff (staff spaces).
//
// Each gap between consecutive onsets gets width  quarterWidth * gap^exponent.
// exponent 1 = strictly proportional to time; lower values compress long notes
// and give fast notes more room. The resulting speed is then smoothed over time
// (Gaussian, `smoothBeats` wide) so the character speeds up and slows down
// gradually instead of jumping between speeds at every note.

const RES = 1 / 48; // grid resolution in beats

export function buildSpacing(score, { quarterWidth, exponent, smoothBeats, barGap, accidentalGap }) {
  const onsets = new Set([0, score.endBeat]);
  for (const n of score.notes) onsets.add(n.start);
  for (const r of score.rests) onsets.add(r.start);
  const times = [...onsets].sort((a, b) => a - b);

  const key = b => Math.round(b * 960);
  const barSet = new Set(score.bars.map(key));
  const accidentalSet = new Set(score.notes.filter(n => n.accidental !== null).map(n => key(n.start)));

  // Speed (staff spaces per beat) of each segment between consecutive onsets.
  // Extra room before barlines and accidentals is kept separate: it must stay
  // right where it's needed, so it only gets a light smoothing below.
  const segSpeed = [];
  const segExtra = [];
  for (let s = 0; s < times.length - 1; s++) {
    const gap = times[s + 1] - times[s];
    let extra = 0;
    if (barSet.has(key(times[s + 1]))) extra += barGap;
    if (accidentalSet.has(key(times[s + 1]))) extra += accidentalGap;
    segSpeed.push((quarterWidth * Math.pow(gap, exponent)) / gap);
    segExtra.push(extra / gap);
  }

  // Sample on a fine grid so it can be smoothed.
  const cells = Math.max(1, Math.ceil(score.endBeat / RES));
  const raw = new Float64Array(cells);
  const rawExtra = new Float64Array(cells);
  let seg = 0;
  for (let i = 0; i < cells; i++) {
    const b = (i + 0.5) * RES;
    while (seg < segSpeed.length - 1 && b >= times[seg + 1]) seg++;
    raw[i] = segSpeed[seg];
    rawExtra[i] = segExtra[seg];
  }

  const base = smooth(raw, smoothBeats / RES);
  const extra = smooth(rawExtra, Math.min(smoothBeats, 0.1) / RES);
  const speed = base.map((v, i) => v + extra[i]);
  const xs = new Float64Array(cells + 1);
  for (let i = 0; i < cells; i++) xs[i + 1] = xs[i] + speed[i] * RES;

  const first = speed[0];
  const last = speed[cells - 1];
  return {
    totalWidth: xs[cells],
    x(beat) {
      if (beat <= 0) return beat * first;
      if (beat >= score.endBeat) return xs[cells] + (beat - score.endBeat) * last;
      const i = Math.min(cells - 1, Math.floor(beat / RES));
      return xs[i] + speed[i] * (beat - i * RES);
    },
    speedAt(beat) {
      if (beat <= 0) return first;
      if (beat >= score.endBeat) return last;
      return speed[Math.min(cells - 1, Math.floor(beat / RES))];
    },
  };
}

function smooth(values, sigma) {
  if (sigma < 0.5) return values;
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-0.5 * (k / sigma) ** 2));
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k));
      const w = kernel[k + radius];
      sum += values[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}
