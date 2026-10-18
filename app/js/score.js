// Score model shared by the built-in demo and MusicXML files (parsed by the
// Python server into the same "raw" shape). All times are in quarter notes
// ("beats" below); tempos are quarter notes per minute.
//
// raw: {
//   title, staves: [{ clef, lines?, tuning? }], keyFifths, timeSig: [num, den],
//   tempo: [{ beat, bpm }], bars: [beat of each barline], endBeat,
//   notes: [{ staff, start, dur, type, dots, step, alter, octave, tieStart, tieStop }],
//   rests: [{ staff, start, dur, type, dots, measureRest }],
// }
// A guitar tab staff has clef "tab", its number of lines and its tuning (MIDI,
// lowest string first); its notes carry tab: { string, fret, hidden, paren, bend }.

const STEPS = "CDEFGAB";
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Diatonic index (octave * 7 + step) of each clef's middle line.
const CLEF_MIDDLE_LINE = { treble: 4 * 7 + 6, treble8vb: 3 * 7 + 6, bass: 3 * 7 + 1, alto: 4 * 7 + 0, tenor: 3 * 7 + 5 };
const SHARP_ORDER = "FCGDAEB";

// [beats, note type, dots]
const DURATIONS = [
  [4, "whole", 0], [3, "half", 1], [2, "half", 0], [1.5, "quarter", 1],
  [1, "quarter", 0], [0.75, "eighth", 1], [0.5, "eighth", 0],
  [0.375, "16th", 1], [0.25, "16th", 0],
];

const DEMO_DEF = {
  title: "demo-lick",
  bpm: 112,
  beatsPerBar: 4,
  // [pitch or "r" for rest, length in beats]
  music: [
    ["C5", 1], ["E5", 1], ["G5", 2],
    ["A5", 0.5], ["G5", 0.5], ["E5", 0.5], ["C5", 0.5], ["D5", 2],
    ["E5", 0.25], ["F#5", 0.25], ["G5", 0.25], ["A5", 0.25], ["B5", 1], ["D6", 1], ["r", 1],
    ["C6", 4],
    ["G4", 0.5], ["B4", 0.5], ["D5", 0.5], ["F5", 0.5], ["A5", 1.5], ["G5", 0.5],
    ["F5", 0.25], ["E5", 0.25], ["D5", 0.25], ["C5", 0.25],
    ["B4", 0.25], ["A4", 0.25], ["G4", 0.25], ["F4", 0.25], ["E4", 2],
    ["C4", 1], ["G4", 1], ["C5", 1], ["Eb5", 1],
    ["D5", 0.5], ["B4", 0.5], ["C5", 3],
  ],
};

// The built-in demo melody, as a raw score.
export function demoRaw() {
  const notes = [];
  const rests = [];
  let beat = 0;
  for (const [what, dur] of DEMO_DEF.music) {
    const hit = DURATIONS.find(([b]) => Math.abs(b - dur) < 1e-6);
    const [, type, dots] = hit;
    if (what === "r") rests.push({ staff: 0, start: beat, dur, type, dots });
    else notes.push({ staff: 0, start: beat, dur, type, dots, ...parsePitch(what) });
    beat += dur;
  }
  const bars = [];
  for (let b = DEMO_DEF.beatsPerBar; b <= beat + 1e-9; b += DEMO_DEF.beatsPerBar) bars.push(b);
  return {
    title: DEMO_DEF.title, staves: [{ clef: "treble" }], keyFifths: 0, timeSig: [4, 4],
    tempo: [{ beat: 0, bpm: DEMO_DEF.bpm }], bars, endBeat: beat, notes, rests,
  };
}

export function parsePitch(name) {
  const m = /^([A-G])(##|#|bb|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad pitch ${name}`);
  const alter = { "##": 2, "#": 1, "b": -1, "bb": -2 }[m[2]] ?? 0;
  return { step: m[1], alter, octave: Number(m[3]) };
}

export function midiOf({ step, alter, octave }) {
  return 12 * (octave + 1) + STEP_SEMITONES[STEPS.indexOf(step)] + alter;
}

// Staff position in half-spaces from the middle line (+ is up).
export function staffPosition({ step, octave }, clef) {
  return octave * 7 + STEPS.indexOf(step) - (CLEF_MIDDLE_LINE[clef] ?? CLEF_MIDDLE_LINE.treble);
}

// Guitar tab: strings are TAB_GAP staff spaces apart, string 1 (the highest) on top.
export const TAB_GAP = 1.5;
const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
export const isTab = staffDef => staffDef?.clef === "tab";
export const stringV = (string, lines) => ((lines - 1) / 2 - (string - 1)) * TAB_GAP;
// From a staff's middle to its outer lines, in staff spaces.
export const staffHalf = staffDef => (isTab(staffDef) ? ((staffDef.lines ?? 6) - 1) / 2 * TAB_GAP : 2);
// How far above its string the character stands on a fret number (half-spaces), so it stays readable.
const FRET_LIFT = 1.4;

// String and fret for a note on a tab staff: from the file, or the lowest fret that plays it.
function tabPlace(n, def, midi) {
  const lines = def.lines ?? 6;
  if (n.tab?.string >= 1 && n.tab.string <= lines && n.tab.fret >= 0) return { ...n.tab };
  const tuning = def.tuning?.length === lines ? def.tuning : STANDARD_TUNING.slice(-lines);
  let best = { string: lines, fret: Math.max(0, midi - tuning[0]) };
  tuning.forEach((open, i) => {
    const fret = midi - open;
    if (fret >= 0 && fret < best.fret) best = { string: lines - i, fret };
  });
  return best;
}

export function keyAlter(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return [...SHARP_ORDER].reverse().indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

// Value in force at `beat` from an initial value and a list of { beat, ... } changes.
function timeline(initial, changes, pick) {
  const list = [...(changes ?? [])].sort((a, b) => a.beat - b.beat);
  return beat => {
    let v = initial;
    for (const c of list) {
      if (c.beat > beat + 1e-6) break;
      v = pick(c);
    }
    return v;
  };
}

// Turns a raw score into the model the renderer uses. `tempoScale` multiplies
// every tempo (the "bpm" setting).
export function finalizeScore(raw, tempoScale = 1) {
  const bars = [...raw.bars].sort((a, b) => a - b);
  const barIndex = beat => {
    let i = 0;
    while (i < bars.length && bars[i] <= beat + 1e-6) i++;
    return i;
  };
  const keyAt = timeline(raw.keyFifths ?? 0, raw.keyChanges, k => k.fifths);
  const timeAt = timeline(raw.timeSig ?? [4, 4], raw.timeChanges, t => [t.num, t.den]);
  const clefChanges = raw.clefChanges ?? [];
  const clefLines = raw.staves.map((s, i) => timeline(s.clef ?? "treble",
    clefChanges.filter(c => c.staff === i), c => c.clef));
  const clefAt = (staff, beat) => (clefLines[staff] ?? clefLines[0])(beat);

  const makeNote = (n, i) => {
    const pitch = { step: n.step, alter: n.alter ?? 0, octave: n.octave };
    const def = raw.staves[n.staff] ?? raw.staves[0];
    const tab = isTab(def) ? tabPlace(n, def, midiOf(pitch)) : null;
    const pos = tab ? 2 * stringV(tab.string, def.lines ?? 6) : staffPosition(pitch, clefAt(n.staff, n.start));
    return {
      staff: n.staff, start: n.start, dur: n.dur ?? 0, type: n.type, dots: n.dots ?? 0, pitch,
      midi: midiOf(pitch), pos, tab, land: pos + (tab ? FRET_LIFT : 0), // land: where the character stands
      el: n.el ?? `n${i}`, voice: n.voice ?? "1",
      tieFromPrev: !!n.tieStop, tieToNext: !!n.tieStart,
      stem: n.stem ?? null, beams: n.beams ?? null, tuplet: n.tuplet ?? null,
      artic: n.artic ?? [], fermata: !!n.fermata, lyrics: n.lyrics ?? [],
    };
  };
  const notes = raw.notes.filter(n => n.dur > 0).map(makeNote)
    .sort((a, b) => a.start - b.start || a.staff - b.staff || b.pos - a.pos);
  notes.forEach((n, i) => { n.id = i; });
  const graces = (raw.graces ?? []).map((g, i) => ({ ...makeNote({ ...g, dur: 0 }, `g${i}`), slash: !!g.slash }));
  // Position of each grace note within its group (graces before the same main note).
  const graceGroups = new Map();
  graces.forEach((g, i) => {
    g.id = i;
    const key = `${g.staff}|${g.start}`;
    if (!graceGroups.has(key)) graceGroups.set(key, []);
    const group = graceGroups.get(key);
    if (!group.some(x => x.el === g.el)) group.push(g); // chord graces share one slot
    g.order = group.findIndex(x => x.el === g.el);
  });
  for (const g of graces) g.groupSize = graceGroups.get(`${g.staff}|${g.start}`).length;

  // Accidentals: show one when the alteration differs from what's in force at
  // that staff position in this bar (key signature, or an earlier accidental).
  // Grace notes come just before the main notes they share a start with.
  const state = new Map();
  const ordered = [...graces.map(g => [g, 0]), ...notes.map(n => [n, 1])]
    .sort((a, b) => a[0].start - b[0].start || a[1] - b[1]);
  for (const [n] of ordered) {
    const key = `${n.staff}:${barIndex(n.start)}:${n.pitch.step}${n.pitch.octave}`;
    const current = state.has(key) ? state.get(key) : keyAlter(n.pitch.step, keyAt(n.start));
    n.accidental = n.pitch.alter !== current && !n.tieFromPrev && !n.tab ? n.pitch.alter : null;
    state.set(key, n.pitch.alter);
  }

  // Elements: a single note, or all the notes of a chord.
  const elements = new Map();
  for (const n of notes) {
    if (!elements.has(n.el)) {
      elements.set(n.el, {
        id: n.el, staff: n.staff, voice: n.voice, start: n.start, dur: n.dur, type: n.type,
        dots: n.dots, stem: n.stem, beams: n.beams, tuplet: n.tuplet, notes: [],
        artic: n.artic, fermata: n.fermata, lyrics: n.lyrics,
      });
    }
    elements.get(n.el).notes.push(n);
  }
  const elementList = [...elements.values()].sort((a, b) => a.start - b.start);
  const beamGroups = notes.some(n => n.beams?.length)
    ? explicitBeams(elementList)
    : autoBeams(elementList, bars, timeAt);

  // Tie chains: the first note sounds for the whole chain.
  for (const n of notes) {
    n.soundingDur = n.dur;
    if (n.tieFromPrev) continue;
    let cur = n;
    while (cur.tieToNext) {
      const end = cur.start + cur.dur;
      const nxt = notes.find(m => m.staff === cur.staff && m.midi === cur.midi
        && m.tieFromPrev && Math.abs(m.start - end) < 1e-6);
      if (!nxt) break;
      n.soundingDur += nxt.dur;
      cur = nxt;
    }
  }

  const tempo = tempoMap(raw.tempo, tempoScale);
  return {
    title: raw.title || "score",
    staves: raw.staves,
    keyFifths: raw.keyFifths ?? 0,
    timeSig: raw.timeSig ?? [4, 4],
    keyChanges: raw.keyChanges ?? [],
    timeChanges: raw.timeChanges ?? [],
    clefChanges,
    keyAt, timeAt, clefAt,
    bpm: tempo.segs[0].bpm,
    notes,
    graces,
    elements: elementList,
    beamGroups,
    slurs: raw.slurs ?? [],
    techniques: raw.techniques ?? [], // tab: hammer-ons, pull-offs, slides
    tuplets: raw.tuplets ?? [],
    dynamics: raw.dynamics ?? [],
    wedges: raw.wedges ?? [],
    repeats: raw.repeats ?? [],
    voltas: raw.voltas ?? [],
    loudness: loudnessCurve(raw.dynamics ?? [], raw.wedges ?? []),
    rests: raw.rests.map(r => ({ ...r, dots: r.dots ?? 0 })),
    bars,
    endBeat: raw.endBeat,
    timeOf: tempo.timeOf,
    beatAt: tempo.beatAt,
  };
}

// How loud each dynamic is, 0..1. Accent-like marks (sf, fz…) only affect the
// note they're on; the others last until the next mark.
const LEVELS = {
  pppp: 0.08, ppp: 0.15, pp: 0.25, p: 0.35, mp: 0.48, mf: 0.6, f: 0.75, ff: 0.88, fff: 0.96, ffff: 1,
  fp: 0.35, sf: 0.85, sfz: 0.9, sffz: 0.95, fz: 0.85, rf: 0.8, rfz: 0.85, sfp: 0.35,
};
const MOMENTARY = new Set(["sf", "sfz", "sffz", "fz", "rf", "rfz"]);
export const DEFAULT_LOUDNESS = 0.6; // mf, when a score has no dynamics

// loudness(staff, beat) -> 0..1, from dynamic marks and crescendo/diminuendo
// hairpins. A staff with no marks of its own follows the other staff.
function loudnessCurve(dynamics, wedges) {
  const known = dynamics.filter(d => d.value in LEVELS).sort((a, b) => a.beat - b.beat);
  const lasting = known.filter(d => !MOMENTARY.has(d.value));
  const forStaff = (list, staff) => (list.some(d => d.staff === staff) ? list.filter(d => d.staff === staff) : list);
  const levelAt = (staff, beat) => {
    let level = DEFAULT_LOUDNESS;
    for (const d of forStaff(lasting, staff)) { if (d.beat > beat + 1e-6) break; level = LEVELS[d.value]; }
    return level;
  };
  return (staff, beat) => {
    const accent = forStaff(known, staff).find(d => MOMENTARY.has(d.value) && Math.abs(d.beat - beat) < 1e-6);
    if (accent) return LEVELS[accent.value];
    const w = forStaff(wedges, staff).find(x => beat >= x.start - 1e-6 && beat <= x.end + 1e-6);
    if (!w) return levelAt(staff, beat);
    // Inside a hairpin: glide from the level at its start to the next mark (or a step up/down).
    const from = levelAt(staff, w.start);
    // (A mark that would go the wrong way, like an ff right after a diminuendo, is ignored.)
    const dir = w.type === "crescendo" ? 1 : -1;
    const next = forStaff(lasting, staff).find(d => d.beat >= w.end - 1e-6 && d.beat <= w.end + 2);
    const to = next && (LEVELS[next.value] - from) * dir > 0
      ? LEVELS[next.value]
      : Math.min(1, Math.max(0, from + dir * 0.2));
    const u = (beat - w.start) / Math.max(1e-6, w.end - w.start);
    return from + (to - from) * Math.min(1, Math.max(0, u));
  };
}

const FLAG_COUNT = { eighth: 1, "16th": 2, "32nd": 3 };
export const flagCount = type => FLAG_COUNT[type] ?? 0;

// Beam groups as written in the file: runs from a "start" to a "stop" on the
// first beam, per staff and voice. Returns arrays of elements.
function explicitBeams(elements) {
  const groups = [];
  const open = new Map(); // staff|voice -> current group
  for (const e of elements) {
    const lane = `${e.staff}|${e.voice}`;
    const first = e.beams?.[0];
    if (!first) { open.delete(lane); continue; }
    let g = open.get(lane);
    if (first === "start" || !g) {
      g = [];
      groups.push(g);
      open.set(lane, g);
    }
    g.push(e);
    if (first === "stop") open.delete(lane);
  }
  return groups.filter(g => g.length > 1);
}

// No beams in the file (like the demo): beam consecutive eighths-and-shorter
// within each beat (dotted-quarter beats in 6/8, 9/8, 12/8).
function autoBeams(elements, bars, timeAt) {
  const groups = [];
  const open = new Map();
  for (const e of elements) {
    const lane = `${e.staff}|${e.voice}`;
    const [num, den] = timeAt(e.start);
    const unit = den === 8 && num % 3 === 0 ? 1.5 : 1;
    const barStart = [0, ...bars].filter(b => b <= e.start + 1e-6).pop();
    const beat = Math.floor((e.start - barStart) / unit + 1e-6);
    const g = open.get(lane);
    const fits = flagCount(e.type) > 0;
    if (fits && g && g.beat === beat && g.barStart === barStart && Math.abs(g.end - e.start) < 1e-6) {
      g.items.push(e);
      g.end = e.start + e.dur;
    } else if (fits) {
      const ng = { beat, barStart, end: e.start + e.dur, items: [e] };
      groups.push(ng);
      open.set(lane, ng);
    } else {
      open.delete(lane);
    }
  }
  return groups.map(g => g.items).filter(items => items.length > 1);
}

function tempoMap(list, scale) {
  const segs = (list?.length ? [...list] : [{ beat: 0, bpm: 120 }])
    .sort((a, b) => a.beat - b.beat)
    .map(s => ({ beat: s.beat, bpm: s.bpm * scale }));
  if (segs[0].beat > 0) segs.unshift({ beat: 0, bpm: segs[0].bpm });
  segs[0].time = 0;
  for (let i = 1; i < segs.length; i++) {
    segs[i].time = segs[i - 1].time + ((segs[i].beat - segs[i - 1].beat) * 60) / segs[i - 1].bpm;
  }
  const find = (key, v) => {
    let i = 0;
    while (i < segs.length - 1 && segs[i + 1][key] <= v) i++;
    return segs[i];
  };
  return {
    segs,
    timeOf: beat => { const s = find("beat", beat); return s.time + ((beat - s.beat) * 60) / s.bpm; },
    beatAt: time => { const s = find("time", time); return s.beat + ((time - s.time) * s.bpm) / 60; },
  };
}
