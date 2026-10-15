import * as THREE from "three";
import { placeQuad, quadAxes } from "./facing.js";
import { makeFrame } from "./ribbon.js";

// A character pack is a folder with character.json and up to 5 sprites:
//   glide (in the air), anticipate (crouch before a jump), hit (landing),
//   ride (holding a long note), rest (floating during rests).
// Missing sprites fall back to "glide". Most of the life comes from the
// procedural motion below (hops, squash & stretch, lean), so even a single
// image works.

const STATES = ["glide", "anticipate", "hit", "ride", "rest"];

export async function loadCharacter(baseUrl) {
  const def = await (await fetch(`${baseUrl}/character.json`)).json();
  const loader = new THREE.TextureLoader();
  const textures = {};
  for (const state of STATES) {
    const file = def.sprites?.[state];
    if (!file) continue;
    const tex = await loader.loadAsync(`${baseUrl}/${file}`);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (def.pixelArt) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    textures[state] = tex;
  }
  if (!textures.glide) textures.glide = Object.values(textures)[0];
  for (const state of STATES) textures[state] ??= textures.glide;
  return { def, textures };
}

const smooth01 = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const easeInOut = u => 0.5 - 0.5 * Math.cos(Math.PI * u);

export class CharacterView {
  constructor({ character, score, spacing, ribbon, params, sOf }) {
    Object.assign(this, { character, score, spacing, ribbon, params, sOf });
    const spb = score.secondsPerBeat;
    // Phase 0 follows the top note of staff 0 at each onset (the melody).
    const byOnset = new Map();
    for (const n of score.notes) {
      if (n.staff !== 0) continue;
      const prev = byOnset.get(n.start);
      if (!prev || n.pos > prev.pos) byOnset.set(n.start, n);
    }
    this.targets = [...byOnset.values()]
      .sort((a, b) => a.start - b.start)
      .map(n => ({ on: n.start * spb, end: (n.start + n.dur) * spb, p: n.pos }));

    this.material = new THREE.MeshBasicMaterial({
      map: character.textures.glide, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
    this.frame = makeFrame();
  }

  // Vertical position (half-spaces from the middle line) and sprite state at time t.
  motion(t) {
    const P = this.params;
    const T = this.targets;
    if (!T.length) return { p: 0, state: "rest", landed: -1, takeoff: Infinity, hop: 0 };

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
      if (t < first.on - hop) return { p: from + this.bob(t), state: "rest", landed: -1, takeoff: first.on - hop, hop };
      const u = (t - (first.on - hop)) / hop;
      return { p: from + (first.p - from) * easeInOut(u), state: "glide", landed: -1, takeoff: first.on - hop, hop };
    }

    const cur = T[lo];
    const next = T[lo + 1];
    const gap = next ? next.on - cur.on : Infinity;
    const hop = next ? THREE.MathUtils.clamp(gap * P.hopFraction, P.hopMin, P.hopMax) : 0;
    const takeoff = next ? next.on - hop : Infinity;
    const restStart = cur.end + 0.05;
    const resting = takeoff - restStart > P.restThreshold;
    const lift = t => (resting ? P.restLift * smooth01(restStart, restStart + 0.35, t) : 0);

    if (t < takeoff) {
      const hitHold = Math.min(P.hitHold, gap * 0.45);
      const antic = gap > 0.25 ? Math.min(0.1, gap * 0.25) : 0;
      let state = "ride";
      if (t < cur.on + hitHold) state = "hit";
      else if (resting && t > restStart) state = "rest";
      if (t > takeoff - antic && state !== "hit") state = "anticipate";
      const l = lift(t);
      return { p: cur.p + l + (l > 0 ? this.bob(t) * (l / P.restLift) : 0), state, landed: cur.on, takeoff, hop, gap };
    }

    // In the air between cur and next.
    const u = (t - takeoff) / hop;
    const from = cur.p + lift(takeoff) + (resting ? this.bob(takeoff) : 0);
    const arc = P.hopHeight * Math.pow(hop / P.hopMax, 0.7) * smooth01(0.06, 0.2, hop);
    const p = from + (next.p - from) * easeInOut(u) + arc * 4 * u * (1 - u);
    return { p, state: "glide", landed: cur.on, takeoff, hop, gap };
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
    if (m.state === "glide") {
      const stretch = 1 + Math.min(0.2, Math.abs(vel) * 0.006) * P.squash;
      sy *= stretch;
      sx /= Math.sqrt(stretch);
    }
    if (m.state === "anticipate") {
      const w = smooth01(m.takeoff - 0.1, m.takeoff, t);
      sy *= 1 - 0.15 * w * P.squash;
      sx *= 1 + 0.1 * w * P.squash;
    }
    const tilt = THREE.MathUtils.clamp(vel * 0.012 * P.lean, -0.4, 0.4);

    this.material.map = this.character.textures[m.state];

    const beat = t / this.score.secondsPerBeat;
    const s = this.sOf(beat);
    const v = m.p / 2;
    this.ribbon.frameAt(s, this.frame);
    const at = new THREE.Vector3().copy(this.frame.P).addScaledVector(this.frame.U, v);
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
    this.last = { state: m.state, at };
  }

  // World position of the character at time t (for the camera rig).
  positionAt(t, target = new THREE.Vector3()) {
    const s = this.sOf(t / this.score.secondsPerBeat);
    return this.ribbon.pointAt(s, this.motion(t).p / 2, target);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
