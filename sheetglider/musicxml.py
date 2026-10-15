"""MusicXML (.musicxml / .xml / .mxl) -> the "raw score" JSON the browser app renders.

Times are in quarter notes ("beats"); tempos in quarter notes per minute.
Only one instrument is used: a single staff, or a two-staff (piano) part.
"""
from pathlib import Path

CLEFS = {("G", 2): "treble", ("F", 4): "bass", ("C", 3): "alto", ("C", 4): "tenor"}
TYPES = {"breve": "whole", "whole": "whole", "half": "half", "quarter": "quarter",
         "eighth": "eighth", "16th": "16th", "32nd": "32nd", "64th": "32nd"}


def parse_file(path):
    # Imported here: music21 takes a moment to load, and only parsing needs it.
    from music21 import converter, stream

    score = converter.parse(str(path))
    warnings = []
    parts = list(score.parts)
    if not parts:
        raise ValueError("no parts found in this file")

    # A piano part shows up as consecutive PartStaff objects; use up to two.
    chosen = [parts[0]]
    if isinstance(parts[0], stream.PartStaff) and len(parts) > 1 and isinstance(parts[1], stream.PartStaff):
        chosen.append(parts[1])
    if len(parts) > len(chosen):
        warnings.append(f"Using the first instrument only ({len(chosen)} of {len(parts)} staves).")

    staves, notes, rests = [], [], []
    for index, part in enumerate(chosen):
        staves.append({"clef": first_clef(part)})
        flat = part.flatten()
        for el in flat.notes:
            if el.duration.isGrace:
                continue
            members = el.notes if el.isChord else [el]
            for member in members:
                tie = member.tie or (el.tie if el.isChord else None)
                tie_type = tie.type if tie else None
                p = member.pitch
                notes.append({
                    "staff": index,
                    "start": float(el.offset),
                    "dur": float(el.quarterLength),
                    "type": TYPES.get(el.duration.type, "quarter"),
                    "dots": int(el.duration.dots),
                    "step": p.step,
                    "alter": int(round(p.alter)),
                    "octave": int(p.octave if p.octave is not None else p.implicitOctave),
                    "tieStart": tie_type in ("start", "continue"),
                    "tieStop": tie_type in ("stop", "continue"),
                })
        for r in flat.getElementsByClass("Rest"):
            if r.style.hideObjectOnPrint or r.quarterLength <= 0:
                continue
            rests.append({
                "staff": index,
                "start": float(r.offset),
                "dur": float(r.quarterLength),
                "type": TYPES.get(r.duration.type, "quarter"),
                "dots": int(r.duration.dots),
                "fullMeasure": r.fullMeasure in (True, "always"),
            })

    first = chosen[0]
    measures = list(first.getElementsByClass("Measure"))
    bars = sorted({round(float(m.offset + m.duration.quarterLength), 6) for m in measures})
    end_beat = max(float(p.highestTime) for p in chosen)
    bar_starts = [0.0] + bars
    for r in rests:  # whole-bar rests get centered in their bar
        r["measureRest"] = r.pop("fullMeasure") or any(
            abs(r["start"] - a) < 1e-6 and abs(r["start"] + r["dur"] - b) < 1e-6
            for a, b in zip(bar_starts, bars))
        if r["measureRest"]:
            r["type"], r["dots"] = "whole", 0

    ts = next(iter(first.recurse().getElementsByClass("TimeSignature")), None)
    ks = next(iter(first.recurse().getElementsByClass("KeySignature")), None)
    # Marks with only text ("Allegro") may have no number; fall back to 120.
    tempo = [{"beat": float(start), "bpm": float(mark.getQuarterBPM() or 120)}
             for start, _end, mark in score.metronomeMarkBoundaries()]

    meta = score.metadata
    title = (meta and (meta.title or meta.movementName)) or Path(path).stem
    return {
        "title": str(title),
        "staves": staves,
        "keyFifths": int(ks.sharps) if ks is not None else 0,
        "timeSig": [ts.numerator, ts.denominator] if ts is not None else [4, 4],
        "tempo": tempo,
        "bars": bars,
        "endBeat": end_beat,
        "notes": notes,
        "rests": rests,
        "warnings": warnings,
    }


def first_clef(part):
    clef = next(iter(part.recurse().getElementsByClass("Clef")), None)
    if clef is None:
        return "treble"
    return CLEFS.get((clef.sign, clef.line), "bass" if clef.sign == "F" else "treble")
