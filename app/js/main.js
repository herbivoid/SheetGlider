import * as THREE from "three";
import GUI from "lil-gui";
import { DEMO, buildScore } from "./score.js";
import { buildSpacing } from "./spacing.js";
import { Ribbon } from "./ribbon.js";
import { RIBBON_PRESETS } from "./presets.js";
import { HEADER_WIDTH, StaffView } from "./staff.js";
import { CharacterView, loadCharacter } from "./character.js";
import { FollowCamera } from "./camera.js";
import { PreviewSynth } from "./audio.js";
import { exportVideo } from "./exporter.js";

const params = {
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
  // Spacing
  quarterWidth: 4.5,
  spacingExponent: 0.65,
  speedSmoothing: 0.75,
  barGap: 1.6,
  accidentalGap: 1.0,
  // Ribbon
  preset: "twist",
  readability: 0.6,
  flipSharpness: 0.2,
  // Motion
  hopHeight: 3,
  hopFraction: 0.6,
  hopMin: 0.08,
  hopMax: 0.42,
  hitHold: 0.16,
  restLift: 2.5,
  restThreshold: 0.35,
  squash: 1,
  lean: 1,
  // Camera
  camDistance: 50,
  fov: 30,
  pitch: 6,
  yaw: 0,
  lead: 0.12,
  followY: 0.35,
  camSmooth: 0.7,
  // Timing
  bpm: DEMO.bpm,
  preroll: 1.5,
  postroll: 2,
  // Preview
  background: "checker",
  sound: true,
  // Export
  resolution: "1920x1080",
  fps: 60,
  format: "prores",
};

const RESOLUTIONS = {
  "1280x720": [1280, 720], "1920x1080": [1920, 1080], "2560x1440": [2560, 1440],
  "3840x2160": [3840, 2160], "1080x1920 (vertical)": [1080, 1920], "1080x1080": [1080, 1080],
};

const canvas = document.getElementById("view");
const frameEl = document.getElementById("frame");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, 16 / 9, 0.5, 2000);
const rig = new FollowCamera(params);
const synth = new PreviewSynth();

let character = null; // loaded pack
let world = null;     // { score, staff, hero, t0, t1 }
let t = 0;
let playing = false;
let playStart = { wall: 0, t: 0 };
let exporting = false;

function exportSize() { return RESOLUTIONS[params.resolution]; }

function rebuild() {
  if (world) {
    scene.remove(world.staff.group, world.hero.mesh);
    world.staff.dispose();
    world.hero.dispose();
  }
  const score = buildScore(DEMO, params.bpm);
  const spacing = buildSpacing(score, {
    quarterWidth: params.quarterWidth, exponent: params.spacingExponent,
    smoothBeats: params.speedSmoothing, barGap: params.barGap, accidentalGap: params.accidentalGap,
  });
  const length = HEADER_WIDTH + spacing.x(score.endBeat) + 3;
  const ribbon = new Ribbon(RIBBON_PRESETS[params.preset](length));
  const staff = new StaffView({ score, spacing, ribbon, params });
  const hero = new CharacterView({
    character, score, spacing, ribbon, params, sOf: beat => staff.sOf(beat),
  });
  scene.add(staff.group, hero.mesh);
  const t0 = -params.preroll;
  const t1 = score.endBeat * score.secondsPerBeat + params.postroll;
  const [w, h] = exportSize();
  rig.bake({ t0, t1, aspect: w / h, ribbon, sEnd: staff.sEnd, positionAt: (tt, v) => hero.positionAt(tt, v) });
  world = { score, staff, hero, t0, t1 };
  t = THREE.MathUtils.clamp(t, t0, t1);
  layout();
}

function renderAt(time) {
  rig.apply(camera, time);
  world.hero.update(time, camera);
  world.staff.update(time, camera);
  renderer.render(scene, camera);
}

// Fit the preview canvas into the stage at the export aspect ratio.
function layout() {
  if (exporting) return;
  const [w, h] = exportSize();
  const stage = document.getElementById("stage");
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const scale = Math.min(availW / w, availH / h);
  const cw = Math.floor(w * scale);
  const ch = Math.floor(h * scale);
  frameEl.style.width = `${cw}px`;
  frameEl.style.height = `${ch}px`;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(cw, ch, false);
  camera.aspect = w / h;
}

// ---- Transport ------------------------------------------------------------
const playBtn = document.getElementById("play");
const scrub = document.getElementById("scrub");
const clock = document.getElementById("clock");

function setPlaying(on) {
  playing = on;
  playBtn.textContent = on ? "❚❚" : "▶";
  if (on) {
    if (t >= world.t1 - 0.01) t = world.t0;
    playStart = { wall: performance.now(), t };
    if (params.sound) synth.play(world.score, t);
  } else {
    synth.stop();
  }
}

playBtn.addEventListener("click", () => setPlaying(!playing));
scrub.addEventListener("input", () => {
  if (playing) setPlaying(false);
  t = world.t0 + (world.t1 - world.t0) * (scrub.value / 10000);
});
window.addEventListener("keydown", e => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    setPlaying(!playing);
  }
});

function fmt(sec) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

function tick() {
  requestAnimationFrame(tick);
  if (!world || exporting) return;
  if (playing) {
    t = playStart.t + (performance.now() - playStart.wall) / 1000;
    if (t >= world.t1) { t = world.t1; setPlaying(false); }
  }
  scrub.value = String(Math.round(((t - world.t0) / (world.t1 - world.t0)) * 10000));
  clock.textContent = fmt(t - world.t0);
  renderAt(t);
}

// ---- Export ---------------------------------------------------------------
const overlay = document.getElementById("export-overlay");
const progressEl = document.getElementById("export-progress");
const detailEl = document.getElementById("export-detail");
const titleEl = document.getElementById("export-title");
const cancelBtn = document.getElementById("export-cancel");
const closeBtn = document.getElementById("export-close");
let cancelRequested = false;
cancelBtn.addEventListener("click", () => { cancelRequested = true; });
closeBtn.addEventListener("click", () => { overlay.hidden = true; });

async function runExport({ from = world.t0, to = world.t1 } = {}) {
  if (exporting) return null;
  setPlaying(false);
  exporting = true;
  cancelRequested = false;
  overlay.hidden = false;
  cancelBtn.hidden = false;
  closeBtn.hidden = true;
  titleEl.textContent = "Exporting…";
  detailEl.textContent = "";
  const [w, h] = exportSize();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const started = performance.now();
  let result = null;
  try {
    result = await exportVideo({
      renderer, width: w, height: h, renderAt, t0: from, t1: to, fps: params.fps, format: params.format, name: world.score.title,
      cancelled: () => cancelRequested,
      onProgress: (done, total) => {
        progressEl.value = done / total;
        const secs = (performance.now() - started) / 1000;
        const eta = (secs / done) * (total - done);
        detailEl.textContent = `Frame ${done} / ${total}  ·  ~${Math.ceil(eta)} s left`;
      },
    });
    titleEl.textContent = result.ok ? "Export finished" : "Export failed";
    detailEl.textContent = result.ok ? `Saved to:\n${result.path}` : result.log;
  } catch (err) {
    titleEl.textContent = err.message === "cancelled" ? "Export cancelled" : "Export failed";
    detailEl.textContent = err.message === "cancelled" ? "" : String(err.message);
  } finally {
    exporting = false;
    cancelBtn.hidden = true;
    closeBtn.hidden = false;
    layout();
  }
  return result;
}

// ---- Settings panel -------------------------------------------------------
function setBackground() {
  frameEl.className = `bg-${params.background}`;
}

function buildGui() {
  const gui = new GUI({ title: "SheetGlider" });
  const re = () => rebuild();

  const look = gui.addFolder("Look");
  look.addColor(params, "staffColor").name("staff color").onChange(c => world.staff.lineMaterial.color.set(c));
  look.addColor(params, "noteColor").name("note color").onFinishChange(re);
  look.addColor(params, "playedColor").name("played note color");
  look.addColor(params, "glowColor").name("hit glow color").onFinishChange(re);
  look.add(params, "characterSize", 1, 8, 0.1).name("character size");
  look.add(params, "glowSize", 0, 10, 0.1).name("glow size");
  look.add(params, "glowStrength", 0, 1, 0.01).name("glow strength");
  look.add(params, "glowDecay", 0.05, 1.5, 0.01).name("glow decay (s)");
  look.add(params, "lineThickness", 0.04, 0.4, 0.01).name("line thickness").onFinishChange(re);

  const ribbon = gui.addFolder("Ribbon");
  ribbon.add(params, "preset", Object.keys(RIBBON_PRESETS)).name("shape").onChange(re);
  ribbon.add(params, "readability", 0, 1, 0.01).name("edge-on readability");
  ribbon.add(params, "flipSharpness", 0.02, 0.6, 0.01).name("flip width");

  const spacing = gui.addFolder("Spacing");
  spacing.add(params, "quarterWidth", 1.5, 10, 0.1).name("quarter note width").onFinishChange(re);
  spacing.add(params, "spacingExponent", 0.3, 1, 0.01).name("time → space exponent").onFinishChange(re);
  spacing.add(params, "speedSmoothing", 0, 4, 0.05).name("speed smoothing (beats)").onFinishChange(re);

  const motion = gui.addFolder("Motion");
  motion.add(params, "hopHeight", 0, 8, 0.1).name("hop height").onFinishChange(re);
  motion.add(params, "hopMax", 0.15, 1, 0.01).name("max hop time (s)").onFinishChange(re);
  motion.add(params, "restLift", 0, 6, 0.1).name("float during rests").onFinishChange(re);
  motion.add(params, "squash", 0, 2, 0.05).name("squash & stretch");
  motion.add(params, "lean", 0, 3, 0.05).name("lean");
  motion.close();

  const cam = gui.addFolder("Camera");
  cam.add(params, "camDistance", 15, 200, 1).name("distance").onFinishChange(re);
  cam.add(params, "fov", 10, 70, 1).name("field of view").onFinishChange(re);
  cam.add(params, "pitch", -45, 60, 1).name("pitch (°)");
  cam.add(params, "yaw", -60, 60, 1).name("yaw (°)");
  cam.add(params, "lead", -0.3, 0.4, 0.01).name("look ahead").onFinishChange(re);
  cam.add(params, "followY", 0, 1, 0.01).name("follow vertically").onFinishChange(re);
  cam.add(params, "camSmooth", 0.1, 3, 0.05).name("responsiveness").onFinishChange(re);
  cam.close();

  const timing = gui.addFolder("Timing");
  timing.add(params, "bpm", 30, 240, 1).onFinishChange(re);
  timing.add(params, "preroll", 0, 5, 0.1).name("lead-in (s)").onFinishChange(re);
  timing.add(params, "postroll", 0, 6, 0.1).name("tail (s)").onFinishChange(re);
  timing.close();

  const preview = gui.addFolder("Preview");
  preview.add(params, "background", ["checker", "dark", "light", "green", "blue"]).onChange(setBackground);
  preview.add(params, "sound").name("preview sound");

  const exp = gui.addFolder("Export");
  exp.add(params, "resolution", Object.keys(RESOLUTIONS)).onChange(re);
  exp.add(params, "fps", [24, 25, 30, 50, 60]);
  exp.add(params, "format", { "ProRes 4444 (.mov)": "prores", "WebM VP9 alpha": "webm", "PNG sequence": "png" });
  exp.add({ go: () => runExport() }, "go").name("⬇ Export video");
}

async function main() {
  character = await loadCharacter("../characters/clawd");
  buildGui();
  setBackground();
  rebuild();
  window.addEventListener("resize", layout);
  // Handle for debugging / scripted exports from the console.
  window.sheetglider = { params, rebuild, runExport, renderAt, get world() { return world; }, get t() { return t; }, set t(v) { t = v; } };
  tick();
}

main().catch(err => {
  document.body.insertAdjacentHTML("beforeend", `<pre style="color:#f88;padding:12px">${err.stack || err}</pre>`);
  console.error(err);
});
