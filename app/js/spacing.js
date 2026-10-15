// Maps musical time (beats) to distance along the staff (staff spaces).
//
// Each gap between consecutive onsets gets width  quarterWidth * gap^exponent.
// exponent 1 = strictly proportional to time; lower values compress long notes
// and give fast notes more room. The resulting speed is then smoothed over time
// (Gaussian, `smoothBeats` wide) so the character speeds up and slows down
// gradually instead of jumping between speeds at every note.
//
// `extras` (from engrave.measureExtras) is extra room needed just before some
// beats: barlines, clef/key/time changes, accidentals, grace notes. It's added
// to the gap leading up to that beat and only lightly smoothed, so it stays
// where it's needed.

const RES = 1 / 48; // grid resolution in beats

export function buildSpacing(score, { quarterWidth, exponent, smoothBeats, extras }) {
  const onsets = new Set([0, score.endBeat]);
  for (const n of score.notes) onsets.add(n.start);
  for (const r of score.rests) onsets.add(r.start);
  for (const b of score.bars) onsets.add(b);
  const times = [...onsets].filter(b => b <= score.endBeat + 1e-9).sort((a, b) => a - b);
  const key = b => Math.round(b * 960);

  // Speed (staff spaces per beat) of each segment between consecutive onsets.
  const segSpeed = [];
  const segExtra = [];
  for (let s = 0; s < times.length - 1; s++) {
    const gap = Math.max(1e-6, times[s + 1] - times[s]);
    segSpeed.push((quarterWidth * Math.pow(gap, exponent)) / gap);
    segExtra.push((extras.get(key(times[s + 1])) ?? 0) / gap);
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
  const extra = smoothBackward(rawExtra, Math.min(smoothBeats, 0.15) / RES);
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
  };
}

// Like smooth(), but only spreads each value toward earlier cells, so room
// reserved before a beat stays entirely before it.
function smoothBackward(values, sigma) {
  if (sigma < 0.5) return values;
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  for (let k = 0; k <= radius; k++) kernel.push(Math.exp(-0.5 * (k / sigma) ** 2));
  const wsum = kernel.reduce((a, b) => a + b, 0);
  const n = values.length;
  const out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    if (!values[j]) continue;
    for (let k = 0; k <= radius; k++) out[Math.max(0, j - k)] += (values[j] * kernel[k]) / wsum;
  }
  return out;
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
