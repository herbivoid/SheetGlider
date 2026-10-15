# SheetGlider

A character glides along a staff of sheet music that's laid on a 3D ribbon, hopping onto each note in time with the music. It renders to video with a transparent background, so you can put it over other footage.

## Run

Needs Python 3.10+ and ffmpeg on your PATH, plus music21 for reading MusicXML:

```bash
python -m pip install music21
```

```bash
python run.py
```

This opens `http://127.0.0.1:8765/app/` in your browser. Settings are in the panel on the right; **Export video** is at the bottom. Exports go to `output/`.

## Music input

Load a **MusicXML** file (`.musicxml`, `.xml`, or compressed `.mxl`) with **Load MusicXML…** or by dropping it on the page. MuseScore (free) and every other notation program can export MusicXML. MuseScore can also open a MIDI file and save it as MusicXML.

- One instrument is used: a single staff, or both staves of a piano part.
- The tempo comes from the file's metronome marks (tempo changes included). The **tempo** setting scales it.
- **Clawd follows** picks the top staff, the bottom staff, or the highest note.
- **Play repeats** (on by default) plays repeats and 1st/2nd endings as performed. Turn it off to play straight through as written.

Notation drawn:
- notes, chords (seconds offset, accidentals stacked) and rests
- beams (as in the file, or automatic when the file has none), flags, dots and ledger lines
- ties, slurs, and tuplet numbers and brackets
- grace notes (shown small, played just before their main note)
- clef, key and time signature changes

Not drawn yet: dynamics, articulations, lyrics, repeat signs.

Examples in `examples/`:
- `piano-example.musicxml`: a short grand-staff piece
- `notation-test.musicxml`: exercises all of the notation above

## Output formats

| Format | Use it for |
|---|---|
| **ProRes 4444 (.mov)** | Video editors (DaVinci Resolve, Premiere, Final Cut). Large files, best compatibility. |
| WebM VP9 with alpha | Web, OBS, browsers. Small files, slow to encode. |
| PNG sequence | Fallback that every editor can import. |

With **also save score audio** on, a `.wav` of the preview synth is saved next to the video. It's lined up with the video, lead-in included.

**DaVinci Resolve:** if the background shows black instead of transparent, right-click the clip in the Media Pool, choose **Clip Attributes…**, and set **Alpha Mode** to *Straight*.

## Ribbon shapes

Pick a **shape** preset: flat, arch, valley, waterslide, approach, fly-in, fly-away, swoop, slalom, twist, barrel-roll, corkscrew, rollercoaster, gentle-waves, coaster-flip, wild-coaster, carousel, loop, spiral.

**Shape tweaks** layer on top of any preset:
- height ×, depth ×, and the shape's own twist ×
- an arch
- extra waves
- two extra twists, each placed anywhere along the piece (0 = start, 1 = end) and spread over any length

## Custom characters

A character is a folder in `characters/` holding `character.json` and up to 6 images:

| Sprite | When it's shown |
|---|---|
| `glide` | In the air, and standing on short notes (required; stands in for any missing sprite) |
| `crouch` | Just before a jump, and landing on a short note |
| `hit` | Landing on a long note: a little celebration |
| `ride` | Holding a long note |
| `rest` | Floating during rests |
| `surf` | Gliding through a fast run (falls back to `ride`) |

In `character.json`, `anchor` is the point that touches the note, as fractions from the bottom-left of the image (`[0.5, 0]` means bottom-center). Set `pixelArt: true` to keep pixel art crisp. Clawd's sprites are generated from the ASCII grids in `tools/make_clawd.py`; edit those and re-run the script to change him.

**Motion** settings control:
- which notes count as **long** (*celebrate notes ≥*, in seconds)
- which count as **fast** (*fast note <*)
- how many fast notes in a row make a **run** that gets surfed instead of hopped

All of these are based on real time, so the tempo matters as well as the note type.

## Credits

Music glyphs: [Bravura](https://github.com/steinbergmedia/bravura) by Steinberg, under the SIL Open Font License (`app/fonts/Bravura-LICENSE.txt`).
