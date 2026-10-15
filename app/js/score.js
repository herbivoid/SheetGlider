// Score model shared by the built-in demo and MusicXML files (parsed by the
// Python server into the same "raw" shape). All times are in quarter notes
// ("beats" below); tempos are quarter notes per minute.
//
// raw: {
//   title, staves: [{ clef }], keyFifths, timeSig: [num, den],
//   tempo: [{ beat, bpm }], bars: [beat of each barline], endBeat,
//   notes: [{ staff, start, dur, type, dots, step, alter, octave, tieStart, tieStop }],
//   rests: [{ staff, start, dur, type, dots, measureRest }],
// }

const STEPS = "CDEFGAB";
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Diatonic index (octave * 7 + step) of each clef's middle line.
const CLEF_MIDDLE_LINE = { treble: 4 * 7 + 6, bass: 3 * 7 + 1, alto: 4 * 7 + 0, tenor: 3 * 7 + 5 };
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

export function keyAlter(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return [...SHARP_ORDER].reverse().indexOf(step) < -fifths ? -1 : 0;
  return 0;
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

  const notes = raw.notes
    .filter(n => n.dur > 0)
    .map(n => {
      const pitch = { step: n.step, alter: n.alter ?? 0, octave: n.octave };
      const clef = raw.staves[n.staff]?.clef ?? "treble";
      return {
        staff: n.staff, start: n.start, dur: n.dur, type: n.type, dots: n.dots ?? 0, pitch,
        midi: midiOf(pitch), pos: staffPosition(pitch, clef),
        tieFromPrev: !!n.tieStop, tieToNext: !!n.tieStart,
      };
    })
    .sort((a, b) => a.start - b.start || a.staff - b.staff || b.pos - a.pos);
  notes.forEach((n, i) => { n.id = i; });

  // Accidentals: show one when the alteration differs from what's in force at
  // that staff position in this bar (key signature, or an earlier accidental).
  const state = new Map();
  for (const n of notes) {
    const key = `${n.staff}:${barIndex(n.start)}:${n.pitch.step}${n.pitch.octave}`;
    const current = state.has(key) ? state.get(key) : keyAlter(n.pitch.step, raw.keyFifths);
    n.accidental = n.pitch.alter !== current && !n.tieFromPrev ? n.pitch.alter : null;
    state.set(key, n.pitch.alter);
  }

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
    bpm: tempo.segs[0].bpm,
    notes,
    rests: raw.rests.map(r => ({ ...r, dots: r.dots ?? 0 })),
    bars,
    endBeat: raw.endBeat,
    timeOf: tempo.timeOf,
    beatAt: tempo.beatAt,
  };
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
