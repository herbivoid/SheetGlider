// Ties, slurs and tuplet marks, laid out in the same flat staff coordinates as
// engrave.js (s along the staff, v up), using the stems/noteheads it placed.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// A curved band (tie or slur) from (x0, y0) to (x1, y1) bulging `height` toward
// `side` (+1 up, -1 down), thick in the middle and thin at the ends.
function arc(x0, y0, x1, y1, height, side, thick) {
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const mid = y0 + (y1 - y0) * t + side * height * 4 * t * (1 - t);
    const w = 0.04 + thick * Math.sin(Math.PI * t);
    // The inner edge bulges a little less than the outer one, giving the crescent shape.
    pts.push({ s: x, va: mid - side * w * 0.2, vb: mid + side * w * 0.8 });
  }
  return pts;
}

export function layoutSpanners(out, score) {
  const info = out.info;
  const noteX = n => info.get(n.el)?.xs.get(n.id) ?? 0;

  // Ties: from each tied note to the next note of the same pitch.
  const byStart = new Map();
  for (const n of score.notes) {
    const key = `${n.staff}|${n.midi}|${Math.round(n.start * 960)}`;
    byStart.set(key, n);
  }
  for (const n of score.notes) {
    if (!n.tieToNext) continue;
    const el = info.get(n.el);
    if (!el) continue;
    const target = byStart.get(`${n.staff}|${n.midi}|${Math.round((n.start + n.dur) * 960)}`);
    const chord = [...el.e.notes].sort((a, b) => a.pos - b.pos);
    let side = el.whole ? 1 : -el.dir;
    if (chord.length > 1) {
      const i = chord.indexOf(n);
      const mid = (chord.length - 1) / 2;
      side = i > mid ? 1 : i < mid ? -1 : -el.dir;
    }
    const v = el.c + n.pos / 2 + side * 0.55;
    const x0 = noteX(n) + 0.45;
    const x1 = target ? noteX(target) - 0.45 : x0 + 1.6;
    const len = Math.max(0.6, x1 - x0);
    out.bands.push(arc(x0, v, x0 + len, v, clamp(0.2 + 0.05 * len, 0.3, 0.9), side, 0.17));
  }

  // Slurs: from the first to the last element, over (or under) everything between.
  for (const sl of score.slurs) {
    const a = info.get(sl.from);
    const b = info.get(sl.to);
    if (!a || !b) continue;
    const side = a.dir > 0 && b.dir > 0 && !a.whole ? -1 : 1;
    const anchor = (el, pad) => {
      if (!el.whole && el.dir === side) return [el.stemX, el.tip + side * 0.4];
      const vs = el.e.notes.map(n => el.c + n.pos / 2);
      return [el.s, (side > 0 ? Math.max(...vs) : Math.min(...vs)) + side * pad];
    };
    const [x0, y0] = anchor(a, 0.7);
    const [x1, y1] = anchor(b, 0.7);
    if (x1 - x0 < 0.5) continue;
    const line = x => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    const len = x1 - x0;
    let height = clamp(0.35 + 0.07 * len, 0.5, 2.2);
    for (const el of info.values()) {
      if (el.e.staff !== a.e.staff || el.e.start <= a.e.start || el.e.start >= b.e.start) continue;
      const [x, y] = anchor(el, 0.6);
      const t = (x - x0) / len;
      if (t <= 0.02 || t >= 0.98) continue;
      height = Math.max(height, ((y - line(x)) * side) / (4 * t * (1 - t)));
    }
    out.bands.push(arc(x0, y0, x1, y1, Math.min(height, 4.5), side, 0.19));
  }

  // Tuplets: the number, plus a bracket unless the notes are beamed together.
  const groups = new Map();
  for (const el of info.values()) {
    if (el.e.tuplet === null || el.e.tuplet === undefined) continue;
    if (!groups.has(el.e.tuplet)) groups.set(el.e.tuplet, []);
    groups.get(el.e.tuplet).push(el);
  }
  for (const t of score.tuplets) {
    const els = (groups.get(t.id) ?? []).sort((p, q) => p.e.start - q.e.start);
    if (!els.length) continue;
    const side = t.placement === "above" ? 1 : t.placement === "below" ? -1 : els[0].dir || 1;
    const reach = els.flatMap(el => {
      const vs = el.e.notes.map(n => el.c + n.pos / 2);
      if (!el.whole && el.dir === side) vs.push(el.tip);
      return vs;
    });
    const y = (side > 0 ? Math.max(...reach) : Math.min(...reach)) + side * 1.1;
    const x0 = els[0].minX;
    const x1 = els[els.length - 1].maxX;
    const mid = (x0 + x1) / 2;
    out.glyphs.push({ kind: `tuplet:${t.actual}`, s: mid, v: y, scale: 1, tint: null });
    const beamedTogether = els.every(el => el.beamed && el.dir === side);
    if (t.bracket && !beamedTogether) {
      const r = 0.045;
      const gap = 0.75;
      out.tubes.push({ s0: x0, v0: y, s1: mid - gap, v1: y, r });
      out.tubes.push({ s0: mid + gap, v0: y, s1: x1, v1: y, r });
      out.tubes.push({ s0: x0, v0: y, s1: x0, v1: y - side * 0.5, r });
      out.tubes.push({ s0: x1, v0: y, s1: x1, v1: y - side * 0.5, r });
    }
  }
}
