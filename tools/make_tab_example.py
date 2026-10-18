"""Writes examples/guitar-tab-example.musicxml: a short A minor pentatonic lick
on a tab staff, exercising what SheetGlider draws for guitar tab (bends held
and released, hammer-ons, pull-offs, slides, ties, triplets, a chord).

    python tools/make_tab_example.py [output path]

Edit BARS below to change the lick; pitches are worked out from string + fret.
"""
import sys
from pathlib import Path
from xml.dom import minidom
from xml.sax.saxutils import escape

TUNING = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}  # string -> open MIDI pitch
DIV = 12  # divisions per quarter
DUR = {"16t": (2, "16th", True), "8t": (4, "eighth", True), "16": (3, "16th", False), "8": (6, "eighth", False),
       "q": (12, "quarter", False), "h": (24, "half", False), "w": (48, "whole", False)}
SPELL_SHARP = ["C", ("C", 1), "D", ("D", 1), "E", "F", ("F", 1), "G", ("G", 1), "A", ("A", 1), "B"]
SPELL_FLAT = ["C", ("D", -1), "D", ("E", -1), "E", "F", ("G", -1), "G", ("A", -1), "A", ("B", -1), "B"]


def N(string, fret, dur, **kw):
    """One note (or a chord with extra=[(string, fret), ...]). Options:
    bend (semitones), release (semitones), hidden (+ at: its bent pitch), paren, H/P/slide ('start'/'stop'/'both'),
    tie ('start'/'stop'), tuplet ('start'/'stop'), dyn."""
    return dict(string=string, fret=fret, dur=dur, **kw)


BARS = [
    # 1: bend and release, pull-off, hammer-on
    [N(3, 7, "8", bend=2, dyn="mf"), N(3, 7, "8", hidden=True, at=2, release=2), N(3, 7, "8", paren=True, P="start"),
     N(3, 5, "8", P="stop"), N(4, 7, "q"), N(4, 5, "8", H="start"), N(4, 7, "8", H="stop")],
    # 2: 16th-triplet pull-offs down the box, then a slide
    [N(1, 8, "16t", P="start", tuplet="start"), N(1, 5, "16t", P="stop"), N(2, 8, "16t", P="start", tuplet="stop"),
     N(2, 5, "16t", P="stop", tuplet="start"), N(3, 7, "16t", P="start"), N(3, 5, "16t", P="stop", tuplet="stop"),
     N(4, 7, "16t", P="start", tuplet="start"), N(4, 5, "16t", P="stop"), N(5, 7, "16t", P="start", tuplet="stop"),
     N(5, 5, "16t", P="stop", tuplet="start"), N(4, 7, "16t"), N(4, 5, "16t", tuplet="stop"),
     N(5, 5, "8", slide="start"), N(5, 7, "8", slide="stop"), N(4, 7, "q", tie="start")],
    # 3: tied over, hammer-on
    [N(4, 7, "h", tie="stop"), N(3, 5, "8", H="start"), N(3, 7, "8", H="stop"), N(2, 5, "q")],
    # 4: double stop with a held bend, then the target note
    [N(2, 8, "q", bend=2, extra=[(1, 8)]), N(2, 8, "q", hidden=True, at=2), N(1, 5, "h")],
    # 5: the shred: 16ths up the box, sliding into the top
    [N(6, 5, "16", dyn="f"), N(6, 8, "16"), N(5, 5, "16"), N(5, 7, "16"),
     N(4, 5, "16"), N(4, 7, "16"), N(3, 5, "16"), N(3, 7, "16"),
     N(2, 5, "16"), N(2, 8, "16"), N(1, 5, "16"), N(1, 8, "16"),
     N(1, 8, "8", slide="start"), N(1, 10, "8", slide="stop")],
    # 6: half-step bend and release, pull-off, then down
    [N(1, 10, "q", bend=1), N(1, 10, "8", hidden=True, at=1, release=1), N(1, 10, "8", paren=True, P="start"),
     N(1, 8, "8", P="stop"), N(2, 10, "8"), N(2, 8, "q")],
    # 7: triplet eighths, then slide down into the last chord
    [N(3, 7, "8t", tuplet="start"), N(2, 5, "8t"), N(1, 5, "8t", tuplet="stop"),
     N(1, 8, "8t", tuplet="start"), N(1, 5, "8t"), N(2, 8, "8t", tuplet="stop"),
     N(2, 5, "q"), N(4, 9, "q", slide="start")],
    # 8: A minor, let it ring
    [N(4, 7, "w", slide="stop", extra=[(3, 5), (2, 5)])],
]


def pitch_xml(midi, flats):
    name = (SPELL_FLAT if flats else SPELL_SHARP)[midi % 12]
    step, alter = (name, 0) if isinstance(name, str) else name
    octave = midi // 12 - 1
    alter_xml = f"<alter>{alter}</alter>" if alter else ""
    return f"<pitch><step>{step}</step>{alter_xml}<octave>{octave}</octave></pitch>"


def beams_for(bar):
    """Beam each beat's eighths/16ths together (MusicXML begin/continue/end)."""
    out = [dict() for _ in bar]
    pos = 0
    groups = {}
    for i, n in enumerate(bar):
        div, typ, _ = DUR[n["dur"]]
        if typ in ("eighth", "16th"):
            groups.setdefault(pos // DIV, []).append(i)
        pos += div
    for idx in groups.values():
        if len(idx) < 2:
            continue
        for level in (1, 2):
            run = [i for i in idx if level == 1 or DUR[bar[i]["dur"]][1] == "16th"]
            if len(run) < 2:
                continue
            for k, i in enumerate(run):
                out[i][level] = "begin" if k == 0 else "end" if k == len(run) - 1 else "continue"
    return out


def note_xml(n, string, fret, chord, beams, flats):
    div, typ, triplet = DUR[n["dur"]]
    midi = TUNING[string] + fret + (n.get("at", 0) if not chord else 0)  # at: a hidden note's bent pitch
    x = ["<note>"]
    if chord:
        x.append("<chord/>")
    x.append(pitch_xml(midi, flats))
    x.append(f"<duration>{div}</duration>")
    if not chord and n.get("tie"):
        x.append(f'<tie type="{n["tie"]}"/>')
    x.append("<voice>1</voice>")
    x.append(f"<type>{typ}</type>")
    if triplet:
        x.append("<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>")
    x.append("<stem>down</stem>")
    if n.get("paren") and not chord:
        x.append('<notehead parentheses="yes">normal</notehead>')
    for level, kind in sorted(beams.items()):
        if not chord:
            x.append(f'<beam number="{level}">{kind}</beam>')
    notations = []
    if not chord:
        if n.get("tie"):
            notations.append(f'<tied type="{n["tie"]}"/>')
        if n.get("tuplet"):
            notations.append(f'<tuplet type="{n["tuplet"]}" bracket="no"/>')
        if n.get("slide"):
            notations.append(f'<slide type="{n["slide"]}" line-type="solid" number="1"/>')
    tech = [f"<string>{string}</string><fret>{fret}</fret>"]
    if not chord:
        for tag, key in (("hammer-on", "H"), ("pull-off", "P")):
            if n.get(key):
                text = key if n[key] == "start" else ""
                tech.append(f'<{tag} type="{n[key]}" number="1">{text}</{tag}>')
        if n.get("bend"):
            tech.append(f"<bend><bend-alter>{n['bend']}</bend-alter></bend>")
        if n.get("release"):
            tech.append(f"<bend><bend-alter>-{n['release']}</bend-alter><release/></bend>")
    hidden = ' print-object="no"' if n.get("hidden") else ""
    notations_xml = "".join(notations)
    x.append(f"<notations{hidden}>{notations_xml}<technical>{''.join(tech)}</technical></notations>")
    x.append("</note>")
    return "".join(x)


def main(path):
    measures = []
    for bi, bar in enumerate(BARS, 1):
        parts = [f'<measure number="{bi}">']
        if bi == 1:
            tuning = "".join(
                f'<staff-tuning line="{line}"><tuning-step>{step}</tuning-step><tuning-octave>{octave}</tuning-octave></staff-tuning>'
                for line, (step, octave) in enumerate([("E", 2), ("A", 2), ("D", 3), ("G", 3), ("B", 3), ("E", 4)], 1))
            parts.append(
                f"<attributes><divisions>{DIV}</divisions><key print-object=\"no\"><fifths>0</fifths><mode>minor</mode></key>"
                "<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef>"
                f"<staff-details><staff-lines>6</staff-lines>{tuning}</staff-details></attributes>")
            parts.append('<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                         '<per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>')
        beams = beams_for(bar)
        for n, b in zip(bar, beams):
            if n.get("dyn"):
                parts.append(f'<direction placement="below"><direction-type><dynamics><{n["dyn"]}/></dynamics>'
                             f'</direction-type></direction>')
            flats = bi == 6  # the blue note bent to in bar 6 is an E flat
            parts.append(note_xml(n, n["string"], n["fret"], False, b, flats))
            for s, f in n.get("extra", []):
                parts.append(note_xml(n, s, f, True, b, flats))
        if bi == len(BARS):
            parts.append('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
        parts.append("</measure>")
        measures.append("".join(parts))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">\n'
           '<score-partwise version="4.0">'
           f"<work><work-title>{escape('Guitar tab example')}</work-title></work>"
           "<identification><creator type=\"composer\">SheetGlider</creator></identification>"
           '<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>'
           '<part id="P1">' + "\n".join(measures) + "</part></score-partwise>\n")
    with open(path, "wb") as f:
        f.write(minidom.parseString(xml).toprettyxml(indent="  ", encoding="UTF-8"))


if __name__ == "__main__":
    default = Path(__file__).resolve().parent.parent / "examples" / "guitar-tab-example.musicxml"
    main(sys.argv[1] if len(sys.argv) > 1 else default)
