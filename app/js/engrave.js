import { flagCount } from "./score.js";
import { METRICS, lyricWidth } from "./glyphs.js";

// Notation layout in the staff's own flat coordinates: s = distance along the
// staff, v = height (both in staff spaces; v = 0 is staff 0's middle line).
// Produces drawing primitives that staff.js maps onto the 3D ribbon:
//   glyphs: { kind, s, v, scale, tint }      font glyphs (tint = which note's color to follow)
//   tubes:  { s0, v0, s1, v1, r, tint }      stems, ledger lines, brackets, grace slashes
//   bands:  [{ s, va, vb }]                  filled shapes between two edges (beams, ties, slurs)
//   visuals: { key, note, s, v, beat, offset, glow, scale }  notes that light up when played

// Notehead sizes depend on the music font; syncFontMetrics() refreshes them.
let HEAD_HALF = 0.59;
let WHOLE_HALF = 0.85;
let SECOND_SHIFT = 1.06;   // how far a notehead moves to the other side of the stem
export const STEM_W = 0.12;
const STEM_ATTACH = 0.168;
const STEM_LEN = 3.5;
const BEAM = 0.5;          // beam thickness
const BEAM_STEP = 0.75;    // distance between beam levels
const ACC_COL = 1.15;      // accidental column width
const GRACE = 0.65;        // grace note scale
const GRACE_STEP = 1.3;    // room per grace note
const ACC_NAMES = { 1: "sharp", "-1": "flat", 0: "natural", 2: "doubleSharp", "-2": "doubleFlat" };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const beatKey = b => Math.round(b * 960);

function syncFontMetrics() {
  HEAD_HALF = METRICS.noteHead / 2;
  WHOLE_HALF = METRICS.wholeHead / 2;
  SECOND_SHIFT = METRICS.noteHead - STEM_W;
}

// Stem direction (+1 up, -1 down) for a set of elements: the file's choice if
// it has one, else away from the note farthest from the middle line.
function stemDir(els) {
  const fromFile = els.find(e => e.stem)?.stem;
  if (fromFile) return fromFile === "up" ? 1 : -1;
  let high = -Infinity;
  let low = Infinity;
  for (const e of els) for (const n of e.notes) { high = Math.max(high, n.pos); low = Math.min(low, n.pos); }
  return high + low >= 0 ? -1 : 1;
}

// Accidental columns for a chord: top to bottom, each in the first column
// where it doesn't collide with one already placed (3 spaces apart).
function accidentalColumns(notes) {
  const cols = [];
  const placed = new Map();
  for (const n of [...notes].filter(n => n.accidental !== null).sort((a, b) => b.pos - a.pos)) {
    let k = 0;
    while (cols[k]?.some(p => Math.abs(p - n.pos) < 6)) k++;
    (cols[k] ??= []).push(n.pos);
    placed.set(n.id, k);
  }
  return { count: cols.length, column: placed };
}

// Room needed just before each beat (barlines, clef/key/time changes,
// accidentals, grace notes), for the spacing and for placing barlines.
export function measureExtras(score, params) {
  const { barGap } = params;
  const extras = new Map();
  const add = (beat, w) => extras.set(beatKey(beat), (extras.get(beatKey(beat)) ?? 0) + w);
  const before = new Map(); // what sits left of the notes at a beat (accidentals, graces)
  const left = (beat, w) => before.set(beatKey(beat), Math.max(before.get(beatKey(beat)) ?? 0, w));
  for (const e of score.elements) {
    const { count } = accidentalColumns(e.notes);
    if (count) left(e.start, 0.25 + count * ACC_COL);
  }
  const graceGroups = new Map();
  for (const g of score.graces) graceGroups.set(`${g.staff}|${g.start}`, g);
  for (const g of graceGroups.values()) {
    const accRoom = score.graces.some(x => x.start === g.start && x.accidental !== null) ? 0.8 : 0;
    const main = before.get(beatKey(g.start)) ?? 0;
    left(g.start, main + g.groupSize * GRACE_STEP + accRoom);
  }
  for (const [k, w] of before) extras.set(k, (extras.get(k) ?? 0) + w);
  for (const bar of score.bars) if (bar < score.endBeat - 1e-6) add(bar, barGap);
  for (const c of changesAt(score)) add(c.beat, c.width);
  for (const r of score.repeats) add(r.beat, 1.2);
  if (params.showLyrics) lyricRoom(score, params, add);
  return { extras, before: beat => before.get(beatKey(beat)) ?? 0 };
}

// Extra room where two neighbouring syllables wouldn't fit side by side
// (estimated from the unsmoothed spacing).
function lyricRoom(score, params, add) {
  const lastByLane = new Map();
  for (const e of score.elements) {
    for (const ly of e.lyrics ?? []) {
      const lane = `${e.staff}|${ly.verse}`;
      const prev = lastByLane.get(lane);
      lastByLane.set(lane, { e, ly });
      if (!prev) continue;
      const hyphen = prev.ly.syllabic === "begin" || prev.ly.syllabic === "middle";
      const need = ((lyricWidth(prev.ly.text) + lyricWidth(ly.text)) / 2) * params.lyricsSize + (hyphen ? 1.6 : 0.8);
      const have = params.quarterWidth * Math.pow(e.start - prev.e.start, params.spacingExponent);
      if (need > have) add(e.start, need - have);
    }
  }
}

export const CHANGE_PAD = 1.4;

// Clef, key and time signature changes, grouped by beat with their total width.
export function changesAt(score) {
  const byBeat = new Map();
  const at = beat => {
    if (!byBeat.has(beatKey(beat))) byBeat.set(beatKey(beat), { beat, clefs: [], key: null, time: null, width: 0 });
    return byBeat.get(beatKey(beat));
  };
  for (const c of score.clefChanges) { at(c.beat).clefs.push(c); }
  for (const k of score.keyChanges) {
    const prev = score.keyAt(k.beat - 1e-3);
    at(k.beat).key = { from: prev, to: k.fifths, cancel: cancelled(prev, k.fifths) };
  }
  for (const t of score.timeChanges) at(t.beat).time = [t.num, t.den];
  // Width includes CHANGE_PAD of breathing room: half before the symbols, half after.
  for (const c of byBeat.values()) {
    c.width = CHANGE_PAD;
    if (c.clefs.length) c.width += 2.6;
    if (c.key) c.width += (c.key.cancel.length + Math.abs(c.key.to)) * 1.0 + 0.8;
    if (c.time) c.width += 2.6;
  }
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat);
}

// Accidentals of the old key that need a natural sign when changing key.
function cancelled(from, to) {
  if (from === 0) return [];
  const sameSide = Math.sign(from) === Math.sign(to);
  const keep = sameSide ? Math.abs(to) : 0;
  const steps = from > 0 ? "FCGDAEB" : "BEADGCF";
  return [...steps.slice(keep, Math.abs(from))];
}

export function engrave(score, { sOf, staffCenter, lineThickness }) {
  syncFontMetrics();
  const out = { glyphs: [], tubes: [], bands: [], visuals: [], info: new Map() };
  const ledgerR = lineThickness * 0.6;

  // Stem directions: shared across a beam group.
  const dirOf = new Map();
  const groupOf = new Map();
  score.beamGroups.forEach((g, gi) => {
    const d = stemDir(g);
    for (const e of g) { dirOf.set(e.id, d); groupOf.set(e.id, gi); }
  });

  for (const e of score.elements) {
    const whole = e.type === "whole";
    const dir = whole ? 1 : dirOf.get(e.id) ?? stemDir([e]);
    const c = staffCenter(e.staff);
    const s = sOf(e.start);
    const headHalf = whole ? WHOLE_HALF : HEAD_HALF;

    // Noteheads, shifting one of each pair a second apart to the other side of the stem.
    const fromBase = [...e.notes].sort((a, b) => (a.pos - b.pos) * dir);
    let prev = null;
    let prevShifted = false;
    const xs = new Map();
    for (const n of fromBase) {
      const shift = prev !== null && Math.abs(n.pos - prev) === 1 && !prevShifted;
      xs.set(n.id, s + (shift ? dir * SECOND_SHIFT : 0));
      prev = n.pos;
      prevShifted = shift;
    }
    const head = whole ? "whole" : e.type === "half" ? "half" : "black";
    for (const n of e.notes) {
      const x = xs.get(n.id);
      const v = c + n.pos / 2;
      out.glyphs.push({ kind: `head:${head}`, s: x, v, scale: 1, tint: `n${n.id}` });
      out.visuals.push({ key: `n${n.id}`, note: n, s: x, v, beat: n.start, offset: 0, glow: !n.tieFromPrev, scale: 1 });
    }
    const minX = Math.min(...xs.values()) - headHalf;
    const maxX = Math.max(...xs.values()) + headHalf;

    // Accidentals in columns, right to left.
    const { count: accCols, column } = accidentalColumns(e.notes);
    for (const n of e.notes) {
      if (n.accidental === null) continue;
      const right = minX - 0.2 - column.get(n.id) * ACC_COL;
      out.glyphs.push({ kind: `acc:${ACC_NAMES[n.accidental] ?? "natural"}`, s: right, v: c + n.pos / 2, scale: 1, tint: `n${n.id}` });
    }

    // Augmentation dots, in spaces, never two in the same space.
    const usedDots = new Set();
    for (const n of [...e.notes].sort((a, b) => b.pos - a.pos)) {
      let p = n.pos % 2 === 0 ? n.pos + 1 : n.pos;
      if (usedDots.has(p)) p -= 2;
      usedDots.add(p);
      for (let d = 0; d < e.dots; d++) {
        out.glyphs.push({ kind: "dot", s: maxX + 0.25 + d * 0.5, v: c + p / 2, scale: 1, tint: `n${n.id}` });
      }
    }

    ledgers(out, e.notes.map(n => n.pos), c, minX - 0.4, maxX + 0.4, ledgerR);

    const vs = e.notes.map(n => c + n.pos / 2);
    const lead = [...e.notes].sort((a, b) => (b.pos - a.pos) * dir)[0];
    out.info.set(e.id, {
      e, dir, c, s, minX, maxX, xs,
      accLeft: minX - (accCols ? 0.2 + accCols * ACC_COL : 0), // left edge of everything drawn
      stemX: s + dir * (HEAD_HALF - STEM_W / 2),
      inner: dir > 0 ? Math.min(...vs) : Math.max(...vs),
      outer: dir > 0 ? Math.max(...vs) : Math.min(...vs),
      flags: flagCount(e.type), whole, beamed: groupOf.has(e.id), tint: `n${lead.id}`,
    });
  }

  score.beamGroups.forEach(g => layoutBeams(out, g.map(e => out.info.get(e.id))));

  // Stems and flags (beamed stems got their tip from the beam).
  for (const inf of out.info.values()) {
    if (inf.whole) continue;
    if (inf.tip === undefined) {
      let tip = inf.outer + inf.dir * (STEM_LEN + Math.max(0, inf.flags - 2) * 0.5);
      tip = inf.dir > 0 ? Math.max(tip, inf.c) : Math.min(tip, inf.c); // reach the middle line
      inf.tip = tip;
      if (inf.flags) {
        out.glyphs.push({ kind: `flag:${inf.e.type}:${inf.dir > 0 ? "up" : "down"}`, s: inf.stemX - STEM_W / 2, v: tip, scale: 1, tint: inf.tint });
      }
    }
    out.tubes.push({ s0: inf.stemX, v0: inf.inner + inf.dir * STEM_ATTACH, s1: inf.stemX, v1: inf.tip, r: STEM_W / 2, tint: inf.tint });
  }

  layoutGraces(out, score, { sOf, staffCenter, ledgerR });
  return out;
}

function ledgers(out, positions, c, x0, x1, r) {
  const high = Math.max(...positions);
  const low = Math.min(...positions);
  for (let p = 6; p <= high; p += 2) out.tubes.push({ s0: x0, v0: c + p / 2, s1: x1, v1: c + p / 2, r, ledger: true });
  for (let p = -6; p >= low; p -= 2) out.tubes.push({ s0: x0, v0: c + p / 2, s1: x1, v1: c + p / 2, r, ledger: true });
}

// A beam group: straight beams, slanted at most one space, far enough from every notehead.
function layoutBeams(out, items) {
  const dir = items[0].dir;
  const first = items[0];
  const last = items[items.length - 1];
  const levels = Math.max(...items.map(i => i.flags));
  // A note in the middle reaching further toward the beam than both ends: keep the beam flat.
  const reach = list => Math.max(...list.map(i => i.outer * dir));
  const concave = items.length > 2 && reach(items.slice(1, -1)) > reach([first, last]) + 1e-6;
  const rise = concave ? 0 : clamp((last.outer - first.outer) * 0.5, -1, 1);
  const span = last.stemX - first.stemX;
  const slope = span > 1e-6 ? rise / span : 0;
  const minStem = 3.0 + 0.75 * (levels - 1);
  let y0 = first.outer + dir * STEM_LEN;
  const line = x => y0 + slope * (x - first.stemX);
  let need = -Infinity;
  for (const i of items) {
    need = Math.max(need, minStem - dir * (line(i.stemX) - i.outer), -dir * (line(i.stemX) - i.c));
  }
  if (need > 0) y0 += dir * need;
  for (const i of items) i.tip = line(i.stemX);

  const band = (xa, xb, level) => {
    const off = -dir * (level - 1) * BEAM_STEP;
    const pts = [];
    for (const x of [xa, xb]) pts.push({ s: x, va: line(x) + off, vb: line(x) + off - dir * BEAM });
    out.bands.push(pts);
  };
  const half = STEM_W / 2;
  band(first.stemX - half, last.stemX + half, 1);

  // Secondary beams join neighbours that are both short enough, so four 16ths
  // share one double beam. (Some files break them into pairs; standard
  // engraving doesn't.) The file still decides which way a lone hook points.
  for (let L = 2; L <= levels; L++) {
    const has = i => i.flags >= L;
    const type = i => i.e.beams?.[L - 1];
    let k = 0;
    while (k < items.length) {
      if (!has(items[k])) { k++; continue; }
      let j = k;
      while (j < items.length - 1 && has(items[j + 1])) j++;
      if (j > k) {
        band(items[k].stemX - half, items[j].stemX + half, L);
      } else {
        // A lone short note: a hook toward its neighbour.
        const explicit = type(items[k]);
        const goLeft = explicit === "partial-left" ? true : explicit === "partial-right" ? false : k > 0;
        const nb = items[goLeft ? k - 1 : k + 1];
        const len = nb ? Math.min(1.1, 0.6 * Math.abs(nb.stemX - items[k].stemX)) : 1.1;
        const x = items[k].stemX;
        if (goLeft) band(x - len, x + half, L); else band(x - half, x + len, L);
      }
      k = j + 1;
    }
  }
}

// Grace notes: small, stem up, slashed if acciaccatura, just left of their main note.
function layoutGraces(out, score, { sOf, staffCenter, ledgerR }) {
  for (const g of score.graces) {
    const c = staffCenter(g.staff);
    // Everything belonging to the main note(s) starts at their left edge (accidentals included).
    let edge = sOf(g.start) - HEAD_HALF;
    for (const inf of out.info.values()) {
      if (inf.e.staff === g.staff && Math.abs(inf.e.start - g.start) < 1e-6) edge = Math.min(edge, inf.accLeft);
    }
    const s = edge - 0.3 - (g.groupSize - g.order - 0.5) * GRACE_STEP;
    const v = c + g.pos / 2;
    const key = `g${g.id}`;
    out.glyphs.push({ kind: `head:${g.type === "half" ? "half" : "black"}`, s, v, scale: GRACE, tint: key });
    out.visuals.push({ key, note: g, s, v, beat: g.start, offset: -0.07 * (g.groupSize - g.order), glow: true, scale: GRACE });
    if (g.accidental !== null) {
      out.glyphs.push({ kind: `acc:${ACC_NAMES[g.accidental] ?? "natural"}`, s: s - HEAD_HALF * GRACE - 0.15, v, scale: GRACE, tint: key });
    }
    const stemX = s + (HEAD_HALF - STEM_W / 2) * GRACE;
    const tip = v + STEM_LEN * GRACE;
    out.tubes.push({ s0: stemX, v0: v + STEM_ATTACH * GRACE, s1: stemX, v1: tip, r: (STEM_W / 2) * GRACE, tint: key });
    if (flagCount(g.type)) {
      out.glyphs.push({ kind: `flag:${g.type}:up`, s: stemX - (STEM_W / 2) * GRACE, v: tip, scale: GRACE, tint: key });
    }
    if (g.slash) out.tubes.push({ s0: stemX - 0.45, v0: tip - 1.35, s1: stemX + 0.6, v1: tip - 0.5, r: 0.045, tint: key });
    ledgers(out, [g.pos], c, s - HEAD_HALF * GRACE - 0.25, s + HEAD_HALF * GRACE + 0.25, ledgerR * 0.8);
  }
}

// Key signature accidentals (as [glyph name, half-space position]) for a clef,
// optionally preceded by naturals cancelling the previous key.
const KEY_SHARPS = [4, 1, 5, 2, -1, 3, 0];
const KEY_FLATS = [0, 3, -1, 2, -2, 1, -3];
const CLEF_KEY_SHIFT = { treble: 0, bass: -2, alto: -1, tenor: 1 };
const STEP_OF_SHARP = "FCGDAEB";
const STEP_OF_FLAT = "BEADGCF";
export function keySignatureGlyphs(fifths, clef, cancel = [], cancelFromSharps = true) {
  const shift = CLEF_KEY_SHIFT[clef] ?? 0;
  const out = [];
  for (const step of cancel) {
    const list = cancelFromSharps ? KEY_SHARPS : KEY_FLATS;
    const steps = cancelFromSharps ? STEP_OF_SHARP : STEP_OF_FLAT;
    out.push(["natural", list[steps.indexOf(step)] + shift]);
  }
  const order = fifths >= 0 ? KEY_SHARPS : KEY_FLATS;
  for (let i = 0; i < Math.abs(fifths); i++) out.push([fifths > 0 ? "sharp" : "flat", order[i] + shift]);
  return out;
}
