import { METRICS, lyricWidth } from "./glyphs.js";

// Dynamics, hairpins, articulations, fermatas, lyrics and duration tails, laid
// out in the same flat staff coordinates as engrave.js (s along the staff,
// v up), using the notes and stems it already placed (out.info).

export function layoutExpression(out, score, { sOf, staffCenter, params }) {
  // Vertical room around each staff: where its notes reach, and whether it has lyrics.
  const staves = score.staves.map((_, i) => ({ c: staffCenter(i), lo: Infinity, hi: -Infinity, lyrics: false }));
  for (const inf of out.info.values()) {
    const st = staves[inf.e.staff];
    for (const n of inf.e.notes) {
      st.lo = Math.min(st.lo, inf.c + n.pos / 2);
      st.hi = Math.max(st.hi, inf.c + n.pos / 2);
    }
    if (inf.e.lyrics?.length) st.lyrics = true;
  }
  staves.forEach((st, i) => {
    st.lyricV = Math.min(st.c - 5.5, st.lo - 2.6);
    // Dynamics go under the staff (between the staves on piano), or above it when lyrics are under it.
    st.dynV = st.lyrics ? Math.max(st.c + 4.5, st.hi + 2.2) : Math.min(st.c - 4.5, st.lo - 2.0);
    if (staves.length > 1 && i === 0 && !st.lyrics) st.dynV = Math.max(st.dynV, st.c - 6);
  });
  out.tails = [];

  if (params.showArticulations) articulations(out);
  if (params.showDynamics) dynamics(out, score, staves, sOf);
  if (params.showLyrics) lyrics(out, staves, params.lyricsSize);
  if (params.tails) tails(out, score, sOf, params.tailMin);
}

function articulations(out) {
  for (const inf of out.info.values()) {
    const e = inf.e;
    if (!e.artic?.length && !e.fermata) continue;
    const vs = e.notes.map(n => inf.c + n.pos / 2);
    // On the notehead side, away from the stem; inside the staff they sit in a space, not on a line.
    const side = inf.whole ? 1 : -inf.dir;
    let v = side > 0 ? Math.max(...vs) + 1.0 : Math.min(...vs) - 1.0;
    for (const a of e.artic) {
      if (Math.abs(v - inf.c) < 2.4) v = inf.c + Math.round(v - inf.c - 0.5) + 0.5;
      out.glyphs.push({ kind: `artic:${a}:${side > 0 ? "above" : "below"}`, s: inf.s, v, scale: 1, tint: inf.tint });
      v += side * 0.9;
    }
    if (e.fermata) {
      const stemUp = !inf.whole && inf.dir > 0 ? inf.tip : -Infinity;
      const v = Math.max(...vs, stemUp, inf.c + 2) + 1.3;
      out.glyphs.push({ kind: "artic:fermata:above", s: inf.s, v, scale: 1, tint: inf.tint });
    }
  }
}

function dynamics(out, score, staves, sOf) {
  const markNear = (staff, beat, within) =>
    score.dynamics.some(d => d.staff === staff && Math.abs(d.beat - beat) <= within);
  for (const d of score.dynamics) {
    const st = staves[d.staff] ?? staves[0];
    out.glyphs.push({ kind: `dyn:${d.value}`, s: sOf(d.beat), v: st.dynV, scale: 1, tint: null });
  }
  // Hairpins: two lines opening (crescendo) or closing (diminuendo), clear of any marks at their ends.
  for (const w of score.wedges) {
    const st = staves[w.staff] ?? staves[0];
    const s0 = sOf(w.start) + (markNear(w.staff, w.start, 1e-6) ? 1.8 : -0.3);
    const s1 = sOf(w.end) - (markNear(w.staff, w.end, 0.5) ? 1.8 : 0.6);
    if (s1 - s0 < 1) continue;
    const open = 0.55;
    const [a, b] = w.type === "crescendo" ? [0, open] : [open, 0];
    out.tubes.push({ s0, v0: st.dynV + a, s1, v1: st.dynV + b, r: 0.05 });
    out.tubes.push({ s0, v0: st.dynV - a, s1, v1: st.dynV - b, r: 0.05 });
  }
}

// Syllables under their notes (glowing with them), with hyphens inside words.
function lyrics(out, staves, size) {
  const sung = [...out.info.values()].filter(inf => inf.e.lyrics?.length).sort((a, b) => a.e.start - b.e.start);
  sung.forEach((inf, i) => {
    for (const ly of inf.e.lyrics) {
      const v = staves[inf.e.staff].lyricV - (ly.verse - 1) * 2.0;
      out.glyphs.push({ kind: `text:lyric:${ly.text}`, s: inf.s, v, scale: size, tint: inf.tint });
      if (ly.syllabic !== "begin" && ly.syllabic !== "middle") continue;
      const next = sung.slice(i + 1).find(o => o.e.staff === inf.e.staff && o.e.lyrics.some(l => l.verse === ly.verse));
      if (!next) continue;
      const nextText = next.e.lyrics.find(l => l.verse === ly.verse).text;
      const a = inf.s + (lyricWidth(ly.text) * size) / 2;
      const b = next.s - (lyricWidth(nextText) * size) / 2;
      if (b - a < 0.6) continue;
      const mid = (a + b) / 2;
      out.tubes.push({ s0: mid - 0.3, v0: v + 0.45 * size, s1: mid + 0.3, v1: v + 0.45 * size, r: 0.05, tint: inf.tint });
    }
  });
}

// Long notes get a soft bar showing how long they last (lit up by staff.js as the character passes).
function tails(out, score, sOf, minBeats) {
  for (const n of score.notes) {
    if (n.tieFromPrev || n.soundingDur < minBeats - 1e-6) continue;
    const inf = out.info.get(n.el);
    if (!inf) continue;
    const half = (inf.whole ? METRICS.wholeHead : METRICS.noteHead) / 2;
    const s0 = inf.xs.get(n.id) + half + 0.2;
    const s1 = sOf(n.start + n.soundingDur) - 0.7;
    if (s1 - s0 < 0.8) continue;
    const v = inf.c + n.pos / 2;
    const h = 0.32;
    out.tails.push([{ s: s0, va: v - h, vb: v + h }, { s: s1, va: v - h * 0.6, vb: v + h * 0.6 }]);
  }
}
