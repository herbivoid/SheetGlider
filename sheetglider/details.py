"""Notation details read straight from the MusicXML, next to music21 (which
skips or reshapes some of them):

- guitar tab: tuning, string and fret, bends, hammer-ons, pull-offs, slides
- every mark on a note: articulations, ornaments, string/guitar techniques,
  fingering, special noteheads, vibrato / trill lines
- the text and lines between notes: expression and staff text, "let ring" or
  "P.M." lines, rehearsal marks, segno / coda, tempo marks, pedal
"""
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

STEP_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# Note-to-note techniques: MusicXML element -> kind.
TECHNIQUES = {"hammer-on": "H", "pull-off": "P", "slide": "slide", "glissando": "slide", "wavy-line": "wavy"}
# Articulations (drawn on the notehead side; some also shape the character's motion).
ARTICULATIONS = {
    "accent": "accent", "strong-accent": "marcato", "staccato": "staccato", "staccatissimo": "staccatissimo",
    "spiccato": "staccatissimo", "tenuto": "tenuto", "detached-legato": "portato", "stress": "stress",
    "unstress": "unstress",
}
# Other marks on a note.
MARKS = {
    "breath-mark": "breath", "caesura": "caesura",
    "scoop": "scoop", "plop": "plop", "doit": "doit", "falloff": "falloff",
    "up-bow": "upBow", "down-bow": "downBow", "harmonic": "harmonic", "open-string": "open", "open": "open",
    "stopped": "stopped", "snap-pizzicato": "snapPizz", "tap": "tap", "thumb-position": "thumb",
    "trill-mark": "trill", "shake": "trill", "mordent": "mordent", "inverted-mordent": "invertedMordent",
    "turn": "turn", "delayed-turn": "turn", "inverted-turn": "invertedTurn", "delayed-inverted-turn": "invertedTurn",
    "arpeggiate": "arpeggio",
}
HEADS = {"x": "x", "cross": "x", "circle-x": "x", "diamond": "diamond"}


def load_xml(path):
    """The score's XML root (also from a compressed .mxl), or None if it can't be read."""
    path = Path(path)
    try:
        if path.suffix.lower() != ".mxl":
            return strip_namespaces(ET.parse(path).getroot())
        with zipfile.ZipFile(path) as z:
            container = ET.fromstring(z.read("META-INF/container.xml"))
            rootfile = next(e for e in container.iter() if e.tag.endswith("rootfile"))
            return strip_namespaces(ET.fromstring(z.read(rootfile.get("full-path"))))
    except (OSError, ET.ParseError, KeyError, StopIteration, zipfile.BadZipFile):
        return None


def strip_namespaces(root):
    for e in root.iter():
        if isinstance(e.tag, str) and "}" in e.tag:
            e.tag = e.tag.split("}", 1)[1]
    return root


def midi_of(step, alter, octave):
    return 12 * (int(octave) + 1) + STEP_SEMITONES[step] + round(float(alter or 0))


def credit_title(root):
    """The title as printed on the page (MuseScore leaves a placeholder in the work title)."""
    if root is None:
        return None
    for credit in root.findall("credit"):
        if credit.findtext("credit-type") == "title":
            words = " ".join((w.text or "").strip() for w in credit.findall("credit-words")).strip()
            if words:
                return words
    return None


def read_details(root, n_staves):
    """Details of the first part, by measure index (in written order).

    Returns {
      "staves": {staff: {lines, tuning}}           tab staves (tuning: MIDI, lowest string first)
      "notes": {key: info}                          key: (staff, measure, offset in quarters, MIDI, is grace)
      "directions": {measure: [item]}               text and line ends, at an offset in quarters
      "open": {}                                    lines/techniques started but not yet stopped
    }
    A note's info (see note_details) has: string, fret, hidden, paren, bend, head,
    artic, marks, and events [(kind, start|stop, number, label)].
    """
    details = {"staves": {}, "notes": {}, "directions": {}, "open": {}}
    part = root.find("part") if root is not None else None
    if part is None:
        return details
    divisions = 1.0
    for mi, measure in enumerate(part.findall("measure")):
        pos = last = 0.0
        for el in measure:
            if el.tag == "attributes":
                divisions = float(el.findtext("divisions") or divisions)
                for sd in el.findall("staff-details"):
                    staff = int(sd.get("number", "1")) - 1
                    tuning = {}
                    for t in sd.findall("staff-tuning"):
                        tuning[int(t.get("line"))] = midi_of(
                            t.findtext("tuning-step"), t.findtext("tuning-alter"), t.findtext("tuning-octave"))
                    lines = int(sd.findtext("staff-lines") or len(tuning) or 6)
                    if staff < n_staves and tuning:
                        details["staves"][staff] = {"lines": lines, "tuning": [tuning[k] for k in sorted(tuning)]}
            elif el.tag == "backup":
                pos -= float(el.findtext("duration") or 0)
            elif el.tag == "forward":
                pos += float(el.findtext("duration") or 0)
            elif el.tag == "direction":
                details["directions"].setdefault(mi, []).extend(direction_items(el, pos, divisions))
            elif el.tag == "note":
                chord = el.find("chord") is not None
                start = last if chord else pos
                if not chord:
                    last = pos
                    pos += float(el.findtext("duration") or 0)
                pitch = el.find("pitch")
                if pitch is None:
                    continue
                staff = int(el.findtext("staff") or 1) - 1
                midi = midi_of(pitch.findtext("step"), pitch.findtext("alter"), pitch.findtext("octave"))
                key = (staff, mi, round(start / divisions, 4), midi, el.find("grace") is not None)
                info = note_details(el)
                if info:
                    details["notes"][key] = info
    return details


def note_details(note):
    info = {"events": [], "artic": [], "marks": []}
    head = note.find("notehead")
    if head is not None:
        if head.get("parentheses") == "yes":
            info["paren"] = True
        if (head.text or "").strip() in HEADS:
            info["head"] = HEADS[head.text.strip()]
    add = lambda key, value: value in info[key] or info[key].append(value)
    for notations in note.findall("notations"):
        tech = notations.find("technical")
        if tech is not None and tech.findtext("string") and tech.findtext("fret"):
            info["string"] = int(tech.findtext("string"))
            info["fret"] = int(tech.findtext("fret"))
            if notations.get("print-object") == "no":
                info["hidden"] = True
        bend = tech.find("bend") if tech is not None else None
        if bend is not None and bend.findtext("bend-alter"):
            alter = float(bend.findtext("bend-alter"))
            info["bend"] = -abs(alter) if bend.find("release") is not None else alter
        printed = notations.get("print-object") != "no"
        # (MuseScore writes hammer-ons/pull-offs directly under <notations>; the standard puts them in <technical>.)
        for e in notations.iter():
            text = (e.text or "").strip()
            if e.tag in TECHNIQUES and e.get("type") in ("start", "stop"):
                label = text if e.tag in ("hammer-on", "pull-off") else ""
                info["events"].append((TECHNIQUES[e.tag], e.get("type"), e.get("number", "1"), label or TECHNIQUES[e.tag]))
            elif not printed:
                continue
            elif e.tag in ARTICULATIONS:
                add("artic", ARTICULATIONS[e.tag])
            elif e.tag in MARKS:
                add("marks", MARKS[e.tag])
            elif e.tag == "fingering" and text:
                add("marks", f"finger:{text}")
            elif e.tag == "pluck" and text:
                add("marks", f"pluck:{text}")
            elif e.tag == "tremolo" and e.get("type", "single") == "single":
                add("marks", f"tremolo:{text or 3}")
    if any(info[k] for k in ("events", "artic", "marks")) or len(info) > 3:
        return info
    return None


def direction_items(direction, pos, divisions):
    """The text and line ends in one <direction>, at its offset in the measure."""
    staff = int(direction.findtext("staff") or 1) - 1
    at = (pos + float(direction.findtext("offset") or 0)) / divisions
    words = []
    style = None
    items = []
    for dt in direction.findall("direction-type"):
        for c in dt:
            text = (c.text or "").strip()
            if c.tag == "words" and text:
                words.append(text)
                style = style or ("italic" if c.get("font-style") == "italic"
                                  else "bold" if c.get("font-weight") == "bold" else "plain")
            elif c.tag == "rehearsal" and text:
                items.append({"kind": "rehearsal", "text": text})
            elif c.tag in ("segno", "coda"):
                items.append({"kind": c.tag})
            elif c.tag == "metronome" and c.findtext("beat-unit") and c.findtext("per-minute"):
                items.append({"kind": "tempo", "unit": c.findtext("beat-unit"),
                              "dots": len(c.findall("beat-unit-dot")), "bpm": c.findtext("per-minute").strip()})
            elif c.tag in ("bracket", "dashes") and c.get("type") in ("start", "stop"):
                items.append({"kind": "line", "type": c.get("type"), "number": c.get("number", "1"),
                              "hook": c.get("line-end", "none"),
                              "dashed": c.tag == "dashes" or c.get("line-type", "solid") != "solid"})
            elif c.tag == "pedal" and c.get("type") in ("start", "stop", "change"):
                items.append({"kind": "pedal", "type": c.get("type"), "number": "1",
                              "line": c.get("line") == "yes", "sign": c.get("sign") != "no"})
    text = " ".join(words)
    if text:
        # Words that start a line ("let ring ----") label it; with a tempo mark ("Allegro ♩=120") they go first.
        labeled = next((i for i in items if i["kind"] in ("line", "pedal", "tempo") and i.get("type", "start") == "start"), None)
        if labeled:
            labeled.update(label=text, style=style)
        else:
            items.append({"kind": "words", "text": text, "style": style})
    for i in items:
        i.update(staff=staff, at=round(at, 4), placement=direction.get("placement"))
    return items


def emit_directions(details, mi, offset, out, n_staves):
    """Adds measure `mi`'s text to out["texts"] and closes its lines into out["lines"] (beats from `offset`)."""
    open_lines = details["open"]
    for d in details["directions"].get(mi, []):
        if d["staff"] >= n_staves:
            continue
        beat = round(offset + d["at"], 6)
        if d["kind"] in ("words", "rehearsal", "segno", "coda", "tempo"):
            keep = ("text", "style", "unit", "dots", "bpm", "label")
            out["texts"].append({"kind": d["kind"], "staff": d["staff"], "beat": beat, "placement": d["placement"],
                                 **{k: d[k] for k in keep if k in d}})
            continue
        key = ("direction", d["kind"], d["number"], d["staff"])
        if d["type"] in ("stop", "change") and key in open_lines:
            line = open_lines.pop(key)
            out["lines"].append({**line, "end": beat, "endHook": d.get("hook", "none" if d["kind"] == "line" else "up")})
        if d["type"] in ("start", "change"):
            open_lines[key] = {
                "kind": d["kind"], "staff": d["staff"], "start": beat, "placement": d["placement"],
                "label": d.get("label"), "style": d.get("style"), "dashed": d.get("dashed", False),
                "startHook": d.get("hook", "none"), "line": d.get("line", True), "sign": d.get("sign", False),
            }
