import * as THREE from "three";
import { demoRaw, finalizeScore } from "./score.js";
import { buildSpacing } from "./spacing.js";
import { Ribbon } from "./ribbon.js";
import { buildShape } from "./presets.js";
import { GLOW_LAYER, StaffView, headerLayout } from "./staff.js";
import { measureExtras } from "./engrave.js";
import { CharacterView, loadCharacter } from "./character.js";
import { Particles } from "./particles.js";
import { FollowCamera } from "./camera.js";
import { PreviewSynth } from "./audio.js";
import { exportVideo } from "./exporter.js";
import { loadMusicFont } from "./glyphs.js";
import { params, RESOLUTIONS } from "./params.js";
import { buildGui } from "./gui.js";

const canvas = document.getElementById("view");
const frameEl = document.getElementById("frame");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(params.fov, 16 / 9, 0.5, 4000);
const rig = new FollowCamera(params);
const synth = new PreviewSynth();

let character = null; // loaded character pack
let raw = demoRaw();  // the current score, before tempo scaling
let world = null;     // { score, staff, hero, particles, t0, t1 }
let panel = null;
let t = 0;
let playing = false;
let playStart = { wall: 0, t: 0 };
let exporting = false;

const exportSize = () => RESOLUTIONS[params.resolution];
const rawBpm = () => raw.tempo?.[0]?.bpm ?? 120;

function rebuild() {
  if (world) {
    scene.remove(world.staff.group, world.hero.group, world.particles.points);
    world.staff.dispose();
    world.hero.dispose();
    world.particles.dispose();
  }
  const score = finalizeScore(raw, params.bpm / rawBpm());
  const extras = measureExtras(score, params);
  const spacing = buildSpacing(score, {
    quarterWidth: params.quarterWidth, exponent: params.spacingExponent,
    smoothBeats: params.speedSmoothing, extras: extras.extras,
  });
  const length = headerLayout(score).width + spacing.x(score.endBeat) + 3;
  const ribbon = new Ribbon(buildShape(params.preset, length, params));
  const staff = new StaffView({ score, spacing, ribbon, params, extras });
  const sOf = beat => staff.sOf(beat);
  const follow = params.follow === "top" || params.follow < score.staves.length ? params.follow : 0;
  const hero = new CharacterView({ character, score, ribbon, params, sOf, follow });
  const particles = new Particles({ hero, ribbon, score, params, sOf });
  scene.add(staff.group, hero.group, particles.points);
  const t0 = -params.preroll;
  const t1 = score.timeOf(score.endBeat) + params.postroll;
  const [w, h] = exportSize();
  const vRange = [staff.staffCenter(score.staves.length - 1) - 3, 3];
  rig.bake({ t0, t1, aspect: w / h, ribbon, sEnd: staff.sEnd, vRange, positionAt: (tt, v) => hero.positionAt(tt, v) });
  world = { score, staff, hero, particles, t0, t1 };
  t = THREE.MathUtils.clamp(t, t0, t1);
  layout();
}

// mode: "all" (preview, or export with glow baked in), "main" (everything but
// the glow and sparks), "glow" (only the glow and sparks, as additive light on
// opaque black).
function renderAt(time, mode = "all") {
  rig.apply(camera, time);
  world.hero.update(time, camera);
  world.staff.update(time, camera);
  world.particles.update(time);
  camera.layers.set(0);
  if (mode === "all") camera.layers.enable(GLOW_LAYER);
  if (mode === "glow") {
    camera.layers.set(GLOW_LAYER);
    renderer.setClearColor(0x000000, 1);
    world.staff.setGlowAdditive(true);
    world.particles.setAdditive(true);
  }
  renderer.render(scene, camera);
  if (mode === "glow") {
    renderer.setClearColor(0x000000, 0);
    world.staff.setGlowAdditive(false);
    world.particles.setAdditive(false);
  }
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

// ---- Messages -------------------------------------------------------------
const toast = document.getElementById("toast");
let toastTimer = 0;
function notify(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? "error" : "";
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 9000 : 5000);
}

// ---- Loading scores -------------------------------------------------------
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".musicxml,.xml,.mxl";
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadScoreFile(fileInput.files[0]);
  fileInput.value = "";
});

let lastFile = null; // re-read when the repeats setting changes

async function loadScoreFile(file) {
  notify(`Reading ${file.name}…`);
  try {
    const query = `name=${encodeURIComponent(file.name)}&repeats=${params.repeats ? 1 : 0}`;
    const res = await fetch(`/api/parse?${query}`, { method: "POST", body: file });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    if (!data.notes.length) throw new Error("no notes found in this file");
    lastFile = file;
    useScore(data);
    notify([`Loaded “${data.title}”.`, ...(data.warnings ?? [])].join(" "));
  } catch (err) {
    notify(`Couldn't load ${file.name}: ${err.message}`, true);
  }
}

function useScore(newRaw) {
  if (playing) setPlaying(false);
  raw = newRaw;
  params.bpm = Math.round(rawBpm());
  panel.refreshBpm();
  panel.setScoreName(raw.title);
  t = -params.preroll;
  rebuild();
}

window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadScoreFile(file);
});

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
  const layers = params.glowLayer
    ? [{ suffix: "", render: tt => renderAt(tt, "main") }, { suffix: "_glow", render: tt => renderAt(tt, "glow"), opaque: true }]
    : [{ suffix: "", render: tt => renderAt(tt, "all") }];
  let results = null;
  try {
    results = await exportVideo({
      renderer, width: w, height: h, layers, t0: from, t1: to, fps: params.fps, format: params.format,
      name: world.score.title, cancelled: () => cancelRequested,
      onProgress: (done, total) => {
        progressEl.value = done / total;
        const secs = (performance.now() - started) / 1000;
        const eta = (secs / done) * (total - done);
        detailEl.textContent = `Frame ${done} / ${total}  ·  ~${Math.ceil(eta)} s left`;
      },
    });
    const ok = results.every(r => r.ok);
    const lines = results.map((r, i) => (r.ok ? `${i ? "Glow layer" : "Saved to"}:\n${r.path}` : r.log));
    if (ok && params.exportAudio) {
      detailEl.textContent = "Rendering audio…";
      const wav = await synth.renderWav(world.score, from, to);
      const res = await fetch(`/api/export/audio?video=${encodeURIComponent(results[0].path)}`, { method: "POST", body: wav });
      const saved = await res.json();
      lines.push(saved.error ? `Audio failed: ${saved.error}` : `Audio:\n${saved.path}`);
    }
    const secs = (performance.now() - started) / 1000;
    titleEl.textContent = ok ? `Export finished in ${secs.toFixed(0)} s` : "Export failed";
    detailEl.textContent = lines.join("\n\n");
  } catch (err) {
    titleEl.textContent = err.message === "cancelled" ? "Export cancelled" : "Export failed";
    detailEl.textContent = err.message === "cancelled" ? "" : String(err.message);
  } finally {
    exporting = false;
    cancelBtn.hidden = true;
    closeBtn.hidden = false;
    layout();
  }
  return results;
}

// ---- Startup --------------------------------------------------------------
function setBackground() {
  frameEl.className = `bg-${params.background}`;
}

async function main() {
  await loadMusicFont();
  character = await loadCharacter("../characters/clawd");
  params.bpm = Math.round(rawBpm());
  panel = buildGui(params, {
    rebuild,
    setBackground,
    loadFile: () => fileInput.click(),
    useDemo: () => { lastFile = null; useScore(demoRaw()); notify("Using the demo melody."); },
    reloadFile: () => { if (lastFile) loadScoreFile(lastFile); },
    exportVideo: () => runExport(),
    restyleStaff: c => world.staff.lineMaterial.color.set(c),
  });
  panel.setScoreName(raw.title);
  setBackground();
  rebuild();
  window.addEventListener("resize", layout);
  // Handle for debugging / scripted exports from the console.
  window.sheetglider = {
    params, rebuild, runExport, renderAt, useScore,
    get world() { return world; }, get t() { return t; }, set t(v) { t = v; },
  };
  tick();
}

main().catch(err => {
  document.body.insertAdjacentHTML("beforeend", `<pre style="color:#f88;padding:12px">${err.stack || err}</pre>`);
  console.error(err);
});
