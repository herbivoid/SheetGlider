import { SHAPE_TWEAK_DEFAULTS } from "./presets.js";

// Every user setting, with its default.
export const params = {
  // Character & font
  character: "clawd",   // a folder in characters/, or a custom character's id
  musicFont: "Bravura",
  // Look
  staffColor: "#f4efe6",
  noteColor: "#f4efe6",
  playedColor: "#f4efe6",
  glowColor: "#d97757",
  lineThickness: 0.13,
  characterSize: 3.0,
  glowSize: 3.4,
  glowStrength: 0.9,
  glowDecay: 0.35,
  // Particles
  burstCount: 6,
  trailRate: 70,
  particleSize: 0.35,
  sparkStyle: "light",  // "light" (glow layer, additive) or "paint" (solid, in the main video)
  sparkWhiteness: 0.15, // how far sparks may be mixed toward white (0 = all glow color)
  sparkBrightness: 1,   // light style only
  // Notation
  showDynamics: true,
  showArticulations: true,
  showLyrics: true,
  lyricsSize: 1,
  tails: true,          // duration tails on long notes
  tailMin: 2,           // beats (quarter notes): half notes and longer get a tail
  tailOpacity: 0,       // the bar itself; 0 = only its light shows, once the character reaches it
  // Depth fog: things fade out with distance (multiples of the camera distance)
  fog: false,
  fogStart: 1.15,
  fogEnd: 2.6,
  // Spacing
  quarterWidth: 4.5,
  spacingExponent: 0.65,
  speedSmoothing: 0.75,
  barGap: 2.2,
  repeats: true,      // play repeats (and 1st/2nd endings) as performed
  // Ribbon
  preset: "twist",
  readability: 0.6,
  flipSharpness: 0.2,
  ...SHAPE_TWEAK_DEFAULTS,
  // Character
  follow: 0,          // staff index to follow, or "top" for the highest note
  hopHeight: 3,
  hopFraction: 0.6,
  hopMin: 0.08,
  hopMax: 0.42,
  restLift: 2.5,
  restThreshold: 0.35,
  squash: 1,
  lean: 1,
  cheerMin: 0.75,     // seconds: notes at least this long get the "hit" celebration
  fastNote: 0.22,     // seconds: notes closer together than this count as fast
  minRunNotes: 3,     // this many fast notes in a row make a run (surfed, not hopped)
  surfLean: 0.12,
  dynamicsEffect: 0.6,  // how much louder notes glow/hop/spark more (0 = ignore dynamics)
  ghosts: "same staff", // chord clones: "off", "same staff", "all staves"
  ghostOpacity: 0.7,
  maxGhosts: 4,
  // Camera
  camDistance: 50,
  fov: 30,
  pitch: 6,
  yaw: 0,
  roll: 0,
  lead: 0.12,
  followY: 0.35,
  camSmooth: 0.7,
  // Timing
  bpm: 112,
  preroll: 1.5,
  postroll: 2,
  // Preview
  background: "checker",
  sound: true,
  // Export
  resolution: "1920x1080",
  fps: 60,
  format: "prores",
  exportAudio: true,
  glowLayer: false,   // export the glow as its own file (for an "Add" blend in the editor)
  exportTrack: false, // also save the character's on-screen position per frame (.csv)
};

export const DEFAULTS = Object.freeze({ ...params });

export const RESOLUTIONS = {
  "1280x720": [1280, 720], "1920x1080": [1920, 1080], "2560x1440": [2560, 1440],
  "3840x2160": [3840, 2160], "1080x1920 (vertical)": [1080, 1920], "1080x1080": [1080, 1080],
};
