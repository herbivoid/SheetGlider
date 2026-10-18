import { curve } from "./tab.js";

// Marks on notes, laid out in the flat staff coordinates of engrave.js (s
// along the staff, v up), next to the notes and stems it placed (out.info):
//   articulations         on the notehead side, closest to it (above, on tab)
//   ornaments, bowings,   above the notes and the staff, stacked upward;
//   harmonics, fingering  the fermata goes on top
//   tremolo               slashes across the stem
//   arpeggio              a wavy line left of the chord
//   scoop/plop/doit/fall  short curves into or out of the note
//   breath mark, caesura  just after the note

// Articulations, closest to the note first.
const NEAR = ["staccato", "staccatissimo", "tenuto", "portato", "unstress", "stress", "accent", "marcato"];
// Symbols stacked above the note, with their height (staff spaces).
const ABOVE = {
  harmonic: 0.8, open: 0.8, stopped: 0.9, snapPizz: 0.9, thumb: 1.0, upBow: 1.3, downBow: 1.0,
  trill: 1.3, mordent: 0.9, invertedMordent: 0.9, turn: 0.9, invertedTurn: 0.9,
};

export function layoutMarks(out, staves, params) {
  for (const inf of out.info.values()) {
    const e = inf.e;
    const st = staves[e.staff];
    const vs = e.notes.map(n => inf.c + n.pos / 2);
    const hi = Math.max(...vs);
    const lo = Math.min(...vs);
    const stemUp = !inf.whole && inf.dir > 0 ? inf.tip : -Infinity;
    let above = inf.tab ? st.top + 1.0 : Math.max(hi + 1.3, stemUp + 0.9, st.top + 1.0); // next free height above

    if (params.showArticulations) {
      // Articulations on the notehead side, away from the stem; inside the staff
      // they sit in a space, not on a line. On tab they go above the staff.
      const artic = NEAR.filter(a => e.artic.includes(a));
      const side = inf.tab || inf.whole ? 1 : -inf.dir;
      let v = inf.tab ? st.top + 0.9 : side > 0 ? hi + 1.0 : lo - 1.0;
      for (const a of artic) {
        if (!inf.tab && Math.abs(v - inf.c) < 2.4) v = inf.c + Math.round(v - inf.c - 0.5) + 0.5;
        out.glyphs.push({ kind: `artic:${a}:${side > 0 ? "above" : "below"}`, s: inf.s, v, scale: 1, tint: inf.tint });
        v += side * 0.9;
      }
      if (side > 0 && artic.length) above = Math.max(above, v + 0.3);

      // Fingering, plucking, tapping, then the symbols above, then the fermata.
      const stack = (kind, height, scale = 1) => {
        out.glyphs.push({ kind, s: inf.s, v: above + height / 2, scale, tint: inf.tint });
        above += height + 0.15;
      };
      for (const m of e.marks) {
        if (m.startsWith("finger:")) stack(`text:finger:${m.slice(7)}`, 1.0);
        else if (m.startsWith("pluck:")) stack(`text:pluck:${m.slice(6)}`, 1.0);
        else if (m === "tap") stack("text:label:T", 1.0, 0.8);
      }
      for (const m of e.marks) {
        if (!(m in ABOVE)) continue;
        if (m === "trill") inf.trillV = above + ABOVE.trill / 2; // its wavy line continues at this height
        stack(`artic:${m}:above`, ABOVE[m]);
      }
      if (e.fermata) stack("artic:fermata:above", 1.2);

      for (const m of e.marks) if (m.startsWith("tremolo:")) tremolo(out, inf, Number(m.slice(8)) || 3, hi);
      if (e.marks.includes("arpeggio")) {
        out.tubes.push({ s0: inf.accLeft - 0.5, v0: lo - 0.6, s1: inf.accLeft - 0.5, v1: hi + 0.6, r: 0.05, tint: inf.tint, wave: WAVE });
      }
      slides(out, inf, hi);
      breaths(out, inf, st);
    }
    inf.above = above;
  }
}

export const WAVE = { amp: 0.17, len: 0.6 }; // wavy lines: vibrato, trills, arpeggios

// Slashes across the stem (or above a note without one).
function tremolo(out, inf, count, hi) {
  const onStem = !inf.whole;
  const x = onStem ? inf.stemX : inf.s;
  const mid = onStem ? inf.inner + (inf.tip - inf.inner) * 0.5 : hi + 1.6;
  for (let k = 0; k < count; k++) {
    const y = mid + (k - (count - 1) / 2) * 0.6;
    out.bands.push([{ s: x - 0.5, va: y - 0.36, vb: y - 0.1 }, { s: x + 0.5, va: y + 0.1, vb: y + 0.36 }]);
  }
}

// Scoop / plop slide into the note from below / above; doit / fall-off slide out of it, up / down.
function slides(out, inf, hi) {
  const marks = inf.e.marks;
  const r = inf.maxX + 0.25;
  const l = inf.accLeft - 0.2;
  if (marks.includes("doit")) curve(out, r, hi, r + 1.4, hi + 1.3, inf.tint);
  if (marks.includes("falloff")) curve(out, r, hi, r + 1.4, hi - 1.3, inf.tint);
  if (marks.includes("scoop")) curve(out, l, hi, l - 1.3, hi - 1.3, inf.tint);
  if (marks.includes("plop")) curve(out, l, hi, l - 1.3, hi + 1.3, inf.tint);
}

// A breath mark (above the staff) or caesura (across its top line), just after the note.
function breaths(out, inf, st) {
  const x = inf.maxX + 1.1;
  if (inf.e.marks.includes("breath")) out.glyphs.push({ kind: "artic:breath:above", s: x, v: st.top + 0.8, scale: 1, tint: null });
  if (inf.e.marks.includes("caesura")) out.glyphs.push({ kind: "artic:caesura:above", s: x, v: st.top - 0.2, scale: 1, tint: null });
}
