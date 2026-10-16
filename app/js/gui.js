import GUI from "lil-gui";
import { RIBBON_PRESETS, SHAPE_TWEAK_DEFAULTS } from "./presets.js";
import { RESOLUTIONS } from "./params.js";
import { MUSIC_FONTS } from "./glyphs.js";

// Allowed values for settings picked from a list (also used to check loaded looks).
export const CHOICES = {
  preset: Object.keys(RIBBON_PRESETS),
  musicFont: Object.keys(MUSIC_FONTS),
  ghosts: ["off", "same staff", "all staves"],
  sparkStyle: ["light", "paint"],
};

// The settings panel. `actions` supplies the callbacks:
//   rebuild(), setBackground(), loadFile(), useDemo(), reloadFile(), exportVideo(),
//   restyleStaff(color), setCharacter(id), importCharacter(), removeCharacter(),
//   setMusicFont(name), saveLook(), loadLook(), resetLook(), remember()
export function buildGui(params, actions) {
  const gui = new GUI({ title: "SheetGlider" });
  const re = () => actions.rebuild();
  gui.onFinishChange(() => actions.remember());

  const music = gui.addFolder("Music");
  const scoreInfo = { name: "demo melody" };
  music.add(scoreInfo, "name").name("score").disable();
  music.add({ load: actions.loadFile }, "load").name("📂 Load MusicXML…");
  music.add({ demo: actions.useDemo }, "demo").name("Use demo melody");
  music.add(params, "repeats").name("play repeats").onChange(actions.reloadFile);
  const bpm = music.add(params, "bpm", 20, 300, 1).name("tempo (bpm)").onFinishChange(re);
  music.add(params, "follow", { "top staff": 0, "bottom staff": 1, "highest note": "top" })
    .name("character follows").onChange(re);

  const who = gui.addFolder("Character");
  let characterPicker = who.add(params, "character", {}).name("character");
  const removeBtn = who.add({ remove: actions.removeCharacter }, "remove").name("Remove this custom character");
  who.add({ add: actions.importCharacter }, "add").name("🖼 Load custom character…");
  const setCharacterOptions = (builtin, custom) => {
    const options = {};
    for (const c of builtin) options[c.name] = c.id;
    for (const c of custom) options[`${c.name} (custom)`] = c.id;
    // options() replaces the dropdown (appending it last), so move it back to the top.
    characterPicker = characterPicker.options(options).name("character").onChange(id => actions.setCharacter(id));
    characterPicker.domElement.parentElement.prepend(characterPicker.domElement);
    removeBtn.show(params.character.startsWith("custom-"));
  };

  const look = gui.addFolder("Look");
  look.add(params, "musicFont", CHOICES.musicFont).name("music font").onChange(name => actions.setMusicFont(name));
  look.addColor(params, "staffColor").name("staff color").onChange(c => actions.restyleStaff(c));
  look.addColor(params, "noteColor").name("note color").onFinishChange(re);
  look.addColor(params, "playedColor").name("played note color");
  look.addColor(params, "glowColor").name("hit glow color").onFinishChange(re);
  look.add(params, "characterSize", 0.5, 15, 0.1).name("character size");
  look.add(params, "glowSize", 0, 20, 0.1).name("glow size");
  look.add(params, "glowStrength", 0, 1, 0.01).name("glow strength");
  look.add(params, "glowDecay", 0.05, 2, 0.01).name("glow decay (s)");
  look.add(params, "lineThickness", 0.04, 0.5, 0.01).name("line thickness").onFinishChange(re);
  look.add(params, "burstCount", 0, 30, 1).name("landing sparks");
  look.add(params, "trailRate", 0, 300, 5).name("surf trail sparks/s");
  look.add(params, "particleSize", 0.1, 1.5, 0.05).name("spark size");
  look.add(params, "sparkStyle", { "light (glow layer)": "light", "paint (solid)": "paint" }).name("spark style");
  look.add(params, "sparkWhiteness", 0, 1, 0.01).name("spark whiteness");
  look.add(params, "sparkBrightness", 0.1, 1, 0.01).name("spark brightness");
  look.close();

  const notation = gui.addFolder("Notation");
  notation.add(params, "showDynamics").name("dynamics & hairpins").onChange(re);
  notation.add(params, "showArticulations").name("articulations & fermatas").onChange(re);
  notation.add(params, "showLyrics").name("lyrics").onChange(re);
  notation.add(params, "lyricsSize", 0.5, 2.5, 0.05).name("lyrics size").onFinishChange(re);
  notation.add(params, "tails").name("duration tails").onChange(re);
  notation.add(params, "tailMin", 0.5, 8, 0.25).name("tails on notes ≥ (beats)").onFinishChange(re);
  notation.add(params, "tailOpacity", 0.05, 1, 0.01).name("tail opacity");
  notation.close();

  const fog = gui.addFolder("Depth fog");
  fog.add(params, "fog").name("fade with distance").onChange(re);
  fog.add(params, "fogStart", 0.5, 5, 0.05).name("starts at (× camera dist.)").onFinishChange(re);
  fog.add(params, "fogEnd", 0.6, 8, 0.05).name("gone at (× camera dist.)").onFinishChange(re);
  fog.close();

  const ribbon = gui.addFolder("Ribbon");
  ribbon.add(params, "preset", Object.keys(RIBBON_PRESETS)).name("shape").onChange(re);
  ribbon.add(params, "readability", 0, 1, 0.01).name("edge-on readability");
  ribbon.add(params, "flipSharpness", 0.02, 0.6, 0.01).name("flip width");
  const tweaks = ribbon.addFolder("Shape tweaks");
  tweaks.add(params, "heightScale", -3, 3, 0.05).name("height ×").onFinishChange(re);
  tweaks.add(params, "depthScale", -3, 3, 0.05).name("depth ×").onFinishChange(re);
  tweaks.add(params, "twistScale", -2, 2, 0.05).name("shape's twist ×").onFinishChange(re);
  tweaks.add(params, "arch", -80, 80, 1).name("arch").onFinishChange(re);
  tweaks.add(params, "waveHeight", 0, 30, 0.5).name("extra waves: height").onFinishChange(re);
  tweaks.add(params, "waveDepth", 0, 40, 0.5).name("extra waves: depth").onFinishChange(re);
  tweaks.add(params, "waveCount", 0.5, 10, 0.5).name("extra waves: count").onFinishChange(re);
  tweaks.add(params, "twist1", -720, 720, 15).name("extra twist A (°)").onFinishChange(re);
  tweaks.add(params, "twist1At", 0, 1, 0.01).name("  … at (0–1)").onFinishChange(re);
  tweaks.add(params, "twist1Over", 0.01, 1, 0.01).name("  … over (0–1)").onFinishChange(re);
  tweaks.add(params, "twist2", -720, 720, 15).name("extra twist B (°)").onFinishChange(re);
  tweaks.add(params, "twist2At", 0, 1, 0.01).name("  … at (0–1)").onFinishChange(re);
  tweaks.add(params, "twist2Over", 0.01, 1, 0.01).name("  … over (0–1)").onFinishChange(re);
  tweaks.add({
    reset() {
      Object.assign(params, SHAPE_TWEAK_DEFAULTS);
      tweaks.controllers.forEach(c => c.updateDisplay());
      re();
    },
  }, "reset").name("Reset tweaks");
  tweaks.close();

  const spacing = gui.addFolder("Spacing");
  spacing.add(params, "quarterWidth", 1, 20, 0.1).name("quarter note width").onFinishChange(re);
  spacing.add(params, "spacingExponent", 0.2, 1, 0.01).name("time → space exponent").onFinishChange(re);
  spacing.add(params, "speedSmoothing", 0, 6, 0.05).name("speed smoothing (beats)").onFinishChange(re);
  spacing.close();

  const motion = gui.addFolder("Motion");
  motion.add(params, "hopHeight", 0, 15, 0.1).name("hop height").onFinishChange(re);
  motion.add(params, "hopMax", 0.15, 1.5, 0.01).name("max hop time (s)").onFinishChange(re);
  motion.add(params, "restLift", 0, 10, 0.1).name("float during rests").onFinishChange(re);
  motion.add(params, "squash", 0, 2, 0.05).name("squash & stretch");
  motion.add(params, "lean", 0, 3, 0.05).name("lean");
  motion.add(params, "cheerMin", 0.1, 4, 0.05).name("celebrate notes ≥ (s)").onFinishChange(re);
  motion.add(params, "fastNote", 0.05, 0.6, 0.01).name("fast note < (s)").onFinishChange(re);
  motion.add(params, "minRunNotes", 2, 12, 1).name("notes to make a run").onFinishChange(re);
  motion.add(params, "surfLean", -0.5, 0.8, 0.01).name("surf lean");
  motion.add(params, "dynamicsEffect", 0, 1.5, 0.05).name("dynamics affect motion").onFinishChange(re);
  motion.add(params, "ghosts", ["off", "same staff", "all staves"]).name("chord clones").onChange(re);
  motion.add(params, "maxGhosts", 1, 8, 1).name("max clones per chord").onFinishChange(re);
  motion.add(params, "ghostOpacity", 0.1, 1, 0.05).name("clone opacity");
  motion.close();

  const cam = gui.addFolder("Camera");
  cam.add(params, "camDistance", 5, 400, 1).name("distance").onFinishChange(re);
  cam.add(params, "fov", 5, 110, 1).name("field of view").onFinishChange(re);
  cam.add(params, "pitch", -85, 85, 1).name("pitch (°)");
  cam.add(params, "yaw", -180, 180, 1).name("yaw (°)").onFinishChange(re);
  cam.add(params, "roll", -180, 180, 1).name("roll (°)");
  cam.add(params, "lead", -0.5, 0.5, 0.01).name("look ahead").onFinishChange(re);
  cam.add(params, "followY", 0, 1, 0.01).name("follow vertically").onFinishChange(re);
  cam.add(params, "camSmooth", 0.1, 5, 0.05).name("responsiveness").onFinishChange(re);
  cam.close();

  const timing = gui.addFolder("Timing");
  timing.add(params, "preroll", 0, 10, 0.1).name("lead-in (s)").onFinishChange(re);
  timing.add(params, "postroll", 0, 10, 0.1).name("tail (s)").onFinishChange(re);
  timing.close();

  const looks = gui.addFolder("Looks");
  looks.add({ save: actions.saveLook }, "save").name("💾 Save look…");
  looks.add({ load: actions.loadLook }, "load").name("📂 Load look…");
  looks.add({ reset: actions.resetLook }, "reset").name("Reset look to defaults");
  looks.close();

  const preview = gui.addFolder("Preview");
  preview.add(params, "background", ["checker", "dark", "light", "green", "blue"]).onChange(actions.setBackground);
  preview.add(params, "sound").name("preview sound");

  const exp = gui.addFolder("Export");
  exp.add(params, "resolution", Object.keys(RESOLUTIONS)).onChange(re);
  exp.add(params, "fps", [24, 25, 30, 50, 60]);
  exp.add(params, "format", { "ProRes 4444 (.mov)": "prores", "WebM VP9 alpha": "webm", "PNG sequence": "png" });
  exp.add(params, "exportAudio").name("also save score audio (.wav)");
  exp.add(params, "glowLayer").name("glow as separate layer");
  exp.add(params, "exportTrack").name("also save character track (.csv)");
  exp.add({ go: actions.exportVideo }, "go").name("⬇ Export video");

  return {
    setScoreName(name) { scoreInfo.name = name; music.controllers[0].updateDisplay(); },
    refreshBpm() { bpm.updateDisplay(); },
    setCharacterOptions,
    // After settings change in code (loading a look): keep numbers inside each
    // slider's range, then show the new values.
    refreshAll() {
      for (const c of gui.controllersRecursive()) {
        if (typeof c.getValue() === "number" && c._min !== undefined && c._max !== undefined) {
          const v = Math.min(c._max, Math.max(c._min, c.getValue()));
          if (v !== c.getValue()) c.object[c.property] = v;
        }
        c.updateDisplay();
      }
      removeBtn.show(params.character.startsWith("custom-"));
    },
  };
}
