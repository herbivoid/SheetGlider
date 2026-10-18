import { METRICS, lyricWidth, wordsWidth } from "./glyphs.js";
import { WAVE, layoutMarks } from "./marks.js";
import { isTab, staffHalf } from "./score.js";

// Everything around the notes, laid out in the same flat staff coordinates as
// engrave.js (s along the staff, v up), using the notes and stems it already
// placed (out.info): marks on notes (marks.js), dynamics and hairpins, lyrics,
// duration tails, and the text and lines between notes (expression text,
// "let ring" lines, tempo marks, pedal, vibrato…).

export function layoutExpression(out, score, { sOf, staffCenter, params }) {
  // Vertical room around each staff: where its notes reach, and whether it has lyrics.
  const staves = score.staves.map((def, i) => {
    const c = staffCenter(i);
    return { c, top: c + staffHalf(def), bottom: c - staffHalf(def), tab: isTab(def), lo: Infinity, hi: -Infinity, lyrics: 0 };
  });
  for (const inf of out.info.values()) {
    const st = staves[inf.e.staff];
    for (const n of inf.e.notes) {
      st.lo = Math.min(st.lo, inf.c + n.pos / 2);
      st.hi = Math.max(st.hi, inf.c + n.pos / 2);
    }
    if (!inf.whole && inf.dir > 0) st.stemHi = Math.max(st.stemHi ?? -Infinity, inf.tip);
    if (inf.tab && !inf.whole) st.lo = Math.min(st.lo, inf.tip); // tab rhythm hangs below the staff
    for (const ly of inf.e.lyrics ?? []) st.lyrics = Math.max(st.lyrics, ly.verse);
  }
  const shown = params.showLyrics;
  staves.forEach((st, i) => {
    st.lyricV = Math.min(st.bottom - 3.5, st.lo - 2.6);
    // Dynamics go under the staff (between the staves on piano), or above it when lyrics are under it.
    const lyricsBelow = st.lyrics && shown;
    st.dynV = st.lyrics ? Math.max(st.top + 2.5, st.hi + 2.2) : Math.min(st.bottom - 2.5, st.lo - 2.0);
    if (staves.length > 1 && i === 0 && !st.lyrics) st.dynV = Math.max(st.dynV, st.c - 6);
    // Rows for text and lines (their middle height): above clears the notes (and
    // tab bend arrows); below clears the notes, dynamics and lyrics.
    const dynamicsBelow = params.showDynamics && !st.lyrics
      && (score.dynamics.some(d => d.staff === i) || score.wedges.some(w => w.staff === i));
    const dynamicsAbove = params.showDynamics && st.lyrics && score.dynamics.some(d => d.staff === i);
    st.aboveV = Math.max(st.top + (st.tab ? 3.4 : 2.4), st.hi + 2.0, (st.stemHi ?? -Infinity) + 1.2,
      dynamicsAbove ? st.dynV + 2.2 : -Infinity);
    st.belowV = Math.min(st.bottom - 3.0, st.lo - 2.2, dynamicsBelow ? st.dynV - 2.2 : Infinity,
      lyricsBelow ? st.lyricV - (st.lyrics - 1) * 2.0 - 1.6 : Infinity);
    st.rows = { above: [], below: [] };
  });
  out.tails = [];

  layoutMarks(out, staves, params);
  if (params.showDynamics) dynamics(out, score, staves, sOf);
  if (params.showLyrics) lyrics(out, staves, params.lyricsSize);
  if (params.tails) tails(out, score, sOf, params.tailMin);
  if (params.showText) {
    texts(out, score, staves, sOf);
    lines(out, score, staves, sOf);
  }
}

// The height of the first row (above or below the staff) with room for something from s0 to s1.
function rowFor(st, placement, s0, s1) {
  const below = placement === "below";
  const rows = st.rows[below ? "below" : "above"];
  for (let k = 0; ; k++) {
    rows[k] ??= [];
    if (rows[k].every(([a, b]) => s1 < a - 0.4 || s0 > b + 0.4)) {
      rows[k].push([s0, s1]);
      return below ? st.belowV - k * 2.1 : st.aboveV + k * 2.1;
    }
  }
}

// Text that belongs to a moment: words ("let ring", "dolce"…), rehearsal marks,
// segno / coda, tempo marks. Left-aligned at their beat, like in the score.
function texts(out, score, staves, sOf) {
  for (const t of [...score.texts].sort((a, b) => a.beat - b.beat)) {
    const st = staves[t.staff] ?? staves[0];
    const s = sOf(t.beat) - 0.6;
    const place = (w, placement = t.placement) => rowFor(st, placement, s, s + w);
    if (t.kind === "words") {
      const w = wordsWidth(t.style, t.text);
      const v = place(w);
      out.glyphs.push({ kind: `text:${t.style}:${t.text}`, s: s + w / 2, v: v - 0.45, scale: 1, tint: null });
    } else if (t.kind === "rehearsal") {
      // Bold, in a box.
      const w = wordsWidth("rehearsal", t.text) + 0.7;
      const v = place(w, "above") + 0.4;
      out.glyphs.push({ kind: `text:rehearsal:${t.text}`, s: s + w / 2, v: v - 0.6, scale: 1, tint: null });
      const [x0, x1, y0, y1] = [s, s + w, v - 1.05, v + 0.95];
      for (const [a, b, c, d] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
        out.tubes.push({ s0: a, v0: b, s1: c, v1: d, r: 0.05 });
      }
    } else if (t.kind === "segno" || t.kind === "coda") {
      const v = place(1.6, "above");
      out.glyphs.push({ kind: `artic:${t.kind}:above`, s: s + 0.8, v: v + 0.3, scale: 1, tint: null });
    } else if (t.kind === "tempo") {
      const label = t.label ? `${t.label}|` : "";
      const w = (t.label ? wordsWidth("bold", `${t.label} `) : 0) + 1.2 + wordsWidth("plain", ` = ${t.bpm}`);
      const v = place(w, "above");
      out.glyphs.push({ kind: `tempo:${t.unit}:${t.dots}:${label}${t.bpm}`, s, v: v - 0.45, scale: 1, tint: null });
    }
  }
}

// Lines over a stretch of music: dashed or solid lines with a label ("let ring",
// "P.M.", "cresc.") and end hooks, pedal marks, and wavy vibrato / trill lines.
function lines(out, score, staves, sOf) {
  const r = 0.045;
  for (const l of [...score.lines].sort((a, b) => a.start - b.start)) {
    const st = staves[l.staff] ?? staves[0];
    if (l.kind === "wavy") {
      // On top of the note's marks, continuing a trill sign if there is one.
      const inf = [...out.info.values()].find(i => i.e.staff === l.staff && Math.abs(i.e.start - l.start) < 1e-6);
      const v = inf?.trillV ?? (inf ? inf.above + 0.3 : st.aboveV);
      const s0 = (inf?.s ?? sOf(l.start)) + (inf?.trillV !== undefined ? 1.0 : -0.3);
      const s1 = Math.max(s0 + 0.8, sOf(l.end) - 0.8);
      out.tubes.push({ s0, v0: v, s1, v1: v, r: 0.05, wave: WAVE });
      continue;
    }
    const pedal = l.kind === "pedal";
    const placement = l.placement ?? (pedal ? "below" : "above");
    const s0 = sOf(l.start) - 0.6;
    const s1 = Math.max(s0 + 1, sOf(l.end) - 0.3);
    const v = rowFor(st, placement, s0, s1);
    // The label ("let ring", or Ped.), then the line.
    let from = s0;
    if (l.label) {
      const w = wordsWidth(l.style ?? "plain", l.label);
      out.glyphs.push({ kind: `text:${l.style ?? "plain"}:${l.label}`, s: s0 + w / 2, v: v - 0.45, scale: 1, tint: null });
      from = s0 + w + 0.4;
    } else if (pedal && l.sign) {
      out.glyphs.push({ kind: "artic:ped:above", s: s0 + 1.1, v, scale: 1, tint: null });
      from = s0 + 2.4;
    }
    if (pedal && !l.line) {
      out.glyphs.push({ kind: "artic:pedUp:above", s: s1, v, scale: 1, tint: null });
      continue;
    }
    if (l.dashed) {
      for (let x = from; x < s1; x += 0.9) out.tubes.push({ s0: x, v0: v, s1: Math.min(s1, x + 0.5), v1: v, r });
    } else if (s1 > from) {
      out.tubes.push({ s0: from, v0: v, s1, v1: v, r });
    }
    hook(out, l.label || (pedal && l.sign) ? "none" : l.startHook, s0, v, r);
    hook(out, l.endHook, s1, v, r);
  }
}

function hook(out, kind, s, v, r) {
  const up = kind === "up" || kind === "both";
  const down = kind === "down" || kind === "both";
  if (up || down) out.tubes.push({ s0: s, v0: down ? v - 0.8 : v, s1: s, v1: up ? v + 0.8 : v, r });
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
