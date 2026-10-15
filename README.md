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

**Glow as separate layer:** exports two files, the video without glow, and `…_glow` with only the hit glow (and the sparks, in *light* spark style), as light on black. In your editor, put the glow file on the track above the main video and set its composite/blend mode to **Add** (or **Screen**). That makes it brighten the footage like real light, instead of sitting on top as a semi-transparent smudge. In DaVinci Resolve, the setting is **Composite Mode** in the Inspector. Left on *Normal*, the glow layer would cover everything with black.

**Spark style** (under Look):
- *light*: sparks are glowing light on the glow layer. Best over darker footage. Added light can only brighten, so over very bright footage they turn white.
- *paint*: solid pixels in the main video that blink out at the end. They keep their color over any footage, so use this one for bright scenes.

**DaVinci Resolve:** if the background shows black instead of transparent, right-click the clip in the Media Pool, choose **Clip Attributes…**, and set **Alpha Mode** to *Straight*.

## Ribbon shapes

Pick a **shape** preset: flat, arch, valley, waterslide, approach, fly-in, fly-away, swoop, slalom, twist, barrel-roll, corkscrew, rollercoaster, gentle-waves, coaster-flip, wild-coaster, carousel, loop, spiral.

**Shape tweaks** layer on top of any preset:
- height ×, depth ×, and the shape's own twist ×
- an arch
- extra waves
- two extra twists, each placed anywhere along the piece (0 = start, 1 = end) and spread over any length

## Characters

Pick one in the **Character** panel. There are two ways to add your own:

- **Load custom character…**: select the character's PNG images, plus its `character.json` if it has one. They're read in the browser and kept in that browser's own storage on your computer. Nothing is uploaded anywhere. Limits: PNG only, at most 4 MB and 2048×2048 pixels per image.
- **Built-in:** put a folder in `characters/` (like `characters/clawd/`). It shows up in the list for everyone using this copy of the app.

A character has up to 6 images:

| Sprite | When it's shown |
|---|---|
| `glide` | In the air, and standing on short notes (required; stands in for any missing sprite) |
| `crouch` | Just before a jump, and landing on a short note |
| `hit` | Landing on a long note: a little celebration |
| `ride` | Holding a long note |
| `rest` | Floating during rests |
| `surf` | Gliding through a fast run (falls back to `ride`) |

Name the images after their state (`glide.png`, `hit.png`, …). A single image works too: it's used for everything.

`character.json` is optional. It can hold:
- `name`
- `anchor`: the point that touches the note, as fractions from the bottom-left of the image (`[0.5, 0]` means bottom-center, the default)
- `pixelArt: true`: keeps pixel art crisp. Without it, images up to 256 pixels are treated as pixel art.
- `sprites`: maps states to file names

Clawd's sprites are generated from the ASCII grids in `tools/make_clawd.py`; edit those and re-run the script to change him.

**Motion** settings control:
- which notes count as **long** (*celebrate notes ≥*, in seconds)
- which count as **fast** (*fast note <*)
- how many fast notes in a row make a **run** that gets surfed instead of hopped

All of these are based on real time, so the tempo matters as well as the note type.

**Chord clones:** when the character lands on a chord, see-through clones split off, land on the other notes of the chord, fan out so they don't pile up, then merge back into him. They can come from the same staff or from every staff, or be turned off. You can also set how many clones a chord gets and how see-through they are.

## Music fonts

Under **Look → music font**:
- **Bravura:** classic engraving
- **Leland:** MuseScore's look
- **Petaluma:** handwritten, jazz-chart style

## Looks

A *look* is all your visual settings: shape, tweaks, colors, motion, camera, character, music font. Settings tied to a particular score (tempo, followed staff, repeats), the preview, and the export aren't part of it.

- **Save look… / Load look…** (in **Looks**) write and read a small `.sheetglider-look.json` file, to reuse on another song or share.
- The app also remembers your last look in the browser, so it comes back next time.
- **Reset look to defaults** starts fresh.
- A loaded look only takes settings it recognizes, with valid values. If it uses a custom character this browser doesn't have, you get the default character.

## Credits

Music fonts, all under the SIL Open Font License (license files in `app/fonts/`):
- [Bravura](https://github.com/steinbergmedia/bravura) and [Petaluma](https://github.com/steinbergmedia/petaluma) by Steinberg
- [Leland](https://github.com/musescore/MuseScore/tree/main/fonts/leland) by MuseScore
