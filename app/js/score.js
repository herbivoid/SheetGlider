// Score model. Phase 0 uses a built-in demo melody; later phases fill the same
// structure from MusicXML.

const STEPS = "CDEFGAB";
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Diatonic index (octave * 7 + step) of each clef's middle line: B4 and D3.
const CLEF_MIDDLE_LINE = { treble: 4 * 7 + 6, bass: 3 * 7 + 1 };
const SHARP_ORDER = "FCGDAEB";

// [beats, note type, dots]
const DURATIONS = [
  [4, "whole", 0], [3, "half", 1], [2, "half", 0], [1.5, "quarter", 1],
  [1, "quarter", 0], [0.75, "eighth", 1], [0.5, "eighth", 0],
  [0.375, "16th", 1], [0.25, "16th", 0],
];

export const DEMO = {
  title: "demo-lick",
  bpm: 112,
  beatsPerBar: 4,
  beatUnit: 4,
  keyFifths: 0,
  staves: [{
    clef: "treble",
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
  }],
};

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
  return octave * 7 + STEPS.indexOf(step) - CLEF_MIDDLE_LINE[clef];
}

function keyAlter(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.indexOf(step) < fifths ? 1 : 0;
  if (fifths < 0) return [...SHARP_ORDER].reverse().indexOf(step) < -fifths ? -1 : 0;
  return 0;
}

function durationInfo(beats) {
  const hit = DURATIONS.find(([b]) => Math.abs(b - beats) < 1e-6);
  if (!hit) throw new Error(`unsupported duration ${beats}`);
  return { type: hit[1], dots: hit[2] };
}

export function buildScore(def, bpmOverride) {
  const bpm = bpmOverride || def.bpm;
  const notes = [];
  const rests = [];
  let endBeat = 0;

  def.staves.forEach((staffDef, staff) => {
    let beat = 0;
    let barState = new Map(); // "step+octave" -> alter currently in force this bar
    let barIndex = 0;
    for (const [what, dur] of staffDef.music) {
      const bar = Math.floor(beat / def.beatsPerBar + 1e-9);
      if (bar !== barIndex) { barIndex = bar; barState = new Map(); }
      const { type, dots } = durationInfo(dur);
      if (what === "r") {
        rests.push({ staff, start: beat, dur, type, dots });
      } else {
        const pitch = parsePitch(what);
        const key = pitch.step + pitch.octave;
        const current = barState.has(key) ? barState.get(key) : keyAlter(pitch.step, def.keyFifths);
        const accidental = pitch.alter !== current ? pitch.alter : null;
        barState.set(key, pitch.alter);
        notes.push({
          id: notes.length, staff, start: beat, dur, type, dots, pitch,
          midi: midiOf(pitch), pos: staffPosition(pitch, staffDef.clef), accidental,
        });
      }
      beat += dur;
    }
    endBeat = Math.max(endBeat, beat);
  });

  const bars = [];
  for (let b = def.beatsPerBar; b <= endBeat + 1e-9; b += def.beatsPerBar) bars.push(b);

  notes.sort((a, b) => a.start - b.start || b.pos - a.pos);
  return {
    title: def.title,
    bpm,
    secondsPerBeat: 60 / bpm,
    beatsPerBar: def.beatsPerBar,
    beatUnit: def.beatUnit,
    keyFifths: def.keyFifths,
    staves: def.staves.map(s => ({ clef: s.clef })),
    notes,
    rests,
    bars,
    endBeat,
  };
}
