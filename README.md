# SheetGlider

A character glides along a staff of sheet music that's laid on a 3D ribbon, hopping onto each note in time with the music. It renders to video with a transparent background, so you can put it over other footage.

## Run

Needs Python 3.10+ and ffmpeg on your PATH. Nothing to install with pip yet.

```bash
python run.py
```

This opens `http://127.0.0.1:8765/app/` in your browser. Settings are in the panel on the right; **Export video** is at the bottom. Exports go to `output/`.

## Output formats

| Format | Use it for |
|---|---|
| **ProRes 4444 (.mov)** | Video editors (DaVinci Resolve, Premiere, Final Cut). Large files, best compatibility. |
| WebM VP9 with alpha | Web, OBS, browsers. Small files, slow to encode. |
| PNG sequence | Fallback that every editor can import. |

**DaVinci Resolve:** if the background shows black instead of transparent, right-click the clip in the Media Pool, choose **Clip Attributes…**, and set **Alpha Mode** to *Straight*.

## Custom characters

A character is a folder in `characters/` holding `character.json` and up to 5 images:

| Sprite | When it's shown |
|---|---|
| `glide` | In the air between notes (required; used for any missing sprite) |
| `anticipate` | Crouch just before a jump |
| `hit` | Landing on a note |
| `ride` | Holding a long note |
| `rest` | Floating during rests |

In `character.json`, `anchor` is the point that touches the note, as fractions from the bottom-left of the image (`[0.5, 0]` means bottom-center). Set `pixelArt: true` to keep pixel art crisp. Clawd's sprites are generated from the ASCII grids in `tools/make_clawd.py`; edit those and re-run the script to change him.

## Status

Phase 0 is a pipeline proof. It uses a built-in demo melody, five preset ribbon shapes, and a preview synth.

Next up:
- Phase 1: MusicXML input, Bravura music font, grand staff
- Phase 2: a curve editor for designing the ribbon
- Phase 3: polish (glow layer, ghost clones, beams, ties)
