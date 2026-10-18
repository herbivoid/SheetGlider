import { fretWidth } from "./glyphs.js";
import { flagCount, staffHalf } from "./score.js";
import { arc } from "./spanners.js";

// Guitar tablature, in the same flat staff coordinates as engrave.js: fret
// numbers on their strings, rhythm stems and beams hanging below the staff,
// and the guitar marks (hammer-ons, pull-offs, slides, bends).

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const STEM_ATTACH = 0.168;

// The fret number as shown: × for a dead note, in parentheses when tied over (or marked so in the file).
export function fretText(n) {
  const fret = n.head === "x" ? "×" : `${n.tab.fret}`;
  return n.tab.paren || n.tieFromPrev ? `(${fret})` : fret;
}
const halfWidth = n => (n.tab.hidden ? 0.1 : fretWidth(fretText(n)) / 2);

// One chord (or single note) on a tab staff. Returns the same info as a
// standard-notation element in engrave.js, with stems pointing down from
// below the staff (or none when the rhythm isn't shown).
export function tabElement(out, e, { s, c, def, rhythm, beamed }) {
  const xs = new Map();
  let minX = s - 0.4;
  let maxX = s + 0.4;
  for (const n of e.notes) {
    xs.set(n.id, s);
    const v = c + n.pos / 2;
    out.visuals.push({ key: `n${n.id}`, note: n, s, v, beat: n.start, offset: 0, glow: !n.tieFromPrev && !n.tab.hidden, scale: 1 });
    if (n.tab.hidden) continue; // a bend's target note: shown by the bend arrow instead
    const w = halfWidth(n);
    out.glyphs.push({ kind: `fret:${fretText(n)}`, s, v, scale: 1, tint: `n${n.id}` });
    out.lineGaps.push({ staff: e.staff, v, s0: s - w - 0.12, s1: s + w + 0.12 });
    minX = Math.min(minX, s - w);
    maxX = Math.max(maxX, s + w);
  }
  const stemTop = c - staffHalf(def) - 0.7;
  const lead = e.notes.find(n => !n.tab.hidden) ?? e.notes[0];
  const info = {
    e, dir: -1, c, s, minX, maxX, xs, accLeft: minX, stemX: s, tab: true, half: staffHalf(def),
    // engrave.js draws stems from inner (+ attach) to the tip, 3.5 below outer: 2.5 below stemTop.
    inner: stemTop + STEM_ATTACH, outer: stemTop + 1,
    flags: flagCount(e.type), whole: e.type === "whole" || !rhythm, beamed: beamed && rhythm, tint: `n${lead.id}`,
    noRhythm: !rhythm,
  };
  if (rhythm && e.type === "half") info.tip = stemTop - 1.3; // half notes: a short stem
  if (rhythm) {
    for (let d = 0; d < e.dots; d++) out.glyphs.push({ kind: "dot", s: s + 0.4 + d * 0.5, v: stemTop - 0.9, scale: 1, tint: info.tint });
  }
  return info;
}

// Hammer-ons, pull-offs, slides and bends.
export function layoutTab(out, score, { sOf, staffCenter }) {
  const notes = score.notes.filter(n => n.tab);
  if (!notes.length) return;
  const byString = new Map(notes.map(n => [`${n.el}|${n.tab.string}`, n]));
  const where = n => {
    const inf = out.info.get(n.el);
    return { x: inf.xs.get(n.id), v: inf.c + n.pos / 2, hw: halfWidth(n) };
  };

  for (const t of score.techniques) {
    const a = byString.get(`${t.from}|${t.fromString}`);
    const b = byString.get(`${t.to}|${t.toString}`);
    if (!a || !b || !out.info.has(a.el) || !out.info.has(b.el)) continue;
    const A = where(a);
    const B = where(b);
    if (t.kind === "slide") {
      // A straight line between the numbers, rising for a slide up.
      const x0 = A.x + A.hw + 0.15;
      const x1 = B.x - B.hw - 0.15;
      if (x1 - x0 < 0.3) continue;
      const d = a.tab.string === b.tab.string ? 0.32 * Math.sign(b.tab.fret - a.tab.fret) : 0;
      out.tubes.push({ s0: x0, v0: A.v - d, s1: x1, v1: B.v + d, r: 0.055, tint: `n${a.id}` });
    } else {
      // Hammer-on / pull-off: a small arc over the two numbers, with H or P on top.
      const len = B.x - A.x;
      if (len < 0.4) continue;
      const v = Math.max(A.v, B.v) + 0.75;
      const height = clamp(0.2 + 0.06 * len, 0.3, 0.7);
      out.bands.push(arc(A.x + 0.1, v, B.x - 0.1, v, height, 1, 0.1));
      out.glyphs.push({ kind: `text:label:${t.kind}`, s: (A.x + B.x) / 2, v: v + height + 0.2, scale: 0.75, tint: `n${a.id}` });
    }
  }

  // Bends: an arrow curving up from the number to above the staff, labeled with
  // how far it bends; a held bend continues level, and a release curves back down.
  const peaks = new Map(); // staff|string -> x where the last bend arrow peaked
  const sorted = [...notes].sort((p, q) => p.start - q.start);
  const nextOnStaff = n => sorted.find(m => m.staff === n.staff && m.start > n.start + 1e-6 && !m.tab.hidden);
  for (const n of sorted) {
    if (!out.info.has(n.el)) continue;
    const key = `${n.staff}|${n.tab.string}`;
    const peakV = staffCenter(n.staff) + staffHalf(score.staves[n.staff]) + 1.2;
    const N = where(n);
    const bend = n.tab.bend ?? 0;
    if (bend > 0) {
      const next = nextOnStaff(n);
      const x0 = N.x + N.hw + 0.1;
      const x1 = clamp(next ? sOf(next.start) - 0.6 : x0 + 1.4, x0 + 0.5, x0 + 1.4);
      curve(out, x0, N.v + 0.2, x1, peakV - 0.4, `n${n.id}`);
      arrowhead(out, x1, peakV, 1);
      out.glyphs.push({ kind: `text:label:${bendLabel(bend)}`, s: x1, v: peakV + 0.25, scale: 0.7, tint: `n${n.id}` });
      peaks.set(key, x1);
      continue;
    }
    if (!n.tab.hidden && bend >= 0) { peaks.delete(key); continue; }
    // A hidden note after a bend (held there), or a release.
    const from = peaks.get(key);
    if (from !== undefined && N.x - from > 0.3) {
      out.tubes.push({ s0: from, v0: peakV, s1: N.x, v1: peakV, r: 0.05, tint: `n${n.id}` });
    }
    if (bend < 0) {
      const next = nextOnStaff(n);
      const end = next ? where(next) : { x: N.x + 1.6, v: N.v, hw: 0 };
      const x1 = Math.max(N.x + 0.5, end.x - end.hw - 0.2);
      const y1 = end.v + 0.55;
      curve(out, N.x, peakV, x1, y1 + 0.4, `n${n.id}`);
      arrowhead(out, x1, y1, -1);
      peaks.delete(key);
    } else {
      peaks.set(key, N.x);
    }
  }
}

const bendLabel = semitones => ({ 0.5: "¼", 1: "½", 2: "full", 3: "1½", 4: "2" }[Math.abs(semitones)] ?? `${Math.abs(semitones) / 2}`);

// A quarter-ellipse polyline from (x0, y0), leaving level, to (x1, y1), arriving vertical.
export function curve(out, x0, y0, x1, y1, tint) {
  const n = 8;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    const x = x0 + (x1 - x0) * Math.sin(a);
    const y = y0 + (y1 - y0) * (1 - Math.cos(a));
    out.tubes.push({ s0: px, v0: py, s1: x, v1: y, r: 0.05, tint });
    px = x;
    py = y;
  }
}

// A filled triangle with its tip at (x, y), pointing up (dir 1) or down (-1).
function arrowhead(out, x, y, dir) {
  const base = y - dir * 0.55;
  out.bands.push([
    { s: x - 0.26, va: base, vb: base },
    { s: x, va: base, vb: y },
    { s: x + 0.26, va: base, vb: base },
  ]);
}
