"""MusicXML (.musicxml / .xml / .mxl) -> the "raw score" JSON the browser app renders.

Times are in quarter notes ("beats"); tempos in quarter notes per minute.
Only one instrument is used: a single staff, or a two-staff (piano) part.

The score is read measure by measure, then the measures are written out in
playing order (repeats expanded, if asked), each pass with fresh element ids,
so ties, slurs, beams and tuplets all repeat along with their notes.
"""
from itertools import count
from pathlib import Path

CLEFS = {("G", 2): "treble", ("F", 4): "bass", ("C", 3): "alto", ("C", 4): "tenor"}
TYPES = {"breve": "whole", "whole": "whole", "half": "half", "quarter": "quarter",
         "eighth": "eighth", "16th": "16th", "32nd": "32nd", "64th": "32nd"}
ARTICULATIONS = {"Staccato": "staccato", "Staccatissimo": "staccatissimo", "Accent": "accent",
                 "StrongAccent": "marcato", "Tenuto": "tenuto"}


def parse_file(path, expand_repeats=True):
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

    staff_measures = [list(p.getElementsByClass("Measure")) for p in chosen]
    order = list(range(len(staff_measures[0])))
    if expand_repeats:
        try:
            order = play_order(chosen[0], staff_measures[0])
        except Exception as exc:  # unusual repeat structures: fall back to the written order
            warnings.append(f"Couldn't expand repeats ({exc}); playing them as written.")

    # Repeat signs and 1st/2nd endings only mean something when playing as written.
    written = order == list(range(len(staff_measures[0])))
    slurs = [(sl.getFirst(), sl.getLast()) for sl in score.spannerBundle.getByClass("Slur")]
    wedges = [("crescendo" if type(w).__name__ == "Crescendo" else "diminuendo", w.getFirst(), w.getLast())
              for w in score.spannerBundle.getByClass("DynamicWedge")]
    out = {"notes": [], "rests": [], "graces": [], "slurs": [], "tuplets": [], "bars": [],
           "keyChanges": [], "timeChanges": [], "clefChanges": [], "tempo": [],
           "dynamics": [], "wedges": [], "repeats": [], "voltas": []}
    ids = count()
    latest = {}  # id(music21 element) -> element id of its most recent copy (+ its timing)
    measure_start = {}
    offset = 0.0
    for mi in order:
        measure_start[mi] = offset
        for staff, measures in enumerate(staff_measures):
            if mi < len(measures):
                read_measure(measures[mi], staff, offset, out, ids, latest, staff == 0, written)
        # Slurs and hairpins whose last note was just written, and whose first note has been.
        just_written = lambda el: latest.get(("pass", id(el))) == offset
        for first, last in slurs:
            if id(last) in latest and id(first) in latest and just_written(last):
                out["slurs"].append({"from": latest[id(first)], "to": latest[id(last)]})
        for kind, first, last in wedges:
            if ("beat", id(first)) in latest and ("beat", id(last)) in latest and just_written(last):
                start, _, staff = latest[("beat", id(first))]
                last_start, last_dur, _ = latest[("beat", id(last))]
                out["wedges"].append({"type": kind, "staff": staff, "start": start,
                                      "end": max(last_start + last_dur, start + 0.5)})
        offset += float(staff_measures[0][mi].duration.quarterLength)
        out["bars"].append(round(offset, 6))

    if written:
        index = {id(m): i for i, m in enumerate(staff_measures[0])}
        for rb in score.spannerBundle.getByClass("RepeatBracket"):
            spanned = [index[id(m)] for m in rb.getSpannedElements() if id(m) in index]
            if spanned:
                first, last = min(spanned), max(spanned)
                end = measure_start[last] + float(staff_measures[0][last].duration.quarterLength)
                out["voltas"].append({"start": measure_start[first], "end": round(end, 6), "label": f"{rb.number}."})

    if not out["tempo"]:
        out["tempo"].append({"beat": 0.0, "bpm": 120.0})
    # A repeated first measure re-states its clef/key/time; only keep real changes.
    out["keyChanges"] = only_changes(out["keyChanges"], lambda k: None, lambda k: k["fifths"])
    out["timeChanges"] = only_changes(out["timeChanges"], lambda t: None, lambda t: (t["num"], t["den"]))
    out["clefChanges"] = only_changes(out["clefChanges"], lambda c: c["staff"], lambda c: c["clef"])
    first_clefs = {}
    for c in out["clefChanges"]:
        first_clefs.setdefault(c["staff"], c)
    staves = []
    for staff in range(len(chosen)):
        c = first_clefs.get(staff)
        staves.append({"clef": c["clef"] if c and c["beat"] == 0 else "treble"})
    out["clefChanges"] = [c for c in out["clefChanges"] if c["beat"] > 0]
    key0 = next((k for k in out["keyChanges"] if k["beat"] == 0), None)
    time0 = next((t for t in out["timeChanges"] if t["beat"] == 0), None)

    meta = score.metadata
    title = (meta and (meta.title or meta.movementName)) or Path(path).stem
    out.update({
        "title": str(title),
        "staves": staves,
        "keyFifths": key0["fifths"] if key0 else 0,
        "timeSig": [time0["num"], time0["den"]] if time0 else [4, 4],
        "keyChanges": [k for k in out["keyChanges"] if k["beat"] > 0],
        "timeChanges": [t for t in out["timeChanges"] if t["beat"] > 0],
        "endBeat": offset,
        "warnings": warnings,
    })
    return out


def play_order(part, measures):
    """Indices of the written measures in playing order, from music21's repeat expander."""
    index_by_number = {}
    for i, m in enumerate(measures):
        index_by_number.setdefault(m.number, i)
    expanded = part.expandRepeats()  # repeated copies get suffixes ("1a"), so match on the number
    return [index_by_number[m.number] for m in expanded.getElementsByClass("Measure")]


def read_measure(m, staff, offset, out, ids, latest, is_first_staff, written):
    from music21 import bar

    rel = lambda el: round(offset + float(el.getOffsetInHierarchy(m)), 6)
    measure_len = float(m.duration.quarterLength)

    if written and is_first_staff:
        if isinstance(m.leftBarline, bar.Repeat) and m.leftBarline.direction == "start":
            out["repeats"].append({"beat": offset, "dir": "start"})
        if isinstance(m.rightBarline, bar.Repeat) and m.rightBarline.direction == "end":
            out["repeats"].append({"beat": round(offset + measure_len, 6), "dir": "end"})
    for d in m.recurse().getElementsByClass("Dynamic"):
        out["dynamics"].append({"staff": staff, "beat": rel(d), "value": str(d.value)})
    # Hairpins can start/stop on an invisible anchor instead of a note.
    for a in m.recurse().getElementsByClass("SpannerAnchor"):
        latest[("pass", id(a))] = offset
        latest[("beat", id(a))] = (rel(a), 0.0, staff)

    for c in m.recurse().getElementsByClass("Clef"):
        out["clefChanges"].append({"staff": staff, "beat": rel(c), "clef": clef_name(c)})
    if is_first_staff:
        for k in m.recurse().getElementsByClass("KeySignature"):
            out["keyChanges"].append({"beat": rel(k), "fifths": int(k.sharps)})
        for t in m.recurse().getElementsByClass("TimeSignature"):
            out["timeChanges"].append({"beat": rel(t), "num": t.numerator, "den": t.denominator})
        for mm in m.recurse().getElementsByClass("MetronomeMark"):
            bpm = mm.getQuarterBPM()
            if bpm:
                out["tempo"].append({"beat": rel(mm), "bpm": float(bpm)})

    tuplet = {}  # voice -> open tuplet group
    for el in m.recurse().notes:
        voice = el.activeSite.id if type(el.activeSite).__name__ == "Voice" else "1"
        eid = next(ids)
        start = rel(el)
        latest[id(el)] = eid
        latest[("pass", id(el))] = offset
        latest[("beat", id(el))] = (start, float(el.quarterLength), staff)
        members = el.notes if el.isChord else [el]
        if el.duration.isGrace:
            for member in members:
                out["graces"].append({
                    "el": eid, "staff": staff, "start": start, **pitch_of(member),
                    "type": TYPES.get(el.duration.type, "eighth"),
                    "slash": bool(getattr(el.duration, "slash", False)),
                })
            continue
        group = tuplet_group(el, voice, tuplet, out, staff, ids)
        stem = el.stemDirection if el.stemDirection in ("up", "down") else None
        beams = [b.type if b.type != "partial" else f"partial-{b.direction or 'right'}"
                 for b in el.beams.beamsList]
        artic = [ARTICULATIONS[type(a).__name__] for a in el.articulations if type(a).__name__ in ARTICULATIONS]
        fermata = any(type(x).__name__ == "Fermata" for x in el.expressions)
        lyrics = [{"text": ly.text, "syllabic": ly.syllabic or "single", "verse": int(ly.number or 1)}
                  for ly in el.lyrics if ly.text]
        for i, member in enumerate(members):
            tie = member.tie or (el.tie if el.isChord else None)
            tie_type = tie.type if tie else None
            out["notes"].append({
                "el": eid, "staff": staff, "voice": voice, "start": start,
                "dur": float(el.quarterLength),
                "type": TYPES.get(el.duration.type, "quarter"),
                "dots": int(el.duration.dots),
                **pitch_of(member),
                "tieStart": tie_type in ("start", "continue"),
                "tieStop": tie_type in ("stop", "continue"),
                "stem": stem, "beams": beams, "tuplet": group,
                "artic": artic, "fermata": fermata,
                "lyrics": lyrics if i == 0 else [],  # one set per chord
            })

    for r in m.recurse().getElementsByClass("Rest"):
        if r.style.hideObjectOnPrint or r.quarterLength <= 0:
            continue
        start = rel(r)
        full = r.fullMeasure in (True, "always") or (
            abs(float(r.getOffsetInHierarchy(m))) < 1e-6 and abs(float(r.quarterLength) - measure_len) < 1e-6)
        out["rests"].append({
            "staff": staff, "start": start, "dur": float(r.quarterLength),
            "type": "whole" if full else TYPES.get(r.duration.type, "quarter"),
            "dots": 0 if full else int(r.duration.dots),
            "measureRest": full,
        })


def tuplet_group(el, voice, open_groups, out, staff, ids):
    """Returns the id of the tuplet group `el` belongs to (or None), opening/closing groups."""
    if not el.duration.tuplets:
        open_groups.pop(voice, None)
        return None
    t = el.duration.tuplets[0]
    g = open_groups.get(voice)
    ratio = (t.numberNotesActual, t.numberNotesNormal)
    if g is None or t.type == "start" or g["ratio"] != ratio or g["filled"] >= g["length"] - 1e-6:
        g = {"id": next(ids), "ratio": ratio, "filled": 0.0, "length": float(t.totalTupletLength())}
        open_groups[voice] = g
        out["tuplets"].append({
            "id": g["id"], "staff": staff, "actual": ratio[0], "normal": ratio[1],
            "bracket": t.bracket is not False, "placement": t.placement,
        })
    g["filled"] += float(el.quarterLength)
    if t.type == "stop":
        open_groups.pop(voice, None)
    return g["id"]


def only_changes(items, group_of, value_of):
    """Drops entries that just repeat the value already in force (per group)."""
    current, kept = {}, []
    for item in sorted(items, key=lambda x: x["beat"]):
        g = group_of(item)
        if current.get(g, object()) != value_of(item):
            kept.append(item)
            current[g] = value_of(item)
    return kept


def pitch_of(n):
    p = n.pitch
    return {"step": p.step, "alter": int(round(p.alter)),
            "octave": int(p.octave if p.octave is not None else p.implicitOctave)}


def clef_name(c):
    return CLEFS.get((c.sign, c.line), "bass" if c.sign == "F" else "treble")
