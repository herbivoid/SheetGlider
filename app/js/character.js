import * as THREE from "three";
import { placeQuad, quadAxes } from "./facing.js";
import { makeFrame } from "./ribbon.js";
import { monotoneCubic } from "./util.js";

// A character pack is a folder with character.json and up to 6 sprites:
//   glide  in the air between notes, and standing on short notes
//   crouch just before a jump, and absorbing a landing
//   hit    landing on a long note (a little celebration)
//   ride   holding a long note
//   rest   floating during rests
//   surf   gliding through a fast run
// Missing sprites fall back (surf -> ride -> glide, others -> glide), so even a
// single image works; most of the life comes from the procedural motion below.

const STATES = ["glide", "crouch", "hit", "ride", "rest", "surf"];
const FALLBACK = { surf: "ride", crouch: "glide", hit: "glide", ride: "glide", rest: "glide" };
const ALIASES = { crouch: "anticipate" }; // older packs

export async function loadCharacter(baseUrl) {
  const def = await (await fetch(`${baseUrl}/character.json`)).json();
  const loader = new THREE.TextureLoader();
  const textures = {};
  for (const state of STATES) {
    const file = def.sprites?.[state] ?? def.sprites?.[ALIASES[state]];
    if (!file) continue;
    const tex = await loader.loadAsync(`${baseUrl}/${file}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (def.pixelArt) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    textures[state] = tex;
  }
  textures.glide ??= Object.values(textures)[0];
  const resolve = s => textures[s] ?? resolve(FALLBACK[s] ?? "glide");
  for (const state of STATES) textures[state] = resolve(state);
  return { def, textures };
}

const smooth01 = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const easeInOut = u => 0.5 - 0.5 * Math.cos(Math.PI * u);

export class CharacterView {
  constructor({ character, score, ribbon, params, sOf, follow }) {
    Object.assign(this, { character, score, ribbon, params, sOf });
    this.targets = pickTargets(score, follow ?? params.follow);
    this.runs = findRuns(this.targets, params.fastNote, params.minRunNotes);
    for (const run of this.runs) {
      const pts = this.targets.slice(run.a, run.b + 1);
      run.t0 = pts[0].on;
      run.t1 = pts[pts.length - 1].on;
      run.curve = monotoneCubic(pts.map(n => n.on), pts.map(n => n.p));
      for (let k = run.a; k < run.b; k++) this.targets[k].run = run;
    }

    this.material = new THREE.MeshBasicMaterial({
      map: character.textures.glide, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
    this.frame = makeFrame();
  }

  // Landings that get a particle burst (not the notes surfed through mid-run).
  landings() {
    return this.targets.filter(n => !n.run);
  }

  // Vertical position (half-spaces from the middle line) and sprite state at time t.
  motion(t) {
    const P = this.params;
    const T = this.targets;
    if (!T.length) return { p: 0, state: "rest", landed: -1 };

    // Index of the last note that has started.
    let lo = -1;
    let hi = T.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (T[mid].on <= t) lo = mid; else hi = mid - 1;
    }

    if (lo < 0) {
      // Before the first note: drift in from above.
      const first = T[0];
      const hop = P.hopMax;
      const from = first.p + P.restLift * 2;
      if (t < first.on - hop) return { p: from + this.bob(t), state: "rest", landed: -1 };
      const u = (t - (first.on - hop)) / hop;
      return { p: from + (first.p - from) * easeInOut(u), state: "glide", landed: -1 };
    }

    const cur = T[lo];
    if (cur.run) {
      // Surfing a fast run: one smooth curve through all its notes, no hops.
      return { p: cur.run.curve(t), state: "surf", landed: -1, surfing: true };
    }

    const next = T[lo + 1];
    const landed = cur.on;
    const gap = next ? next.on - cur.on : Infinity;
    const hop = next ? THREE.MathUtils.clamp(gap * P.hopFraction, P.hopMin, P.hopMax) : 0;
    const takeoff = next ? next.on - hop : Infinity;
    const restStart = cur.end + 0.05;
    const resting = takeoff - restStart > P.restThreshold;
    const lift = tt => (resting ? P.restLift * smooth01(restStart, restStart + 0.35, tt) : 0);

    if (t < takeoff) {
      const stand = takeoff - cur.on;
      const long = cur.end - cur.on >= P.cheerMin;
      const hitHold = long ? Math.min(0.4, stand * 0.5) : Math.min(0.12, stand * 0.4);
      // Skip the crouch sprites when there's barely time to stand: squash does the job.
      const crouchOk = stand > 0.16;
      let state = long ? "ride" : "glide";
      if (t < cur.on + hitHold) state = long ? "hit" : crouchOk ? "crouch" : "glide";
      else if (resting && t > restStart) state = "rest";
      const antic = crouchOk && next ? Math.min(0.1, gap * 0.25) : 0;
      if (t > takeoff - antic && state !== "hit") state = "crouch";
      const l = lift(t);
      return {
        p: cur.p + l + (l > 0 ? this.bob(t) * (l / P.restLift) : 0),
        state, landed, takeoff, crouching: state === "crouch" && t > takeoff - antic,
      };
    }

    // In the air between cur and next.
    const u = (t - takeoff) / hop;
    const from = cur.p + lift(takeoff) + (resting ? this.bob(takeoff) : 0);
    const arc = P.hopHeight * Math.pow(hop / P.hopMax, 0.7) * smooth01(0.06, 0.2, hop);
    const p = from + (next.p - from) * easeInOut(u) + arc * 4 * u * (1 - u);
    return { p, state: "glide", landed, takeoff };
  }

  bob(t) { return 0.35 * Math.sin(t * Math.PI * 1.6); }

  update(t, camera) {
    const P = this.params;
    const m = this.motion(t);
    const dt = 1 / 240;
    const vel = (this.motion(t + dt).p - this.motion(t - dt).p) / (2 * dt); // half-spaces per second

    // Squash & stretch
    let sx = 1;
    let sy = 1;
    if (m.landed >= 0 && t >= m.landed) {
      const e = Math.exp(-(t - m.landed) / 0.07);
      sy *= 1 - 0.28 * P.squash * e;
      sx *= 1 + 0.22 * P.squash * e;
    }
    if (m.state === "glide" && m.takeoff !== undefined && t >= m.takeoff) {
      const stretch = 1 + Math.min(0.2, Math.abs(vel) * 0.006) * P.squash;
      sy *= stretch;
      sx /= Math.sqrt(stretch);
    }
    if (m.crouching) {
      const w = smooth01(m.takeoff - 0.1, m.takeoff, t);
      sy *= 1 - 0.15 * w * P.squash;
      sx *= 1 + 0.1 * w * P.squash;
    }
    let tilt = THREE.MathUtils.clamp(vel * 0.012 * P.lean, -0.4, 0.4);
    if (m.surfing) tilt = THREE.MathUtils.clamp(vel * 0.02 * P.lean, -0.5, 0.5) - P.surfLean;

    this.material.map = this.character.textures[m.state];

    const s = this.sOf(this.score.beatAt(t));
    this.ribbon.frameAt(s, this.frame);
    const at = new THREE.Vector3().copy(this.frame.P).addScaledVector(this.frame.U, m.p / 2);
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    quadAxes(camera, at, this.frame.T, this.frame.U, 1, P.flipSharpness, X, Y, tilt);

    // Stand on top of the notehead, nudged toward the camera so lines don't cut through.
    at.addScaledVector(Y, 0.45);
    const toCam = new THREE.Vector3().subVectors(camera.position, at).normalize();
    at.addScaledVector(toCam, 0.4);

    const tex = this.material.map.image;
    const aspect = tex ? tex.width / tex.height : 1;
    const h = P.characterSize * sy;
    const w = P.characterSize * aspect * sx;
    const [ax, ay] = this.character.def.anchor ?? [0.5, 0];
    placeQuad(this.mesh, at, X, Y, w, h, ax, ay, camera);
  }

  // World position of the character's feet at time t (for the camera and particles).
  positionAt(t, target = new THREE.Vector3()) {
    const s = this.sOf(this.score.beatAt(t));
    return this.ribbon.pointAt(s, this.motion(t).p / 2, target);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// The notes the character lands on: one per onset, from the followed staff
// (or the highest note overall). Tied continuations aren't re-landed.
function pickTargets(score, follow) {
  const byOnset = new Map();
  for (const n of score.notes) {
    if (n.tieFromPrev) continue;
    if (follow !== "top" && n.staff !== follow) continue;
    const prev = byOnset.get(n.start);
    if (!prev || n.pos + n.staff * -20 > prev.pos + prev.staff * -20) byOnset.set(n.start, n);
  }
  return [...byOnset.values()]
    .sort((a, b) => a.start - b.start)
    .map(n => ({
      on: score.timeOf(n.start),
      end: score.timeOf(n.start + n.soundingDur),
      p: n.pos - n.staff * 20, // staff 1 sits 10 spaces (20 half-spaces) below staff 0
    }));
}

// Runs: at least `minNotes` notes in a row, each starting less than `fast` seconds after the previous.
function findRuns(targets, fast, minNotes) {
  const runs = [];
  let a = 0;
  for (let i = 1; i <= targets.length; i++) {
    const isFast = i < targets.length && targets[i].on - targets[i - 1].on < fast;
    if (!isFast) {
      if (i - a >= minNotes) runs.push({ a, b: i - 1 });
      a = i;
    }
  }
  return runs;
}

